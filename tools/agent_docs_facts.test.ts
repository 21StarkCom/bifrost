// Contract test for `skill/stark-agent-docs/references/load-facts.md`: the caps
// it states are the ones the measuring tools hold. The doc is prose a writer
// reads; `memory_tidy_lib.ts` and `rules_load_lib.ts` are what gets re-measured
// after a `claude` or `codex` upgrade. A re-measure that moves a constant fails
// here until the doc says the same number.
// node built-ins only — runs under `npm test`.
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  FILE_MAX_BYTES,
  FILE_MAX_LINES,
  INDEX_MAX_CHARS,
  INDEX_MAX_LINES,
} from "./memory_tidy_lib.ts";
import { CODEX_DEFAULT_MAX_BYTES } from "./rules_load_lib.ts";
import { GATE_PHRASES, GATE_STEP_PHRASES, GROWTH_PHRASES, HISTORY_MARKERS, PLAYBOOK_BUDGETS } from "./rules_audit_lib.ts";

const DOC_REL = "skill/stark-agent-docs/references/load-facts.md";
const DOC = path.resolve(import.meta.dirname, "..", DOC_REL);
// Prose wraps, so compare against the doc with every whitespace run collapsed.
const text = fs.readFileSync(DOC, "utf8").replace(/\s+/g, " ");
const grouped = (n: number) => n.toLocaleString("en-US");

function states(claim: string, source: string): void {
  assert.ok(
    text.includes(claim),
    `${DOC_REL} no longer says "${claim}", the value ${source} holds. ` +
      "Update the doc and the constant together.",
  );
}

test("load-facts: the MEMORY.md index caps match memory_tidy_lib", () => {
  states(
    `first ${INDEX_MAX_LINES} lines or ${grouped(INDEX_MAX_CHARS)} characters of MEMORY.md`,
    "memory_tidy_lib.ts INDEX_MAX_LINES / INDEX_MAX_CHARS",
  );
});

test("load-facts: the topic-file recall caps match memory_tidy_lib", () => {
  states(
    `a topic file's first ${FILE_MAX_LINES} lines or ${grouped(FILE_MAX_BYTES)} bytes`,
    "memory_tidy_lib.ts FILE_MAX_LINES / FILE_MAX_BYTES",
  );
});

test("load-facts: Codex's default project-doc cap matches rules_load_lib", () => {
  assert.equal(CODEX_DEFAULT_MAX_BYTES % 1024, 0, "the doc states the cap in whole KiB");
  states(
    `\`project_doc_max_bytes\`, ${CODEX_DEFAULT_MAX_BYTES / 1024} KiB by default`,
    "rules_load_lib.ts CODEX_DEFAULT_MAX_BYTES",
  );
});

// Contract test for `playbook.md`: the budgets and phrase lists of its tables
// are the constants `rules_audit.ts --playbook` triages with.
const PLAYBOOK_REL = "skill/stark-agent-docs/references/playbook.md";
const playbook = fs.readFileSync(path.resolve(import.meta.dirname, "..", PLAYBOOK_REL), "utf8").split("\n");

/** The body rows of the first table under `heading`, as trimmed cells. */
function tableUnder(heading: string): string[][] {
  const start = playbook.indexOf(heading);
  assert.ok(start >= 0, `${PLAYBOOK_REL} has no heading "${heading}"`);
  const rows: string[][] = [];
  for (const line of playbook.slice(start + 1)) {
    if (line.startsWith("#")) break;
    if (line.startsWith("|")) rows.push(line.slice(1, -1).split("|").map((c) => c.trim()));
    else if (rows.length) break;
  }
  return rows.slice(2); // the header row and the rule row
}

const code = (cell: string) => /`([^`]+)`/.exec(cell)?.[1];

test("playbook: the size budgets match PLAYBOOK_BUDGETS", () => {
  const rows = new Map(tableUnder("## Size budgets").map(([label, value]) => [label, value]));
  const chars = (v: string | undefined) => (v?.endsWith("k") ? Number(v.slice(0, -1)) * 1000 : Number(v));
  const expected: [string, number][] = [
    ["A repo's root CLAUDE.md or AGENTS.md", PLAYBOOK_BUDGETS.rootFile],
    ["A package CLAUDE.md or a rule file", PLAYBOOK_BUDGETS.packageFile],
    ["A SKILL.md core (the rest goes to `references/`)", PLAYBOOK_BUDGETS.skillCore],
    ["A skill `description:`", PLAYBOOK_BUDGETS.skillDescription],
    [`A \`MEMORY.md\` index (each line ${PLAYBOOK_BUDGETS.memoryIndexLine} or fewer)`, PLAYBOOK_BUDGETS.memoryIndex],
    ["All files that load together at start-up in one repo", PLAYBOOK_BUDGETS.loadSet],
  ];
  assert.deepEqual([...rows.keys()].sort(), expected.map(([label]) => label).sort(),
    `${PLAYBOOK_REL} and PLAYBOOK_BUDGETS name different files. Update them together.`);
  for (const [label, budget] of expected) {
    assert.equal(chars(rows.get(label)), budget, `${PLAYBOOK_REL} gives "${label}" ${rows.get(label)}, the code ${budget}.`);
  }
  assert.equal(Object.keys(PLAYBOOK_BUDGETS).length, expected.length + 1, "each budget has a row (the index line is in the MEMORY.md row)");
});

test("playbook: the gate phrases match GATE_PHRASES; RED, or RED with a step for GATE_STEP_PHRASES", () => {
  const rows = tableUnder("### Gate phrases (GATE)");
  assert.deepEqual(rows.map(([phrase]) => code(phrase)), [...GATE_PHRASES]);
  for (const [phrase, flag] of rows) {
    const expected = GATE_STEP_PHRASES.includes(code(phrase)!) ? "RED when the sentence gives a step" : "RED";
    assert.equal(flag, expected, `${PLAYBOOK_REL} flags ${phrase} "${flag}", the code "${expected}".`);
  }
});

test("playbook: the gate checks name the code's lists", () => {
  const section = playbook.join("\n");
  for (const name of ["gateFlag", "KEPT_GATE_RES", "GATE_STEP_PHRASES"]) {
    assert.ok(section.includes(`\`${name}\``), `${PLAYBOOK_REL} no longer names \`${name}\`.`);
  }
  assert.ok(GATE_STEP_PHRASES.every((p) => GATE_PHRASES.includes(p)), "each GATE_STEP_PHRASES entry is a gate phrase");
});

test("playbook: the growth phrases match GROWTH_PHRASES, all RED", () => {
  const rows = tableUnder("### Growth phrases (GROWTH)");
  assert.deepEqual(rows.map(([phrase]) => code(phrase)), [...GROWTH_PHRASES]);
  assert.ok(rows.every(([, flag]) => flag === "RED"));
});

test("playbook: the history markers match HISTORY_MARKERS", () => {
  const rows = tableUnder("### Markers (HISTORY)");
  assert.deepEqual(
    rows.map(([label, cell, flag]) => ({ label, match: code(cell), notAfter: [...cell.matchAll(/"([^"]+)"/g)].map((m) => m[1]), flag })),
    HISTORY_MARKERS.map((m) => ({ label: m.label, match: m.pattern ?? m.phrase, notAfter: [...(m.notAfter ?? [])], flag: m.flag })),
  );
});
