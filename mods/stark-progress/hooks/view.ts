import type { BeatMinute, Cell, Count, GitSignal, Row, RunFile, Seg, Stage, Tone, Verdict, View } from '../types'

// What a tab draws, from the contract's files (../README.md), git's signal for
// each ticket and the time. Pure: the poller in register.tsx reads the disk.
export const STAGES: Stage[] = ['ticket', 'pr', 'review', 'merged', 'closed']
const ALL_STAGES: string[] = [...STAGES, 'blocked']
const TICKET_ID = /^STARK-\d+$/
const MIN = 60_000
const IDLE_MIN = 15
const SLOW_MIN = 45
const STALLED_MIN = 90
const CELLS = 12
const CELL_MIN = 5
const BARS = '▁▂▃▄▅▆'
const CALLS_A_STEP = 6
const RECENT = 10
const FAILED_OF_RECENT = 5

function parse<T>(text: string | undefined): Partial<T> | null {
  if (!text) return null
  try {
    const value: unknown = JSON.parse(text)

    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Partial<T>) : null
  } catch {
    return null
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const time = (v: unknown): number | null => {
  const ms = typeof v === 'string' ? Date.parse(v) : Number.NaN

  return Number.isFinite(ms) ? ms : null
}

export const isRunName = (name: string) => name.startsWith('run-') && name.endsWith('.json')

/** `7m`, `2h05m`. */
export function dur(ms: number): string {
  const m = Math.max(0, Math.floor(ms / MIN))

  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** The first run file, by name, whose `session` is this session's: Gru's run. */
export function ownRun(session: string, files: Record<string, string>): RunFile | null {
  for (const name of Object.keys(files).filter(isRunName).sort()) {
    const run = parse<RunFile>(files[name])
    if (run?.session !== session || !Array.isArray(run.tickets)) continue
    const tickets = run.tickets.filter((id): id is string => typeof id === 'string')

    return { epic: str(run.epic) ?? '', session, tickets: [...new Set(tickets)] }
  }

  return null
}

/** The ticket a worker's worktree is named for, from a path. */
export function ticketOf(path: string): string | null {
  const base = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''

  return TICKET_ID.test(base) ? base : null
}

/**
 * The worktree git reads for a ticket: its file's `worktree` when that folder
 * is named for the ticket (Gru's stamps write Gru's own folder there, which is
 * not), else the session's root when this is the worker's own tab.
 */
export function worktreeOf(id: string, text: string | undefined, root: string): string | null {
  const own = str(parse<{ worktree: string }>(text)?.worktree)
  if (own !== null && ticketOf(own) === id) return own

  return ticketOf(root) === id ? root : null
}

type Ticket = { title: string; stage: Stage; pr: string | null; updated: number | null }
type Beat = {
  lastActivity: number | null
  running: { tool: string; since: number } | null
  minutes: Map<number, BeatMinute>
  recent: boolean[]
}

/** A ticket's file; a field of the wrong type reads as absent, so drawing never throws. */
function ticket(text: string): Ticket {
  const t = parse<Record<string, unknown>>(text)
  const stage = str(t?.stage)

  return {
    title: str(t?.title) ?? '',
    stage: stage !== null && ALL_STAGES.includes(stage) ? (stage as Stage) : 'ticket',
    pr: str(t?.pr),
    updated: time(t?.updated),
  }
}

function beat(text: string | undefined): Beat | null {
  const b = parse<Record<string, unknown>>(text)
  if (b === null) return null
  const minutes = new Map<number, BeatMinute>()
  for (const m of Array.isArray(b.minutes) ? b.minutes : []) {
    const { at, calls, fails } = (m ?? {}) as Record<string, unknown>
    if (typeof at === 'number' && typeof calls === 'number') {
      minutes.set(at, { at, calls, fails: typeof fails === 'number' ? fails : 0 })
    }
  }
  const run = (b.running ?? null) as Record<string, unknown> | null
  const since = time(run?.since)
  const tool = str(run?.tool)

  return {
    lastActivity: time(b.lastActivity),
    running: since !== null && tool !== null ? { tool, since } : null,
    minutes,
    recent: Array.isArray(b.recent) ? b.recent.filter((x): x is boolean => typeof x === 'boolean') : [],
  }
}

export function verdict(t: Ticket | null, b: Beat | null, milestones: number[], now: number): Verdict {
  if (t === null) return { word: 'waiting', text: 'no file yet', tone: 'dim' }
  if (t.stage === 'closed') return { word: 'done', text: 'done', tone: 'good' }
  if (t.stage === 'blocked') {
    return { word: 'blocked', text: t.updated === null ? 'blocked' : `blocked ${dur(now - t.updated)}`, tone: 'bad' }
  }
  if (b?.lastActivity != null && now - b.lastActivity >= IDLE_MIN * MIN) {
    const tool = b.running === null ? '' : ` · in ${b.running.tool}`

    return { word: 'idle', text: `idle ${dur(now - b.lastActivity)}${tool}`, tone: 'warn' }
  }
  if (milestones.length === 0) return { word: 'waiting', text: 'no time yet', tone: 'dim' }
  const age = now - Math.max(...milestones)
  if (age < SLOW_MIN * MIN) return { word: 'moving', text: 'moving', tone: 'good' }
  if (age < STALLED_MIN * MIN) return { word: 'slow', text: `slow ${dur(age)}`, tone: 'warn' }

  return { word: 'stalled', text: `stalled ${dur(age)}`, tone: 'bad' }
}

/**
 * The stage track, one station per stage: `●` done, `◉` the current stage in
 * its verdict's tone, `○` to come, `✕` where a blocked ticket stopped (`pr`
 * once it has a PR, else `ticket`); a closed ticket draws all green.
 */
export function track(stage: Stage, hasPr: boolean, tone: Tone): Seg[] {
  const isClosed = stage === 'closed'
  const at = stage === 'blocked' ? (hasPr ? 1 : 0) : STAGES.indexOf(stage)
  const done: Seg['tone'] = isClosed ? 'good' : 'done'
  const segs: Seg[] = []
  for (let i = 0; i < STAGES.length; i++) {
    if (i > 0) segs.push(isClosed || i <= at ? { ch: '━', tone: done } : { ch: '┄', tone: 'todo' })
    if (isClosed || i < at) segs.push({ ch: '●', tone: done })
    else if (i === at) segs.push({ ch: stage === 'blocked' ? '✕' : '◉', tone })
    else segs.push({ ch: '○', tone: 'todo' })
  }

  return segs
}

/**
 * The last hour in 12 cells of 5 minutes: a bar per the calls (6 a step,
 * capped at `▆`), failed when more than half failed, `◆` for a milestone, `─`
 * for one call running with no other, `·` for none, blank with no heartbeat.
 */
export function timeline(b: Beat | null, milestones: number[], now: number): Cell[] {
  const nowMin = Math.floor(now / MIN)
  const first = nowMin - CELLS * CELL_MIN + 1
  const marked = new Set(milestones.map(ms => Math.floor((Math.floor(ms / MIN) - first) / CELL_MIN)))
  const cells: Cell[] = []
  for (let i = 0; i < CELLS; i++) {
    const start = first + i * CELL_MIN
    const end = start + CELL_MIN - 1
    let calls = 0
    let fails = 0
    for (let at = start; at <= end; at++) {
      calls += b?.minutes.get(at)?.calls ?? 0
      fails += b?.minutes.get(at)?.fails ?? 0
    }
    const running = b?.running ?? null
    if (marked.has(i)) cells.push({ ch: '◆', kind: 'milestone' })
    else if (b === null) cells.push({ ch: ' ', kind: 'none' })
    else if (calls > 0) {
      const bar = BARS[Math.min(BARS.length, Math.ceil(calls / CALLS_A_STEP)) - 1] ?? '▁'
      cells.push({ ch: bar, kind: fails * 2 > calls ? 'fail' : 'busy' })
    } else if (running !== null && Math.floor(running.since / MIN) <= end) cells.push({ ch: '─', kind: 'running' })
    else cells.push({ ch: '·', kind: 'quiet' })
  }

  return cells
}

/** A ticket's row, from its file, its heartbeat and git's signal. */
export function row(id: string, files: Record<string, string>, git: GitSignal | null, now: number): Row {
  const text = files[`${id}.json`]
  const t = text === undefined ? null : ticket(text)
  const b = beat(files[`${id}.beat.json`])
  const milestones = [...(t?.updated == null ? [] : [t.updated]), ...(git?.commits ?? [])]
  const v = verdict(t, b, milestones, now)
  const stage = t?.stage ?? 'ticket'
  const isLive = v.word !== 'done' && v.word !== 'blocked' && v.word !== 'waiting'
  const last = b?.recent.slice(-RECENT) ?? []
  const failed = last.filter(Boolean).length

  return {
    id,
    title: t?.title ?? '',
    stage,
    inStage: t === null || t.updated === null || stage === 'closed' ? '' : dur(now - t.updated),
    track: track(stage, t?.pr != null, v.tone),
    cells: timeline(b, milestones, now),
    verdict: v,
    failed: isLive && last.length === RECENT && failed >= FAILED_OF_RECENT ? `${failed}/${RECENT} failed` : null,
    diff: git === null || stage === 'closed' ? null : `+${git.added} −${git.removed}`,
  }
}

const COUNTED: [Verdict['word'], Tone][] = [
  ['stalled', 'bad'],
  ['slow', 'warn'],
  ['idle', 'warn'],
  ['blocked', 'bad'],
]

/**
 * What this tab shows. A run file whose `session` is this session's wins
 * (Gru's tab, which stands in a worktree named for its launch id, the epic's
 * own `STARK-n` included); otherwise a worker's worktree is named for its
 * ticket, so its tab shows that ticket's row once the file exists.
 */
export function buildView(
  root: string,
  session: string,
  now: number,
  files: Record<string, string>,
  git: Record<string, GitSignal | null>,
): View | null {
  const run = ownRun(session, files)
  if (run !== null) {
    const rows = run.tickets.map(id => row(id, files, git[id] ?? null, now))
    const closed = rows.filter(r => r.stage === 'closed').length
    const counts: Count[] = []
    for (const [word, tone] of COUNTED) {
      const n = rows.filter(r => r.verdict.word === word).length
      if (n > 0) counts.push({ label: `${n} ${word}`, tone })
    }

    return { heading: `Gru · ${run.epic} · ${closed}/${rows.length} closed`, counts, hasLegend: true, rows }
  }

  const id = ticketOf(root)
  if (id === null || files[`${id}.json`] === undefined) return null

  return { heading: null, counts: [], hasLegend: false, rows: [row(id, files, git[id] ?? null, now)] }
}
