#!/usr/bin/env node
// run_list.ts — mirror one Gru or Super-Gru run in a Slack List.
//
// `start` makes the List, shares it with the user of the Slack read token and
// starts the watcher detached. The watcher syncs each 2 minutes from the run
// files in ~/.cache/stark-progress and from alfred, and ends one final sync
// after the run file is gone. The skill /stark-run-list drives it.
//
// The pure logic is in run_list_lib.ts. This file does the I/O: the run files,
// the state file, `frigg invoke` for the List and `alfred task show` for the
// tickets. RUN_LIST_GAP_MS sets the wait between two Slack writes (default
// 3200, so a first sync of 150 rows stays under Slack's rate limits); the
// tests set it to 0.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { precheckCli } from "./cli_args_lib.ts";
import { isMainModule } from "./main_module_lib.ts";
import { stateRoot } from "./asset_root_lib.ts";
import {
  type GruRunFile, type RowRecord, type TicketFile,
  chunks, diffCells, epicLabel, freshSent, friggResult, gruTitles, isRetryable, listSchema,
  parseChildren, planRows, runFileName, runView, titleRichText,
} from "./run_list_lib.ts";

const USAGE = `usage: run_list.ts <start|sync|watch|stop> <run id> [options]

Mirror one Gru or Super-Gru run in a Slack List: one row for each epic and
each ticket. A run id is SUPER-n (a Super-Gru run), or STARK-n or GRU-n (a
Gru run). Its run file must exist in $STARK_PROGRESS_DIR
(default ~/.cache/stark-progress).

  start <run id> [--name <text>] [--description <text>] [--children <file>] [--no-watch]
      Make the List, or use the one the state names. Share it with the user
      of the Slack read token, print its URL, and start the watcher
      detached. --children is a JSON file: a map of epic id to a list of
      ticket ids, from alfred's list_children tool.
  sync <run id> [--alfred]
      Add the missing rows, then write the cells that changed. --alfred
      reads the state of each open ticket from alfred.
  watch <run id> [--interval <seconds>]
      Sync each 120 seconds, with --alfred on the first round and each
      15th round. After the run file is gone, sync one last time and exit.
  stop <run id>
      Stop the watcher by the PID in its pid file.

State: <state root>/run-lists/<run id>.json, with .log and .pid beside it.
The List writes go through frigg invoke, with TYR_SLACK_LIST_WRITES_ENABLE=1.
Run it from inside a git checkout: alfred needs one.
`;

const VERBS = ["start", "sync", "watch", "stop"] as const;
type Verb = (typeof VERBS)[number];
const FLAGS_OF: Record<Verb, string[]> = {
  start: ["name", "description", "children", "no-watch"],
  sync: ["alfred"],
  watch: ["interval"],
  stop: [],
};

interface ListState {
  version: 1;
  runId: string;
  listId: string;
  url: string;
  cols: Record<string, string>;
  children: Record<string, string[]>;
  rows: Record<string, RowRecord>;
  order: string[];
  lastRun?: unknown;
  /** False until the user of the read token can open the List: each start tries the share again. */
  shared?: boolean;
}

interface Meta {
  title: string;
  url: string;
  state: string;
}

const GAP_MS = Math.max(0, Number(process.env.RUN_LIST_GAP_MS ?? 3200) || 0);
const MAX_CELLS = 100;

function progressDir(): string {
  return process.env.STARK_PROGRESS_DIR?.trim() || path.join(os.homedir(), ".cache", "stark-progress");
}

function paths(runId: string) {
  const dir = path.join(stateRoot(), "run-lists");
  return {
    dir,
    state: path.join(dir, `${runId}.json`),
    log: path.join(dir, `${runId}.log`),
    pid: path.join(dir, `${runId}.pid`),
    lock: path.join(dir, `${runId}.lock`),
  };
}

function sleep(ms: number): void {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(data, null, 1)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

function stamp(): string {
  return new Date().toISOString();
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readPid(file: string): number {
  try {
    return Number(fs.readFileSync(file, "utf8").trim());
  } catch {
    return 0;
  }
}

/** One frigg capability call. A write sets the List gate and `--confirm`. */
function frigg(cap: string, args: unknown, write: boolean): Record<string, unknown> {
  const argv = ["invoke", cap, "--json-args", JSON.stringify(args), "--json"];
  const env = { ...process.env };
  if (write) {
    argv.push("--confirm");
    env.TYR_SLACK_LIST_WRITES_ENABLE = "1";
  }
  for (let attempt = 1; ; attempt++) {
    const r = spawnSync("frigg", argv, { encoding: "utf8", env, timeout: 180_000, maxBuffer: 64 << 20 });
    if (r.error) {
      // A spawn timeout can come after a write landed: only a read tries again.
      const timedOut = (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
      if (!timedOut || write || attempt >= 3) throw new Error(`frigg ${cap}: ${r.error.message}`);
      sleep(20_000);
      continue;
    }
    if (r.status === 0) {
      try {
        return friggResult(JSON.parse(r.stdout));
      } catch {
        throw new Error(`frigg ${cap}: the answer is not JSON: ${r.stdout.slice(0, 300)}`);
      }
    }
    const text = `${r.stdout}\n${r.stderr}`.trim().slice(-800);
    if (attempt >= 3 || !isRetryable(text, write)) throw new Error(`frigg ${cap} exit ${r.status}: ${text}`);
    sleep(20_000);
  }
}

/** A ticket's title, URL and state from alfred, or undefined when alfred cannot read it. */
function alfredShow(id: string): Meta | undefined {
  const r = spawnSync("alfred", ["task", "show", "--no-comments", "--json", id], { encoding: "utf8", timeout: 60_000, maxBuffer: 16 << 20 });
  if (r.error || r.status !== 0) return undefined;
  try {
    const item = (JSON.parse(r.stdout) as { item?: { name?: unknown; state?: unknown; ref?: { url?: unknown } } }).item;
    if (!item) return undefined;
    return {
      title: typeof item.name === "string" ? item.name.trim() : "",
      url: typeof item.ref?.url === "string" ? item.ref.url : "",
      state: typeof item.state === "string" ? item.state : "",
    };
  } catch {
    return undefined;
  }
}

/** The run file of a run: its data, or the last copy the state holds once it is gone. */
function readRun(runId: string, st?: ListState): { data: unknown; gone: boolean } {
  const file = path.join(progressDir(), runFileName(runId).file);
  const data = readJson(file);
  if (data !== undefined) return { data, gone: false };
  if (fs.existsSync(file)) throw new Error(`the run file ${file} does not parse`);
  return { data: st?.lastRun, gone: true };
}

/** Take the sync lock of a run, or return false while a live process holds it. */
function takeLock(file: string): boolean {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const holder = readPid(file);
      if (pidAlive(holder)) return false;
      // An empty lock is one that its taker has not written yet: not stale.
      if (!holder && Date.now() - (fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0) < 10_000) return false;
      fs.rmSync(file, { force: true });
    }
  }
  return false;
}

function dropLock(file: string): void {
  if (readPid(file) === process.pid) fs.rmSync(file, { force: true });
}

/** Wait for the sync lock of a run: a first sync can hold it for some minutes. */
function waitLock(file: string): void {
  const until = Date.now() + 15 * 60_000;
  while (!takeLock(file)) {
    if (Date.now() > until) throw new Error(`another sync holds ${file}: try again later`);
    sleep(2_000);
  }
}

/** Share the List with the user of the Slack read token: frigg writes as the bot, so that user cannot open it until then. */
function shareList(st: ListState): void {
  const who = frigg("slack.auth_test", {}, false);
  if (typeof who.url === "string" && typeof who.team_id === "string") st.url = `${who.url.replace(/\/?$/, "/")}lists/${who.team_id}/${st.listId}`;
  if (typeof who.user_id === "string" && !who.bot_id) {
    // Slack can answer ok and still leave an id unchanged: only `complete` proves the share.
    const shared = frigg("slack.set_list_access", { list_id: st.listId, access_level: "write", user_ids: [who.user_id] }, true);
    st.shared = shared.complete === true;
    console.log(st.shared ? `shared with ${who.user_id} (write)` : `share incomplete, share the List by hand: ${JSON.stringify(shared).slice(0, 300)}`);
  } else {
    console.log("not shared: the Slack read token is not a user's; share the List by hand");
  }
}

function start(runId: string, flags: Map<string, string | true>): void {
  const p = paths(runId);
  const children = typeof flags.get("children") === "string" ? parseChildren(readJsonFile(flags.get("children") as string)) : {};
  // The state changes under the sync lock only: a sync that read it before would write over this change.
  waitLock(p.lock);
  let st: ListState | undefined;
  let gone: boolean;
  try {
    st = readJson(p.state) as ListState | undefined;
    const run = readRun(runId, st);
    gone = run.gone;
    st = makeOrMerge(runId, p.state, st, run.data, gone, children, flags);
  } finally {
    dropLock(p.lock);
  }
  console.log(`List: ${st.url || st.listId}`);
  console.log(`state: ${p.state}`);
  if (flags.has("no-watch")) return;
  if (gone) {
    console.log("watcher: none, the run file is gone");
    return;
  }
  const live = readPid(p.pid);
  if (pidAlive(live)) {
    console.log(`watcher: already runs, pid ${live}`);
    return;
  }
  const out = fs.openSync(p.log, "a");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "watch", runId], {
    detached: true, stdio: ["ignore", out, out], cwd: process.cwd(), env: process.env,
  });
  child.unref();
  fs.closeSync(out);
  // Write the pid now, not when the watcher starts: a second start in between would launch a second watcher.
  if (child.pid) fs.writeFileSync(p.pid, String(child.pid));
  console.log(`watcher: pid ${child.pid}, log ${p.log}`);
}

/** Make the List when the state names none, else merge new children into the state. The caller holds the sync lock. */
function makeOrMerge(
  runId: string, stateFile: string, st: ListState | undefined, data: unknown, gone: boolean,
  children: Record<string, string[]>, flags: Map<string, string | true>,
): ListState {
  if (!st) {
    if (gone) throw new Error(`no run file for ${runId} in ${progressDir()}`);
    const view = runView(runId, data, false);
    const meta: Record<string, Meta> = {};
    for (const e of view.epics) meta[e] = alfredShow(e) ?? { title: "", url: "", state: "" };
    const choices = view.epics.map((e, i) => ({
      id: e,
      label: view.noEpicRow ? epicLabel(i, runId, runId) : epicLabel(i, meta[e]!.title, e),
    }));
    const name = typeof flags.get("name") === "string"
      ? (flags.get("name") as string)
      : view.kind === "super" ? `${runId} run (Super-Gru)` : `${view.noEpicRow ? runId : meta[view.epics[0]!]!.title || runId} (Gru)`;
    const description = typeof flags.get("description") === "string"
      ? (flags.get("description") as string)
      : `The epics and tickets of run ${runId}, one row each. A sync updates it each 2 minutes until the run ends.`;
    const made = frigg("slack.create_list", { name, description, schema: listSchema(choices) }, true);
    const listId = typeof made.list_id === "string" ? made.list_id : "";
    if (!listId) throw new Error(`slack.create_list answered no list_id: the List may exist. Answer: ${JSON.stringify(made).slice(0, 300)}`);
    const cols: Record<string, string> = {};
    for (const c of (Array.isArray(made.schema) ? made.schema : []) as Array<{ key?: unknown; id?: unknown }>) {
      if (typeof c.key === "string" && typeof c.id === "string") cols[c.key] = c.id;
    }
    // A write of the state before the share: a failed share leaves `shared` false, and the next start tries it again.
    st = { version: 1, runId, listId, url: "", cols, children, rows: {}, order: [], lastRun: data, shared: false };
    writeJson(stateFile, st);
    console.log(`made List ${listId} for ${runId}`);
  } else if (Object.keys(children).length > 0) {
    for (const [e, kids] of Object.entries(children)) st.children[e] = [...new Set([...(st.children[e] ?? []), ...kids])];
    writeJson(stateFile, st);
  }
  if (st.shared === false) {
    shareList(st);
    writeJson(stateFile, st);
  }
  return st;
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`cannot read ${file}: ${(err as Error).message}`);
  }
}

/** One sync. Returns the log line, or undefined when another sync holds the lock. */
function sync(runId: string, withAlfred: boolean): string | undefined {
  const p = paths(runId);
  if (!fs.existsSync(p.state)) throw new Error(`no List for ${runId}: run start first`);
  if (!takeLock(p.lock)) return undefined;
  try {
    // Read the state under the lock: a copy read before it can miss the rows that another sync added.
    const st = readJson(p.state) as ListState | undefined;
    if (!st) throw new Error(`the state ${p.state} does not parse`);
    const { data, gone } = readRun(runId, st);
    if (data === undefined) throw new Error(`no run file for ${runId}, and the state holds no copy`);
    if (!gone) st.lastRun = data;
    const view = runView(runId, data, gone);
    const gruRuns: Record<string, GruRunFile | undefined> = {};
    const titles: Record<string, string> = {};
    for (const e of view.epics) {
      gruRuns[e] = (view.kind === "gru" ? data : readJson(path.join(progressDir(), `run-${e}.json`))) as GruRunFile | undefined;
      Object.assign(titles, gruTitles(gruRuns[e]));
    }

    let added = 0;
    const fresh = new Set<string>();
    for (const row of planRows(view, st.children, gruRuns)) {
      if (st.rows[row.id]) continue;
      const meta = alfredShow(row.id);
      const title = meta?.title || titles[row.id] || "";
      if (!meta && !title) {
        console.error(`${stamp()} skip ${row.id} this round: alfred cannot read it`);
        continue;
      }
      const made = frigg("slack.create_list_item", {
        list_id: st.listId,
        initial_fields: [
          { column_id: st.cols.title, rich_text: titleRichText(row.id, title, meta?.url ?? "") },
          { column_id: st.cols.status, select: ["queued"] },
          { column_id: st.cols.kind, select: [row.kind] },
          { column_id: st.cols.epic, select: [row.epic] },
        ],
      }, true);
      const item = made.item as { id?: unknown } | undefined;
      const rowId = typeof item?.id === "string" ? item.id : typeof made.id === "string" ? made.id : "";
      if (!rowId) throw new Error(`slack.create_list_item answered no row id for ${row.id}: read the List before a new sync`);
      st.rows[row.id] = { rowId, kind: row.kind, epic: row.epic, sent: freshSent(), alfred: meta?.state };
      st.order.push(row.id);
      fresh.add(row.id);
      added++;
      writeJson(p.state, st);
      sleep(GAP_MS);
    }

    if (withAlfred) {
      for (const id of st.order) {
        const rec = st.rows[id]!;
        if (fresh.has(id) || rec.sent.status === "done" || rec.sent.status === "cancelled") continue;
        const meta = alfredShow(id);
        if (meta?.state) rec.alfred = meta.state;
      }
    }

    const files: Record<string, TicketFile | undefined> = {};
    for (const id of st.order) {
      if (st.rows[id]!.kind === "task") files[id] = readJson(path.join(progressDir(), `${id}.json`)) as TicketFile | undefined;
    }
    const changes = diffCells(st.order, st.rows, st.cols, view, files);
    const parts = chunks(changes, MAX_CELLS);
    parts.forEach((part, i) => {
      if (i > 0) sleep(GAP_MS);
      frigg("slack.update_list_items", { list_id: st.listId, cells: part.map((c) => c.cell) }, true);
      for (const c of part) st.rows[c.id]!.sent[c.key] = c.value;
      writeJson(p.state, st);
    });
    writeJson(p.state, st);
    const shown = changes.slice(0, 12).map((c) => `${c.id} ${c.key}=${c.value}`).join(", ");
    return `${stamp()} sync${withAlfred ? " --alfred" : ""}: ${added} rows added, ${changes.length} cells${shown ? `: ${shown}` : ""}${gone ? " (run file gone)" : ""}`;
  } finally {
    dropLock(p.lock);
  }
}

async function watch(runId: string, intervalS: number): Promise<void> {
  const p = paths(runId);
  if (!fs.existsSync(p.state)) throw new Error(`no List for ${runId}: run start first`);
  const live = readPid(p.pid);
  if (live !== process.pid && pidAlive(live)) throw new Error(`a watcher of ${runId} runs: pid ${live}`);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.pid, String(process.pid));
  const runFile = path.join(progressDir(), runFileName(runId).file);
  console.log(`${stamp()} watch ${runId}: pid ${process.pid}, each ${intervalS} s`);
  try {
    for (let round = 0, finalTries = 0; ; round++) {
      const gone = !fs.existsSync(runFile);
      let synced = false;
      try {
        const line = sync(runId, gone || round % 15 === 0);
        synced = line !== undefined;
        console.log(line ?? `${stamp()} sync skipped: another sync holds the lock`);
      } catch (err) {
        console.error(`${stamp()} sync failed: ${(err as Error).message}`);
      }
      // No later round fixes a failed or skipped final sync, so try it again a few times.
      if (gone && (synced || ++finalTries >= 3)) {
        console.log(`${stamp()} run file gone: ${synced ? "final sync done" : "final sync failed 3 times"}, watcher ends`);
        return;
      }
      await new Promise((r) => setTimeout(r, intervalS * 1000));
    }
  } finally {
    if (readPid(p.pid) === process.pid) fs.rmSync(p.pid, { force: true });
  }
}

function stop(runId: string): void {
  const p = paths(runId);
  const pid = readPid(p.pid);
  if (!pidAlive(pid)) {
    fs.rmSync(p.pid, { force: true });
    console.log(`no watcher of ${runId} runs`);
    return;
  }
  const ps = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", timeout: 10_000 });
  const command = ps.stdout ?? "";
  // Match the whole run id: STARK-1 must not match the watcher of STARK-12.
  if (!command.includes("run_list.ts") || !new RegExp(` watch ${runId}(\\s|$)`).test(command)) {
    throw new Error(`pid ${pid} in ${p.pid} is not the watcher of ${runId}: ${command.trim() || "no command"}`);
  }
  process.kill(pid, "SIGTERM");
  fs.rmSync(p.pid, { force: true });
  console.log(`stopped the watcher of ${runId}, pid ${pid}`);
}

export async function main(argv: string[]): Promise<number> {
  const { flags, positionals } = precheckCli(argv, {
    values: ["--name", "--description", "--children", "--interval"],
    switches: ["--alfred", "--no-watch"],
    positionals: 2,
  }, USAGE);
  const [verb, runId] = positionals;
  if (!verb || !(VERBS as readonly string[]).includes(verb)) {
    process.stderr.write(`unknown subcommand: ${verb ?? "(none)"}\n${USAGE}`);
    return 2;
  }
  if (!runId) {
    process.stderr.write(`${verb} needs a run id\n${USAGE}`);
    return 2;
  }
  for (const key of flags.keys()) {
    if (!FLAGS_OF[verb as Verb].includes(key)) {
      process.stderr.write(`unsupported argument for ${verb}: --${key}\n${USAGE}`);
      return 2;
    }
  }
  let interval = 120;
  if (flags.has("interval")) {
    interval = Number(flags.get("interval"));
    // setTimeout runs a delay above 2^31 - 1 ms at once, so the cap is one day.
    if (!Number.isFinite(interval) || interval < 1 || interval > 86_400) {
      process.stderr.write(`--interval needs a number of seconds, 1 to 86400\n${USAGE}`);
      return 2;
    }
  }
  try {
    runFileName(runId);
    if (verb === "start") start(runId, flags);
    else if (verb === "sync") {
      const line = sync(runId, flags.has("alfred"));
      if (!line) throw new Error(`another sync of ${runId} runs now`);
      console.log(line);
    } else if (verb === "watch") await watch(runId, interval);
    else stop(runId);
    return 0;
  } catch (err) {
    process.stderr.write(`run_list: ${(err as Error).message}\n`);
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
