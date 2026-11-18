import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type RowRecord,
  STATUS_CHOICES, cellFor, chunks, diffCells, epicCells, epicLabel, freshSent, friggResult, gruTickets, gruTitles,
  isRetryable, listSchema, parseChildren, planRows, prName, runFileName, runView, taskCells, titleRichText,
} from "./run_list_lib.ts";

test("runFileName maps a run id to its run file and refuses anything else", () => {
  assert.deepEqual(runFileName("SUPER-17981"), { kind: "super", file: "super-SUPER-17981.json" });
  assert.deepEqual(runFileName("STARK-19039"), { kind: "gru", file: "run-STARK-19039.json" });
  assert.deepEqual(runFileName("GRU-17489"), { kind: "gru", file: "run-GRU-17489.json" });
  for (const bad of ["17981", "SUPER-", "stark-1", "../SUPER-1", "SUPER-1.json"]) assert.throws(() => runFileName(bad), /not a run id/);
});

test("runView reads a Super-Gru run file, and every Gru ends once the file is gone", () => {
  const data = {
    epics: ["STARK-1", "STARK-2", "STARK-3", "bad"],
    grus: { "STARK-1": { state: "live" }, "STARK-2": { state: "ended" }, "STARK-3": { state: "nonsense" } },
  };
  const live = runView("SUPER-1", data, false);
  assert.deepEqual(live.epics, ["STARK-1", "STARK-2", "STARK-3"]);
  assert.deepEqual(live.gru, { "STARK-1": "live", "STARK-2": "ended", "STARK-3": "queued" });
  assert.equal(live.noEpicRow, false);
  assert.deepEqual(runView("SUPER-1", data, true).gru, { "STARK-1": "ended", "STARK-2": "ended", "STARK-3": "ended" });
});

test("runView reads a Gru run file; a --tickets run gets no epic row", () => {
  const epicRun = runView("STARK-10", { epic: "STARK-10", tickets: ["STARK-11", "STARK-12"] }, false);
  assert.deepEqual(epicRun, { kind: "gru", epics: ["STARK-10"], gru: { "STARK-10": "live" }, noEpicRow: false });
  const ticketsRun = runView("GRU-20", { epic: "STARK-20", tickets: ["STARK-20", "STARK-21"] }, true);
  assert.deepEqual(ticketsRun, { kind: "gru", epics: ["STARK-20"], gru: { "STARK-20": "ended" }, noEpicRow: true });
  assert.throws(() => runView("STARK-10", { tickets: [] }, false), /names no epic/);
});

test("gruTickets and gruTitles keep only well-formed tickets, never the epic", () => {
  const run = { epic: "STARK-10", tickets: ["STARK-10", "STARK-11", 7, "x"], titles: { "STARK-11": " Add it ", "STARK-12": 3, bad: "no" } };
  assert.deepEqual(gruTickets(run), ["STARK-11"]);
  assert.deepEqual(gruTitles(run), { "STARK-11": "Add it" });
  assert.deepEqual(gruTickets(undefined), []);
});

test("parseChildren takes a map of epic to ticket ids and refuses any other shape", () => {
  assert.deepEqual(parseChildren({ "STARK-1": ["STARK-2", "STARK-3", "STARK-2"] }), { "STARK-1": ["STARK-2", "STARK-3"] });
  assert.deepEqual(parseChildren({ "STARK-1": ["STARK-100", "STARK-12", "STARK-9"] }), { "STARK-1": ["STARK-9", "STARK-12", "STARK-100"] });
  assert.throws(() => parseChildren([]), /JSON object/);
  assert.throws(() => parseChildren({ "1": [] }), /not a STARK-n id/);
  assert.throws(() => parseChildren({ "STARK-1": "STARK-2" }), /list of STARK-n ids/);
  assert.throws(() => parseChildren({ "STARK-1": ["STARK-2", 3] }), /list of STARK-n ids/);
});

test("planRows puts each epic before its tickets: children first, then the Gru's extra tickets, each once", () => {
  const view = runView("SUPER-1", { epics: ["STARK-1", "STARK-5"], grus: {} }, false);
  const rows = planRows(view, { "STARK-1": ["STARK-2", "STARK-3"], "STARK-5": ["STARK-6"] }, {
    "STARK-1": { epic: "STARK-1", tickets: ["STARK-3", "STARK-4"] },
    "STARK-5": { epic: "STARK-5", tickets: ["STARK-4", "STARK-7"] },
  });
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.id}@${r.epic}`), [
    "epic:STARK-1@STARK-1", "task:STARK-2@STARK-1", "task:STARK-3@STARK-1", "task:STARK-4@STARK-1",
    "epic:STARK-5@STARK-5", "task:STARK-6@STARK-5", "task:STARK-7@STARK-5",
  ]);
});

test("planRows of a --tickets run lists each ticket, the first one included, with no epic row", () => {
  const data = { epic: "STARK-20", tickets: ["STARK-20", "STARK-21"] };
  const rows = planRows(runView("GRU-20", data, false), {}, { "STARK-20": data });
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.id}@${r.epic}`), ["task:STARK-20@STARK-20", "task:STARK-21@STARK-20"]);
});

test("epicLabel numbers the epic and cuts its title to a short name", () => {
  assert.equal(epicLabel(0, "AWS monitoring: CloudWatch, canary", "STARK-1"), "01 AWS monitoring");
  assert.equal(epicLabel(9, "[spec] syn-mcp-server", "STARK-1"), "10 syn-mcp-server");
  assert.equal(epicLabel(2, "", "STARK-7"), "03 STARK-7");
  assert.equal(epicLabel(0, "x".repeat(60), "STARK-1").length, 43);
});

test("listSchema has the 7 columns of List F0CHPN3SFT7, and each select choice has a color", () => {
  const schema = listSchema([{ id: "STARK-1", label: "01 One" }, { id: "STARK-2", label: "02 Two" }]);
  assert.deepEqual(schema.map((c) => `${c.key}:${c.name}:${c.type}`), [
    "title:Ticket:text", "done:Done:checkbox", "status:Status:select", "kind:Kind:select", "epic:Epic:select", "pr:PR:text", "notes:Notes:text",
  ]);
  assert.equal(schema.filter((c) => c.is_primary_column).length, 1);
  assert.deepEqual(schema[2]!.options!.choices.map((c) => c.value), ["queued", "in_progress", "pr_open", "in_review", "merged", "done", "blocked", "cancelled"]);
  for (const col of schema) for (const c of col.options?.choices ?? []) assert.ok(c.color, `${col.key} ${c.value}`);
  assert.deepEqual(schema[4]!.options!.choices, [
    { value: "STARK-1", label: "01 One", color: "indigo" }, { value: "STARK-2", label: "02 Two", color: "blue" },
  ]);
  assert.equal(STATUS_CHOICES.length, 8);
});

test("taskCells maps each stage, a hold, and alfred's state", () => {
  assert.deepEqual(taskCells(undefined, undefined), { status: "queued", done: "false", pr: "", notes: "" });
  assert.equal(taskCells({ stage: "ticket" }, undefined).status, "in_progress");
  assert.deepEqual(taskCells({ stage: "pr", pr: "https://github.com/o/r/pull/9" }, "in progress"), {
    status: "pr_open", done: "false", pr: "https://github.com/o/r/pull/9", notes: "",
  });
  assert.equal(taskCells({ stage: "review" }, undefined).status, "in_review");
  assert.equal(taskCells({ stage: "merged" }, undefined).status, "merged");
  assert.equal(taskCells({ stage: "blocked" }, undefined).status, "blocked");
  assert.equal(taskCells({ stage: "odd" }, undefined).status, "in_progress");
  assert.equal(taskCells({ stage: "review", hold: "merge" }, undefined).notes, "held: merge");
  assert.deepEqual(taskCells({ stage: "closed", hold: "merge" }, undefined), { status: "done", done: "true", pr: "", notes: "" });
  assert.deepEqual(taskCells({ stage: "merged" }, "Closed"), { status: "done", done: "true", pr: "", notes: "" });
  assert.equal(taskCells({ stage: "blocked" }, "cancelled").status, "cancelled");
  assert.equal(taskCells(undefined, "on hold").status, "blocked");
  assert.equal(taskCells(undefined, "in progress").status, "in_progress");
  assert.equal(taskCells(undefined, "review").status, "in_review");
  assert.equal(taskCells({ stage: "pr" }, "on hold").status, "pr_open");
});

test("epicCells counts done tickets and reads the Gru's state", () => {
  assert.deepEqual(epicCells("queued", ["queued", "queued"], undefined), { status: "queued", done: "false", pr: "", notes: "0 of 2 done" });
  assert.deepEqual(epicCells("live", ["done", "pr_open"], undefined), { status: "in_progress", done: "false", pr: "", notes: "1 of 2 done, Gru live" });
  assert.equal(epicCells("reported", ["done", "queued"], undefined).status, "in_progress");
  assert.deepEqual(epicCells("ended", ["done", "blocked"], undefined), { status: "blocked", done: "false", pr: "", notes: "1 of 2 done, Gru ended" });
  assert.deepEqual(epicCells("ended", ["done", "cancelled"], undefined), { status: "done", done: "true", pr: "", notes: "2 of 2 done" });
  assert.equal(epicCells("live", ["done"], undefined).status, "done");
  assert.equal(epicCells("ended", [], undefined).status, "blocked");
  assert.equal(epicCells("queued", [], "done").status, "done");
});

test("the Ticket and PR cells carry links", () => {
  assert.deepEqual(titleRichText("STARK-1", "Add it", "https://app.clickup.com/t/x"), [{
    type: "rich_text", elements: [{ type: "rich_text_section", elements: [
      { type: "link", url: "https://app.clickup.com/t/x", text: "STARK-1" }, { type: "text", text: " Add it" },
    ] }],
  }]);
  assert.deepEqual(titleRichText("STARK-1", "", ""), [{ type: "rich_text", elements: [{ type: "rich_text_section", elements: [{ type: "text", text: "STARK-1" }] }] }]);
  assert.equal(prName("https://github.com/21StarkCom/frigg/pull/962"), "frigg#962");
  assert.equal(prName("https://example.com/x"), "https://example.com/x");
  const cols = { status: "C1", done: "C2", pr: "C3", notes: "C4" };
  assert.deepEqual(cellFor(cols, "R1", "status", "done"), { row_id: "R1", column_id: "C1", select: ["done"] });
  assert.deepEqual(cellFor(cols, "R1", "done", "true"), { row_id: "R1", column_id: "C2", checkbox: true });
  assert.deepEqual(cellFor(cols, "R1", "pr", "https://github.com/o/tyr/pull/5"), {
    row_id: "R1", column_id: "C3",
    rich_text: [{ type: "rich_text", elements: [{ type: "rich_text_section", elements: [{ type: "link", url: "https://github.com/o/tyr/pull/5", text: "tyr#5" }] }] }],
  });
  assert.deepEqual(cellFor(cols, "R1", "notes", ""), { row_id: "R1", column_id: "C4", text: " " });
  assert.throws(() => cellFor({}, "R1", "notes", "x"), /no notes column/);
});

test("diffCells writes only the changed cells, and the epic counts its tickets' new statuses", () => {
  const cols = { status: "CS", done: "CD", pr: "CP", notes: "CN" };
  const rows: Record<string, RowRecord> = {
    "STARK-1": { rowId: "R1", kind: "epic", epic: "STARK-1", sent: freshSent() },
    "STARK-2": { rowId: "R2", kind: "task", epic: "STARK-1", sent: freshSent() },
    "STARK-3": { rowId: "R3", kind: "task", epic: "STARK-1", sent: freshSent(), alfred: "done" },
  };
  const order = ["STARK-1", "STARK-2", "STARK-3"];
  const view = runView("SUPER-1", { epics: ["STARK-1"], grus: { "STARK-1": { state: "live" } } }, false);
  const files = { "STARK-2": { stage: "pr", pr: "https://github.com/o/r/pull/4" } };
  const changes = diffCells(order, rows, cols, view, files);
  assert.deepEqual(changes.map((c) => `${c.id} ${c.key}=${c.value}`), [
    "STARK-2 status=pr_open", "STARK-2 pr=https://github.com/o/r/pull/4",
    "STARK-3 status=done", "STARK-3 done=true",
    "STARK-1 status=in_progress", "STARK-1 notes=1 of 2 done, Gru live",
  ]);
  assert.deepEqual(rows["STARK-2"]!.sent, freshSent(), "diffCells changes no record");
  for (const c of changes) rows[c.id]!.sent[c.key] = c.value;
  assert.deepEqual(diffCells(order, rows, cols, view, files), []);
});

test("chunks, friggResult and isRetryable", () => {
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunks([], 100), []);
  assert.deepEqual(friggResult({ result: { list_id: "F1" }, warnings: [] }), { list_id: "F1" });
  assert.deepEqual(friggResult({ list_id: "F1" }), { list_id: "F1" });
  assert.deepEqual(friggResult(null), {});
  assert.equal(isRetryable("slack: ratelimited", true), true);
  assert.equal(isRetryable("HTTP 429", true), true);
  assert.equal(isRetryable("request timed out", true), false);
  assert.equal(isRetryable("request timed out", false), true);
  assert.equal(isRetryable("invalid_arguments", false), false);
});
