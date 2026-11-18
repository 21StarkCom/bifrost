// The pure logic of `run_list.ts`, the Slack List mirror of one Gru or
// Super-Gru run: the List's schema, the rows a run wants, the cells each row
// wants, and the diff against the cells the last sync sent. No subprocess,
// no file and no clock here; `run_list.ts` does the I/O.
//
// The shape copies List F0CHPN3SFT7, the hand-made mirror of run SUPER-17981:
// one row for each epic and for each ticket, with the columns Ticket, Done,
// Status, Kind, Epic, PR and Notes.

export type Status = "queued" | "in_progress" | "pr_open" | "in_review" | "merged" | "done" | "blocked" | "cancelled";
export type Kind = "epic" | "task";
export type CellKey = "status" | "done" | "pr" | "notes";
export type GruState = "queued" | "live" | "reported" | "ended";

// Slack refuses a select choice with no color.
export const STATUS_CHOICES: ReadonlyArray<{ value: Status; label: string; color: string }> = [
  { value: "queued", label: "Queued", color: "gray" },
  { value: "in_progress", label: "In progress", color: "blue" },
  { value: "pr_open", label: "PR open", color: "yellow" },
  { value: "in_review", label: "In review", color: "purple" },
  { value: "merged", label: "Merged", color: "cyan" },
  { value: "done", label: "Done", color: "green" },
  { value: "blocked", label: "Blocked", color: "red" },
  { value: "cancelled", label: "Cancelled", color: "brown" },
];
export const EPIC_COLORS = ["indigo", "blue", "cyan", "pink", "yellow", "green", "red", "purple", "orange", "brown", "gray"];

/** The stage of a ticket's progress file, as the stark-progress mod's state contract names it. */
const STAGE_STATUS: Record<string, Status> = {
  ticket: "in_progress", pr: "pr_open", review: "in_review", merged: "merged", closed: "done", blocked: "blocked",
};

const RUN_ID = /^(SUPER|STARK|GRU)-\d+$/;
const TICKET_ID = /^STARK-\d+$/;

/** The run file of a run id: `super-SUPER-n.json` for a Super-Gru run, `run-<id>.json` for a Gru run. */
export function runFileName(runId: string): { kind: "super" | "gru"; file: string } {
  if (!RUN_ID.test(runId)) throw new Error(`not a run id: ${runId} (want SUPER-n, STARK-n or GRU-n)`);
  return runId.startsWith("SUPER-") ? { kind: "super", file: `super-${runId}.json` } : { kind: "gru", file: `run-${runId}.json` };
}

export function isTicketId(id: unknown): id is string {
  return typeof id === "string" && TICKET_ID.test(id);
}

/** One run, read from its run file: the epics in order and the state of each epic's Gru. */
export interface RunView {
  kind: "super" | "gru";
  epics: string[];
  gru: Record<string, GruState>;
  /** A Gru `--tickets` run: its `epic` is one of its tickets, so it gets no epic row. */
  noEpicRow: boolean;
}

/** A Gru run file, as `run-<id>.json` holds it. */
export interface GruRunFile {
  epic?: unknown;
  tickets?: unknown;
  titles?: unknown;
}

/**
 * Read a run file into a RunView. `gone` says that the run file no longer
 * exists and `data` is the last copy: every Gru of the run has ended.
 */
export function runView(runId: string, data: unknown, gone: boolean): RunView {
  const { kind } = runFileName(runId);
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (kind === "super") {
    const epics = Array.isArray(obj.epics) ? obj.epics.filter(isTicketId) : [];
    const grus = (obj.grus && typeof obj.grus === "object" ? obj.grus : {}) as Record<string, { state?: unknown }>;
    const gru: Record<string, GruState> = {};
    for (const e of epics) {
      const s = grus[e]?.state;
      gru[e] = gone ? "ended" : s === "live" || s === "reported" || s === "ended" ? s : "queued";
    }
    return { kind, epics, gru, noEpicRow: false };
  }
  const epic = isTicketId(obj.epic) ? obj.epic : undefined;
  if (!epic) throw new Error(`run file of ${runId} names no epic`);
  const tickets = Array.isArray(obj.tickets) ? obj.tickets : [];
  return { kind, epics: [epic], gru: { [epic]: gone ? "ended" : "live" }, noEpicRow: tickets.includes(epic) };
}

/** The tickets of one Gru run file, without its epic. */
export function gruTickets(run: GruRunFile | undefined): string[] {
  if (!run || !Array.isArray(run.tickets)) return [];
  return run.tickets.filter((t): t is string => isTicketId(t) && t !== run.epic);
}

/** The titles a Gru run file holds, by ticket. */
export function gruTitles(run: GruRunFile | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!run || !run.titles || typeof run.titles !== "object") return out;
  for (const [k, v] of Object.entries(run.titles as Record<string, unknown>)) {
    if (isTicketId(k) && typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

/**
 * Check a `--children` file: a JSON map of epic id to a list of ticket ids.
 * The ids of each epic come back in number order: `list_children` lists the
 * newest child first.
 */
export function parseChildren(data: unknown): Record<string, string[]> {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("the children file must hold a JSON object of epic id to a list of ticket ids");
  const out: Record<string, string[]> = {};
  for (const [epic, kids] of Object.entries(data as Record<string, unknown>)) {
    if (!isTicketId(epic)) throw new Error(`children file: ${epic} is not a STARK-n id`);
    if (!Array.isArray(kids) || !kids.every(isTicketId)) throw new Error(`children file: the value of ${epic} must be a list of STARK-n ids`);
    out[epic] = [...new Set(kids)].sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  }
  return out;
}

export interface PlannedRow {
  id: string;
  kind: Kind;
  epic: string;
}

/**
 * The rows the List wants, in order: each epic's row, then its tickets. The
 * tickets of an epic are its children from the `--children` file, then the
 * tickets of its Gru run file that the children do not name (a follow-up or
 * a split the Gru added). A ticket shows one time, under its first epic.
 */
export function planRows(view: RunView, children: Record<string, string[]>, gruRuns: Record<string, GruRunFile | undefined>): PlannedRow[] {
  const rows: PlannedRow[] = [];
  const seen = new Set<string>(view.noEpicRow ? [] : view.epics);
  for (const epic of view.epics) {
    if (!view.noEpicRow) rows.push({ id: epic, kind: "epic", epic });
    const ticketsRun = view.noEpicRow ? [epic] : [];
    for (const t of [...ticketsRun, ...(children[epic] ?? []), ...gruTickets(gruRuns[epic])]) {
      if (seen.has(t)) continue;
      seen.add(t);
      rows.push({ id: t, kind: "task", epic });
    }
  }
  return rows;
}

/** The label of an epic's choice: `NN <short name>`, the short name cut from the epic's title. */
export function epicLabel(index: number, title: string, fallback: string): string {
  let name = title.trim().replace(/^\[[^\]]*\]\s*/, "");
  const colon = name.indexOf(":");
  if (colon > 0) name = name.slice(0, colon);
  name = name.trim();
  if (!name) name = fallback;
  if (name.length > 40) name = `${name.slice(0, 39).trimEnd()}…`;
  return `${String(index + 1).padStart(2, "0")} ${name}`;
}

export interface SchemaColumn {
  key: string;
  name: string;
  type: string;
  is_primary_column?: boolean;
  options?: { format: string; choices: Array<{ value: string; label: string; color: string }> };
}

/** The List's columns, for `slack.create_list`. `epics` are the Epic column's choices, in order. */
export function listSchema(epics: Array<{ id: string; label: string }>): SchemaColumn[] {
  const select = (choices: Array<{ value: string; label: string; color: string }>) => ({ format: "single_select", choices });
  return [
    { key: "title", name: "Ticket", type: "text", is_primary_column: true },
    { key: "done", name: "Done", type: "checkbox" },
    { key: "status", name: "Status", type: "select", options: select(STATUS_CHOICES.map((c) => ({ ...c }))) },
    { key: "kind", name: "Kind", type: "select", options: select([{ value: "epic", label: "Epic", color: "indigo" }, { value: "task", label: "Task", color: "gray" }]) },
    { key: "epic", name: "Epic", type: "select", options: select(epics.map((e, i) => ({ value: e.id, label: e.label, color: EPIC_COLORS[i % EPIC_COLORS.length]! }))) },
    { key: "pr", name: "PR", type: "text" },
    { key: "notes", name: "Notes", type: "text" },
  ];
}

/** A ticket's progress file, `STARK-n.json`, as the stark-progress mod's state contract names it. */
export interface TicketFile {
  stage?: unknown;
  pr?: unknown;
  hold?: unknown;
}

export type Cells = Record<CellKey, string>;

/**
 * The cells a ticket row wants. The ticket file gives the stage, the PR and
 * a hold. alfred's state wins for done and cancelled, and fills in a ticket
 * that has no file yet.
 */
export function taskCells(file: TicketFile | undefined, alfredState: string | undefined): Cells {
  let status: Status = "queued";
  let pr = "";
  let notes = "";
  if (file) {
    status = (typeof file.stage === "string" && STAGE_STATUS[file.stage]) || "in_progress";
    if (typeof file.pr === "string") pr = file.pr.trim();
    if ((file.hold === "merge" || file.hold === "release") && status !== "done" && status !== "blocked") notes = `held: ${file.hold}`;
  }
  const a = (alfredState ?? "").trim().toLowerCase();
  if (a === "done" || a === "closed") status = "done";
  else if (a === "cancelled") status = "cancelled";
  else if (status === "queued") {
    if (a === "on hold") status = "blocked";
    else if (a === "in progress") status = "in_progress";
    else if (a === "review") status = "in_review";
  }
  if (status === "done" || status === "cancelled") notes = "";
  return { status, done: String(status === "done" || status === "cancelled"), pr, notes };
}

/** The cells an epic row wants, from its Gru's state and the statuses of its tickets. */
export function epicCells(gru: GruState, kids: Status[], alfredState: string | undefined): Cells {
  const total = kids.length;
  const done = kids.filter((s) => s === "done" || s === "cancelled").length;
  const allDone = total > 0 && done === total;
  let status: Status = "queued";
  if (gru === "live" || gru === "reported") status = "in_progress";
  if (gru === "ended") status = allDone ? "done" : "blocked";
  if (allDone) status = "done";
  const a = (alfredState ?? "").trim().toLowerCase();
  if (a === "done" || a === "closed") status = "done";
  else if (a === "cancelled") status = "cancelled";
  let notes = `${done} of ${total} done`;
  if (gru === "live") notes += ", Gru live";
  else if (gru === "ended" && status !== "done" && status !== "cancelled") notes += ", Gru ended";
  return { status, done: String(status === "done" || status === "cancelled"), pr: "", notes };
}

/** A rich_text value of one section. */
function richText(elements: unknown[]): unknown[] {
  return [{ type: "rich_text", elements: [{ type: "rich_text_section", elements }] }];
}

/** The Ticket cell: the id as a link to the ticket, then its title. */
export function titleRichText(id: string, title: string, url: string): unknown[] {
  const head = url ? { type: "link", url, text: id } : { type: "text", text: id };
  return richText(title ? [head, { type: "text", text: ` ${title}` }] : [head]);
}

/** The short name of a PR URL: `frigg#962` for https://github.com/21StarkCom/frigg/pull/962. */
export function prName(url: string): string {
  const m = url.match(/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/);
  return m ? `${m[1]}#${m[2]}` : url;
}

/** One cell for `slack.update_list_items`. An empty text cell takes one space: Slack refuses an empty one. */
export function cellFor(cols: Record<string, string>, rowId: string, key: CellKey, value: string): Record<string, unknown> {
  const column_id = cols[key];
  if (!column_id) throw new Error(`the List has no ${key} column`);
  const cell: Record<string, unknown> = { row_id: rowId, column_id };
  if (key === "status") cell.select = [value];
  else if (key === "done") cell.checkbox = value === "true";
  else if (key === "pr" && value) cell.rich_text = richText([{ type: "link", url: value, text: prName(value) }]);
  else cell.text = value || " ";
  return cell;
}

/** What the last sync sent for one row. */
export interface RowRecord {
  rowId: string;
  kind: Kind;
  epic: string;
  sent: Partial<Cells>;
  alfred?: string;
}

/** One cell to write, and the record it changes once the write lands. */
export interface CellChange {
  id: string;
  key: CellKey;
  value: string;
  cell: Record<string, unknown>;
}

/** The `sent` values a fresh row holds: `slack.create_list_item` writes the status, and the other cells are empty. */
export function freshSent(): Cells {
  return { status: "queued", done: "false", pr: "", notes: "" };
}

/**
 * The cells to write: each cell whose wanted value differs from what the
 * last sync sent. It changes no record: the caller sets `sent` for each
 * change once its write lands. Ticket rows go first: an epic counts its
 * tickets' new statuses.
 */
export function diffCells(
  order: string[],
  rows: Record<string, RowRecord>,
  cols: Record<string, string>,
  view: RunView,
  ticketFiles: Record<string, TicketFile | undefined>,
): CellChange[] {
  const changes: CellChange[] = [];
  const statusOf: Record<string, Status> = {};
  const apply = (id: string, rec: RowRecord, want: Cells) => {
    for (const key of ["status", "done", "pr", "notes"] as const) {
      if (rec.sent[key] === want[key]) continue;
      changes.push({ id, key, value: want[key], cell: cellFor(cols, rec.rowId, key, want[key]) });
    }
  };
  for (const id of order) {
    const rec = rows[id];
    if (!rec || rec.kind !== "task") continue;
    const want = taskCells(ticketFiles[id], rec.alfred);
    statusOf[id] = want.status as Status;
    apply(id, rec, want);
  }
  for (const id of order) {
    const rec = rows[id];
    if (!rec || rec.kind !== "epic") continue;
    const kids = order.filter((k) => rows[k]?.kind === "task" && rows[k]!.epic === id).map((k) => statusOf[k] ?? "queued");
    apply(id, rec, epicCells(view.gru[id] ?? "queued", kids, rec.alfred));
  }
  return changes;
}

/** Split a list into parts of at most `size` items. */
export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The answer of `frigg invoke --json`: the result, or `{result, warnings}` when frigg adds a notice. */
export function friggResult(out: unknown): Record<string, unknown> {
  if (out && typeof out === "object" && "result" in out && "warnings" in out) {
    const r = (out as { result: unknown }).result;
    return (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
  }
  return (out && typeof out === "object" ? out : {}) as Record<string, unknown>;
}

/**
 * True when a later try of a failed frigg call can pass. A rate limit
 * means that Slack did nothing, so a write retries it. A timeout can come
 * after a write landed, so only a read retries it: a second create would
 * make a second row.
 */
export function isRetryable(text: string, write: boolean): boolean {
  if (/rate.?limit|ratelimited|\b429\b/i.test(text)) return true;
  return !write && /timeout|timed out|temporar/i.test(text);
}
