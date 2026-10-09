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
