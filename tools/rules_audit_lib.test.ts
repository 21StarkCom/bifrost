// rules_audit_lib over in-memory repos: one check per test, each asserting the
// finding (or candidate) it exists to produce and the false positive it must not.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  agentKind, auditRules, formatText, formatTriage, injectedText, skillDescription, triage,
  type AgentKind, type AuditInput, type RepoView, type TriageGroup, type TriageInput,
} from "./rules_audit_lib.ts";

function view(files: Record<string, string>, extra: Partial<RepoView> = {}): RepoView {
  const names = Object.keys(files).sort();
  return {
    files: names,
    read: (rel) => files[rel] ?? null,
    exists: (rel) => rel in files || names.some((f) => f.startsWith(`${rel}/`)),
    ignored: new Set(),
    claudeFamilyAbove: true,
    ...extra,
  };
}

function audit(files: Record<string, string>, opts: Partial<AuditInput> & { extra?: Partial<RepoView> } = {}) {
  return auditRules({ repoRoot: "/repo", view: view(files, opts.extra), budgets: opts.budgets, always: opts.always });
}

const scoped = (glob: string, body = "rule body\n") => `---\npaths:\n  - "${glob}"\n---\n${body}`;
const find = (r: ReturnType<typeof audit>, re: RegExp) => r.findings.filter((f) => re.test(f.short_summary));

test("unscoped rules outside the declared always-loaded set are high; the declared one is not flagged", () => {
  const r = audit({
    "CLAUDE.md": "Plane rules load by path, plus the always-loaded `discover.md`.\n",
    ".claude/rules/discover.md": "always here\n",
    ".claude/rules/jfrog.md": "big unscoped rule\n",
    ".claude/rules/gh.md": scoped("internal/gh/**"),
    "internal/gh/x.go": "package gh\n",
  });
  assert.deepEqual(r.declaredAlways.rules, [".claude/rules/discover.md"]);
  assert.deepEqual(r.declaredAlways.sources, [{ file: "CLAUDE.md", line: 1 }]);
  const unscoped = find(r, /Unscoped rule/);
  assert.deepEqual(unscoped.map((f) => [f.file, f.severity]), [[".claude/rules/jfrog.md", "high"]]);
  assert.deepEqual(r.totals.alwaysLoaded.sort(), [".claude/rules/discover.md", ".claude/rules/jfrog.md", "CLAUDE.md"]);
});

test("without a declared set an unscoped rule is medium; --always overrides and refuses unknown names", () => {
  const files = { ".claude/rules/a.md": "a\n", ".claude/rules/b.md": "b\n" };
  assert.deepEqual(find(audit(files), /Unscoped/).map((f) => f.severity), ["medium", "medium"]);
  assert.deepEqual(find(audit(files, { always: ["a.md"] }), /Unscoped/).map((f) => [f.file, f.severity]), [[".claude/rules/b.md", "high"]]);
  assert.throws(() => audit(files, { always: ["nope.md"] }), /--always names no rule/);
});

test("a rule that looks scoped but is not: foreign key, unquoted * item, fence not at byte 0", () => {
  const r = audit({
    ".claude/rules/globs.md": "---\nglobs: src/**\n---\nx\n",
    ".claude/rules/star.md": "---\npaths:\n  - **/*.ts\n---\nx\n",
    ".claude/rules/blank.md": '\n---\npaths:\n  - "src/**"\n---\nx\n',
    "src/a.ts": "",
  });
  const hits = find(r, /Looks path-scoped/);
  assert.deepEqual(hits.map((f) => f.file).sort(), [".claude/rules/blank.md", ".claude/rules/globs.md", ".claude/rules/star.md"]);
  assert.ok(hits.every((f) => f.severity === "high"));
  assert.match(hits.find((f) => f.file.endsWith("globs.md"))!.fix, /Rename the key to `paths:`/);
  assert.equal(find(r, /Unscoped/).length, 0, "an intended scope is reported once, as a broken scope");
});

test("paths: globs — dead, structurally dead, universal and unanchored", () => {
  const r = audit({
    ".claude/rules/dead.md": scoped("gone/**"),
    ".claude/rules/dot.md": scoped("./src/**"),
    ".claude/rules/all.md": scoped("**/*"),
    ".claude/rules/md.md": scoped("*.md"),
    ".claude/rules/one.md": scoped("configs/**"),
    "src/a.ts": "",
    "docs/a.md": "",
    "pkg/b.md": "",
    "configs/x.yaml": "",
  });
  assert.deepEqual(find(r, /matches no file/).map((f) => [f.file, f.line]), [[".claude/rules/dead.md", 3]]);
  const dot = find(r, /can never match/);
  assert.deepEqual(dot.map((f) => [f.file, f.severity]), [[".claude/rules/dot.md", "high"]]);
  assert.deepEqual(find(r, /Universal glob/).map((f) => f.file), [".claude/rules/all.md"]);
  assert.deepEqual(find(r, /Unanchored glob/).map((f) => f.file), [".claude/rules/md.md"], "configs/** matches only under configs/");
});

test("a negation glob counts the files it excludes and is never 'matches no file'", () => {
  const r = audit({
    ".claude/rules/ts.md": '---\npaths:\n  - "src/**/*.ts"\n  - "!src/**/*.test.ts"\n---\nts rule\n',
    "src/a.ts": "",
    "src/a.test.ts": "",
  });
  assert.equal(find(r, /matches no file/).length, 0);
  const scope = r.files.find((f) => f.path === ".claude/rules/ts.md")!.scope!;
  assert.deepEqual(scope.patterns!.map((p) => p.matches), [2, 1]);
  assert.equal(scope.matchedFiles, 1, "the set applies the negation");
});

test("an @import in a scoped rule loads at session start and counts toward the always total", () => {
  const r = audit({
    ".claude/rules/api.md": scoped("api/**", "see @../../docs/api.md\n"),
    "docs/api.md": "API NOTES\n",
    "api/x.ts": "",
  });
  const f = find(r, /@import in a scoped rule/);
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, "high");
  assert.ok(r.totals.alwaysLoaded.includes("docs/api.md"));
});

test("import defects: trailing punctuation, dead, too deep, directory; mentions are candidates", () => {
  const r = audit({
    "CLAUDE.md": "See @notes.md.\nAlso @missing.md\nDeep @d1.md\nDir @docs\nPing @someone\n",
    "notes.md": "n\n",
    "d1.md": "@d2.md\n", "d2.md": "@d3.md\n", "d3.md": "@d4.md\n", "d4.md": "@d5.md\n", "d5.md": "deep\n",
    "docs/a.md": "",
  });
  assert.equal(find(r, /Trailing punctuation/).length, 1);
  assert.deepEqual(find(r, /Dead @import/).map((f) => f.line), [2]);
  assert.deepEqual(find(r, /hops deep/).map((f) => f.file), ["d4.md"]);
  assert.equal(find(r, /names a directory/).length, 1);
  assert.deepEqual(r.candidates.filter((c) => c.kind === "import").map((c) => c.text), ["@someone"]);
  assert.ok(!r.totals.alwaysLoaded.includes("d5.md"));
  assert.ok(r.totals.alwaysLoaded.includes("d4.md"));
});

test("a trailing-slash @import names a directory, never a phantom file", () => {
  const r = audit({ "CLAUDE.md": "See @docs/ for more.\n", "docs/a.md": "x\n" });
  assert.equal(find(r, /names a directory/).length, 1);
  assert.ok(!r.files.some((f) => f.path.startsWith("docs")), JSON.stringify(r.files.map((f) => f.path)));
});

test("a file too deep on one chain but loaded through a shallower one is not reported", () => {
  const r = audit({
    "CLAUDE.md": "Deep @d1.md\n",
    "d1.md": "@d2.md\n", "d2.md": "@d3.md\n", "d3.md": "@d4.md\n", "d4.md": "@d5.md\n", "d5.md": "deep\n",
    "pkg/CLAUDE.md": "@../d4.md\n",
  });
  assert.equal(find(r, /hops deep/).length, 0);
  assert.equal(r.files.find((f) => f.path === "d5.md")?.claude, "on-demand");
});

test("size: per-file and always-loaded budgets measure injected text, not frontmatter or comments", () => {
  const big = "x".repeat(20 * 1024);
  const r = audit({
    "CLAUDE.md": big,
    ".claude/rules/big-scoped.md": scoped("src/**", big),
    ".claude/rules/small.md": `---\npaths:\n  - "src/**"\n---\n<!--\n${"c".repeat(30000)}\n-->\nshort\n`,
    ".claude/rules/extra.md": big,
    "src/a.ts": "",
  });
  const sizes = r.findings.filter((f) => f.category === "size-budget");
  assert.deepEqual(sizes.map((f) => [f.file, f.severity]).sort(), [
    [".claude/rules/big-scoped.md", "low"],
    [".claude/rules/extra.md", "medium"],
    ["CLAUDE.md", "medium"],
    ["CLAUDE.md", "medium"],
  ]);
  assert.ok(sizes.some((f) => /Always-loaded total/.test(f.short_summary)));
  assert.equal(injectedText("---\npaths: x\n---\n<!-- a -->\nbody\n"), "body\n");
});

test("Codex: the chain is cut where the budget runs out, the cap comes from .codex/config.toml", () => {
  const r = audit({
    "AGENTS.md": "a".repeat(100),
    "pkg/AGENTS.md": "b".repeat(100),
    ".codex/config.toml": "project_doc_max_bytes = 150\n",
    "pkg/x.go": "",
  }, { extra: { ignored: new Set([".codex/config.toml"]) } });
  const cut = find(r, /Codex cuts/);
  assert.equal(cut.length, 1);
  assert.equal(cut[0].file, "pkg/AGENTS.md");
  assert.match(cut[0].summary, /gitignored `\.codex\/config\.toml`/);
  assert.ok(r.files.find((f) => f.path === "AGENTS.md")!.codex);
});

test("Codex: one cut is one finding, whatever the number of directories behind it", () => {
  const r = audit({
    "AGENTS.md": "a".repeat(100),
    "pkg/AGENTS.md": "b".repeat(100),
    "pkg/sub/AGENTS.md": "c".repeat(100),
    ".codex/config.toml": "project_doc_max_bytes = 50\n",
  });
  const cut = find(r, /Codex cuts/);
  assert.equal(cut.length, 1, JSON.stringify(cut));
  assert.match(cut[0].summary, /\(0\.3 KiB\) for work under `pkg\/sub`.*the same cut applies under 2 other directories/);
  assert.match(cut[0].failure_scenario, /plus `pkg\/AGENTS\.md`, `pkg\/sub\/AGENTS\.md`/);
});

test("Codex: an empty AGENTS.override.md hides AGENTS.md; @imports are not expanded", () => {
  const r = audit({
    "AGENTS.override.md": "\n",
    "AGENTS.md": "real content @docs/x.md\n",
    "docs/x.md": "x\n",
    "pkg/AGENTS.md": "see @../docs/x.md\n",
  });
  const hide = find(r, /Empty AGENTS.override.md/);
  assert.equal(hide.length, 1);
  assert.equal(hide[0].verdict, "PLAUSIBLE");
  assert.deepEqual(find(r, /Codex does not expand/).map((f) => f.file), ["pkg/AGENTS.md"]);
});

test("AGENTS.md mode: with no CLAUDE-family file at or above the root, Claude loads AGENTS.md", () => {
  const files = { "AGENTS.md": "agents\n" };
  assert.equal(audit(files).files[0].claude, "never");
  const on = audit(files, { extra: { claudeFamilyAbove: false } });
  assert.equal(on.files[0].claude, "always");
  assert.equal(on.files[0].conditional, true);
});

test("gitignored instruction files, non-.md rules and CLAUDE.md paths: are flagged", () => {
  const r = audit({
    ".claude/rules/a.md": scoped("src/**"),
    ".claude/rules/b.MD": "never loads\n",
    ".claude/rules/c.mdc": "cursor rule\n",
    "CLAUDE.md": "---\npaths: src/**\n---\nroot\n",
    "CLAUDE.local.md": "mine\n",
    "src/x.ts": "",
  }, { extra: { ignored: new Set([".claude/rules/a.md", "CLAUDE.local.md"]) } });
  assert.deepEqual(find(r, /gitignored/).map((f) => f.file), [".claude/rules/a.md"]);
  assert.deepEqual(find(r, /never loads/).map((f) => f.file).sort(), [".claude/rules/b.MD", ".claude/rules/c.mdc"]);
  assert.equal(find(r, /paths: in a CLAUDE.md/).length, 1);
});

test("staleness: dead links and anchored paths are findings; examples, negations and slugs are not", () => {
  const r = audit({
    "CLAUDE.md": [
      "Read [the guide](docs/guide.md) and [gone](docs/gone.md).",
      "Config lives in `internal/config/load.go` and `internal/config/missing.go`.",
      "Never create `docs/plans/`.",
      "Run `go build ./cmd/app` against `origin/main` for `21StarkCom/app`.",
      "```",
      "internal/example/only.go",
      "```",
      "Set `APP_TOKEN` and `ZZZ_UNKNOWN_VAR`; see `internal/config.Load`.",
    ].join("\n"),
    "docs/guide.md": "",
    "internal/config/load.go": "package config\nfunc Load() { os.Getenv(\"APP_TOKEN\") }\n",
    "cmd/app/main.go": "",
  });
  const dead = r.findings.filter((f) => f.category === "staleness").map((f) => f.short_summary);
  assert.deepEqual(dead.sort(), ["Dead link docs/gone.md", "Dead path internal/config/missing.go"]);
  const soft = r.candidates.filter((c) => c.kind === "path").map((c) => c.text).sort();
  assert.deepEqual(soft, ["docs/plans/", "internal/example/only.go"]);
  assert.deepEqual(r.candidates.filter((c) => c.kind === "identifier").map((c) => c.text), ["ZZZ_UNKNOWN_VAR"]);
});

test("staleness: call arguments, angle-bracket links and HTML comments are not dead references", () => {
  const r = audit({
    "CLAUDE.md": [
      "- `internal/slackfmt.Render(CardOpts{Title,Body,Code})` is the renderer.",
      "Read [the guide](<docs/my guide.md>).",
      "<!--",
      "Config: `internal/cfg/stale.go`",
      "-->",
      "<!-- also `internal/cfg/other.go` -->",
    ].join("\n"),
    "internal/slackfmt/render.go": "package slackfmt\nfunc Render() {}\n",
    "docs/my guide.md": "",
  });
  assert.deepEqual(r.findings.filter((f) => f.category === "staleness"), []);
});

test("duplicates count when one file imports the other", () => {
  const sentence = "Every write is dry-run by default and needs an explicit confirm flag to apply.";
  const r = audit({ "CLAUDE.md": `@AGENTS.md\n\n${sentence}\n`, "AGENTS.md": `${sentence}\n` });
  assert.equal(r.candidates.filter((c) => c.kind === "duplicate").length, 1);
});

test("a sentence that denies an always-load declares nothing", () => {
  const r = audit({
    "CLAUDE.md": "Only `discover.md` is always-loaded. `jfrog.md` must never always-load; scope it.\n",
    ".claude/rules/discover.md": "d\n",
    ".claude/rules/jfrog.md": "j\n",
  });
  assert.deepEqual(r.declaredAlways.rules, [".claude/rules/discover.md"]);
  assert.deepEqual(find(r, /Unscoped/).map((f) => [f.file, f.severity]), [[".claude/rules/jfrog.md", "high"]]);
});

test("duplicates are candidates only where both copies load together", () => {
  const sentence = "Every write is dry-run by default and needs an explicit confirm flag to apply.";
  const r = audit({
    "CLAUDE.md": `${sentence}\n`,
    ".claude/rules/a.md": scoped("a/**", `${sentence}\n`),
    "AGENTS.md": `${sentence}\n`,
    "pkg1/CLAUDE.md": "Only pkg1 says this long sentence about its own local conventions here.\n",
    "pkg2/CLAUDE.md": "Only pkg1 says this long sentence about its own local conventions here.\n",
    "a/x": "",
  });
  const dups = r.candidates.filter((c) => c.kind === "duplicate");
  assert.equal(dups.length, 1, JSON.stringify(dups));
  assert.deepEqual([dups[0].file, ...dups[0].also!.map((a) => a.file)].sort(), [".claude/rules/a.md", "AGENTS.md", "CLAUDE.md"]);
});

test("narrative: ticket history is a candidate; ids inside code spans do not count", () => {
  const r = audit({
    "CLAUDE.md": [
      "- Reads LIVE-VERIFIED 2026-09-11 (STARK-4481) against the real tenant.",
      "- Shipped in STARK-1, STARK-2 and STARK-3 over three slices.",
      "- Run `alfred task show STARK-1 STARK-2 STARK-3` to read tickets.",
    ].join("\n"),
  });
  assert.deepEqual(r.candidates.filter((c) => c.kind === "narrative").map((c) => c.line), [1, 2]);
});

test("gate: every gate phrase is a candidate, without case, on the line where it starts", () => {
  const r = audit({
    "CLAUDE.md": [
      "- A tag needs a GO first.",
      "- Publish only with a GO from the operator.",
      "- A new commit is The Operator's call.",
      "- Re-run only on the operator’s word.",
      "- That repo is not yours.",
      "- Never, whoever asks.",
      "- Do not add tickets the operator did not name.",
      "- Ask each run before moving it.",
      "- A push runs only on the operator's GO.",
      "- Every destructive step needs the operator's go.",
      "- Copyleft code needs the operator's OK.",
      "- A locked screen is the operator's to unlock.",
      "- Publish only with the operator's GO.",
      "- A rerun waits for the go-ahead.",
    ].join("\n"),
  });
  const gates = r.candidates.filter((c) => c.kind === "gate");
  assert.deepEqual(gates.map((c) => c.line), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.match(gates[3].detail, /"the operator’s word"/);
  assert.equal(gates[0].file, "CLAUDE.md");
  assert.equal(gates[0].text, "A tag needs a GO first.");
});

test("gate: a stray quote, a period in code and a table row do not hide or split a gate", () => {
  const r = audit({
    "CLAUDE.md": [
      "Use a 12\" screen. A tag needs a GO first. Then say \"done\".",
      "",
      "Run `git log. x` and the push needs a GO, which is the operator's call.",
      "",
      "| Step | Who |",
      "|------|-----|",
      "| Publish | needs a GO |",
    ].join("\n"),
  });
  const gates = r.candidates.filter((c) => c.kind === "gate");
  assert.deepEqual(gates.map((c) => [c.line, c.text]), [
    [1, "A tag needs a GO first."],
    [3, "Run `git log. x` and the push needs a GO, which is the operator's call."],
    [7, "| Publish | needs a GO |"],
  ]);
});

test("gate: a phrase wrapped across lines or emphasis matches; one candidate per sentence", () => {
  const r = audit({
    "AGENTS.md": [
      "Intro line.",
      "",
      "A window there is the operator's: ask",
      "each run before moving it. The tab is reaped, and that is the **operator's call**,",
      "not yours. Then report it.",
    ].join("\n"),
  });
  const gates = r.candidates.filter((c) => c.kind === "gate");
  assert.equal(gates.length, 2, JSON.stringify(gates));
  assert.equal(gates[0].line, 3);
  assert.equal(gates[0].text, "A window there is the operator's: ask each run before moving it.");
  assert.equal(gates[1].line, 4);
  assert.match(gates[1].detail, /"the operator's call", "not yours"/);
});

test("gate: code spans, quotes, the Go language and longer words do not count", () => {
  const r = audit({
    "CLAUDE.md": [
      "- The check flags `needs a GO` and `the operator's call`.",
      "- A gate reads \"ask each run\" or “not yours”.",
      "- Build it with a Go toolchain; the repo needs a Go module.",
      "- Do it yourself; the work is not yourself to hand off, and a go-to tool helps.",
      "- Start with a go-to recipe.",
      "- A launch is the operator's GO for all of its work.",
    ].join("\n"),
  });
  assert.deepEqual(r.candidates.filter((c) => c.kind === "gate"), []);
});

test("gate: a long sentence is clipped near its match", () => {
  const long = `${"word ".repeat(60)}then waits for the operator's word: Other sessions.`;
  const r = audit({ "CLAUDE.md": `${long}\n` });
  const [gate] = r.candidates.filter((c) => c.kind === "gate");
  assert.equal(gate.text.length, 160, gate.text);
  assert.match(gate.text, /^…/);
  assert.match(gate.text, /the operator's word: Other sessions\.$/);
});

test("formatText renders the load summary, findings and candidates", () => {
  const out = formatText(audit({ ".claude/rules/a.md": "x\n" }));
  assert.match(out, /Always loaded at Claude Code session start/);
  assert.match(out, /\[medium\] load-scope \.claude\/rules\/a\.md:1/);
  assert.match(out, /load model: Claude Code/);
});

test("loadOnly settles the same loads as the full audit, with no findings", () => {
  const files = {
    "CLAUDE.md": "root @docs/x.md\n\n@docs/gone.md\n", // the import walk reports the dead one
    "docs/x.md": "imported\n",
    ".claude/rules/a.md": "unscoped\n",
    ".claude/rules/b.md": scoped("src/**"),
    "src/a.ts": "",
  };
  const full = audit(files);
  const lean = auditRules({ repoRoot: "/repo", view: view(files), loadOnly: true });
  assert.deepEqual(lean.totals.alwaysLoaded, full.totals.alwaysLoaded);
  assert.deepEqual(lean.totals.alwaysLoaded.sort(), [".claude/rules/a.md", "CLAUDE.md", "docs/x.md"]);
  assert.ok(full.findings.some((f) => f.short_summary.startsWith("Dead @import")));
  assert.deepEqual([lean.findings, lean.candidates], [[], []]);
});

// ── Playbook triage ───────────────────────────────────────────────────────

/** Triage one repo: every agent file in it, by `agentKind`, or the kinds given. */
function tri(
  files: Record<string, string>,
  opts: { kinds?: Record<string, AgentKind>; repo?: boolean; rootRules?: TriageInput["rootRules"]; above?: TriageGroup["above"] } = {},
) {
  const kinds = opts.kinds ?? {};
  const list = Object.keys(files).sort()
    .map((rel) => ({ rel, kind: kinds[rel] ?? agentKind(rel), path: rel }))
    .filter((f): f is { rel: string; kind: AgentKind; path: string } => f.kind !== null);
  return triage({
    groups: [{ root: "/repo", view: view(files), repo: opts.repo ?? false, files: list, above: opts.above }],
    rootRules: opts.rootRules,
  });
}
const fileOf = (r: ReturnType<typeof tri>, p: string) => r.files.find((f) => f.path === p)!;
const clauses = (r: ReturnType<typeof tri>, p: string) => fileOf(r, p).clauses.map((c) => `${c.flag} ${c.type} :${c.line}`);

test("triage: a gate phrase is RED; a file in budget with only rules is GREEN", () => {
  const r = tri({
    "CLAUDE.md": "# Rules\n\n- Run the tests before you push.\n- This is the operator's call.\n",
    "pkg/CLAUDE.md": "# Pkg\n\n- Use `make build` to build the binary.\n",
  });
  assert.deepEqual(clauses(r, "CLAUDE.md"), ["RED GATE :4"]);
  assert.match(fileOf(r, "CLAUDE.md").clauses[0].detail, /gate words "the operator's call"/);
  assert.equal(fileOf(r, "CLAUDE.md").flag, "RED");
  assert.equal(fileOf(r, "pkg/CLAUDE.md").flag, "GREEN");
  assert.deepEqual(r.totals, { GREEN: 1, YELLOW: 0, RED: 1 });
});

test("triage: size is YELLOW over the budget and RED over twice it, by the kind's budget", () => {
  const body = (n: number) => `${"x".repeat(n)}\n`;
  const r = tri({
    "CLAUDE.md": body(15_500),
    "pkg/CLAUDE.md": body(10_500),
    ".claude/rules/r.md": body(9_000),
    "skill/s/SKILL.md": `---\nname: s\ndescription: short\n---\n${body(31_000)}`,
  });
  assert.deepEqual(clauses(r, "CLAUDE.md"), ["YELLOW SIZE :1"]);
  assert.deepEqual(clauses(r, "pkg/CLAUDE.md"), ["YELLOW SIZE :1"]);
  assert.deepEqual(clauses(r, ".claude/rules/r.md"), []);
  assert.deepEqual(clauses(r, "skill/s/SKILL.md"), ["RED SIZE :1"]);
  assert.equal(fileOf(r, "skill/s/SKILL.md").budget, 15_000);
});

test("triage: a skill description is measured as YAML reads it", () => {
  const folded = `---\nname: s\ndescription: >-\n  ${"word ".repeat(70).trim()}\n  more\n---\nbody\n`;
  assert.equal(skillDescription(folded)?.text.length, 70 * 5 - 1 + 5);
  assert.deepEqual(skillDescription(`---\nname: s\ndescription: "a \\"quoted\\" one"\n---\n`), { text: 'a "quoted" one', line: 3 });
  const r = tri({
    "skill/a/SKILL.md": `---\nname: a\ndescription: ${"d".repeat(301)}\n---\nbody\n`,
    "skill/b/SKILL.md": `---\nname: b\ndescription: ${"d".repeat(601)}\n---\nbody\n`,
    "skill/c/SKILL.md": `---\nname: c\ndescription: ${"d".repeat(300)}\n---\nbody\n`,
  });
  assert.deepEqual(clauses(r, "skill/a/SKILL.md"), ["YELLOW SIZE :3"]);
  assert.deepEqual(clauses(r, "skill/b/SKILL.md"), ["RED SIZE :3"]);
  assert.deepEqual(clauses(r, "skill/c/SKILL.md"), []);
});

test("triage: a MEMORY.md line over 150 chars is YELLOW, over 300 RED; a note has no size budget", () => {
  const r = tri({
    "MEMORY.md": `# Memory index\n\n- ${"a".repeat(160)}\n- ${"b".repeat(310)}\n- [ok](note.md) — fine\n`,
    "note.md": `${"n".repeat(50_000)}\n`,
  }, { kinds: { "MEMORY.md": "memory-index", "note.md": "memory-note" } });
  assert.deepEqual(clauses(r, "MEMORY.md"), ["YELLOW SIZE :3", "RED SIZE :4"]);
  assert.deepEqual(clauses(r, "note.md"), []);
  assert.equal(fileOf(r, "note.md").budget, null);
});

test("triage: growth phrases are RED; history markers are YELLOW or RED; cited text does not count", () => {
  const r = tri({
    "CLAUDE.md": [
      "- When you find a trap, add a rule here.", // 1 growth
      "- The deploy used to run by hand.", // 2 past habit
      "- Ship it (STARK-123, 2026-01-02).", // 3 ticket + date
      "- Measured on Chrome 153, the tab sleeps.", // 4 measurement
      "- They moved here from the README.", // 5 move record
      "- The flag is used to skip, can be used to retry, and is never used to deploy.",
      "- The check flags `add a rule`, \"used to\" and `STARK-9`.",
      "- Lessons", "  learned go in the ticket.", // 8-9: a phrase across a line break
    ].join("\n"),
  });
  assert.deepEqual(clauses(r, "CLAUDE.md"), [
    "RED GROWTH :1", "RED HISTORY :2", "YELLOW HISTORY :3", "YELLOW HISTORY :3",
    "RED HISTORY :4", "RED HISTORY :5", "RED GROWTH :8",
  ]);
  const details = fileOf(r, "CLAUDE.md").clauses.map((c) => c.detail);
  assert.ok(details.includes('a STARK ticket id "STARK-123"'), details.join("; "));
  assert.ok(details.includes('a past habit "used to"'));
});

test("triage: a copy of the root rules is RED; a copy of a sibling is YELLOW; the root file is not flagged", () => {
  const rule = "Never commit or push to a default branch directly unless the operator asks.";
  const sibling = "Run the full test suite and the typecheck before you open the pull request.";
  const r = tri(
    { "CLAUDE.md": `- ${rule}\n- ${sibling}\n`, "AGENTS.md": `- ${sibling}\n`, "pkg/CLAUDE.md": `- ${rule}\n` },
    { rootRules: { path: "~/Code/CLAUDE.md", text: `# Root\n\n- ${rule}\n` } },
  );
  assert.deepEqual(clauses(r, "CLAUDE.md"), ["RED DUPLICATE :1", "YELLOW DUPLICATE :2"]);
  assert.deepEqual(clauses(r, "AGENTS.md"), ["YELLOW DUPLICATE :1"]);
  assert.match(fileOf(r, "pkg/CLAUDE.md").clauses[0].detail, /a copy of the root rules at ~\/Code\/CLAUDE\.md:3/);
  // The root rules among the triaged files: their own text is no copy.
  const self = tri({ "CLAUDE.md": `- ${rule}\n`, "pkg/CLAUDE.md": `- ${rule}\n` }, { rootRules: { path: "CLAUDE.md", text: `- ${rule}\n` } });
  assert.deepEqual(clauses(self, "CLAUDE.md"), []);
  assert.deepEqual(clauses(self, "pkg/CLAUDE.md"), ["RED DUPLICATE :1"]);
});

test("triage: a dead link or @import is RED, a missing doc path YELLOW; code paths and a skill's target-repo paths are not checked", () => {
  const r = tri({
    "CLAUDE.md": [
      "- Read [the guide](docs/gone.md) first.", // 1 dead link
      "- Read `docs/specs/old-spec.md` before you change it.", // 2 a doc path not in this repo (maybe in another)
      "- Read `docs/live.md` and [ok](docs/live.md).", // 3 live
      "- See `src/gone.ts` and `docs/` for code.", // 4 code paths: the review's
      "- Read `guide.md` in the package.", // 5 bare name
      "@docs/missing.md", // 6 dead import
      "- Name an ADR `docs/adr/NNN-title.md` or a spec `docs/specs/YYYY-MM-DD-x.md`.", // 7 templates
    ].join("\n"),
    "docs/live.md": "live\n",
    "pkg/docs/local.md": "x\n",
    "pkg/CLAUDE.md": "- Read `docs/local.md` first.\n",
    ".claude/rules/r.md": "- Read `docs/local.md` before a change.\n", // package-relative: found under pkg/
    "skill/s/SKILL.md": "---\nname: s\ndescription: d\n---\n- Read `docs/adr/0001-x.md` in the target repo.\n- Read [ref](references/old.md) and `references/old2.md`.\n",
    "skill/s/references/here.md": "x\n",
  });
  assert.deepEqual(clauses(r, "CLAUDE.md"), ["RED POINTER :1", "YELLOW POINTER :2", "RED POINTER :6"]);
  assert.deepEqual(fileOf(r, "CLAUDE.md").clauses.map((c) => [c.text, c.detail]), [
    ["docs/gone.md", "dead link"], ["docs/specs/old-spec.md", "no such doc in this repo"], ["@docs/missing.md", "dead @import"],
  ]);
  assert.deepEqual(clauses(r, "pkg/CLAUDE.md"), []);
  assert.deepEqual(clauses(r, ".claude/rules/r.md"), []);
  assert.deepEqual(fileOf(r, "skill/s/SKILL.md").clauses.map((c) => `${c.flag} ${c.text}`).sort(), [
    "RED references/old.md", "YELLOW references/old2.md",
  ]);
});

test("triage: the root rules give no GATE flag; another file with the same gate words does", () => {
  const gate = "- A message to a person or a channel that the request did not name needs a GO.\n";
  const r = tri({ "CLAUDE.md": gate, "pkg/CLAUDE.md": gate }, { rootRules: { path: "CLAUDE.md", text: gate } });
  assert.deepEqual(clauses(r, "CLAUDE.md"), []);
  assert.deepEqual(clauses(r, "pkg/CLAUDE.md"), ["RED DUPLICATE :1", "RED GATE :1"]);
});

test("triage: 'used to' after a passive form, a contraction or a negation is no past habit", () => {
  const r = tri({
    "CLAUDE.md": [
      "- It's used to sign releases.",
      "- It isn't used to sign anything.",
      "- They’re only used to build.",
      "- Being used to it helps.",
      "- The tool used to sign by hand.", // 5: a past habit
    ].join("\n"),
  });
  assert.deepEqual(clauses(r, "CLAUDE.md"), ["RED HISTORY :5"]);
});

test("triage: a repo's start-up load set over 40k is flagged on its root CLAUDE.md", () => {
  // A different letter for each file: one long copied sentence would be a DUPLICATE.
  const big = (c: string) => `${c.repeat(14_000)}\n`;
  const r = tri({
    "CLAUDE.md": big("w"), ".claude/rules/a.md": big("x"), ".claude/rules/b.md": big("y"), ".claude/rules/c.md": scoped("src/**", big("z")), "src/a.ts": "",
  }, { repo: true });
  const [load] = fileOf(r, "CLAUDE.md").clauses.filter((c) => /load set/.test(c.detail));
  assert.equal(load.flag, "YELLOW");
  assert.match(load.text, /^42k chars in 3 files$/);
  assert.match(load.detail, /\.claude\/rules\/a\.md/);
  assert.doesNotMatch(load.detail, /c\.md/, "a path-scoped rule does not load at start-up");
  const smallFiles = { "CLAUDE.md": big("w"), ".claude/rules/a.md": `${"x".repeat(9_000)}\n` };
  assert.deepEqual(tri(smallFiles, { repo: true }).files.map((f) => f.flag), ["GREEN", "GREEN"]);
  // The CLAUDE.md files above the repo load with it.
  const withAbove = tri(smallFiles, { repo: true, above: [{ path: "~/Code/CLAUDE.md", text: `${"v".repeat(18_000)}\n` }] });
  const [above] = fileOf(withAbove, "CLAUDE.md").clauses;
  assert.equal(above.text, "41k chars in 3 files");
  assert.match(above.detail, /~\/Code\/CLAUDE\.md\)$/);
});

test("formatTriage prints one line per file, then the RED clauses, then the totals", () => {
  const out = formatTriage(tri({ "CLAUDE.md": "- This is the operator's call.\n", "pkg/CLAUDE.md": "- Plain rule here.\n" }));
  assert.deepEqual(out.split("\n"), [
    "RED     CLAUDE.md  31/15k chars · GATE 1",
    "GREEN   pkg/CLAUDE.md  19/10k chars",
    "",
    "RED clauses:",
    "  CLAUDE.md:1  GATE  gate words \"the operator's call\": This is the operator's call.",
    "",
    "2 agent files: GREEN 1 · YELLOW 0 · RED 1",
  ]);
});
