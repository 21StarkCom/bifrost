import type { Board, BoardRow, BoardState, BoardTone, GitSignal, GruSettings, Row } from '../types'
import { beatFields, RECENT } from './beat'
import { buildLog, logName, logOf, runLogName } from './log'
import { runStats, runStatsName, statsOf } from './stats'
import { dur, isRunName, row, STAGES, STATION_LABELS, time } from './view'

// What the Gru pane draws (pane.tsx), from the contract's files (../README.md):
// one run, picked as register.tsx says, with a calm status per ticket. Pure:
// the poller reads the disk. Counts and elapsed times only, never a forecast.
const MIN = 60_000
const ACTIVE_MIN = 60
const RECENT_CALLS_MIN = 15
const DEFAULT_WORKERS = 3
/** A heartbeat younger than this says its worker's tab is open: the mod writes one at least once a minute. */
const LIVE_MIN = 3

export const MAX_WORKERS = 8

export const launchIdOf = (runName: string) => runName.slice('run-'.length, -'.json'.length)
export const settingsName = (launchId: string) => `run-${launchId}.settings.json`

export function parse(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null
  try {
    const value: unknown = JSON.parse(text)

    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const workers = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_WORKERS ? v : null
// The launch's `--max-workers` has no cap: a run launched above the pane's range keeps its N.
const launched = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null)
const agent = (v: unknown): 'claude' | 'codex' | null => (v === 'claude' || v === 'codex' ? v : null)
const flag = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

/** One run file, read: its launch id (from the file's name), and when any of its files last changed. */
export type RunEntry = {
  name: string
  launchId: string
  epic: string
  session: string
  tickets: string[]
  /** Each ticket's title as Gru wrote it at launch, so a ticket with no file yet has a name. */
  titles: Record<string, string>
  maxWorkers: number | null
  minionAgent: 'claude' | 'codex' | null
  active: number
}

/** A run file's `titles`: only the string titles of its own tickets count. */
function titlesOf(v: unknown, tickets: readonly string[]): Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
  const all = v as Record<string, unknown>

  return Object.fromEntries(tickets.flatMap(id => {
    const title = str(all[id])

    return title === null ? [] : [[id, title]]
  }))
}

/**
 * Every run file, most recently active first: the latest change to the run
 * file, its log, its tickets' files, their heartbeats or their logs. A run file changes only at
 * launch and at a split, so its own time says little about a live run.
 */
export function runsOf(files: Record<string, string>, mtimes: ReadonlyMap<string, number>): RunEntry[] {
  const runs: RunEntry[] = []
  for (const name of Object.keys(files).filter(isRunName).sort()) {
    const run = parse(files[name])
    if (run === null || !Array.isArray(run.tickets)) continue
    const tickets = [...new Set(run.tickets.filter((id): id is string => typeof id === 'string'))]
    const active = Math.max(
      mtimes.get(name) ?? 0,
      mtimes.get(runLogName(launchIdOf(name))) ?? 0,
      ...tickets.flatMap(id => [
        mtimes.get(`${id}.json`) ?? 0,
        mtimes.get(`${id}.beat.json`) ?? 0,
        mtimes.get(logName(id)) ?? 0,
      ]),
    )
    runs.push({
      name,
      launchId: launchIdOf(name),
      epic: str(run.epic) ?? launchIdOf(name),
      session: str(run.session) ?? '',
      tickets,
      titles: titlesOf(run.titles, tickets),
      maxWorkers: launched(run.maxWorkers),
      minionAgent: agent(run.minionAgent),
      active,
    })
  }

  return runs.sort((a, b) => b.active - a.active)
}

/** The epic's title from the run file: a `--tickets` run's epic is its first ticket, whose title `titles` holds. */
export const epicTitleOf = (run: RunEntry): string | null =>
  Object.hasOwn(run.titles, run.epic) ? (run.titles[run.epic] ?? null) : null

/** When a run started: its log's oldest line (Gru writes one at launch), else when Gru's stats began, else null. */
export function startOf(log: string | undefined, gruStats: string | undefined): number | null {
  const lines = logOf(log)
  if (lines.length > 0) return Math.min(...lines.map(l => l.at))

  return statsOf(gruStats)?.since ?? null
}

/** The run a tab shows: the one `pick` names, else this session's own (Gru's tab), else the most recently active. */
export function pickRun(runs: RunEntry[], session: string, pick: string): RunEntry | undefined {
  return runs.find(r => r.launchId === pick) ?? runs.find(r => r.session === session) ?? runs[0]
}

/**
 * The settings Gru reads before each launch: the settings file's value, else
 * the launch's (from the run file), else Gru's default. A field of the wrong
 * type reads as absent.
 */
export function settingsOf(run: RunEntry, text: string | undefined): GruSettings {
  const s = parse(text)

  return {
    decideForMe: flag(s?.decideForMe) ?? true,
    maxWorkers: workers(s?.maxWorkers) ?? run.maxWorkers ?? DEFAULT_WORKERS,
    followUps: flag(s?.followUps) ?? true,
    minionAgent: agent(s?.minionAgent) ?? run.minionAgent ?? 'claude',
  }
}

// An epic's `EPIC:` lead goes as a kind tag does.
const KIND_TAG = /^(?:\[[^\]]+\]|EPIC:)\s*/i
const REPO_LEAD = /^([\w.-]+):\s+/
const SLICE = /\s*\((slice \d+ of \d+)\)\s*$/

/** A title without its `[bug]` tag, `repo: ` lead and `(slice n of m)` tail, and the two parts. */
export function nameOf(title: string): { name: string; repo: string | null; slice: string | null } {
  const untagged = title.replace(KIND_TAG, '')
  const repo = REPO_LEAD.exec(untagged)?.[1] ?? null
  const rest = untagged.replace(REPO_LEAD, '')
  const slice = SLICE.exec(rest)?.[1] ?? null
  const name = rest.replace(SLICE, '')

  return { name: name.charAt(0).toUpperCase() + name.slice(1), repo, slice }
}

const prName = (url: string) => {
  const m = /github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/.exec(url)

  return m === null ? url : `${m[1]}#${m[2]}`
}

const two = (n: number) => String(n).padStart(2, '0')
export const clockOf = (ms: number) => {
  const d = new Date(ms)

  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

/** The state of a ticket that is moving, by its stage. */
const STEP: Partial<Record<Row['stage'], BoardState>> = { ticket: 'starting', pr: 'pr', review: 'review', merged: 'merged' }

/** The time a verdict names, as words: `12m`, or '' when it names none. */
const ageOf = (v: Row['verdict']) => (v.age === undefined ? '' : dur(v.age))

/**
 * The calm reading of a band row: its tone, its state, the words after the
 * state, and why it is worth a look. `beat` is its parsed heartbeat, which
 * tells a long call from no call while its tab lives.
 */
export function calm(
  r: Row,
  hasFile: boolean,
  beat: Record<string, unknown> | null,
  now: number,
): Omit<BoardRow, 'name' | 'repo' | 'slice' | 'detail' | 'cells' | 'tab'> {
  const base = { id: r.id, at: STAGES.indexOf(r.stage) }
  const v = r.verdict
  if (!hasFile) return { ...base, at: -1, tone: 'none', state: 'todo', status: '', attention: null }
  if (v.word === 'done') return { ...base, at: STAGES.length, tone: 'done', state: 'done', status: '', attention: null }
  if (v.word === 'blocked') {
    const at = r.track.findIndex(s => s.ch === '✕')
    const blocked = ageOf(v)
    return {
      ...base,
      at: at < 0 ? 0 : at / 2,
      tone: 'warn',
      state: 'blocked',
      status: blocked,
      attention: blocked === '' ? 'blocked' : `blocked for ${blocked}`,
    }
  }
  if (v.word === 'held') {
    const hold = v.text.slice('held · '.length)
    const status = r.inStage === '' ? hold : `${hold} · ${r.inStage}`
    return { ...base, tone: 'warn', state: 'held', status, attention: `held by its settings: ${hold}` }
  }
  if (v.word === 'idle') {
    // A call still marked running is a long call only while the tab lives: a session that died in a call never ends it.
    const call = tabIsLive(beat, now) ? runningOf(beat) : null
    if (call !== null) {
      const long = dur(now - call.since)
      return { ...base, tone: 'idle', state: 'running', status: long, attention: `one ${call.tool} call has run for ${long}` }
    }
    const quiet = ageOf(v)
    return { ...base, tone: 'idle', state: 'quiet', status: quiet, attention: `no tool call for ${quiet}` }
  }
  const failed = r.failed === null ? null : `${r.failed.replace(/^(\d+)\/(\d+) failed$/, '$1 of the last $2 calls failed')}`
  if (v.word === 'slow' || v.word === 'stalled') {
    // A slow ticket has an emoji; it is worth a look once the band calls it stalled.
    const quiet = ageOf(v)
    const attention = failed ?? (v.word === 'stalled' ? `no stage change or commit for ${quiet}` : null)
    return { ...base, tone: 'warn', state: 'slow', status: quiet, attention }
  }

  return { ...base, tone: failed === null ? 'move' : 'warn', state: STEP[r.stage] ?? 'starting', status: r.inStage, attention: failed }
}

/** A heartbeat's oldest running call, or null. */
function runningOf(beat: Record<string, unknown> | null): { tool: string; since: number } | null {
  const running = (beat?.running ?? null) as Record<string, unknown> | null
  const since = time(running?.since)

  return typeof running?.tool === 'string' && since !== null ? { tool: running.tool, since } : null
}

/** A cmux surface id: a UUID, so a value from a file never reads as a flag. */
const SURFACE = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/

/**
 * The cmux surface of a ticket's worker tab while it is open: the worker's mod
 * writes its heartbeat at least once a minute while its tab lives, so one
 * under LIVE_MIN old says the tab is open.
 */
export function tabOf(beat: Record<string, unknown> | null, now: number): string | null {
  const surface = beat?.surface

  return typeof surface === 'string' && SURFACE.test(surface) && tabIsLive(beat, now) ? surface : null
}

/** Whether a heartbeat says its worker's tab lives: it was written under LIVE_MIN ago. */
export function tabIsLive(beat: Record<string, unknown> | null, now: number): boolean {
  const updated = time(beat?.updated)

  return updated !== null && now - updated < LIVE_MIN * MIN
}

/** One bar of the Overview's graph: the tickets at one step of the spine, and how many of them are worth a look. */
export type StepCount = { label: string; tone: BoardTone; count: number; looks: number }

/**
 * The Overview's graph, a bar for each step in the spine's order: not
 * started, the four stations a worker is at, then done. A blocked ticket
 * counts at the station it stopped at.
 */
export function stepCounts(rows: readonly Pick<BoardRow, 'at' | 'tone' | 'attention'>[]): StepCount[] {
  const steps: StepCount[] = [
    { label: 'not started', tone: 'none', count: 0, looks: 0 },
    ...STATION_LABELS.slice(0, -1).map(label => ({ label, tone: 'move' as const, count: 0, looks: 0 })),
    { label: 'done', tone: 'done', count: 0, looks: 0 },
  ]
  for (const r of rows) {
    const i = r.tone === 'none' ? 0 : r.tone === 'done' ? steps.length - 1 : 1 + Math.min(Math.max(r.at, 0), STAGES.length - 2)
    const step = steps[i]
    if (step === undefined) continue
    step.count += 1
    if (r.attention !== null) step.looks += 1
  }

  return steps
}

function detailOf(
  hasFile: boolean,
  title: string | null,
  slice: string | null,
  pr: string | null,
  updated: number | null,
  r: Row,
  beat: Record<string, unknown> | null,
  now: number,
): string[] {
  const out = title === null ? [] : [title]
  if (!hasFile) return [...out, 'Its worker has not started yet.']
  if (slice !== null) out.push(`This is ${slice}.`)
  if (pr !== null) out.push(`Pull request: ${prName(pr)}`)
  if (updated !== null && r.stage !== 'closed') out.push(`In this step since ${clockOf(updated)}.`)
  if (r.diff !== null) out.push(`${r.diff} in its worktree.`)
  // As row() reads it: on a closed ticket, a call still running is the stand-down's, which never ends.
  if (beat !== null) out.push(...callsOf(r.stage === 'closed' ? { ...beat, running: null } : beat, now))

  return out
}

/** A heartbeat's lines: the running or last tool call, the calls in the last 15 minutes, the failures among the last 10. */
export function callsOf(beat: Record<string, unknown>, now: number): string[] {
  const out: string[] = []
  const { minutes, recent, lastActivity } = beatFields(beat)
  const call = runningOf(beat)
  if (call !== null) {
    out.push(`Running ${call.tool} for ${dur(now - call.since)}.`)
  } else if (lastActivity !== null) {
    out.push(`Last tool call ${dur(now - lastActivity)} ago.`)
  }
  const first = Math.floor(now / MIN) - RECENT_CALLS_MIN + 1
  const calls = [...minutes.values()].filter(m => m.at >= first).reduce((sum, m) => sum + m.calls, 0)
  out.push(`${calls} tool calls in the last ${RECENT_CALLS_MIN} minutes.`)
  const last = recent.slice(-RECENT)
  if (last.length > 0) out.push(`${last.filter(Boolean).length} of the last ${last.length} calls failed.`)

  return out
}

/**
 * The board for one run: `pick` names a launch id to show; else Gru's own run
 * (the one whose `session` is this session's), else the most recently active.
 * The others are the runs with a change in the last hour.
 */
export function buildBoard(
  session: string,
  pick: string,
  now: number,
  files: Record<string, string>,
  mtimes: ReadonlyMap<string, number>,
  git: Record<string, GitSignal | null>,
  /** Each epic's title as alfred gave it, for an epic the run file does not name. */
  epicTitles: Readonly<Record<string, string>> = {},
): Board | null {
  const runs = runsOf(files, mtimes)
  const chosen = pickRun(runs, session, pick)
  if (chosen === undefined) return null
  const rawTitle = epicTitleOf(chosen) ?? (Object.hasOwn(epicTitles, chosen.epic) ? epicTitles[chosen.epic] : undefined) ?? null
  const rows: BoardRow[] = chosen.tickets.map(id => {
    const text = files[`${id}.json`]
    const t = parse(text)
    const beat = parse(files[`${id}.beat.json`])
    const r = row(id, files, git[id] ?? null, now)
    // The worker's title, else the one Gru wrote at launch; the pane shows the id beside it, so none is no name.
    const title = str(t?.title) ?? (Object.hasOwn(chosen.titles, id) ? chosen.titles[id] : undefined) ?? null
    const words = title === null ? null : nameOf(title)
    const updated = typeof t?.updated === 'string' ? Date.parse(t.updated) : Number.NaN
    const hasFile = text !== undefined

    return {
      ...calm(r, hasFile, beat, now),
      name: words?.name ?? '',
      repo: words?.repo ?? null,
      slice: words?.slice ?? null,
      detail: detailOf(hasFile, title, words?.slice ?? null, str(t?.pr), Number.isFinite(updated) ? updated : null, r, beat, now),
      cells: r.cells,
      tab: tabOf(beat, now),
    }
  })
  const done = chosen.tickets.filter(id => parse(files[`${id}.json`])?.stage === 'closed').length
  const notStarted = rows.filter(r => r.tone === 'none').length

  return {
    launchId: chosen.launchId,
    epic: chosen.epic,
    title: rawTitle === null ? null : nameOf(rawTitle).name || null,
    started: startOf(files[runLogName(chosen.launchId)], files[runStatsName(chosen.launchId)]),
    isOwn: chosen.session === session,
    repos: [...new Set(rows.flatMap(r => (r.repo === null ? [] : [r.repo])))],
    rows,
    done,
    inProgress: rows.length - done - notStarted,
    notStarted,
    next: rows.filter(r => r.tone === 'none').map(r => r.id),
    others: runs
      .filter(r => r !== chosen && r.active > now - ACTIVE_MIN * MIN)
      .map(r => ({ launchId: r.launchId, epic: r.epic })),
    settings: settingsOf(chosen, files[settingsName(chosen.launchId)]),
    log: buildLog(
      [
        { who: 'Gru', isRun: true, text: files[runLogName(chosen.launchId)] },
        ...rows.map(r => ({ who: r.name, id: r.id, text: files[logName(r.id)] })),
      ],
      now,
    ),
    stats: runStats(files, chosen.launchId, chosen.tickets, git),
    readAt: now,
  }
}
