import type { GitSignal, StatGroup, StatModel, StatsFile, StatsView, Tokens, ToolTally } from '../types'
import { parse as parseAs } from './view'

const parse = (text: string | undefined) => parseAs<Record<string, unknown>>(text)

// What a Stats tab counts and draws, from the contract's stats files
// (../README.md). The counts are kept in memory in each session that has the
// mod, from its model requests, prompts and tool calls; a worker's tab and
// Gru's tab write them to a file, which a pane reads. Pure: register.tsx
// hooks the events and reads the disk. Counts only, never a forecast.

/** A worker's stats file. */
export const statsName = (id: string) => `${id}.stats.json`
/** A Gru run's stats file. */
export const runStatsName = (launchId: string) => `run-${launchId}.stats.json`

/** A session's counts, in memory: the file's fields less who wrote it and when. */
export type Stats = Omit<StatsFile, 'session' | 'since' | 'updated'> & { since: number | null }

const zero = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

export function newStats(): Stats {
  return {
    since: null,
    model: null,
    effort: null,
    requests: 0,
    tokens: zero(),
    models: {},
    prompts: { operator: 0, peer: 0, other: 0 },
    sent: 0,
    launches: 0,
    reviews: 0,
    tools: {},
    git: null,
  }
}

/** The API's four counts, as a model request's usage carries them. */
export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  model: string
}

const addTokens = (to: Tokens, u: Usage) => {
  to.input += u.input_tokens
  to.output += u.output_tokens
  to.cacheRead += u.cache_read_input_tokens
  to.cacheWrite += u.cache_creation_input_tokens
}

/** The counts begin at the first event they count. */
const begin = (s: Stats, now: number) => {
  if (s.since === null) s.since = now
}

/** One model request ended: its tokens count in the total and under its model. A request with no usage counts nothing. */
export function addUsage(s: Stats, usage: Usage | null | undefined, now: number): void {
  if (usage === null || usage === undefined) return
  begin(s, now)
  s.requests += 1
  addTokens(s.tokens, usage)
  const model = usage.model === '' ? 'unknown' : usage.model
  const per = s.models[model] ?? { ...zero(), requests: 0 }
  per.requests += 1
  addTokens(per, usage)
  s.models[model] = per
}

/** The main loop's model and effort, at each of its requests. */
export function noteModel(s: Stats, model: string, effort: string | number | undefined): void {
  s.model = model
  s.effort = effort === undefined ? null : String(effort)
}

/** The prompt origins (`e.origin.kind`) that are the operator's own: typed, from a phone, or a Slack ping. */
const OPERATOR = new Set(['composer', 'bridge', 'slack-ping'])
/** The prompt origins that are another session's or a coordinator's. */
const PEER = new Set(['peer', 'peer-send-message', 'coordinator', 'projects-relay'])

/** Where a prompt came from, by its origin; a prompt the person does not see as typed is never the operator's. */
export function promptKind(kind: string, isMeta: boolean): keyof Stats['prompts'] {
  if (OPERATOR.has(kind)) return isMeta ? 'other' : 'operator'

  return PEER.has(kind) ? 'peer' : 'other'
}

/** One prompt entered the session. */
export function addPrompt(s: Stats, kind: string, isMeta: boolean, now: number): void {
  begin(s, now)
  s.prompts[promptKind(kind, isMeta)] += 1
}

/** One run of the code-review skill, typed or by the Skill tool. */
export function addReview(s: Stats, now: number): void {
  begin(s, now)
  s.reviews += 1
}

// A word of a shell command starts the line or follows a space or a shell operator.
const LEAD = String.raw`(?:^|[\s;&|(])`
const SENT = new RegExp(`${LEAD}hermod\\s+msg\\s+(?:send|reply)\\b`, 'g')
const LAUNCH = new RegExp(`${LEAD}valkyrie\\s+(?:agnes|minion|gru)\\b`, 'g')
const CODEX_REVIEW = new RegExp(`${LEAD}codex\\s+(?:exec\\s+)?review\\b`, 'g')
const HELP = /(?:^|\s)(?:--help|-h)(?:\s|$)/

/** What one Bash command does that the stats count: messages to other sessions, worker launches and Codex reviews. */
export function bashCounts(command: string): { sent: number; launches: number; reviews: number } {
  // A `--help` run does nothing.
  if (HELP.test(command)) return { sent: 0, launches: 0, reviews: 0 }
  const count = (re: RegExp) => [...command.matchAll(re)].length

  return { sent: count(SENT), launches: count(LAUNCH), reviews: count(CODEX_REVIEW) }
}

/**
 * A tool call, as the stats read it: the tool, a Bash call's command, and
 * whether a SendMessage call carries a message (a call with only
 * `notify_when_idle` sends none).
 */
export type Call = { tool: string; command?: string; hasMessage?: boolean }

/** One tool call ended. It counts under its tool; one that did not fail also counts what it does. */
export function addCall(s: Stats, call: Call, isFailed: boolean, now: number): void {
  begin(s, now)
  const tally = s.tools[call.tool] ?? { calls: 0, fails: 0 }
  tally.calls += 1
  if (isFailed) tally.fails += 1
  s.tools[call.tool] = tally
  if (isFailed) return
  if (call.tool === 'SendMessage' && call.hasMessage === true) s.sent += 1
  if (call.tool === 'Bash' && call.command !== undefined) {
    const n = bashCounts(call.command)
    s.sent += n.sent
    s.launches += n.launches
    s.reviews += n.reviews
  }
}

/** Keep a worker's last git signal; true when it changed. */
export function noteGit(s: Stats, git: GitSignal | null): boolean {
  if (git === null) return false
  const next = { added: git.added, removed: git.removed, commits: git.commits.length }
  if (s.git !== null && s.git.added === next.added && s.git.removed === next.removed && s.git.commits === next.commits) {
    return false
  }
  s.git = next

  return true
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const tokensOf = (v: unknown): Tokens => {
  const t = obj(v)

  return { input: count(t.input), output: count(t.output), cacheRead: count(t.cacheRead), cacheWrite: count(t.cacheWrite) }
}

/** A stats file, read; null when it does not parse. A field of the wrong type reads as zero or absent. */
export function statsOf(file: string | undefined): (Stats & { session: string | null }) | null {
  const f = parse(file)
  if (f === null) return null
  const since = typeof f.since === 'string' ? Date.parse(f.since) : Number.NaN
  const prompts = obj(f.prompts)
  const git = obj(f.git)
  const models: Stats['models'] = {}
  for (const [id, v] of Object.entries(obj(f.models))) models[id] = { ...tokensOf(v), requests: count(obj(v).requests) }
  const tools: Record<string, ToolTally> = {}
  for (const [name, v] of Object.entries(obj(f.tools))) tools[name] = { calls: count(obj(v).calls), fails: count(obj(v).fails) }

  return {
    session: text(f.session),
    since: Number.isFinite(since) ? since : null,
    model: text(f.model),
    effort: text(f.effort),
    requests: count(f.requests),
    tokens: tokensOf(f.tokens),
    models,
    prompts: { operator: count(prompts.operator), peer: count(prompts.peer), other: count(prompts.other) },
    sent: count(f.sent),
    launches: count(f.launches),
    reviews: count(f.reviews),
    tools,
    git: f.git === null || f.git === undefined ? null : { added: count(git.added), removed: count(git.removed), commits: count(git.commits) },
  }
}

const sumTokens = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

/**
 * `older` and `newer` summed: every count added, the earlier start kept, and
 * the newer model, effort and git signal where it has one. A tab seeds its
 * counts this way from the file it writes, so a reload or a relaunch keeps
 * the total.
 */
export function addStats(older: Stats, newer: Stats): Stats {
  const models: Stats['models'] = { ...older.models }
  for (const [id, t] of Object.entries(newer.models)) {
    const was = models[id]
    models[id] = was === undefined ? { ...t } : { ...sumTokens(was, t), requests: was.requests + t.requests }
  }
  const tools: Record<string, ToolTally> = { ...older.tools }
  for (const [name, t] of Object.entries(newer.tools)) {
    const was = tools[name]
    tools[name] = was === undefined ? { ...t } : { calls: was.calls + t.calls, fails: was.fails + t.fails }
  }
  const starts = [older.since, newer.since].filter((t): t is number => t !== null)

  return {
    since: starts.length === 0 ? null : Math.min(...starts),
    model: newer.model ?? older.model,
    effort: newer.model !== null ? newer.effort : older.effort,
    requests: older.requests + newer.requests,
    tokens: sumTokens(older.tokens, newer.tokens),
    models,
    prompts: {
      operator: older.prompts.operator + newer.prompts.operator,
      peer: older.prompts.peer + newer.prompts.peer,
      other: older.prompts.other + newer.prompts.other,
    },
    sent: older.sent + newer.sent,
    launches: older.launches + newer.launches,
    reviews: older.reviews + newer.reviews,
    tools,
    git: newer.git ?? older.git,
  }
}

/** The file the contract names. */
export function statsFile(s: Stats, session: string, now: number): StatsFile {
  return {
    session,
    since: new Date(s.since ?? now).toISOString(),
    updated: new Date(now).toISOString(),
    model: s.model,
    effort: s.effort,
    requests: s.requests,
    tokens: s.tokens,
    models: s.models,
    prompts: s.prompts,
    sent: s.sent,
    launches: s.launches,
    reviews: s.reviews,
    tools: s.tools,
    git: s.git,
  }
}

// What a Stats tab draws.

/** `999`, `1,234`, `12.3k`, `123k`, `1.2M`: short enough for a column. */
export function short(n: number): string {
  const whole = Math.round(n)
  if (whole < 10_000) return grouped(whole)
  const [size, mark] = whole < 1e6 ? [1e3, 'k'] : whole < 1e9 ? [1e6, 'M'] : [1e9, 'B']
  const scaled = whole / size

  return `${scaled < 100 ? scaled.toFixed(1).replace(/\.0$/, '') : Math.round(scaled)}${mark}`
}

/** `1,234`. */
export function grouped(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** A model and its effort, in words: `claude-opus-5-5 · xhigh`. */
export const modelWords = (s: Pick<Stats, 'model' | 'effort'>) =>
  s.model === null ? 'no model request yet' : s.effort === null ? s.model : `${s.model} · ${s.effort}`

/** What git and the ticket file add to a column: lines, commits and PRs. `null` draws `—`. */
export type Work = { added: number; removed: number; commits: number; prs: number; merged: number } | null

const TOP_TOOLS = 5
const DASH = '—'

/**
 * The table's groups, one value a column. `work[i]` is column i's lines,
 * commits and PRs, or null for `—` (Gru writes no code).
 */
function groupsOf(columns: Stats[], work: Work[]): StatGroup[] {
  const each = (f: (s: Stats) => number) => columns.map(s => short(f(s)))
  const ofWork = (f: (w: NonNullable<Work>) => string) => work.map(w => (w === null ? DASH : f(w)))

  return [
    {
      title: 'Tokens',
      rows: [
        { label: 'input', values: each(s => s.tokens.input) },
        { label: 'output', values: each(s => s.tokens.output) },
        { label: 'cache read', values: each(s => s.tokens.cacheRead) },
        { label: 'cache write', values: each(s => s.tokens.cacheWrite) },
        { label: 'model requests', values: each(s => s.requests) },
      ],
    },
    {
      title: 'Work',
      rows: [
        { label: 'lines added', values: ofWork(w => `+${grouped(w.added)}`) },
        { label: 'lines removed', values: ofWork(w => `−${grouped(w.removed)}`) },
        { label: 'commits', values: ofWork(w => grouped(w.commits)) },
        { label: 'PRs opened', values: ofWork(w => grouped(w.prs)) },
        { label: 'PRs merged', values: ofWork(w => grouped(w.merged)) },
        { label: 'review rounds', values: each(s => s.reviews) },
      ],
    },
    {
      title: 'Tools',
      rows: [
        { label: 'tools used', values: each(s => Object.keys(s.tools).length) },
        { label: 'tool calls', values: each(s => Object.values(s.tools).reduce((n, t) => n + t.calls, 0)) },
        { label: 'failed calls', values: each(s => Object.values(s.tools).reduce((n, t) => n + t.fails, 0)) },
      ],
    },
    {
      title: 'Prompts and messages',
      rows: [
        { label: 'prompts from you', values: each(s => s.prompts.operator) },
        { label: 'from other sessions', values: each(s => s.prompts.peer) },
        { label: 'other prompts', values: each(s => s.prompts.other) },
        { label: 'messages sent', values: each(s => s.sent) },
        { label: 'workers launched', values: each(s => s.launches) },
      ],
    },
  ]
}

function topTools(s: Stats): StatsView['tools'] {
  return Object.entries(s.tools)
    .map(([name, t]) => ({ name, calls: t.calls, fails: t.fails }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
    .slice(0, TOP_TOOLS)
}

function modelsOf(s: Stats): StatsView['models'] {
  return Object.entries(s.models)
    .map(([id, t]) => ({ id, requests: t.requests, output: t.output }))
    .sort((a, b) => b.output - a.output || a.id.localeCompare(b.id))
}

/** A ticket's PR count from its file: a `pr` URL is one PR, merged once the stage is `merged` or `closed`. */
export function prsOf(ticket: string | undefined): { prs: number; merged: number } {
  const t = parse(ticket)
  const hasPr = typeof t?.pr === 'string' && t.pr !== ''

  return { prs: hasPr ? 1 : 0, merged: hasPr && (t?.stage === 'merged' || t?.stage === 'closed') ? 1 : 0 }
}

/** A ticket's lines and commits: git's live signal, else the last one its stats file kept, else none. */
function linesOf(git: GitSignal | null, stats: Stats | null): Omit<NonNullable<Work>, 'prs' | 'merged'> {
  if (git !== null) return { added: git.added, removed: git.removed, commits: git.commits.length }

  return stats?.git ?? { added: 0, removed: 0, commits: 0 }
}

/** The ticket pane's Stats tab: one column, the counts of the ticket's worker session. */
export function ticketStats(files: Record<string, string>, id: string, git: GitSignal | null): StatsView {
  const s = statsOf(files[statsName(id)])
  const counted = s ?? newStats()
  const work: Work = { ...linesOf(git, s), ...prsOf(files[`${id}.json`]) }

  return {
    columns: [],
    groups: groupsOf([counted], [work]),
    tools: topTools(counted),
    sessions: s === null ? [] : [{ id: null, words: modelWords(s) }],
    models: modelsOf(counted),
    missing: [],
    since: s?.since ?? null,
  }
}

/**
 * The Gru pane's Stats tab: Gru's own column, and the whole run's (Gru's
 * counts and each ticket's added). Lines, commits and PRs are the tickets':
 * Gru's column draws `—` for them.
 */
export function runStats(
  files: Record<string, string>,
  launchId: string,
  tickets: readonly string[],
  git: Record<string, GitSignal | null>,
): StatsView {
  const gru = statsOf(files[runStatsName(launchId)])
  let all = gru ?? newStats()
  const work = { added: 0, removed: 0, commits: 0, prs: 0, merged: 0 }
  const sessions: StatModel[] = gru === null ? [] : [{ id: null, words: modelWords(gru) }]
  const missing: string[] = []
  for (const id of tickets) {
    const s = statsOf(files[statsName(id)])
    // An id like `constructor` must not read a key every object has.
    const lines = linesOf(Object.hasOwn(git, id) ? (git[id] ?? null) : null, s)
    const prs = prsOf(files[`${id}.json`])
    work.added += lines.added
    work.removed += lines.removed
    work.commits += lines.commits
    work.prs += prs.prs
    work.merged += prs.merged
    if (s !== null) {
      all = addStats(all, s)
      sessions.push({ id, words: modelWords(s) })
    } else if (files[`${id}.json`] !== undefined) {
      missing.push(id)
    }
  }
  // The run's model and effort are each session's: a sum has none. Its start is the earliest of them, as addStats keeps it.
  return {
    columns: ['Gru', 'Whole run'],
    groups: groupsOf([gru ?? newStats(), all], [null, work]),
    tools: topTools(all),
    sessions,
    models: modelsOf(all),
    missing,
    since: all.since,
  }
}
