/**
 * rules_audit_lib.ts — the code-backed checks behind `/stark-rules-optimizer`.
 *
 * Audits one repo's agent instruction files — every `.claude/rules/**.md`,
 * `CLAUDE.md` / `.claude/CLAUDE.md` / `CLAUDE.local.md`, `AGENTS.md` /
 * `AGENTS.override.md` — against how Claude Code and Codex actually load them
 * (`rules_load_lib.ts`), and returns a report whose `findings[]` is
 * `ReportFindings`-shaped:
 *
 *   - load scope: unscoped rules against the set the repo declares always-
 *     loaded; rules that look scoped but load every session; dead, universal
 *     and unanchored `paths:` globs; imports that defeat a scope; rule files
 *     that never load; instruction files git ignores;
 *   - size: per-file budgets, the always-loaded total, Codex's chain budget;
 *   - staleness: dead `@imports`, links and repo paths.
 *
 * What needs judgement — identifiers missing from source, a dead path beside a
 * "never", repeated sentences, ticket-history paragraphs — is returned as
 * `candidates[]` for the skill to verify, never as a finding.
 *
 * Pure: every read goes through the `RepoView` the caller passes.
 */
import path from "node:path";

import {
  CODEX_DEFAULT_MAX_BYTES,
  LOAD_MODEL,
  chargeChain,
  classifyRule,
  codexCandidates,
  compileGlob,
  isUniversal,
  matchesAny,
  parseCodexConfig,
  readFrontmatter,
  scanImports,
  structurallyDead,
  type CompiledGlob,
  type Scope,
} from "./rules_load_lib.ts";

export type Severity = "high" | "medium" | "low";
export type Category = "load-scope" | "size-budget" | "staleness";
export type ClaudeLoad = "always" | "on-demand" | "never" | "unknown";
export type FileKind = "rule" | "claude-md" | "agents-md" | "import";
export type CandidateKind = "identifier" | "path" | "bare-file" | "import" | "frontmatter" | "duplicate" | "narrative";

export interface RulesFinding {
  file: string;
  line: number;
  category: Category;
  severity: Severity;
  short_summary: string;
  summary: string;
  failure_scenario: string;
  fix: string;
  /** CONFIRMED: measured from the tree. PLAUSIBLE: depends on runtime state the tree does not show. */
  verdict: "CONFIRMED" | "PLAUSIBLE";
}

export interface Candidate {
  kind: CandidateKind;
  file: string;
  line: number;
  text: string;
  detail: string;
  also?: { file: string; line: number }[];
}

export interface Budgets {
  /** Advisory per-file budget, injected bytes. */
  fileBytes: number;
  /** Advisory per-file budget, lines (Claude Code's docs: "under 200 lines"). */
  fileLines: number;
  /** Advisory always-loaded total, injected bytes. */
  alwaysBytes: number;
}

export const DEFAULT_BUDGETS: Budgets = { fileBytes: 16 * 1024, fileLines: 200, alwaysBytes: 32 * 1024 };
/** Claude Code skips a memory file or import larger than this. */
export const CLAUDE_SKIP_BYTES = 4 * 1024 * 1024;
/** Claude Code warns "Large … will impact performance" above this many chars. */
export const CLAUDE_WARN_CHARS = 40000;
const MAX_IMPORT_DEPTH = 4;

export interface RepoView {
  /** Every on-disk file under the root, pruned of `.git`, nested repos and
   *  worktrees, and dependency trees; repo-relative with `/` separators. */
  files: readonly string[];
  read(rel: string): string | null;
  /** On-disk existence of any path, pruned or not. */
  exists(rel: string): boolean;
  /** The files among `files` that git ignores. */
  ignored: ReadonlySet<string>;
  /** A CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md exists at or above the
   *  repo root (ancestors outside the repo count). */
  claudeFamilyAbove: boolean;
  /** Entries in a `.claude/rules` dir that are symlinks resolving outside the repo. */
  externalRuleLinks?: readonly string[];
}

export interface PatternReport {
  pattern: string;
  line: number;
  matches: number;
}

export interface InstructionFile {
  path: string;
  kind: FileKind;
  /** The directory whose subtree the file governs ("." for the repo root). */
  owner: string;
  claude: ClaudeLoad;
  /** Read by Codex as part of an AGENTS.md chain. */
  codex: boolean;
  /** Its Claude load depends on runtime state (the AGENTS.md mode). */
  conditional?: boolean;
  /** Injected content: frontmatter and block HTML comments removed. */
  bytes: number;
  chars: number;
  lines: number;
  ignored: boolean;
  /** Rules: how the loader reads the frontmatter. */
  scope?: { kind: Scope["kind"]; reason?: string; patterns?: PatternReport[]; matchedFiles?: number };
  importedBy?: string[];
}

export interface Declared {
  rules: string[];
  sources: { file: string; line: number }[];
  fromFlag: boolean;
}

export interface AuditReport {
  repoRoot: string;
  loadModel: string;
  repoFiles: number;
  budgets: Budgets;
  declaredAlways: Declared;
  files: InstructionFile[];
  totals: {
    instructionFiles: number;
    rules: number;
    unscopedRules: number;
    alwaysLoadedBytes: number;
    alwaysLoadedTokens: number;
    alwaysLoaded: string[];
  };
  findings: RulesFinding[];
  candidates: Candidate[];
}

const ALWAYS_RE = /\balways[- ]load|\bloads? (?:into |in )?every (?:session|time)\b/i;
const NEGATION_RE =
  /\b(?:never|not|no|don't|without|instead of|removed|deleted|retired|gone|moved|renamed|replaced|superseded|formerly|legacy)\b/i;
const CREATION_RE = /\b(?:writes?|creates?|generates?|outputs?|produces?|emits?|scaffolds?|will be)\b/i;
const EXT_RE = /\.(?:md|mdx|ts|tsx|js|mjs|cjs|go|mod|sum|json|jsonc|ya?ml|toml|sh|bash|zsh|py|rs|rb|java|kt|swift|tf|hcl|sql|txt|lock|html|css|proto)$/;
const GLOB_CHARS = /[*?[{]/;
const ENV_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const PLATFORM_ENV = /^(?:GITHUB|RUNNER|NODE|NPM|CLAUDE|ANTHROPIC|OPENAI|XDG|GOOGLE|AWS|LC|GIT)_|^(?:GH_TOKEN|GITHUB_TOKEN|CODEX_HOME|NO_COLOR|CGO_ENABLED)$/;
const TICKET_RE = /\b(?!(?:UTF|SHA|ISO|RFC|CVE|TLS|SSL|HTTP|AES|GPT|WCAG|ECMA|IPV|PEP)-)[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g;
const DATE_RE = /\b20\d\d-\d\d-\d\d\b/g;
const HISTORY_RE = /\b(?:measured|incident|live[- ]verif\w*|regression|post-?mortem|used to|previously|was fixed|root cause)\b/gi;
/** Import targets Claude Code's text-extension allowlist does not carry. */
const NON_TEXT_EXT = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp", "ico", "zip", "gz", "tgz", "tar", "7z", "docx", "xlsx", "pptx", "mdx", "mp3", "mp4", "mov", "wasm", "bin", "exe", "dll", "so", "dylib", "woff", "woff2", "ttf", "otf", "jar", "class", "pyc"]);

// ── Discovery ─────────────────────────────────────────────────────────────

/** A path's instruction-file kind and owning directory, or null. */
export function instructionKind(rel: string): { kind: Exclude<FileKind, "import">; owner: string } | null {
  const rules = /^(?:(.*)\/)?\.claude\/rules\/(.+)$/.exec(rel);
  if (rules) return rules[2].endsWith(".md") ? { kind: "rule", owner: rules[1] ?? "." } : null;
  const base = path.posix.basename(rel);
  const dir = path.posix.dirname(rel);
  const owner = path.posix.basename(dir) === ".claude" ? path.posix.dirname(dir) : dir;
  if (base === "CLAUDE.md" || base === "CLAUDE.local.md") return { kind: "claude-md", owner };
  // `.claude/AGENTS.md` is Claude's alone; Codex reads only directory-level files.
  if (base === "AGENTS.md" || (base === "AGENTS.override.md" && path.posix.basename(dir) !== ".claude")) {
    return { kind: "agents-md", owner };
  }
  return null;
}

const isAncestorOrSelf = (a: string, b: string) => a === "." || a === b || b.startsWith(`${a}/`);

/** Frontmatter and block-level HTML comments removed: what the loader injects. */
export function injectedText(raw: string): string {
  const text = raw.replace(/^﻿/, "");
  const fm = readFrontmatter(text);
  const body = text.slice(fm.length);
  const out: string[] = [];
  let fence: string | null = null;
  let comment = false;
  for (const line of body.split("\n")) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (!comment && marker && (fence === null || marker[0] === fence[0])) fence = fence === null ? marker : null;
    if (fence === null && !comment && /^\s*<!--/.test(line)) {
      if (!line.includes("-->")) comment = true;
      else if (/^\s*<!--[\s\S]*-->\s*$/.test(line)) continue;
      if (comment) continue;
    }
    if (comment) {
      if (line.includes("-->")) comment = false;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

// ── Declared always-loaded set ────────────────────────────────────────────

export function resolveRuleName(token: string, rules: readonly string[]): string | null {
  const t = token.replace(/^\.\//, "");
  return (
    rules.find((r) => r === t || r === `.claude/rules/${t}`) ??
    rules.find((r) => path.posix.basename(r) === path.posix.basename(t)) ??
    null
  );
}

/** Rule names the repo's own instructions call always-loaded. */
export function parseDeclaredAlways(docs: { file: string; text: string }[], rules: readonly string[]): Declared {
  const found = new Set<string>();
  const sources: Declared["sources"] = [];
  for (const { file, text } of docs) {
    text.split("\n").forEach((line, i) => {
      if (!ALWAYS_RE.test(line)) return;
      let hit = false;
      for (const m of line.matchAll(/[\w./-]+\.md\b/g)) {
        const rule = resolveRuleName(m[0], rules);
        if (rule) {
          found.add(rule);
          hit = true;
        }
      }
      if (hit) sources.push({ file, line: i + 1 });
    });
  }
  return { rules: [...found].sort(), sources, fromFlag: false };
}

// ── Markdown walking ──────────────────────────────────────────────────────

interface Line {
  n: number;
  text: string;
  fenced: boolean;
}

function bodyLines(raw: string): Line[] {
  const fm = readFrontmatter(raw);
  const out: Line[] = [];
  let fence: string | null = null;
  raw.replace(/^﻿/, "").split("\n").forEach((line, i) => {
    if (i < fm.bodyLine - 1) return;
    const text = line.replace(/\r$/, "");
    const marker = /^\s*(`{3,}|~{3,})/.exec(text)?.[1];
    if (marker && (fence === null || marker[0] === fence[0])) {
      fence = fence === null ? marker : null;
      return;
    }
    out.push({ n: i + 1, text, fenced: fence !== null });
  });
  return out;
}

interface Block {
  line: number;
  text: string;
  starts: { offset: number; line: number }[];
}

/** Prose blocks: paragraphs, with every list item and heading its own block;
 *  tables, fences and command lines are skipped. */
function proseBlocks(raw: string): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const { n, text, fenced } of bodyLines(raw)) {
    const t = text.trim();
    if (fenced || !t || t.startsWith("|") || t.startsWith("$ ") || /^co-authored-by:/i.test(t)) {
      cur = null;
      continue;
    }
    if (!cur || /^(?:[-*+]|\d+\.)\s|^#/.test(t)) {
      cur = { line: n, text: "", starts: [] };
      blocks.push(cur);
    }
    cur.starts.push({ offset: cur.text.length, line: n });
    cur.text += (cur.text ? " " : "") + t;
  }
  return blocks;
}

function lineAt(block: Block, offset: number): number {
  let line = block.line;
  for (const s of block.starts) if (s.offset <= offset) line = s.line;
  return line;
}

// ── Reference extraction ──────────────────────────────────────────────────

export interface Ref {
  kind: "link" | "path";
  token: string;
  line: number;
  /** In a fenced block, or on a line that reads as a negation or a creation:
   *  a miss there is a candidate, not a finding. */
  soft: boolean;
}

export interface Ident {
  kind: "env" | "symbol";
  name: string;
  token: string;
  line: number;
}

/** Trims wrapping punctuation and `:line`/`#anchor`/`::symbol` suffixes; null
 *  for anything that cannot be a repo path (URL, home path, placeholder…). */
export function cleanPathToken(raw: string): string | null {
  let t = raw.replace(/^[("'[]+/, "").replace(/[)"'\],;:!?]+$/, "");
  t = t.replace(/\.$/, "");
  t = t.replace(/::.*$/, "").replace(/#.*$/, "").replace(/:\d+(?:-\d+)?$/, "");
  if (!t || /[<>$`|…\\=]/.test(t) || t.includes("://") || t.includes("...")) return null;
  if (/^[~/@-]/.test(t)) return null;
  if (/^[A-Za-z0-9-]+\.(?:com|io|org|dev|net|ai|app|sh|in)\//.test(t)) return null;
  return t;
}

export function extractRefs(raw: string): { refs: Ref[]; idents: Ident[] } {
  const refs: Ref[] = [];
  const idents: Ident[] = [];
  const addTokens = (s: string, n: number, soft: boolean, symbols: boolean) => {
    const parts = s.trim().split(/\s+/).filter(Boolean);
    for (const token of parts) {
      if (/^[A-Z][A-Z0-9_]*=/.test(token)) continue; // a definition, not a reference
      const env = token.replace(/^\$\{?/, "").replace(/\}$/, "");
      // `_\d+` endings are error codes (`OAUTH_102`), not environment names.
      if (ENV_RE.test(env) && !/_\d+$/.test(env)) idents.push({ kind: "env", name: env, token, line: n });
      const sym = /::([A-Za-z_]\w*)/.exec(token);
      if (sym) idents.push({ kind: "symbol", name: sym[1], token, line: n });
      let t = cleanPathToken(token);
      // A Go qualified name, `internal/pkg.Symbol`: the package path plus a symbol.
      const goSym = t ? /^(.+\/[\w-]+)\.([A-Z]\w*)(?:\(\))?$/.exec(t) : null;
      if (goSym && !EXT_RE.test(t!)) {
        t = goSym[1];
        idents.push({ kind: "symbol", name: goSym[2], token, line: n });
      }
      if (t && (t.includes("/") || EXT_RE.test(t))) refs.push({ kind: "path", token: t, line: n, soft });
    }
    if (symbols && parts.length === 1) {
      const m = /^(?:[A-Za-z_]\w*\.)+([A-Za-z_]\w{3,})(?:\(\))?$|^([A-Za-z_]\w{3,})\(\)$/.exec(parts[0]);
      const name = m?.[1] ?? m?.[2];
      if (name && !EXT_RE.test(parts[0])) idents.push({ kind: "symbol", name, token: parts[0], line: n });
    }
  };
  for (const { n, text, fenced } of bodyLines(raw)) {
    const soft = fenced || NEGATION_RE.test(text) || CREATION_RE.test(text);
    if (fenced) {
      addTokens(text, n, true, false);
      continue;
    }
    const prose = text.replace(/(`+)(.+?)\1/g, (_m, _tick, code: string) => {
      addTokens(code, n, soft, true);
      return " ";
    });
    for (const m of prose.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
      const t = target.replace(/#.*$/, "");
      if (t) {
        let decoded = t;
        try {
          decoded = decodeURI(t);
        } catch {
          // keep the raw target
        }
        refs.push({ kind: "link", token: decoded, line: n, soft: false });
      }
    }
  }
  return { refs, idents };
}

// ── Duplication and narrative candidates ──────────────────────────────────

function normalizeSentence(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_`[\]()>#|]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?:;,\s]+$/, "")
    .trim();
}

/** Sentences of at least `minChars` (normalized) stated in two or more
 *  places. `coLoad` keeps only groups where two locations can land in one
 *  context window; a repeat nobody ever sees twice costs nothing. */
export function findDuplicates(
  docs: { file: string; text: string }[],
  coLoad: (a: string, b: string) => boolean = () => true,
  minChars = 60,
): Candidate[] {
  const seen = new Map<string, { file: string; line: number; text: string }[]>();
  for (const { file, text } of docs) {
    for (const block of proseBlocks(text)) {
      if (block.text.startsWith("#")) continue;
      const body = block.text.replace(/^(?:[-*+]|\d+\.)\s+/, "");
      const lead = block.text.length - body.length;
      let offset = 0;
      for (const sentence of body.split(/(?<=[.!?])\s+/)) {
        const key = normalizeSentence(sentence);
        const at = { file, line: lineAt(block, lead + offset), text: sentence.trim() };
        offset += sentence.length + 1;
        if (key.length < minChars) continue;
        const list = seen.get(key) ?? [];
        if (!list.some((l) => l.file === at.file && l.line === at.line)) list.push(at);
        seen.set(key, list);
      }
    }
  }
  const out: Candidate[] = [];
  for (const list of seen.values()) {
    if (list.length < 2) continue;
    const together = list.some((a, i) => list.slice(i + 1).some((b) => coLoad(a.file, b.file)));
    if (!together) continue;
    const [first, ...rest] = list;
    out.push({
      kind: "duplicate", file: first.file, line: first.line, text: clip(first.text, 160),
      detail: `stated ${list.length} times where they load together`,
      also: rest.map(({ file, line }) => ({ file, line })),
    });
  }
  return out;
}

/** Blocks that read as ticket history or a live-verify log, not a rule. Ids
 *  inside code spans are commands or examples and do not count. */
export function findNarrative(file: string, text: string): Candidate[] {
  const out: Candidate[] = [];
  for (const block of proseBlocks(text)) {
    const prose = block.text.replace(/(`+)(.+?)\1/g, " ");
    const tickets = new Set(prose.match(TICKET_RE) ?? []).size;
    const dates = (prose.match(DATE_RE) ?? []).length;
    const history = (prose.match(HISTORY_RE) ?? []).length;
    if (tickets >= 3 || (dates >= 1 && tickets + history >= 1)) {
      out.push({
        kind: "narrative", file, line: block.line, text: clip(block.text, 160),
        detail: `${tickets} ticket id(s), ${dates} date(s), ${history} history word(s) in ${block.text.length} chars`,
      });
    }
  }
  return out;
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

// ── Reference resolution ──────────────────────────────────────────────────

interface Tree {
  files: readonly string[];
  fileSet: Set<string>;
  dirSet: Set<string>;
  topLevel: Set<string>;
  view: RepoView;
}

type Resolution = "ok" | "missing" | "unanchored" | "bare-missing";

/** Links resolve from the file's directory (or the root for `/x`). A code path
 *  is only checked when it is anchored in the tree — its first segment is a
 *  top-level entry or an entry beside the file — so `origin/main` or an
 *  `owner/repo` slug is never read as a path. */
export function resolveRef(ref: Ref, dir: string, tree: Tree): Resolution {
  const exists = (rel: string): boolean => {
    const r = rel.replace(/\/$/, "");
    if (r === "" || r === ".") return true;
    if (GLOB_CHARS.test(r)) {
      return tree.files.some((f) => path.matchesGlob(f, r)) || [...tree.dirSet].some((d) => path.matchesGlob(d, r));
    }
    return tree.fileSet.has(r) || tree.dirSet.has(r) || tree.view.exists(r);
  };
  const local = (t: string) => path.posix.normalize(path.posix.join(dir, t));
  if (ref.kind === "link") {
    const target = ref.token.startsWith("/") ? ref.token.slice(1) : local(ref.token);
    if (target.startsWith("../")) return "unanchored";
    return exists(target) ? "ok" : "missing";
  }
  const t = ref.token;
  if (!t.includes("/")) {
    if (/^\.[A-Za-z0-9]+$/.test(t)) return "unanchored"; // a bare extension, `.ts`
    if (exists(local(t)) || exists(t)) return "ok";
    const base = path.posix.basename(t);
    const glob = GLOB_CHARS.test(base);
    return tree.files.some((f) => (glob ? path.matchesGlob(path.posix.basename(f), base) : path.posix.basename(f) === base))
      ? "ok"
      : "bare-missing";
  }
  if (/^\.{1,2}\//.test(t)) {
    // `./x` in a command is relative to wherever the command runs: the repo
    // root, the file's directory, or any directory that holds `x`.
    if (t.startsWith("./")) {
      const rest = path.posix.normalize(t);
      if (exists(rest) || tree.files.some((f) => f.endsWith(`/${rest}`)) || [...tree.dirSet].some((d) => d.endsWith(`/${rest.replace(/\/$/, "")}`))) {
        return "ok";
      }
    }
    const target = local(t);
    if (target.startsWith("../")) return "unanchored";
    return exists(target) ? "ok" : "missing";
  }
  const first = t.split("/")[0];
  const besideFile = dir === "." ? first : `${dir}/${first}`;
  const rootAnchored = tree.topLevel.has(first);
  const localAnchored = dir !== "." && (tree.fileSet.has(besideFile) || tree.dirSet.has(besideFile));
  if (!rootAnchored && !localAnchored) return "unanchored";
  if ((rootAnchored && exists(t)) || (localAnchored && exists(local(t)))) return "ok";
  return "missing";
}

// ── The audit ─────────────────────────────────────────────────────────────

export interface AuditInput {
  repoRoot: string;
  view: RepoView;
  budgets?: Partial<Budgets>;
  /** Overrides the declared always-loaded set (rule names or paths). */
  always?: string[];
}

function wordSet(view: RepoView, skip: Set<string>): Set<string> {
  const words = new Set<string>();
  for (const f of view.files) {
    if (skip.has(f)) continue;
    const text = view.read(f);
    if (text === null || text.length > 1024 * 1024 || text.slice(0, 8000).includes("\0")) continue;
    for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) words.add(m[0]);
  }
  return words;
}

function relTo(owner: string, file: string): string | null {
  if (owner === ".") return file;
  return file.startsWith(`${owner}/`) ? file.slice(owner.length + 1) : null;
}

export function auditRules(input: AuditInput): AuditReport {
  const { view, repoRoot } = input;
  const budgets: Budgets = { ...DEFAULT_BUDGETS, ...input.budgets };
  const files = [...view.files].sort();
  const fileSet = new Set(files);
  const dirSet = new Set<string>();
  for (const f of files) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirSet.add(parts.slice(0, i).join("/"));
  }
  const tree: Tree = { files, fileSet, dirSet, topLevel: new Set(files.map((f) => f.split("/")[0])), view };
  const findings: RulesFinding[] = [];
  const candidates: Candidate[] = [];
  const texts = new Map<string, string>();
  const add = (f: Omit<RulesFinding, "verdict"> & { verdict?: RulesFinding["verdict"] }) =>
    findings.push({ verdict: "CONFIRMED", ...f });
  const agentsMode = !view.claudeFamilyAbove;

  // Instruction files and how Claude Code loads each.
  const inst: InstructionFile[] = [];
  const scopes = new Map<string, Scope>();
  const measure = (raw: string) => {
    const injected = injectedText(raw);
    return {
      bytes: Buffer.byteLength(injected),
      chars: injected.length,
      lines: injected.split("\n").length - (injected.endsWith("\n") ? 1 : 0),
    };
  };
  for (const rel of files) {
    const k = instructionKind(rel);
    if (!k) continue;
    const raw = view.read(rel);
    if (raw === null) continue;
    texts.set(rel, raw);
    let claude: ClaudeLoad;
    let conditional = false;
    let scope: InstructionFile["scope"];
    if (k.kind === "rule") {
      const s = classifyRule(raw);
      scopes.set(rel, s);
      scope = { kind: s.kind, reason: s.kind === "always" ? s.reason : s.kind === "undecidable" ? s.detail : undefined };
      claude = s.kind === "undecidable" ? "unknown" : s.kind === "always" && k.owner === "." ? "always" : "on-demand";
    } else if (k.kind === "claude-md") {
      claude = k.owner === "." ? "always" : "on-demand";
    } else {
      const base = path.posix.basename(rel);
      const dirHasClaude = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"].some((c) =>
        fileSet.has(k.owner === "." ? c : `${k.owner}/${c}`));
      claude = base === "AGENTS.override.md" || !agentsMode || dirHasClaude ? "never" : k.owner === "." ? "always" : "on-demand";
      conditional = claude !== "never";
    }
    inst.push({
      path: rel, kind: k.kind, owner: k.owner, claude, codex: false, conditional: conditional || undefined,
      ...measure(raw), ignored: view.ignored.has(rel), scope,
    });
  }
  const byPath = new Map(inst.map((f) => [f.path, f]));
  const rules = inst.filter((f) => f.kind === "rule" && f.owner === ".").map((f) => f.path);

  // Declared always-loaded set.
  let declared: Declared;
  if (input.always) {
    const resolved = input.always.map((a) => resolveRuleName(a, rules));
    const missing = input.always.filter((_, i) => !resolved[i]);
    if (missing.length) throw new Error(`--always names no rule in .claude/rules/: ${missing.join(", ")}`);
    declared = { rules: [...new Set(resolved as string[])].sort(), sources: [], fromFlag: true };
  } else {
    const docs = ["CLAUDE.md", ".claude/CLAUDE.md", "AGENTS.md"]
      .filter((f) => texts.has(f))
      .map((f) => ({ file: f, text: texts.get(f)! }));
    declared = parseDeclaredAlways(docs, rules);
  }
  const declaredAt = declared.fromFlag ? "the --always flag" : declared.sources.map((s) => `${s.file}:${s.line}`).join(", ");

  // @imports: depth-0 files are everything Claude reads; each import target
  // loads by its own `paths:` when the tree it hangs from is a rule's, and
  // with its importer otherwise.
  const importEdges: { from: string; to: string }[] = [];
  const importLoad = new Map<string, ClaudeLoad>();
  const rank: Record<ClaudeLoad, number> = { always: 3, "on-demand": 2, unknown: 1, never: 0 };
  const raise = (p: string, l: ClaudeLoad) => {
    if (rank[l] > rank[importLoad.get(p) ?? "never"]) importLoad.set(p, l);
  };
  const seenImport = new Set<string>();
  for (const root of inst.filter((f) => f.claude !== "never")) {
    const queue: { file: string; depth: number }[] = [{ file: root.path, depth: 0 }];
    const visited = new Set<string>([root.path]);
    while (queue.length) {
      const { file, depth } = queue.shift()!;
      const raw = texts.get(file) ?? view.read(file);
      if (raw === null) continue;
      texts.set(file, raw);
      for (const imp of scanImports(raw)) {
        const key = `${file}:${imp.line}:${imp.token}`;
        const report = !seenImport.has(key);
        seenImport.add(key);
        if (imp.token.startsWith("~/")) continue;
        let target: string;
        if (imp.token.startsWith("/")) {
          const abs = path.posix.normalize(imp.token);
          if (!abs.startsWith(`${repoRoot}/`)) continue;
          target = abs.slice(repoRoot.length + 1);
        } else target = path.posix.normalize(path.posix.join(path.posix.dirname(file), imp.token));
        if (target.startsWith("../")) continue;
        const ext = /\.([A-Za-z0-9]+)$/.exec(path.posix.basename(target))?.[1]?.toLowerCase();
        if (fileSet.has(target) || (view.exists(target) && !dirSet.has(target))) {
          if (ext && NON_TEXT_EXT.has(ext)) {
            if (report) add({
              file, line: imp.line, category: "staleness", severity: "medium", verdict: "PLAUSIBLE",
              short_summary: `@import of a .${ext} file is skipped`,
              summary: `\`@${imp.token}\` names a .${ext} file; Claude Code imports only text extensions and skips this one with a debug log.`,
              failure_scenario: `The content of \`${target}\` never reaches the session.`,
              fix: `Import a text file, or point at the file in prose instead.`,
            });
            continue;
          }
          if (depth + 1 > MAX_IMPORT_DEPTH) {
            if (report) add({
              file, line: imp.line, category: "staleness", severity: "medium",
              short_summary: `@import is ${depth + 1} hops deep and never loads`,
              summary: `\`@${imp.token}\` sits ${depth + 1} imports below \`${root.path}\`; Claude Code follows at most ${MAX_IMPORT_DEPTH}.`,
              failure_scenario: `\`${target}\` is silently dropped.`,
              fix: `Import it from a shallower file, or inline what it carries.`,
            });
            continue;
          }
          if (imp.inListCode && report) {
            add({
              file, line: imp.line, category: "load-scope", severity: "low",
              short_summary: `Code span in a list item imports ${clip(imp.token, 30)}`,
              summary: `\`@${imp.token}\` sits inside an inline code span in a list item, where Claude Code's import scanner still reads it.`,
              failure_scenario: `\`${target}\` loads with this file although the text reads as an example, not an import.`,
              fix: `Move the example out of the list item, or write \`\\@\` so it is not an import.`,
            });
          }
          importEdges.push({ from: file, to: target });
          // Classification: a rule tree's files load by their own `paths:`.
          let load: ClaudeLoad = root.claude;
          if (root.kind === "rule") {
            const own = byPath.get(target)?.kind === "rule" ? scopes.get(target)! : classifyRule(texts.get(target) ?? view.read(target) ?? "");
            if (own.kind === "scoped") load = "on-demand";
            else load = root.owner === "." ? "always" : "on-demand";
            if (own.kind !== "scoped" && root.owner === "." && root.claude !== "always" && report) {
              add({
                file, line: imp.line, category: "load-scope", severity: "high",
                short_summary: "@import in a scoped rule loads every session",
                summary: `\`${root.path}\` is path-scoped, but the file it imports, \`${target}\`, has no \`paths:\` of its own, so Claude Code loads it at session start whether or not the rule ever matches.`,
                failure_scenario: `Every session carries \`${target}\`; the rule's scope does not reach its imports.`,
                fix: `Inline what \`${target}\` carries into the rule, or replace the import with a prose pointer.`,
              });
            }
          }
          raise(target, load);
          if (!visited.has(target)) {
            visited.add(target);
            queue.push({ file: target, depth: depth + 1 });
          }
          continue;
        }
        if (!report || imp.inListCode) continue;
        if (dirSet.has(target) || (view.exists(target) && !ext)) {
          add({
            file, line: imp.line, category: "staleness", severity: "medium",
            short_summary: `@import names a directory`,
            summary: `\`@${imp.token}\` resolves to a directory; Claude Code imports files only and skips it silently.`,
            failure_scenario: `Nothing under \`${target}\` loads through this import.`,
            fix: `Import the specific file, or drop the line.`,
          });
          continue;
        }
        const stripped = imp.token.replace(/[.,;:)!?]+$/, "");
        const strippedTarget = path.posix.normalize(path.posix.join(path.posix.dirname(file), stripped));
        if (stripped !== imp.token && fileSet.has(strippedTarget)) {
          add({
            file, line: imp.line, category: "staleness", severity: "medium",
            short_summary: `Trailing punctuation breaks @${clip(stripped, 30)}`,
            summary: `\`@${imp.token}\` carries trailing punctuation, which Claude Code keeps as part of the path, so the import of \`${strippedTarget}\` fails.`,
            failure_scenario: `\`${strippedTarget}\` exists but never loads, with no warning.`,
            fix: `Separate the punctuation from the path (put the import at the end of its own line, or add a space).`,
          });
          continue;
        }
        if (!EXT_RE.test(imp.token) && !/^(?:\.{1,2}\/|\/)/.test(imp.token)) {
          candidates.push({
            kind: "import", file, line: imp.line, text: `@${imp.token}`,
            detail: "an @-mention Claude Code tries, and silently fails, to import (no such file); likely a handle, domain or package name",
          });
          continue;
        }
        add({
          file, line: imp.line, category: "staleness", severity: "medium",
          short_summary: `Dead @import ${clip(imp.token, 40)}`,
          summary: `\`@${imp.token}\` imports a file that does not exist, so its content never loads.`,
          failure_scenario: `\`${target}\` is not on disk; Claude Code skips a missing import without a warning.`,
          fix: `Point the import at the file's current path, or delete the line.`,
        });
      }
    }
  }
  for (const [p, load] of importLoad) {
    const existing = byPath.get(p);
    if (existing) {
      if (rank[load] > rank[existing.claude]) existing.claude = load;
      existing.importedBy = importEdges.filter((e) => e.to === p).map((e) => e.from);
      continue;
    }
    const raw = texts.get(p) ?? view.read(p) ?? "";
    const owner = path.posix.dirname(p);
    const f: InstructionFile = {
      path: p, kind: "import", owner, claude: load, codex: false, ...measure(raw),
      ignored: view.ignored.has(p), importedBy: importEdges.filter((e) => e.to === p).map((e) => e.from),
    };
    inst.push(f);
    byPath.set(p, f);
  }

  // Load scope: every rule the loader reads.
  for (const f of inst.filter((x) => x.kind === "rule")) {
    const s = scopes.get(f.path)!;
    const nested = f.owner !== ".";
    if (s.kind === "undecidable") {
      candidates.push({
        kind: "frontmatter", file: f.path, line: s.line, text: s.detail,
        detail: "frontmatter uses YAML the auditor does not model; confirm the rule's scope with /context or an InstructionsLoaded hook",
      });
      continue;
    }
    if (s.kind === "always") {
      if (s.intendedScope) {
        const universal = s.reason === "empty-or-universal";
        add({
          file: f.path, line: s.line, category: "load-scope", severity: universal || nested ? "medium" : "high",
          short_summary: nested ? "Looks scoped but loads for its whole subtree" : "Looks path-scoped but loads every session",
          summary: `\`${f.path}\` reads as path-scoped, but ${s.detail}, so Claude Code loads it ${nested ? `on the first read anywhere under \`${f.owner}/\`` : "into every session"} (${kib(f.bytes)}).`,
          failure_scenario: `The scope the author wrote never applies; ${nested ? "every read in the subtree" : "every session"} pays for the rule.`,
          fix: s.reason === "foreign-key"
            ? "Rename the key to `paths:`."
            : s.reason === "empty-or-universal"
              ? "List the globs the rule governs, or drop the `paths:` key and declare the rule always-loaded."
              : "Start the file with a bare `---` line, and quote every glob: `- \"src/**/*.ts\"`.",
        });
        continue;
      }
      if (nested) continue;
      if (declared.rules.includes(f.path)) continue;
      const hasDecl = declared.rules.length > 0;
      add({
        file: f.path, line: 1, category: "load-scope", severity: hasDecl ? "high" : "medium",
        short_summary: `Unscoped rule loads every session (${kib(f.bytes)})`,
        summary: hasDecl
          ? `\`${f.path}\` has no \`paths:\` header, so it loads into every session, but the repo declares only ${declared.rules.map((r) => `\`${path.posix.basename(r)}\``).join(", ")} always-loaded (${declaredAt}).`
          : `\`${f.path}\` has no \`paths:\` header, so it loads into every session; the repo declares no always-loaded rule set.`,
        failure_scenario: `Every session pays ${kib(f.bytes)} for this rule, including sessions that never touch its subject.`,
        fix: `Add a quoted \`paths:\` list naming the packages this rule governs${hasDecl ? "" : ", or declare it always-loaded in CLAUDE.md"}.`,
      });
      continue;
    }
    if (declared.rules.includes(f.path)) {
      add({
        file: f.path, line: s.patterns[0].line, category: "load-scope", severity: "medium",
        short_summary: "Declared always-loaded but path-scoped",
        summary: `\`${f.path}\` is declared always-loaded (${declaredAt}) but carries a \`paths:\` header, so it loads only when a matching file is read.`,
        failure_scenario: `A session that never reads a matching file never sees a rule the repo says is always present.`,
        fix: `Drop the \`paths:\` header, or stop calling the rule always-loaded.`,
      });
    }
    const globs: { p: (typeof s.patterns)[number]; g: CompiledGlob | null; dead: string | null }[] =
      s.patterns.map((p) => ({ p, g: compileGlob(p.pattern), dead: structurallyDead(p.pattern) }));
    const universe = files.map((x) => relTo(f.owner, x)).filter((x): x is string => x !== null);
    const union = new Set<string>();
    const reports: PatternReport[] = [];
    for (const { p, g, dead } of globs) {
      const hits = !g || dead ? [] : universe.filter((x) => matchesAny([g], x));
      for (const h of hits) union.add(h);
      reports.push({ pattern: p.pattern, line: p.line, matches: hits.length });
      if (g && !dead && !g.negative && !p.pattern.includes("/") && !isUniversal(p.pattern)) {
        const tops = new Set(hits.map((h) => h.split("/")[0]));
        if (tops.size > 1) {
          add({
            file: f.path, line: p.line, category: "load-scope", severity: "medium",
            short_summary: `Unanchored glob ${clip(p.source, 30)} matches repo-wide`,
            summary: `\`${p.source}\` normalizes to the slashless \`${p.pattern}\`, which matches at any depth: ${hits.length} files under ${tops.size} top-level entries (${[...tops].slice(0, 4).join(", ")}${tops.size > 4 ? ", …" : ""}).`,
            failure_scenario: `Reading any of those files loads the rule, not just files in the directory the author meant.`,
            fix: `Anchor it with a leading slash (\`/${p.pattern}${p.source.endsWith("/**") ? "/**" : ""}\`) or a multi-segment path.`,
          });
        }
      }
      if (g && !dead && !g.negative && isUniversal(p.pattern)) {
        add({
          file: f.path, line: p.line, category: "load-scope", severity: "medium",
          short_summary: `Universal glob ${clip(p.source, 30)}`,
          summary: `\`${p.source}\` matches every file, so the rule loads on the first file read in any session.`,
          failure_scenario: `The scope buys nothing; the rule is effectively always loaded (${kib(f.bytes)}).`,
          fix: `Narrow the glob to the packages the rule governs, or drop \`paths:\` and declare it always-loaded.`,
        });
      }
    }
    const deadCount = globs.filter((x) => x.dead).length;
    for (const { p, dead } of globs) {
      if (!dead) continue;
      add({
        file: f.path, line: p.line, category: "load-scope", severity: deadCount === globs.length ? "high" : "medium",
        short_summary: `paths: glob can never match`,
        summary: `\`${p.source}\` can never match: ${dead}.${deadCount === globs.length ? " No glob in this rule can match, so it never loads." : ""}`,
        failure_scenario: `Files the glob was meant to cover never load the rule through it.`,
        fix: p.pattern.startsWith("./") ? `Drop the \`./\`: \`${p.pattern.slice(2)}\`.` : `Rewrite the glob as a plain quoted path pattern.`,
      });
    }
    const noMatch = reports.filter((r, i) => r.matches === 0 && !globs[i].dead);
    for (const r of noMatch) {
      add({
        file: f.path, line: r.line, category: "load-scope", severity: "medium",
        short_summary: `paths: glob matches no file`,
        summary: `\`${r.pattern}\` matches no file on disk${noMatch.length + deadCount === reports.length ? ", and neither does any other glob in this rule" : ""}.`,
        failure_scenario: `The rule fires only after a matching file exists and is read; it never guides creating one.`,
        fix: `Point the glob at where the code lives now, or delete it.`,
      });
    }
    f.scope = { kind: "scoped", patterns: reports, matchedFiles: union.size };
  }

  // Files in a rules dir that never load.
  for (const rel of files) {
    const m = /^(?:.*\/)?\.claude\/rules\/(.+)$/.exec(rel);
    if (!m || rel.endsWith(".md") || !/\.(?:md|markdown|mdc|mdx|txt)$/i.test(rel)) continue;
    add({
      file: rel, line: 1, category: "load-scope", severity: "medium",
      short_summary: "Rules-dir file never loads",
      summary: `\`${rel}\` sits in a rules directory, but Claude Code loads only entries whose name ends in lowercase \`.md\`.`,
      failure_scenario: `The file looks like a rule and is never read by any session.`,
      fix: `Rename it to \`${rel.replace(/\.[^.]+$/, ".md")}\`, or move it out of the rules directory.`,
    });
  }
  for (const rel of view.externalRuleLinks ?? []) {
    add({
      file: rel, line: 1, category: "load-scope", severity: "medium", verdict: "PLAUSIBLE",
      short_summary: "Rule symlink points outside the repo",
      summary: `\`${rel}\` is a symlink whose target is outside the repo; Claude Code loads it only after an external-import approval, and then only if it is unscoped.`,
      failure_scenario: `Headless runs and other clones never load it; a path-scoped target never loads at all.`,
      fix: `Copy the rule into the repo, or make the link target a file inside it.`,
    });
  }
  for (const f of inst.filter((x) => x.kind === "claude-md")) {
    const fm = readFrontmatter(texts.get(f.path)!);
    if (fm.yaml !== null && /^\s*["']?paths["']?\s*:/m.test(fm.yaml)) {
      add({
        file: f.path, line: 2, category: "load-scope", severity: "low",
        short_summary: "paths: in a CLAUDE.md has no effect",
        summary: `\`${f.path}\` carries a \`paths:\` header; Claude Code strips it and loads the file by location alone.`,
        failure_scenario: `The author expects scoping that never happens.`,
        fix: `Move the content into a \`.claude/rules/\` file with that \`paths:\`, or drop the header.`,
      });
    }
  }
  for (const f of inst.filter((x) => x.ignored && x.kind !== "import" && path.posix.basename(x.path) !== "CLAUDE.local.md")) {
    add({
      file: f.path, line: 1, category: "load-scope", severity: "medium",
      short_summary: "Instruction file is gitignored",
      summary: `\`${f.path}\` is ignored by git, so only this checkout has it.`,
      failure_scenario: `Other clones, CI, and worktrees made with \`git worktree add\` never load it; Claude-created worktrees get it only through \`.worktreeinclude\`.`,
      fix: `Commit it (adjust .gitignore), or move what it says into a tracked instruction file.`,
    });
  }

  // Size.
  for (const f of inst.filter((x) => x.claude !== "never")) {
    const always = f.claude === "always";
    if (f.bytes > CLAUDE_SKIP_BYTES) {
      add({
        file: f.path, line: 1, category: "size-budget", severity: "high",
        short_summary: `Over Claude Code's 4 MiB limit (${kib(f.bytes)})`,
        summary: `\`${f.path}\` is ${kib(f.bytes)}; Claude Code skips memory files larger than 4 MiB.`,
        failure_scenario: `None of it ever loads.`,
        fix: `Split it; move bulk reference material into docs the agent reads on demand.`,
      });
      continue;
    }
    const overBytes = f.bytes > budgets.fileBytes;
    const overLines = f.lines > budgets.fileLines;
    const overWarn = f.chars > CLAUDE_WARN_CHARS;
    if (!overBytes && !overLines && !overWarn) continue;
    const isRule = f.kind === "rule";
    add({
      file: f.path, line: 1, category: "size-budget",
      severity: overWarn || always ? "medium" : "low",
      verdict: overWarn && !overBytes && !overLines ? "PLAUSIBLE" : "CONFIRMED",
      short_summary: `${kib(f.bytes)} / ${f.lines} lines, over budget`,
      summary: `\`${f.path}\` injects ${kib(f.bytes)} in ${f.lines} lines, over the ${kib(budgets.fileBytes)} / ${budgets.fileLines}-line budget${overWarn ? `, past the ${CLAUDE_WARN_CHARS.toLocaleString("en-US")}-char point where Claude Code warns it "will impact performance"` : ""}.`,
      failure_scenario: always
        ? `Every session starts with all of it in context.`
        : `Whenever it loads, all ${kib(f.bytes)} lands in context at once.`,
      fix: isRule
        ? scopes.get(f.path)?.kind === "scoped"
          ? `Split it by concern into rules with narrower \`paths:\`, and trim what the code or \`-h\` already says.`
          : `Scope it with \`paths:\`; if it still runs long, split it by concern into narrower rules.`
        : `Move package-specific detail into path-scoped rules or nested instruction files, and trim what the code already says.`,
    });
  }
  const alwaysFiles = inst.filter((f) => f.claude === "always").sort((a, b) => b.bytes - a.bytes);
  const alwaysBytes = alwaysFiles.reduce((s, f) => s + f.bytes, 0);
  const alwaysChars = alwaysFiles.reduce((s, f) => s + f.chars, 0);
  if (alwaysBytes > budgets.alwaysBytes) {
    const top = alwaysFiles.slice(0, 5).map((f) => `${f.path} ${kib(f.bytes)}`).join(", ");
    const anchor = alwaysFiles.find((f) => f.kind === "claude-md") ?? alwaysFiles[0];
    add({
      file: anchor.path, line: 1, category: "size-budget", severity: "medium",
      short_summary: `Always-loaded total ${kib(alwaysBytes)} over budget`,
      summary: `${alwaysFiles.length} files load at every session start, ${kib(alwaysBytes)} (~${Math.round(alwaysChars / 4).toLocaleString("en-US")} tokens), over the ${kib(budgets.alwaysBytes)} budget.`,
      failure_scenario: `Every session starts with that much instruction text before any work; largest: ${top}.`,
      fix: `Scope the unscoped rules with \`paths:\` and move package detail out of the always-loaded files.`,
    });
  }

  // Codex: one file per directory, root to working directory, charged
  // against `project_doc_max_bytes` (closest `.codex/config.toml` wins).
  const configs = new Map<string, { cfg: ReturnType<typeof parseCodexConfig>; path: string }>();
  for (const rel of files) {
    if (!/(?:^|\/)\.codex\/config\.toml$/.test(rel)) continue;
    const dir = path.posix.dirname(path.posix.dirname(rel));
    configs.set(dir === "" ? "." : dir, { cfg: parseCodexConfig(view.read(rel) ?? ""), path: rel });
  }
  const chainDirs = (dir: string) => {
    const parts = dir === "." ? [] : dir.split("/");
    return [".", ...parts.map((_, i) => parts.slice(0, i + 1).join("/"))];
  };
  const effective = (dir: string) => {
    let maxBytes = CODEX_DEFAULT_MAX_BYTES;
    let source: string | null = null;
    let fallbacks: string[] = [];
    for (const d of chainDirs(dir)) {
      const c = configs.get(d);
      if (!c) continue;
      if (c.cfg.maxBytes !== undefined) {
        maxBytes = c.cfg.maxBytes;
        source = c.path;
      }
      if (c.cfg.fallbacks) fallbacks = c.cfg.fallbacks;
    }
    return { maxBytes, source, fallbacks };
  };
  const pick = (dir: string, fallbacks: string[]) => {
    for (const name of codexCandidates(fallbacks)) {
      const rel = dir === "." ? name : `${dir}/${name}`;
      if (fileSet.has(rel)) return rel;
    }
    return null;
  };
  const leafDirs = new Set<string>();
  const allFallbacks = new Set([...configs.values()].flatMap((c) => c.cfg.fallbacks ?? []));
  for (const rel of files) {
    const base = path.posix.basename(rel);
    if (codexCandidates([...allFallbacks]).includes(base) && !/(?:^|\/)\.claude\//.test(rel)) {
      const d = path.posix.dirname(rel);
      leafDirs.add(d === "" ? "." : d);
    }
  }
  const reported = new Set<string>();
  for (const dir of [...leafDirs].sort()) {
    const { maxBytes, source, fallbacks } = effective(dir);
    const chain = chainDirs(dir)
      .map((d) => pick(d, fallbacks))
      .filter((p): p is string => p !== null)
      .map((p) => ({ path: p, text: view.read(p) ?? "" }));
    for (const c of chain) {
      const f = byPath.get(c.path);
      if (f) f.codex = true;
    }
    const override = dir === "." ? "AGENTS.override.md" : `${dir}/AGENTS.override.md`;
    const sibling = dir === "." ? "AGENTS.md" : `${dir}/AGENTS.md`;
    if (fileSet.has(override) && !(view.read(override) ?? "").trim() && (view.read(sibling) ?? "").trim() && !reported.has(override)) {
      reported.add(override);
      add({
        file: override, line: 1, category: "load-scope", severity: "high", verdict: "PLAUSIBLE",
        short_summary: "Empty AGENTS.override.md hides AGENTS.md",
        summary: `\`${override}\` is empty, but Codex picks it over \`${sibling}\` by existence alone, then reads nothing from it.`,
        failure_scenario: `Codex never sees \`${sibling}\` for work under \`${dir}\`.`,
        fix: `Delete the empty override.`,
      });
    }
    const charged = chargeChain(chain, maxBytes);
    if (!charged.cut) continue;
    const key = `${charged.cut.path}|${charged.dropped.join(",")}`;
    if (reported.has(key)) continue;
    reported.add(key);
    const localCfg = source && view.ignored.has(source) ? ` (cap from the gitignored \`${source}\`)` : source ? ` (cap from \`${source}\`)` : "";
    add({
      file: charged.cut.path, line: charged.cut.line, category: "size-budget", severity: "high",
      short_summary: `Codex cuts ${path.posix.basename(charged.cut.path)} at ${kib(charged.cut.keptBytes)}`,
      summary: `Codex reads ${chain.map((c) => `\`${c.path}\``).join(" + ")} (${kib(charged.total)}) for work under \`${dir}\`, over its ${kib(maxBytes)} \`project_doc_max_bytes\` budget${localCfg}.`,
      failure_scenario: `Codex keeps the first ${charged.cut.keptBytes} bytes of \`${charged.cut.path}\` (through line ${charged.cut.line}) and drops the rest${charged.dropped.length ? `, plus ${charged.dropped.map((d) => `\`${d}\``).join(", ")}` : ""}, logging only a trace warning.`,
      fix: `Cut the chain under ${kib(maxBytes)}: keep AGENTS.md a short index and move detail into the files it points at.`,
    });
  }
  for (const f of inst.filter((x) => x.codex)) {
    for (const imp of scanImports(texts.get(f.path)!)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f.path), imp.token));
      if (!fileSet.has(target)) continue;
      add({
        file: f.path, line: imp.line, category: "staleness", severity: "medium",
        short_summary: `Codex does not expand @${clip(imp.token, 30)}`,
        summary: `\`${f.path}\` imports \`${target}\` with \`@\`, but Codex reads AGENTS.md as plain text and never expands imports.`,
        failure_scenario: `Codex sees the literal \`@${imp.token}\` and none of the content behind it.`,
        fix: `Inline what Codex needs, or point at the file in prose so the agent reads it itself.`,
      });
    }
  }

  // Staleness: links and repo paths. Links and anchored repo paths are
  // findings; misses in examples, negations and creation lines are candidates.
  const words = wordSet(view, new Set(inst.map((f) => f.path)));
  const seenRef = new Set<string>();
  for (const f of inst) {
    const raw = texts.get(f.path) ?? view.read(f.path) ?? "";
    const dir = path.posix.dirname(f.path);
    const { refs, idents } = extractRefs(raw);
    for (const ref of refs) {
      const key = `${f.path}:${ref.line}:${ref.token}`;
      if (seenRef.has(key)) continue;
      seenRef.add(key);
      const res = resolveRef(ref, dir, tree);
      if (res === "ok" || res === "unanchored") continue;
      if (res === "bare-missing") {
        candidates.push({ kind: "bare-file", file: f.path, line: ref.line, text: ref.token, detail: "no file of this name anywhere in the repo" });
        continue;
      }
      if (ref.soft) {
        candidates.push({
          kind: "path", file: f.path, line: ref.line, text: ref.token,
          detail: "does not resolve, but it sits in a code block or on a line about something absent or to be created",
        });
        continue;
      }
      const isGlob = GLOB_CHARS.test(ref.token);
      add({
        file: f.path, line: ref.line, category: "staleness", severity: "medium",
        short_summary: `Dead ${ref.kind === "link" ? "link" : isGlob ? "glob" : "path"} ${clip(ref.token, 40)}`,
        summary: ref.kind === "link"
          ? `The link target \`${ref.token}\` does not resolve from \`${dir}\`.`
          : isGlob
            ? `\`${ref.token}\` matches no file in the repo.`
            : `\`${ref.token}\` names a path that does not exist in the repo.`,
        failure_scenario: `An agent following this instruction looks for \`${ref.token}\` and finds nothing.`,
        fix: `Update the reference to the current path, or drop it if the thing it named is gone.`,
      });
    }
    const seenIdent = new Set<string>();
    for (const id of idents) {
      if (seenIdent.has(id.name) || words.has(id.name) || (id.kind === "env" && PLATFORM_ENV.test(id.name))) continue;
      seenIdent.add(id.name);
      candidates.push({
        kind: "identifier", file: f.path, line: id.line, text: id.token,
        detail: `${id.kind === "env" ? "env var" : "symbol"} \`${id.name}\` appears in no non-instruction file on disk (a dependency or the environment may define it)`,
      });
    }
  }

  // Duplication, among files that land in one context window.
  const imports = new Set(importEdges.map((e) => `${e.from}>${e.to}`));
  const coLoad = (a: string, b: string): boolean => {
    if (a === b) return true;
    if (imports.has(`${a}>${b}`) || imports.has(`${b}>${a}`)) return false;
    const fa = byPath.get(a)!;
    const fb = byPath.get(b)!;
    const claude = fa.claude !== "never" && fb.claude !== "never" &&
      (fa.claude === "always" || fb.claude === "always" || isAncestorOrSelf(fa.owner, fb.owner) || isAncestorOrSelf(fb.owner, fa.owner));
    const codex = fa.codex && fb.codex && (isAncestorOrSelf(fa.owner, fb.owner) || isAncestorOrSelf(fb.owner, fa.owner));
    return claude || codex;
  };
  const docs = inst.map((f) => ({ file: f.path, text: texts.get(f.path) ?? view.read(f.path) ?? "" }));
  candidates.push(...findDuplicates(docs, coLoad));
  for (const d of docs) candidates.push(...findNarrative(d.file, d.text));

  const sev: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) =>
    sev[a.severity] - sev[b.severity] || a.category.localeCompare(b.category) ||
    a.file.localeCompare(b.file) || a.line - b.line);
  const ruleFiles = inst.filter((f) => f.kind === "rule");
  return {
    repoRoot,
    loadModel: LOAD_MODEL,
    repoFiles: files.length,
    budgets,
    declaredAlways: declared,
    files: inst.sort((a, b) => a.path.localeCompare(b.path)),
    totals: {
      instructionFiles: inst.length,
      rules: ruleFiles.length,
      unscopedRules: ruleFiles.filter((f) => f.owner === "." && f.claude === "always").length,
      alwaysLoadedBytes: alwaysBytes,
      alwaysLoadedTokens: Math.round(alwaysChars / 4),
      alwaysLoaded: alwaysFiles.map((f) => f.path),
    },
    findings,
    candidates,
  };
}

// ── Text rendering ────────────────────────────────────────────────────────

export function formatText(r: AuditReport, maxCandidates = 40): string {
  const out: string[] = [];
  const t = r.totals;
  out.push(`rules audit — ${r.repoRoot} (${r.repoFiles} files; load model: ${r.loadModel})`);
  out.push("");
  out.push(`Always loaded at Claude Code session start: ${kib(t.alwaysLoadedBytes)}, ~${t.alwaysLoadedTokens.toLocaleString("en-US")} tokens (budget ${kib(r.budgets.alwaysBytes)})`);
  for (const p of t.alwaysLoaded) {
    const f = r.files.find((x) => x.path === p)!;
    const note = f.kind === "rule" ? `  (${f.scope?.reason ?? "no paths:"})` : f.kind === "import" ? "  (@import)" : f.conditional ? "  (AGENTS.md mode)" : "";
    out.push(`  ${kib(f.bytes).padStart(10)}  ${p}${note}`);
  }
  const decl = r.declaredAlways;
  out.push(decl.rules.length
    ? `Declared always-loaded: ${decl.rules.join(", ")} (${decl.fromFlag ? "--always" : decl.sources.map((s) => `${s.file}:${s.line}`).join(", ")})`
    : "Declared always-loaded: none found in CLAUDE.md / AGENTS.md");
  out.push("");
  out.push(`Instruction files: ${t.instructionFiles}; rules: ${t.rules}, ${t.unscopedRules} loading every session`);
  for (const f of [...r.files].sort((a, b) => b.bytes - a.bytes)) {
    const load = f.kind === "rule" && f.scope?.kind === "scoped"
      ? `${f.scope.patterns?.length ?? 0} glob(s) → ${f.scope.matchedFiles ?? 0}/${r.repoFiles} files`
      : `claude: ${f.claude}`;
    out.push(`  ${kib(f.bytes).padStart(10)}  ${f.path}  [${load}${f.codex ? "; codex" : ""}${f.ignored ? "; gitignored" : ""}]`);
  }
  out.push("");
  const count = (s: Severity) => r.findings.filter((f) => f.severity === s).length;
  out.push(`Findings: ${r.findings.length} (high ${count("high")}, medium ${count("medium")}, low ${count("low")})`);
  for (const f of r.findings) {
    out.push(`  [${f.severity}${f.verdict === "PLAUSIBLE" ? ", plausible" : ""}] ${f.category} ${f.file}:${f.line} — ${f.short_summary}`);
    out.push(`      ${f.summary}`);
    out.push(`      evidence: ${f.failure_scenario}`);
    out.push(`      fix: ${f.fix}`);
  }
  out.push("");
  const kinds = new Map<string, number>();
  for (const c of r.candidates) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1);
  out.push(`Candidates to verify: ${r.candidates.length}${kinds.size ? ` (${[...kinds].map(([k, n]) => `${k} ${n}`).join(", ")})` : ""}`);
  for (const c of r.candidates.slice(0, maxCandidates)) {
    const also = c.also?.length ? `; also ${c.also.map((a) => `${a.file}:${a.line}`).join(", ")}` : "";
    out.push(`  ${c.kind} ${c.file}:${c.line} — ${c.text} (${c.detail}${also})`);
  }
  if (r.candidates.length > maxCandidates) out.push(`  … ${r.candidates.length - maxCandidates} more (--json lists all)`);
  return out.join("\n");
}
