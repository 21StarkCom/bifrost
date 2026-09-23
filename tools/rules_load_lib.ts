/**
 * rules_load_lib.ts — how Claude Code and Codex decide which instruction files
 * load, emulated for `rules_audit_lib.ts`.
 *
 * - Claude Code rule frontmatter: the fence regex, a YAML 1.2 subset, the one
 *   quoting retry the loader makes when YAML throws, and the `paths` value
 *   normalization (comma split, brace expansion, one trailing `/**` stripped).
 *   Anything that does not parse, or normalizes to nothing or to `**`, loads
 *   the rule into every session.
 * - Claude Code's glob matcher: gitignore semantics, case-insensitive, relative
 *   to the directory that owns the `.claude/` holding the rule.
 * - Claude Code's `@import` scanner.
 * - Codex's AGENTS.md chain and its `project_doc_max_bytes` budget.
 *
 * Measured against LOAD_MODEL. Loader behaviour is not a stable contract:
 * re-measure after a `claude` or `codex` upgrade and update the fixtures in
 * `rules_load_lib.test.ts` with what the live run shows.
 *
 * Pure: no I/O.
 */

export const LOAD_MODEL = "Claude Code 2.1.280; Codex openai/codex@7342991f";

// ── A YAML 1.2 subset ─────────────────────────────────────────────────────
// Rule frontmatter is a handful of `key: value` lines. This parser covers the
// block map / block list / flow list / scalar shapes rules use, fails where the
// real parser fails on them, and refuses (Undecidable) anything richer —
// anchors, tags with values, block scalars, nested collections.

export type Yaml = string | number | boolean | null | Yaml[] | { [k: string]: Yaml };

export class YamlError extends Error {}
export class Undecidable extends Error {}

function stripComment(s: string): string {
  const i = s.search(/(?:^|[ \t])#/);
  return i < 0 ? s : s.slice(0, i);
}

function parseQuoted(s: string): { value: string; rest: string } {
  const q = s[0];
  let out = "";
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (q === "'" && c === "'") {
      if (s[i + 1] === "'") {
        out += "'";
        i++;
        continue;
      }
      return { value: out, rest: s.slice(i + 1) };
    }
    if (q === '"' && c === "\\") {
      const n = s[++i];
      out += n === "n" ? "\n" : n === "t" ? "\t" : n ?? "";
      continue;
    }
    if (q === '"' && c === '"') return { value: out, rest: s.slice(i + 1) };
    out += c;
  }
  throw new YamlError("unterminated quoted scalar");
}

function resolvePlain(s: string): Yaml {
  if (/^(?:null|Null|NULL|~|)$/.test(s)) return null;
  if (/^(?:true|True|TRUE)$/.test(s)) return true;
  if (/^(?:false|False|FALSE)$/.test(s)) return false;
  if (/^[-+]?(?:\d+|0x[0-9a-fA-F]+|0o[0-7]+)$/.test(s)) return Number(s);
  if (/^[-+]?(?:\.\d+|\d+(?:\.\d*)?)(?:[eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}

function parseFlowSeq(s: string): { value: Yaml[]; rest: string } {
  const items: Yaml[] = [];
  let i = 1;
  for (;;) {
    while (s[i] === " " || s[i] === "\t") i++;
    if (i >= s.length) throw new YamlError("unterminated flow sequence");
    if (s[i] === "]") return { value: items, rest: s.slice(i + 1) };
    const c = s[i];
    if (c === "[" || c === "{") throw new Undecidable("nested flow collection");
    if (c === '"' || c === "'") {
      const q = parseQuoted(s.slice(i));
      items.push(q.value);
      i = s.length - q.rest.length;
    } else {
      if (/[*&!|>%@`]/.test(c)) {
        if (c === "&" || c === "!") throw new Undecidable("anchor or tag in flow sequence");
        throw new YamlError(`plain scalar cannot start with ${c}`);
      }
      let j = i;
      while (j < s.length && s[j] !== "," && s[j] !== "]") j++;
      items.push(resolvePlain(s.slice(i, j).trim()));
      i = j;
    }
    while (s[i] === " " || s[i] === "\t") i++;
    if (s[i] === ",") i++;
    else if (s[i] !== "]") throw new YamlError("expected , or ] in flow sequence");
  }
}

/** One inline value: after `key:` or `- `. */
export function parseInlineValue(raw: string): Yaml {
  const s = raw.replace(/^[ \t]+/, "");
  if (s === "") return null;
  const c = s[0];
  const tail = (rest: string) => {
    if (stripComment(rest).trim() !== "") throw new YamlError("trailing content after value");
  };
  if (c === '"' || c === "'") {
    const q = parseQuoted(s);
    tail(q.rest);
    return q.value;
  }
  if (c === "[") {
    const f = parseFlowSeq(s);
    tail(f.rest);
    return f.value;
  }
  if (c === "{") {
    const close = s.indexOf("}");
    if (close >= 0 && stripComment(s.slice(close + 1)).trim() !== "") throw new YamlError("trailing content after flow map");
    throw new Undecidable("flow mapping");
  }
  if (c === "*") throw new YamlError("unresolved alias");
  if (c === "&") throw new Undecidable("anchor");
  if (c === "!") {
    if (/^!\S*$/.test(stripComment(s).trim())) return null;
    throw new Undecidable("tagged value");
  }
  if (c === "|" || c === ">") throw new Undecidable("block scalar");
  if (c === "%" || c === "@" || c === "`") throw new YamlError(`plain scalar cannot start with ${c}`);
  if (/^[-?:](?:[ \t]|$)/.test(s)) throw new YamlError("unexpected indicator");
  const plain = stripComment(s).trim();
  if (/:(?:[ \t]|$)/.test(plain)) throw new YamlError("mapping values are not allowed here");
  return resolvePlain(plain);
}

function parseKey(line: string): { key: string; rest: string } | null {
  let key: string;
  let rest: string;
  if (line[0] === '"' || line[0] === "'") {
    const q = parseQuoted(line);
    key = q.value;
    rest = q.rest.replace(/^[ \t]*/, "");
  } else {
    const m = /^([^:#]*?)[ \t]*:(?=[ \t]|$)(.*)$/.exec(line);
    if (!m) return null;
    key = m[1];
    rest = ":" + m[2];
  }
  if (!rest.startsWith(":")) return null;
  return { key, rest: rest.slice(1) };
}

export function parseYaml(text: string): Yaml {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const content = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.trim() !== "" && !/^[ \t]*#/.test(l));
  if (content.length === 0) return null;
  for (const { l } of content) {
    if (/^ *\t/.test(l)) throw new YamlError("tab in indentation");
    if (/^(?:---|\.\.\.)(?:\s|$)/.test(l)) throw new Undecidable("document marker");
  }
  if (/^- |^-$/.test(content[0].l)) return content.map(() => null);
  const map: { [k: string]: Yaml } = {};
  let k = 0;
  while (k < content.length) {
    const { l } = content[k];
    if (/^\s/.test(l)) throw new YamlError("unexpected indentation");
    const kv = parseKey(l);
    if (!kv) throw new YamlError("expected a key");
    k++;
    const child: string[] = [];
    while (k < content.length && /^\s/.test(content[k].l)) child.push(content[k++].l);
    if (kv.rest.trim() !== "" && stripComment(kv.rest).trim() !== "") {
      if (child.length) {
        if (/^[&!|>]/.test(kv.rest.trim())) throw new Undecidable("anchor, tag or block scalar on a block");
        throw new YamlError("value and indented block");
      }
      map[kv.key] = parseInlineValue(kv.rest);
      continue;
    }
    if (!child.length) {
      map[kv.key] = null;
      continue;
    }
    const indent = /^ */.exec(child[0])![0].length;
    if (child.some((c) => /^ */.exec(c)![0].length !== indent)) throw new Undecidable("nested block");
    if (child.every((c) => /^ *-(?:[ \t]|$)/.test(c))) {
      map[kv.key] = child.map((c) => {
        const item = c.replace(/^ *-/, "");
        if (parseKeyish(item)) throw new Undecidable("map inside a list");
        return parseInlineValue(item);
      });
      continue;
    }
    if (child.some((c) => /^ *-(?:[ \t]|$)/.test(c))) throw new YamlError("mixed block");
    const sub: { [k: string]: Yaml } = {};
    for (const c of child) {
      const ckv = parseKey(c.trimStart());
      if (!ckv) throw new YamlError("expected a key");
      sub[ckv.key] = parseInlineValue(ckv.rest);
    }
    map[kv.key] = sub;
  }
  return map;
}

function parseKeyish(item: string): boolean {
  const t = item.trim();
  return /^[^"'[{*&!|>%@`#][^:]*:(?:[ \t]|$)/.test(t);
}

/** Claude Code's second attempt after a YAML failure: on each LF line shaped
 *  `key: value` whose unquoted value holds a YAML-special character, quote the
 *  whole rest of the line; turn each leading tab into two spaces. A CRLF line
 *  never matches (`.` stops at `\r`), so a CRLF file gets no rescue. */
export function retryRewrite(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      let out = line;
      const m = /^([a-zA-Z_-]+):\s+(.+)$/.exec(line);
      if (m) {
        const value = m[2];
        let flow = false;
        if (value.startsWith("[")) {
          try {
            flow = Array.isArray(parseInlineValue(value));
          } catch {
            flow = false;
          }
        }
        if (!/^["']/.test(value) && !flow && (/[{}[\]*&#!|>%@`]/.test(value) || value.includes(": "))) {
          out = `${m[1]}: "${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
        }
      }
      return out.replace(/^\t+/, (t) => "  ".repeat(t.length));
    })
    .join("\n");
}

// ── Rule frontmatter → load scope ─────────────────────────────────────────

const FENCE_RE = /^---\s*\n([\s\S]*?)---\s*\n?/;
/** Keys other rule systems use for scoping; Claude Code reads only `paths`. */
const FOREIGN_KEYS = ["Paths", "PATHS", "path", "globs", "glob", "applyTo", "alwaysApply", "trigger", "inclusion", "fileMatchPattern", "files", "include"];

export type AlwaysReason =
  | "no-frontmatter"
  | "fence-not-at-start"
  | "parse-failed"
  | "not-a-map"
  | "no-paths-key"
  | "foreign-key"
  | "empty-or-universal";

export interface Pattern {
  /** The normalized pattern Claude Code matches with. */
  pattern: string;
  /** The value as written, before splitting and brace expansion. */
  source: string;
  /** 1-indexed line of `source` in the file. */
  line: number;
}

export type Scope =
  | { kind: "scoped"; patterns: Pattern[]; retried: boolean }
  | { kind: "always"; reason: AlwaysReason; detail: string; intendedScope: boolean; line: number }
  | { kind: "undecidable"; detail: string; line: number };

export interface Frontmatter {
  /** Byte length of the matched fence block (0 when none). */
  length: number;
  /** 1-indexed line the body starts on. */
  bodyLine: number;
  yaml: string | null;
}

export function readFrontmatter(raw: string): Frontmatter {
  const text = raw.replace(/^﻿/, "");
  const m = FENCE_RE.exec(text);
  if (!m) return { length: 0, bodyLine: 1, yaml: null };
  return { length: m[0].length, bodyLine: m[0].split("\n").length - (m[0].endsWith("\n") ? 0 : 1), yaml: m[1] };
}

/** Split on commas outside `{…}`. */
export function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "{") depth++;
    if (ch === "}") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const BRACE_BUDGET = 1000;

/** Expands the first `{…}` group (up to the first `}`), left to right. Nested
 *  groups are not supported by the loader and come out mangled the same way. */
export function expandBraces(patterns: string[]): string[] {
  const out: string[] = [];
  let budget = BRACE_BUDGET;
  for (const p of patterns) {
    if (!/\{[^}]*\}/.test(p)) {
      out.push(p);
      continue;
    }
    const expanded: string[] = [];
    let over = false;
    const expand = (cur: string) => {
      if (over) return;
      const m = /\{([^}]*)\}/.exec(cur);
      if (!m) {
        expanded.push(cur);
        if (expanded.length > budget) over = true;
        return;
      }
      const pre = cur.slice(0, m.index);
      const post = cur.slice(m.index + m[0].length);
      for (const alt of m[1].split(",")) expand(pre + alt + post);
    };
    expand(p);
    if (over) out.push(p);
    else {
      budget -= expanded.length;
      out.push(...expanded);
    }
  }
  return out;
}

function flatStrings(v: Yaml): string[] {
  if (Array.isArray(v)) return v.flatMap(flatStrings);
  return typeof v === "string" ? [v] : [];
}

export function normalizePaths(value: Yaml): { pattern: string; source: string }[] {
  const out: { pattern: string; source: string }[] = [];
  for (const source of flatStrings(value)) {
    const parts = splitTopLevelCommas(source).map((s) => s.trim());
    for (const p of expandBraces(parts)) {
      const q = p.endsWith("/**") ? p.slice(0, -3) : p;
      if (q) out.push({ pattern: q, source });
    }
  }
  return out;
}

function lineOf(raw: string, needle: string, from: number, to: number): number {
  const lines = raw.split("\n");
  for (let i = from; i < Math.min(to, lines.length); i++) if (lines[i].includes(needle)) return i + 1;
  return from + 1;
}

/** How Claude Code loads one `.claude/rules` file. */
export function classifyRule(raw: string): Scope {
  const text = raw.replace(/^﻿/, "");
  const fm = readFrontmatter(raw);
  const pathsLine = (() => {
    const i = text.split("\n").findIndex((l, n) => n < 40 && /^\s*["']?paths["']?\s*:/.test(l));
    return i < 0 ? 0 : i + 1;
  })();
  if (fm.yaml === null) {
    const looksFenced = /^\s*-{3,}\s*$/m.test(text.split("\n").slice(0, 3).join("\n"));
    if (looksFenced && pathsLine) {
      return {
        kind: "always", reason: "fence-not-at-start", intendedScope: true, line: 1,
        detail: "the frontmatter fence is not a bare `---` at the first byte, or never closes, so the header is read as body text",
      };
    }
    return { kind: "always", reason: "no-frontmatter", intendedScope: false, line: 1, detail: "no frontmatter" };
  }
  let parsed: Yaml;
  let retried = false;
  try {
    parsed = parseYaml(fm.yaml);
  } catch (e) {
    if (e instanceof Undecidable) return { kind: "undecidable", detail: e.message, line: 1 };
    try {
      retried = true;
      parsed = parseYaml(retryRewrite(fm.yaml));
    } catch (e2) {
      if (e2 instanceof Undecidable) return { kind: "undecidable", detail: e2.message, line: 1 };
      return {
        kind: "always", reason: "parse-failed", intendedScope: pathsLine > 0, line: pathsLine || 1,
        detail: `the frontmatter is not valid YAML (${(e as Error).message}), so the loader drops it`,
      };
    }
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    return { kind: "always", reason: "not-a-map", intendedScope: pathsLine > 0, line: 1, detail: "the frontmatter is not a key/value map" };
  }
  if (!("paths" in parsed)) {
    const foreign = FOREIGN_KEYS.find((k) => k in parsed);
    if (foreign) {
      return {
        kind: "always", reason: "foreign-key", intendedScope: true, line: lineOf(raw, foreign, 0, fm.bodyLine),
        detail: `it scopes with \`${foreign}:\`, which Claude Code ignores; only the exact key \`paths\` scopes a rule`,
      };
    }
    return { kind: "always", reason: "no-paths-key", intendedScope: false, line: 1, detail: "no `paths:` key" };
  }
  const norm = normalizePaths(parsed.paths);
  if (norm.length === 0 || norm.every((n) => n.pattern === "**")) {
    return {
      kind: "always", reason: "empty-or-universal", intendedScope: true, line: pathsLine || 1,
      detail: norm.length === 0
        ? "`paths:` holds no string pattern (empty, null, a number, a map), which the loader treats as no scope"
        : "`paths:` is only `**`, which the loader treats as no scope",
    };
  }
  const lines = raw.split("\n");
  const from = Math.max(0, (pathsLine || 1) - 1);
  return {
    kind: "scoped",
    retried,
    patterns: norm.map((n) => {
      let line = pathsLine || 1;
      for (let i = from; i < Math.min(fm.bodyLine - 1, lines.length); i++) {
        if (lines[i].includes(n.source)) {
          line = i + 1;
          break;
        }
      }
      return { pattern: n.pattern, source: n.source, line };
    }),
  };
}

/** Why a normalized pattern can never match, independent of the tree. */
export function structurallyDead(pattern: string): string | null {
  if (pattern.startsWith("./")) return "a `./` prefix never matches; the matcher compares paths without it";
  if (pattern.startsWith("#")) return "a leading `#` makes it a comment";
  if (/[ \t]#/.test(pattern)) return "it carries an inline `# comment` as part of the pattern (the loader's quoting retry kept it)";
  if (pattern.includes("\\")) return "backslashes are escapes, not path separators";
  if (compileGlob(pattern) === null) return "it has an unbalanced `[`, so the matcher drops it";
  return null;
}

// ── Gitignore-style matching ──────────────────────────────────────────────

export interface CompiledGlob {
  negative: boolean;
  dirOnly: boolean;
  re: RegExp;
}

function escapeRe(s: string): string {
  return s.replace(/[.+^${}()|\\]/g, "\\$&");
}

function segmentToRe(seg: string): string | null {
  let out = "";
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "[") {
      const close = seg.indexOf("]", i + 2);
      if (close < 0) return null;
      let body = seg.slice(i + 1, close);
      if (body.startsWith("!")) body = "^" + body.slice(1);
      out += `[${body.replace(/\\/g, "\\\\")}]`;
      i = close;
    } else out += escapeRe(c);
  }
  return out;
}

/** One pattern → a matcher over repo-relative paths (gitignore semantics). */
export function compileGlob(pattern: string): CompiledGlob | null {
  let p = pattern.replace(/[ \t]+$/, "");
  if (!p || p.startsWith("#")) return { negative: false, dirOnly: false, re: /(?!)/ };
  const negative = p.startsWith("!");
  if (negative) p = p.slice(1);
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.includes("/");
  if (p.startsWith("/")) p = p.slice(1);
  const segs = p.split("/");
  let body = "";
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    if (seg === "**") {
      body += last ? ".*" : "(?:.*/)?";
      continue;
    }
    const re = segmentToRe(seg);
    if (re === null) return null;
    body += re + (last ? "" : "/");
  }
  const src = anchored ? `^${body}$` : `^(?:.*/)?${body}$`;
  return { negative, dirOnly, re: new RegExp(src, "i") };
}

/** node-ignore's `ignores(rel)`: a path matches when it, or any directory
 *  above it, matches; a later `!pattern` can clear a match, but never inside
 *  a directory that already matched. */
export function matchesAny(globs: readonly CompiledGlob[], rel: string): boolean {
  const parts = rel.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const sub = parts.slice(0, i).join("/");
    const isDir = i < parts.length;
    let hit = false;
    for (const g of globs) {
      if (g.negative !== hit) continue;
      if (g.dirOnly && !isDir) continue;
      if (g.re.test(sub)) hit = !g.negative;
    }
    if (hit) return true;
  }
  return false;
}

/** A pattern that matches any file at all: it scopes nothing. */
export function isUniversal(pattern: string): boolean {
  const g = compileGlob(pattern);
  if (!g || g.negative) return false;
  return matchesAny([g], "q7x.q7y") && matchesAny([g], "q7a/q7b/q7c.q7d");
}

// ── @imports ──────────────────────────────────────────────────────────────

export interface ImportRef {
  /** The path as Claude reads it: fragment stripped, trailing punctuation kept. */
  token: string;
  line: number;
  /** Found inside an inline code span in a list item (the scanner reads those). */
  inListCode: boolean;
}

const IMPORT_RE = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g;

/** `@path` tokens Claude Code tries to import from one instruction file. Skips
 *  frontmatter, HTML comments, fenced and indented code, HTML blocks, and
 *  inline code spans outside list items. */
export function scanImports(raw: string): ImportRef[] {
  const fm = readFrontmatter(raw);
  const lines = raw.replace(/^﻿/, "").split("\n");
  const out: ImportRef[] = [];
  let fence: string | null = null;
  let inComment = false;
  let prevBlank = true;
  let inList = false;
  for (let i = fm.bodyLine - 1; i < lines.length; i++) {
    let line = lines[i].replace(/\r$/, "");
    if (inComment) {
      const end = line.indexOf("-->");
      if (end < 0) continue;
      line = line.slice(end + 3);
      inComment = false;
    }
    line = line.replace(/<!--[\s\S]*?-->/g, " ");
    const open = line.indexOf("<!--");
    if (open >= 0) {
      line = line.slice(0, open);
      inComment = true;
    }
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (fence === null || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence === null ? marker : null;
      prevBlank = false;
      continue;
    }
    if (fence !== null) continue;
    const blank = line.trim() === "";
    const isItem = /^\s*(?:[-*+]|\d+[.)])\s/.test(line);
    if (isItem) inList = true;
    else if (blank) {
      // A blank line ends the list only if the next content line is not indented.
    } else if (!/^\s/.test(line)) inList = false;
    const indentedCode = /^(?: {4}|\t)/.test(line) && prevBlank && !inList;
    prevBlank = blank;
    if (blank || indentedCode || /^\s{0,3}<[A-Za-z/]/.test(line)) continue;
    const spans: { code: string; start: number }[] = [];
    const prose = line.replace(/(`+)(.+?)\1/g, (m, _t, code: string, at: number) => {
      spans.push({ code, start: at });
      return " ".repeat(m.length);
    });
    const scan = (s: string, inListCode: boolean) => {
      for (const m of s.matchAll(IMPORT_RE)) {
        const token = m[1].replace(/\\ /g, " ").replace(/#.*$/, "");
        if (!token || token === "/") continue;
        if (!/^(?:\.\/|~\/|\/|[A-Za-z0-9._-])/.test(token)) continue;
        out.push({ token, line: i + 1, inListCode });
      }
    };
    scan(prose, false);
    if (inList) for (const s of spans) scan(` ${s.code}`, true);
  }
  return out;
}

// ── Codex AGENTS.md chain ─────────────────────────────────────────────────

export const CODEX_DEFAULT_MAX_BYTES = 32768;

export interface CodexConfig {
  maxBytes?: number;
  fallbacks?: string[];
}

/** The two project-doc keys from a `.codex/config.toml` (top-level only). */
export function parseCodexConfig(toml: string): CodexConfig {
  const out: CodexConfig = {};
  for (const line of toml.split("\n")) {
    if (/^\s*\[/.test(line)) break;
    const max = /^\s*project_doc_max_bytes\s*=\s*(\d[\d_]*)\s*(?:#.*)?$/.exec(line);
    if (max) out.maxBytes = Number(max[1].replace(/_/g, ""));
    const fb = /^\s*project_doc_fallback_filenames\s*=\s*\[(.*)\]\s*(?:#.*)?$/.exec(line);
    if (fb) {
      out.fallbacks = [...fb[1].matchAll(/"([^"]*)"|'([^']*)'/g)]
        .map((m) => m[1] ?? m[2])
        .filter((n) => n && !/[/\0]/.test(n) && n !== "." && n !== "..");
    }
  }
  return out;
}

/** Codex's per-directory pick: the first of these that exists. */
export function codexCandidates(fallbacks: readonly string[] = []): string[] {
  return [...new Set(["AGENTS.override.md", "AGENTS.md", ...fallbacks])];
}

export interface ChainLink {
  path: string;
  bytes: number;
}

export interface ChainBudget {
  cap: number;
  /** Bytes Codex reads, whitespace-only files costing nothing. */
  total: number;
  /** The file the budget runs out in, with the bytes kept from it. */
  cut: { path: string; keptBytes: number; line: number } | null;
  dropped: string[];
}

/** Charges a root-to-leaf chain against the budget the way Codex does: the
 *  file that crosses it is cut, everything deeper is dropped. */
export function chargeChain(chain: { path: string; text: string }[], cap: number): ChainBudget {
  let remaining = cap;
  let total = 0;
  let cut: ChainBudget["cut"] = null;
  const dropped: string[] = [];
  for (const link of chain) {
    if (cut) {
      if (link.text.trim()) dropped.push(link.path);
      continue;
    }
    if (!link.text.trim()) continue;
    const bytes = Buffer.byteLength(link.text);
    total += bytes;
    if (bytes > remaining) {
      const kept = Buffer.from(link.text).subarray(0, remaining).toString("utf8");
      cut = { path: link.path, keptBytes: remaining, line: kept.split("\n").length };
      remaining = 0;
      continue;
    }
    remaining -= bytes;
  }
  return { cap, total, cut, dropped };
}
