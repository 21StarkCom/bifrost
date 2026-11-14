import type { LogView, SuperBoard, SuperLook, SuperMemory, SuperRow, SuperSettings, SuperState } from '../types'
import { launched, MAX_WORKERS, nameOf, parse, titleIn, titlesOf } from './board'
import { buildSuperGithub } from './github'
import type { RepoAnswer } from './github'
import { buildLog, LOG_SHOWN, logName, logOf, runLogName, superLogName } from './log'
import { runStatsName, statsName, superStats, superStatsName } from './stats'

// What the Super-Gru pane draws (super-pane.tsx), from the Super-Gru run file
// (skill/super-gru/references/run-file.md), each epic's Gru run file and
// ticket files, and the stats files of Super-Gru, each Gru and each worker
// (../README.md). Pure: the poller reads the disk and asks GitHub.

const DEFAULT_WORKERS = 4
const DEFAULT_PARALLEL = 1

/** A Super-Gru run file's name; its settings and stats files (`super-<id>.settings.json`, `.stats.json`) are not. */
export const isSuperName = (name: string) =>
  name.startsWith('super-') && name.endsWith('.json') && !name.endsWith('.settings.json') && !name.endsWith('.stats.json')
export const superIdOf = (name: string) => name.slice('super-'.length, -'.json'.length)
export const superSettingsName = (launchId: string) => `super-${launchId}.settings.json`

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const flag = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
/** A count in the settings file: 1 to MAX_WORKERS, as the pane steps it. */
const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_WORKERS ? v : null

type Grus = Record<string, Record<string, unknown> | undefined>

/** A Super-Gru run file, read: its epics, each once, and each epic's Gru; null when it is no such file. */
function superRunOf(text: string | undefined): { run: Record<string, unknown>; epics: string[]; grus: Grus } | null {
  const run = parse(text)
  if (run === null || !Array.isArray(run.epics)) return null
  const grus = (run.grus !== null && typeof run.grus === 'object' ? run.grus : {}) as Grus

  return { run, epics: [...new Set(run.epics.filter((e): e is string => typeof e === 'string'))], grus }
}

/** The name of the first Super-Gru run file, by name, whose `session` is `session`, else null. */
export function ownSuper(session: string, files: Record<string, string>): string | null {
  for (const name of Object.keys(files).filter(isSuperName).sort()) {
    if (superRunOf(files[name])?.run.session === session) return name
  }

  return null
}

/**
 * The settings of a Super-Gru run: the settings file's value, else the run
 * file's, else the default. A field of the wrong type reads as absent. The
 * run file's counts are the launch's, with no cap: a run launched above the
 * pane's range keeps its value.
 */
export function superSettingsOf(run: Record<string, unknown> | null, text: string | undefined): SuperSettings {
  const s = parse(text)
  const r = run?.settings !== null && typeof run?.settings === 'object' ? (run.settings as Record<string, unknown>) : null

  return {
    maxWorkers: count(s?.maxWorkers) ?? launched(r?.maxWorkers) ?? DEFAULT_WORKERS,
    parallel: count(s?.parallel) ?? launched(r?.parallel) ?? DEFAULT_PARALLEL,
    followUps: flag(s?.followUps) ?? flag(r?.followUps) ?? true,
    decideForMe: flag(s?.decideForMe) ?? flag(r?.decideForMe) ?? true,
  }
}

/** The Gru run file an epic's Gru writes: `run-<launch>.json`, the launch being the epic. */
export const gruRunName = (launch: string) => `run-${launch}.json`

/** What Super-Gru's tab remembers of each epic, by epic. */
type Kept = SuperMemory['epics']

/** A Gru's state in the Super-Gru run file; anything else reads `queued`. */
const GRU_STATES = new Set(['queued', 'live', 'reported', 'ended'])
const gruStateOf = (gru: Record<string, unknown> | undefined): SuperRow['gruState'] =>
  typeof gru?.state === 'string' && GRU_STATES.has(gru.state) ? (gru.state as SuperRow['gruState']) : 'queued'

/**
 * An epic's Gru: its launch id (the epic while none is written), and its
 * tickets, their titles, its Gru's stats file and its Gru's log, from its run
 * files while they exist, else from what Super-Gru's tab kept of them; null
 * tickets with neither. `isGone` says the Gru's run file is gone. A queued
 * Gru has run nothing in this run: what was kept of its epic, and a log
 * under its epic's name, are an earlier run's.
 */
function epicRun(epic: string, gru: Record<string, unknown> | undefined, files: Record<string, string>, kept: Kept = {}) {
  const launch = str(gru?.launch) ?? epic
  const runFile = parse(files[gruRunName(launch)])
  const isQueued = gruStateOf(gru) === 'queued'
  const was = !isQueued && Object.hasOwn(kept, epic) ? kept[epic] : undefined
  const listed = Array.isArray(runFile?.tickets)
    ? [...new Set(runFile.tickets.filter((id): id is string => typeof id === 'string'))]
    : null
  const tickets = listed ?? was?.tickets ?? null

  return {
    launch,
    tickets,
    titles: listed !== null ? titlesOf(runFile?.titles, listed) : (was?.titles ?? {}),
    gruStats: files[runStatsName(launch)] ?? was?.gruStats ?? undefined,
    log: isQueued ? undefined : (files[runLogName(launch)] ?? was?.log ?? undefined),
    isQueued,
    isGone: runFile === null,
  }
}

/**
 * What Super-Gru's tab keeps of each epic of the run file `name`: its
 * tickets, their titles, its Gru's stats and the newest LOG_SHOWN lines of
 * its Gru's log, read now while the Gru's files exist, else kept from `was`.
 * A Gru deletes its files at its end; the board then reads these. Null while
 * the run file does not parse and nothing is kept.
 */
export function rememberSuper(name: string, files: Record<string, string>, was: SuperMemory | null): SuperMemory | null {
  const s = superRunOf(files[name])
  if (s === null) return was
  const launchId = superIdOf(name)
  const kept = was?.launchId === launchId ? was.epics : {}
  const epics: Kept = {}
  for (const epic of s.epics) {
    const r = epicRun(epic, s.grus[epic], files, kept)
    if (r.tickets === null) continue
    const log = r.log === undefined ? '' : newestLines(r.log)
    epics[epic] = { tickets: r.tickets, titles: r.titles, gruStats: r.gruStats ?? null, ...(log === '' ? {} : { log }) }
  }

  return { launchId, epics }
}

/** A log's newest LOG_SHOWN steps, each line whole: the Log tab never shows more of one file. A line logOf skips takes no place. */
function newestLines(text: string): string {
  const lines = text.split('\n').filter(l => logOf(l).length > 0)

  return lines.length === 0 ? '' : `${lines.slice(-LOG_SHOWN).join('\n')}\n`
}

/** A ticket's name, as the Gru pane names it: its own file's title, else the one its Gru wrote at launch, less its leads; '' with neither. */
function ticketName(id: string, titles: Record<string, string>, file: Record<string, unknown> | null): string {
  const title = titleIn({ titles }, id, file)

  return title === undefined ? '' : nameOf(title).name
}

/** The tickets of each epic of a Super-Gru run file, its own or kept: the files a poll reads for its board. */
export function superTickets(name: string, files: Record<string, string>, kept: Kept = {}): string[] {
  const s = superRunOf(files[name])

  return s === null ? [] : s.epics.flatMap(epic => epicRun(epic, s.grus[epic], files, kept).tickets ?? [])
}

/**
 * One epic's row: its tickets from its Gru's run file, or kept from it, each
 * ticket's stage from its own file, and how many are blocked. All closed reads `done`; any blocked,
 * `blocked`; a Gru not started yet, `waiting`; a Gru that reported or ended
 * with no run file left, `done` (with no count when nothing was kept); else
 * `in work`.
 */
function rowOf(
  epic: string,
  gru: Record<string, unknown> | undefined,
  files: Record<string, string>,
  { tickets, isGone }: ReturnType<typeof epicRun>,
): { row: Omit<SuperRow, 'title'>; looks: SuperLook[] } {
  const gruState = gruStateOf(gru)
  const stages = (tickets ?? []).map(id => ({ id, file: parse(files[`${id}.json`]) }))
  const done = stages.filter(t => t.file?.stage === 'closed').length
  const blocked = stages.filter(t => t.file?.stage === 'blocked')
  const total = tickets?.length ?? null
  const isEnded = gruState === 'reported' || gruState === 'ended'
  const state: SuperState =
    total !== null && total > 0 && done === total
      ? 'done'
      : blocked.length > 0
        ? 'blocked'
        : gruState === 'queued'
          ? 'waiting'
          : isEnded && isGone
            ? 'done'
            : 'in work'
  const looks = blocked.map(t => ({
    epic,
    id: t.id,
    waits: logOf(files[logName(t.id)]).at(-1)?.text ?? 'no reason in its log yet',
  }))

  return {
    row: {
      epic,
      state,
      done: total === null ? null : done,
      total,
      blocked: blocked.length,
      gruState,
    },
    looks,
  }
}

/**
 * The board of the Super-Gru run file `name`, or null when it does not parse.
 * `github` is each repo's last answer, by `owner/repo`; `memory` is what this
 * tab kept of each epic's Gru.
 */
export function buildSuper(
  name: string,
  files: Record<string, string>,
  epicTitles: ReadonlyMap<string, string>,
  now: number,
  github: ReadonlyMap<string, RepoAnswer> = new Map(),
  memory: SuperMemory | null = null,
): SuperBoard | null {
  const s = superRunOf(files[name])
  if (s === null) return null
  const launchId = superIdOf(name)
  const kept = memory?.launchId === launchId ? memory.epics : {}
  const runs = s.epics.map(epic => ({ epic, ...epicRun(epic, s.grus[epic], files, kept) }))
  const built = runs.map(r => rowOf(r.epic, s.grus[r.epic], files, r))
  const stats = superStats(
    files,
    launchId,
    runs.map((r, i) => ({
      epic: r.epic,
      gruStats: r.gruStats,
      tickets: r.tickets ?? [],
      done: built[i]?.row.done ?? null,
      total: built[i]?.row.total ?? null,
    })),
  )

  const rows = built.map(b => ({ ...b.row, title: epicName(epicTitles.get(b.row.epic)) }))

  return {
    launchId,
    rows,
    looks: built.flatMap(b => b.looks),
    settings: superSettingsOf(s.run, files[superSettingsName(launchId)]),
    stats: stats.view,
    epicStats: stats.epics,
    // A ticket two epics list is one ticket, as every count on the board takes it.
    tickets: new Set(runs.flatMap(r => r.tickets ?? [])).size,
    github: buildSuperGithub(
      runs.map(r => ({
        epic: r.epic,
        tickets: (r.tickets ?? []).map(id => {
          const file = parse(files[`${id}.json`])
          return { id, name: ticketName(id, r.titles, file), pr: file?.pr }
        }),
      })),
      github,
    ),
    log: superLog(launchId, files, runs.map((r, i) => ({ epic: r.epic, name: rows[i]?.title ?? null, log: r.log })), now),
    endedAt: null,
    readAt: now,
  }
}

/** An epic's title as the Gru pane names its epic: less its `EPIC:`, `[tag]` and `repo: ` leads; null with none. */
function epicName(title: string | undefined): string | null {
  const name = title === undefined ? '' : nameOf(title).name

  return name === '' ? null : name
}

/**
 * The Log tab: Super-Gru's own steps, and each epic's Gru's steps from its
 * run log, or the lines kept of it, newest first. A Gru's step names its
 * epic, by its row's name.
 */
function superLog(
  launchId: string,
  files: Record<string, string>,
  runs: readonly { epic: string; name: string | null; log: string | undefined }[],
  now: number,
): LogView {
  return buildLog(
    [
      { who: 'Super-Gru', isRun: true, text: files[superLogName(launchId)] },
      ...runs.map(r => ({ who: r.name ?? '', id: r.epic, text: r.log })),
    ],
    now,
  )
}

/**
 * The files a Super-Gru board reads beyond the run files: its settings,
 * stats and log files, each Gru's stats file, each started Gru's log, and
 * each epic's tickets' files and stats files.
 */
export function superReads(name: string, files: Record<string, string>, kept: Kept = {}): string[] {
  const s = superRunOf(files[name])
  const launchId = superIdOf(name)
  const runs = s === null ? [] : s.epics.map(epic => epicRun(epic, s.grus[epic], files, kept))

  return [
    superSettingsName(launchId),
    superStatsName(launchId),
    superLogName(launchId),
    ...runs.flatMap(r => [runStatsName(r.launch), ...(r.isQueued ? [] : [runLogName(r.launch)])]),
    ...runs.flatMap(r => r.tickets ?? []).flatMap(id => [`${id}.json`, statsName(id)]),
  ]
}

/** The logs a Super-Gru board reads once its tickets' files are in: each blocked ticket's, for what it waits on. */
export function superLogs(name: string, files: Record<string, string>, kept: Kept = {}): string[] {
  return superTickets(name, files, kept)
    .filter(id => parse(files[`${id}.json`])?.stage === 'blocked')
    .map(logName)
}
