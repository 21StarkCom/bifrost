// Tests for `tools/fact_routing_hook_lib.ts` (STARK-1785). Covers the classifier
// (the four routing classes + the null cases), the frontmatter/body parsers, the
// whole-word slug matcher (hyphenated slugs, no substring false-hits), the
// queue roundtrip, and the corpus slug reader. Every fixture is synthetic: real
// memory files are never copied in.
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyMemory,
  frontmatterType,
  bodyOf,
  descriptionOf,
  fleetSlugsMentioned,
  makeEntry,
  appendToQueue,
  claudeConfigDir,
  defaultQueuePath,
  isAutoMemoryPath,
  resolveFleetSlugs,
  FALLBACK_SLUGS,
} from "./fact_routing_hook_lib.ts";

const SLUGS = ["tyr", "frigg", "alfred", "meridian", "stark-tui", "plume"];

function note(type: string, body: string): string {
  return `---\nname: x\ntype: ${type}\n---\n\n${body}\n`;
}

test("frontmatterType reads the type; bodyOf strips frontmatter", () => {
  const c = note("project", "hello body");
  assert.equal(frontmatterType(c), "project");
  assert.equal(bodyOf(c).trim(), "hello body");
  assert.equal(frontmatterType("no frontmatter here"), undefined);
});

test("fleetSlugsMentioned is whole-word and hyphen-safe (no substring hits)", () => {
  assert.deepEqual(fleetSlugsMentioned("stark-tui powers frigg's cockpit", SLUGS).sort(), ["frigg", "stark-tui"]);
  assert.deepEqual(fleetSlugsMentioned("startup friggin fritter", SLUGS), []); // no false hits
  assert.deepEqual(fleetSlugsMentioned("use tyr's clickup adapter", SLUGS), ["tyr"]); // apostrophe boundary
});

test("class 1 — product language + a fleet slug routes to corpus", () => {
  const c = note("project", "Reach for meridian for cron jobs instead of a one-off script.");
  assert.deepEqual(classifyMemory(c, "/x/projects/p/memory/f.md", SLUGS)?.route, "corpus");
  const d = note("project", "Reach for plume instead of a spreadsheet macro for xlsx output.");
  assert.deepEqual(classifyMemory(d, "/x/projects/p/memory/f.md", SLUGS)?.route, "corpus");
});

test("class 1 — a cross-repo relationship (two slugs) routes to corpus even without when-to-reach words", () => {
  const c = note("project", "frigg imports tyr connector libraries as a pinned module.");
  assert.equal(classifyMemory(c, "/x/projects/p/memory/f.md", SLUGS)?.route, "corpus");
});

test("class 2 — implementation detail about a repo routes to repo-claude", () => {
  const c = note("project", "The lint gate in tools/lint.ts trips on plume; the test covers the exit code.");
  assert.equal(classifyMemory(c, "/x/projects/p/memory/f.md", SLUGS)?.route, "repo-claude");
});

test("class 2 — a multi-repo IMPLEMENTATION fact routes to repo-claude, not corpus", () => {
  // Two slugs, but impl markers present → the repo, not the corpus. Guards the
  // dominant mis-store class (repo-implementation) against the bare 2-slug rule.
  const c = note("project", "frigg's cache schema is imported by tyr's sql adapter in internal/db.go.");
  assert.equal(classifyMemory(c, "/x/projects/p/memory/f.md", SLUGS)?.route, "repo-claude");
});

test("class 2 — implementation markers win over product language", () => {
  // File paths plus an incidental "instead of": a repo note, not a fleet fact.
  const c = note("project", "plume writes the sheet in pkg/xlsx/writer.go with a streaming encoder instead of buffering rows.");
  assert.equal(classifyMemory(c, "/x/projects/p/memory/f.md", SLUGS)?.route, "repo-claude");
});

test("null — ordinary prose around one slug is not when-to-reach language", () => {
  for (const body of ["plume is a document toolkit.", "frigg is the cockpit.", "frigg owns the identity cache."]) {
    assert.equal(classifyMemory(note("project", body), "/x/projects/p/memory/f.md", SLUGS), null, body);
  }
});

test("null — a ticket progress log routes nowhere", () => {
  const fp = "/x/projects/p/memory/f.md";
  // Names one slug and says "is a": the old class-1 test sent this to the corpus.
  assert.equal(classifyMemory(note("project", "STARK-4242 done, merged 1a2b3c4. plume is a dependency of the report."), fp, SLUGS), null);
  // The headline is the description when there is one, and a log stays a log
  // whatever its body names — implementation markers and a second slug included.
  const described = "---\nname: x\ntype: project\ndescription: STARK-4242 shipped the frigg cache\n---\n\ntyr's schema in internal/db.go.\n";
  assert.equal(classifyMemory(described, fp, SLUGS), null);
  // The ticket id can sit in the filename instead.
  assert.equal(classifyMemory(note("project", "DONE — frigg imports tyr as a pinned module."), "/x/projects/p/memory/stark-4242-frigg-cache.md", SLUGS), null);
});

test("a ticket id alone, or a completion word alone, is not a progress log", () => {
  const fp = "/x/projects/p/memory/f.md";
  assert.equal(classifyMemory(note("project", "frigg main requires the ci gate (STARK-4242)."), fp, SLUGS)?.route, "repo-claude");
  assert.equal(classifyMemory(note("project", "frigg's merged cache schema lives in internal/db.go."), fp, SLUGS)?.route, "repo-claude");
  // "fail-closed" is not "closed".
  assert.equal(classifyMemory(note("project", "STARK-4242: frigg's gate is fail-closed."), fp, SLUGS)?.route, "repo-claude");
});

test("classifier scans the description field, not only the body", () => {
  const c = "---\nname: x\ntype: project\ndescription: Reach for meridian instead of a one-off cron script.\n---\n\nterse body.\n";
  assert.equal(descriptionOf(c), "Reach for meridian instead of a one-off cron script.");
  assert.equal(classifyMemory(c, "/x/projects/p/memory/f.md", SLUGS)?.route, "corpus");
});

test("fleetSlugsMentioned tolerates a regex-metachar slug (no throw)", () => {
  assert.deepEqual(fleetSlugsMentioned("built on node.js runtime", ["node.js", "frigg"]), ["node.js"]);
});

test("null — feedback and user types stay in Claude memory", () => {
  assert.equal(classifyMemory(note("feedback", "Reach for meridian; frigg is the cache."), "/x/projects/p/memory/f.md", SLUGS), null);
  assert.equal(classifyMemory(note("user", "Aryeh prefers Go and tyr."), "/x/projects/p/memory/f.md", SLUGS), null);
});

test("null — MEMORY.md index and no-signal facts are not flagged", () => {
  assert.equal(classifyMemory(note("project", "tyr frigg meridian"), "/x/projects/p/memory/MEMORY.md", SLUGS), null);
  assert.equal(classifyMemory(note("project", "Remember to buy milk on the way home."), "/x/projects/p/memory/f.md", SLUGS), null);
});

test("queue roundtrip — makeEntry extracts the project, appendToQueue writes JSONL", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fact-route-"));
  try {
    const q = path.join(dir, "q.jsonl");
    const fp = "/Users/x/.claude/projects/-Users-x-Code-21Stark-plume/memory/foo.md";
    const entry = makeEntry({ route: "corpus", reason: "r" }, fp, "  a   b  ", "2026-08-29T00:00:00Z");
    assert.equal(entry.project, "-Users-x-Code-21Stark-plume");
    assert.equal(entry.snippet, "a b");
    appendToQueue(entry, q);
    appendToQueue(entry, q);
    const lines = fs.readFileSync(q, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).route, "corpus");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("claudeConfigDir honors CLAUDE_CONFIG_DIR, else ~/.claude; the queue lives under it", () => {
  assert.equal(claudeConfigDir({}, "/home/x"), "/home/x/.claude");
  assert.equal(claudeConfigDir({ CLAUDE_CONFIG_DIR: "/home/x/.claude-work" }, "/home/x"), "/home/x/.claude-work");
  assert.equal(defaultQueuePath("/home/x/.claude"), "/home/x/.claude/.fact-routing-queue.jsonl");
});

test("isAutoMemoryPath matches <configDir>/projects/<p>/memory/<n>.md only", () => {
  const cfg = "/home/x/.claude-work";
  assert.equal(isAutoMemoryPath(`${cfg}/projects/p/memory/f.md`, cfg), true);
  assert.equal(isAutoMemoryPath(`${cfg}/projects/p/memory/sub/f.md`, cfg), false);
  assert.equal(isAutoMemoryPath(`${cfg}/projects/p/memory/f.txt`, cfg), false);
  // Another profile's memory, and a repo that merely has the same shape, are not this profile's.
  assert.equal(isAutoMemoryPath("/home/x/.claude/projects/p/memory/f.md", cfg), false);
  assert.equal(isAutoMemoryPath("/home/x/Code/r/.claude/projects/p/memory/f.md", "/home/x/.claude"), false);
});

test("resolveFleetSlugs reads one folder per entity: <repos|systems>/<slug>/index.md", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fact-corpus-"));
  const entity = (sub: string, slug: string, file = "index.md") => {
    fs.mkdirSync(path.join(dir, sub, slug), { recursive: true });
    fs.writeFileSync(path.join(dir, sub, slug, file), "x");
  };
  try {
    entity("repos", "plume");
    entity("repos", "stark-tui");
    entity("systems", "mimir");
    entity("systems", "plume"); // an entity under both roots is one slug
    entity("repos", "no-index", "notes.md"); // a folder without an index.md is not an entity
    entity("repos", "_template"); // nor is a non-kebab folder
    fs.writeFileSync(path.join(dir, "repos", "README.md"), "x");
    fs.writeFileSync(path.join(dir, "repos", "frigg.md"), "x"); // the retired flat-file layout
    assert.deepEqual(resolveFleetSlugs(dir).sort(), ["mimir", "plume", "stark-tui"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveFleetSlugs is empty when the corpus is absent", () => {
  assert.deepEqual(resolveFleetSlugs(path.join(os.tmpdir(), "no-such-corpus-xyz")), []);
});

test("FALLBACK_SLUGS are unique kebab slugs", () => {
  assert.equal(new Set(FALLBACK_SLUGS).size, FALLBACK_SLUGS.length);
  for (const s of FALLBACK_SLUGS) assert.match(s, /^[a-z0-9][a-z0-9-]*$/);
});
