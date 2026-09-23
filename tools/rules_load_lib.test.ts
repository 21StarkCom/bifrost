// Pins rules_load_lib to what Claude Code 2.1.280 actually loaded. Every
// expectation below was observed live: a headless `claude -p` session with an
// `InstructionsLoaded` hook Read the trigger files over a tree of these rules,
// and each rule's load_reason (session_start / path_glob_match / none) and
// trigger file were compared with the prediction. Re-run that probe after a
// `claude` upgrade and update this table from what it shows.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  chargeChain,
  classifyRule,
  compileGlob,
  expandBraces,
  isUniversal,
  matchesAny,
  normalizePaths,
  parseCodexConfig,
  scanImports,
  structurallyDead,
} from "./rules_load_lib.ts";

const body = (id: string) => `# FX ${id}\n\nMarker FX-${id}.\n`;
const crlf = (s: string) => s.replace(/\n/g, "\r\n");
const BOM = "﻿";

type Expect = { always: string } | { scoped: string[]; hits?: string[]; misses?: string[] };

// [id, raw rule text, expectation]
const FIXTURES: [string, string, Expect][] = [
  ["quoted list", `---\npaths:\n  - "trig/a01.txt"\n---\n${body("a01")}`, { scoped: ["trig/a01.txt"], hits: ["trig/a01.txt"] }],
  ["unquoted list item starting with *", `---\npaths:\n  - **/a02.txt\n---\n${body("a02")}`, { always: "parse-failed" }],
  ["unquoted list item, * mid-scalar", `---\npaths:\n  - trig/**/a03.txt\n---\n${body("a03")}`, { scoped: ["trig/**/a03.txt"], hits: ["trig/a03.txt"] }],
  ["inline unquoted **/x (retry quotes it)", `---\npaths: **/a04.txt\n---\n${body("a04")}`, { scoped: ["**/a04.txt"], hits: ["trig/a04.txt"] }],
  ["inline comma string", `---\npaths: trig/a05.txt, trig/a05b.txt\n---\n${body("a05")}`, { scoped: ["trig/a05.txt", "trig/a05b.txt"], hits: ["trig/a05b.txt"] }],
  ["inline comma string starting with *", `---\npaths: **/a06.txt, **/a06b.txt\n---\n${body("a06")}`, { scoped: ["**/a06.txt", "**/a06b.txt"], hits: ["trig/a06b.txt"] }],
  ["leading blank line before ---", `\n---\npaths:\n  - "trig/a07.txt"\n---\n${body("a07")}`, { always: "fence-not-at-start" }],
  ["Paths: capitalized", `---\nPaths:\n  - "trig/a08.txt"\n---\n${body("a08")}`, { always: "foreign-key" }],
  ["globs: key", `---\nglobs: trig/a09.txt\n---\n${body("a09")}`, { always: "foreign-key" }],
  ["paths: []", `---\npaths: []\n---\n${body("a10")}`, { always: "empty-or-universal" }],
  ["paths: (null)", `---\npaths:\n---\n${body("a11")}`, { always: "empty-or-universal" }],
  ['paths: ""', `---\npaths: ""\n---\n${body("a12")}`, { always: "empty-or-universal" }],
  ["BOM + quoted list", `${BOM}---\npaths:\n  - "trig/a13.txt"\n---\n${body("a13")}`, { scoped: ["trig/a13.txt"], hits: ["trig/a13.txt"] }],
  ["CRLF + quoted list", crlf(`---\npaths:\n  - "trig/a14.txt"\n---\n${body("a14")}`), { scoped: ["trig/a14.txt"], hits: ["trig/a14.txt"] }],
  ["CRLF + inline unquoted **/x (no retry)", crlf(`---\npaths: **/a15.txt\n---\n${body("a15")}`), { always: "parse-failed" }],
  ["tab-indented list item (retry)", `---\npaths:\n\t- "trig/a16.txt"\n---\n${body("a16")}`, { scoped: ["trig/a16.txt"], hits: ["trig/a16.txt"] }],
  ["flow sequence quoted", `---\npaths: ["trig/a17.txt", "trig/a17b.txt"]\n---\n${body("a17")}`, { scoped: ["trig/a17.txt", "trig/a17b.txt"], hits: ["trig/a17b.txt"] }],
  ["flow sequence unquoted * (becomes a bracket literal)", `---\npaths: [**/a18.txt]\n---\n${body("a18")}`, { scoped: ["[**/a18.txt]"], misses: ["trig/a18.txt"] }],
  ['paths: "**"', `---\npaths: "**"\n---\n${body("a19")}`, { always: "empty-or-universal" }],
  ['paths: "**/**"', `---\npaths: "**/**"\n---\n${body("a20")}`, { always: "empty-or-universal" }],
  ["paths: 42", `---\npaths: 42\n---\n${body("a21")}`, { always: "empty-or-universal" }],
  ["paths: true", `---\npaths: true\n---\n${body("a22")}`, { always: "empty-or-universal" }],
  ["--- inside a value closes the block", `---\npaths:\n  - "trig/a23---x.txt"\n  - "trig/a23.txt"\n---\n${body("a23")}`, { always: "parse-failed" }],
  ["trailing # comment on an inline value", `---\npaths: trig/a24.txt # comment\n---\n${body("a24")}`, { scoped: ["trig/a24.txt"], hits: ["trig/a24.txt"] }],
  ["---- opener", `----\npaths:\n  - "trig/a25.txt"\n----\n${body("a25")}`, { always: "fence-not-at-start" }],
  ["closed with ...", `---\npaths:\n  - "trig/a26.txt"\n...\n${body("a26")}`, { always: "fence-not-at-start" }],
  ["opener with trailing spaces", `---   \npaths:\n  - "trig/a27.txt"\n---  \n${body("a27")}`, { scoped: ["trig/a27.txt"], hits: ["trig/a27.txt"] }],
  ["duplicate paths key (last wins)", `---\npaths:\n  - "trig/a28x.txt"\npaths:\n  - "trig/a28.txt"\n---\n${body("a28")}`, { scoped: ["trig/a28.txt"], hits: ["trig/a28.txt"], misses: ["trig/a28x.txt"] }],
  ["other key with ': ' (retry fixes)", `---\ndescription: note: this has a colon\npaths:\n  - "trig/a29.txt"\n---\n${body("a29")}`, { scoped: ["trig/a29.txt"], hits: ["trig/a29.txt"] }],
  ["other key unterminated quote", `---\ndescription: "unterminated\npaths:\n  - "trig/a30.txt"\n---\n${body("a30")}`, { always: "parse-failed" }],
  ["comma inside one list item splits", `---\npaths:\n  - "trig/a31x.txt,trig/a31.txt"\n---\n${body("a31")}`, { scoped: ["trig/a31x.txt", "trig/a31.txt"], hits: ["trig/a31.txt"] }],
  ["case-insensitive match", `---\npaths:\n  - "TRIG/A32.TXT"\n---\n${body("a32")}`, { scoped: ["TRIG/A32.TXT"], hits: ["trig/a32.txt"] }],
  ["slashless pattern matches at any depth", `---\npaths:\n  - "a33.txt"\n---\n${body("a33")}`, { scoped: ["a33.txt"], hits: ["trig/deep/a33.txt"] }],
  ["dir/** stripped to an unanchored dir", `---\npaths:\n  - "a34dir/**"\n---\n${body("a34")}`, { scoped: ["a34dir"], hits: ["trig/a34dir/x.txt"] }],
  ["middle slash anchors to the root", `---\npaths:\n  - "a35dir/*.txt"\n---\n${body("a35")}`, { scoped: ["a35dir/*.txt"], misses: ["trig/a35dir/x.txt"] }],
  ["negation cannot exclude inside a matched dir", `---\npaths:\n  - "trig/a36/**"\n  - "!trig/a36/skip.txt"\n---\n${body("a36")}`, { scoped: ["trig/a36", "!trig/a36/skip.txt"], hits: ["trig/a36/skip.txt"] }],
  ["paths: nested map", `---\npaths:\n  a: trig/a37.txt\n---\n${body("a37")}`, { always: "empty-or-universal" }],
  ["frontmatter is a sequence", `---\n- trig/a38.txt\n---\n${body("a38")}`, { always: "not-a-map" }],
  ["empty frontmatter", `---\n---\n${body("a39")}`, { always: "not-a-map" }],
  ["single-quoted inline", `---\npaths: '**/a40.txt'\n---\n${body("a40")}`, { scoped: ["**/a40.txt"], hits: ["trig/a40.txt"] }],
  ["unquoted list item starting with {", `---\npaths:\n  - {trig,x}/a41.txt\n---\n${body("a41")}`, { always: "parse-failed" }],
  ["inline brace mid-scalar", `---\npaths: trig/a42.{txt,md}\n---\n${body("a42")}`, { scoped: ["trig/a42.txt", "trig/a42.md"], hits: ["trig/a42.txt"] }],
  ["./ prefix never matches", `---\npaths:\n  - "./trig/a43.txt"\n---\n${body("a43")}`, { scoped: ["./trig/a43.txt"], misses: ["trig/a43.txt"] }],
  ["leading / anchors", `---\npaths:\n  - "/trig/a44.txt"\n---\n${body("a44")}`, { scoped: ["/trig/a44.txt"], hits: ["trig/a44.txt"] }],
  ["unquoted list item starting with ! (a tag)", `---\npaths:\n  - !trig/a45.txt\n---\n${body("a45")}`, { always: "empty-or-universal" }],
  ["BOM + CRLF + inline unquoted", BOM + crlf(`---\npaths: **/a46.txt\n---\n${body("a46")}`), { always: "parse-failed" }],
  ["no closing fence", `---\npaths:\n  - "trig/a47.txt"\n${body("a47")}`, { always: "fence-not-at-start" }],
  ["non-string item dropped", `---\npaths:\n  - 7\n  - "trig/a48.txt"\n---\n${body("a48")}`, { scoped: ["trig/a48.txt"], hits: ["trig/a48.txt"] }],
  ["**/* stays scoped", `---\npaths: "**/*"\n---\n${body("a49")}`, { scoped: ["**/*"], hits: ["anything/at/all.txt"] }],
  ["tab after colon (retry)", `---\npaths:\t**/a50.txt\n---\n${body("a50")}`, { scoped: ["**/a50.txt"], hits: ["trig/a50.txt"] }],
  ["single-segment dir/** unanchors", '---\npaths:\n  - "configs/**"\n---\nM01\n', { scoped: ["configs"], hits: ["deep/configs/app.yaml", "configs/base.yaml"] }],
  ["leading / root-only", '---\npaths:\n  - "/top.txt"\n---\nM02\n', { scoped: ["/top.txt"], hits: ["top.txt"], misses: ["sub/top.txt"] }],
  ["slashless *.md any depth", '---\npaths:\n  - "*.md"\n---\nM03\n', { scoped: ["*.md"], hits: ["docs/guide.md"] }],
  ["dot dir is not special", '---\npaths:\n  - ".github/**"\n---\nM04\n', { scoped: [".github"], hits: [".github/workflows/ci.yml"] }],
  ["anchored ** in the middle", '---\npaths:\n  - "src/**/*.go"\n---\nM05\n', { scoped: ["src/**/*.go"], hits: ["src/a/b/c.go"], misses: ["pkg/src/x.go"] }],
  ["star inside a segment", '---\npaths:\n  - "internal/foo*cli/**"\n---\nM06\n', { scoped: ["internal/foo*cli"], hits: ["internal/foocli/x.go"], misses: ["internal/foo/bar/foocli/y.go"] }],
];

for (const [name, raw, want] of FIXTURES) {
  test(`classifyRule: ${name}`, () => {
    const s = classifyRule(raw);
    if ("always" in want) {
      assert.equal(s.kind, "always", JSON.stringify(s));
      assert.equal(s.kind === "always" && s.reason, want.always);
      return;
    }
    assert.equal(s.kind, "scoped", JSON.stringify(s));
    if (s.kind !== "scoped") return;
    assert.deepEqual(s.patterns.map((p) => p.pattern), want.scoped);
    const globs = s.patterns.map((p) => compileGlob(p.pattern)).filter((g) => g !== null);
    for (const h of want.hits ?? []) assert.ok(matchesAny(globs, h), `${h} should match ${want.scoped.join(", ")}`);
    for (const m of want.misses ?? []) assert.ok(!matchesAny(globs, m), `${m} should not match ${want.scoped.join(", ")}`);
  });
}

test("classifyRule: every pattern keeps the line it was written on", () => {
  const s = classifyRule('---\ndescription: x\npaths:\n  - "a/**"\n  - "b/*.go"\n---\nbody\n');
  assert.equal(s.kind, "scoped");
  if (s.kind === "scoped") assert.deepEqual(s.patterns.map((p) => [p.pattern, p.line]), [["a", 4], ["b/*.go", 5]]);
});

test("classifyRule: YAML outside the modelled subset is undecidable, never guessed", () => {
  assert.equal(classifyRule('---\npaths: &x\n  - "a"\n---\n').kind, "undecidable");
  assert.equal(classifyRule("---\npaths: |\n  a\n---\n").kind, "undecidable");
});

// Valid YAML (checked against the `yaml` and `js-yaml` packages) must never
// read as parse-failed: that reports a scoped rule as loading every session.
test("classifyRule: valid YAML outside the subset is modelled or undecidable, never parse-failed", () => {
  const indentless = classifyRule('---\npaths:\n- "src/**"\n- "lib/*.go"\ndescription: x\n---\nbody\n');
  assert.equal(indentless.kind, "scoped", JSON.stringify(indentless));
  if (indentless.kind === "scoped") assert.deepEqual(indentless.patterns.map((p) => p.pattern), ["src", "lib/*.go"]);
  for (const raw of [
    '---\ndescription: a long\n  continued line\npaths:\n  - "src/**"\n---\nbody\n',
    '---\ndescription: "multi\n  line"\npaths:\n  - "src/**"\n---\nbody\n',
    '---\npaths: [\n  "src/**",\n  "lib/**"\n]\n---\nbody\n',
    '---\n  paths:\n    - "src/**"\n---\nbody\n',
  ]) assert.equal(classifyRule(raw).kind, "undecidable", raw);
  // A complete value followed by an indented block is a real parse error.
  const bad = classifyRule('---\npaths: ["a"]\n  - b\n---\nbody\n');
  assert.equal(bad.kind === "always" && bad.reason, "parse-failed");
});

test("normalizePaths: split, brace-expand, strip one trailing /**, drop empties", () => {
  assert.deepEqual(normalizePaths(["src/{a,b}/**", "", "x, y/**/**"]).map((n) => n.pattern), ["src/a", "src/b", "x", "y/**"]);
  assert.deepEqual(normalizePaths("/**").map((n) => n.pattern), []);
  assert.deepEqual(normalizePaths([7, true, null, { a: "b" }]), []);
});

test("expandBraces: nested groups come out mangled as the loader mangles them", () => {
  assert.deepEqual(expandBraces(["{a,{b,c}}"]), ["a}", "b", "c}"]);
  assert.deepEqual(expandBraces(["x.{ts,tsx}"]), ["x.ts", "x.tsx"]);
});

test("structurallyDead names the patterns no file can match", () => {
  assert.match(structurallyDead("./src/x.ts")!, /\.\//);
  assert.match(structurallyDead("#src")!, /comment/);
  assert.match(structurallyDead("src/[ab")!, /unbalanced/);
  assert.match(structurallyDead("**/*.ts # api")!, /inline/);
  assert.equal(structurallyDead("src/**/*.ts"), null);
});

test("isUniversal: * and **/* match everything; anchored globs do not", () => {
  assert.ok(isUniversal("*"));
  assert.ok(isUniversal("**/*"));
  assert.ok(!isUniversal("*.go"));
  assert.ok(!isUniversal("src"));
});

test("scanImports: the tokens Claude Code 2.1.280 imported, and the ones it did not", () => {
  const raw = [
    "Import plain: @imp/plain.md",
    "Trailing dot: @imp/trail.md.",
    "Paren (see @imp/paren.md)",
    "Paragraph code span `tool @imp/paracode.md --flag` here.",
    "",
    "- run `tool @imp/listcode.md --flag`",
    "",
    "No extension: @imp/noext",
    "<!-- hidden @imp/comment.md -->",
    "mail me at someone@example.com",
    "",
    "```",
    "@imp/fenced.md",
    "```",
    "",
    "    @imp/indented.md",
  ].join("\n");
  const got = scanImports(raw).map((i) => [i.token, i.line, i.inListCode]);
  // Live: plain, listcode and noext loaded; trail.md. and paren.md) were tried
  // with their punctuation and failed; the rest were never tried.
  assert.deepEqual(got, [
    ["imp/plain.md", 1, false],
    ["imp/trail.md.", 2, false],
    ["imp/paren.md)", 3, false],
    ["imp/listcode.md", 6, true],
    ["imp/noext", 8, false],
  ]);
});

test("parseCodexConfig reads the two project-doc keys and stops at the first table", () => {
  const cfg = parseCodexConfig('project_doc_max_bytes = 65_536\nproject_doc_fallback_filenames = ["TEAM.md", "../x", "a/b"]\n[profiles.x]\nproject_doc_max_bytes = 1\n');
  assert.deepEqual(cfg, { maxBytes: 65536, fallbacks: ["TEAM.md"] });
});

test("chargeChain cuts the file that crosses the budget and drops everything deeper", () => {
  const r = chargeChain([
    { path: "AGENTS.md", text: "a".repeat(30) + "\n" + "b".repeat(30) },
    { path: "pkg/AGENTS.md", text: "   \n" },
    { path: "pkg/sub/AGENTS.md", text: "c".repeat(10) },
  ], 40);
  assert.deepEqual(r.cut, { path: "AGENTS.md", keptBytes: 40, line: 2 });
  assert.deepEqual(r.dropped, ["pkg/sub/AGENTS.md"]);
  assert.equal(r.total, 71, "the whole chain, dropped files included");
  assert.equal(chargeChain([{ path: "AGENTS.md", text: "x" }], 40).cut, null);
});
