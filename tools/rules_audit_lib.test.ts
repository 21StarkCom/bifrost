// rules_audit_lib over in-memory repos: one check per test, each asserting the
// finding (or candidate) it exists to produce and the false positive it must not.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { auditRules, formatText, injectedText, type AuditInput, type RepoView } from "./rules_audit_lib.ts";

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

test("formatText renders the load summary, findings and candidates", () => {
  const out = formatText(audit({ ".claude/rules/a.md": "x\n" }));
  assert.match(out, /Always loaded at Claude Code session start/);
  assert.match(out, /\[medium\] load-scope \.claude\/rules\/a\.md:1/);
  assert.match(out, /load model: Claude Code/);
});
