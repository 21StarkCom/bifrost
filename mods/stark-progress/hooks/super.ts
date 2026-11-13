import type { SuperBoard, SuperLook, SuperRow, SuperSettings, SuperState } from '../types'
import { MAX_WORKERS, parse } from './board'
import { logName, logOf } from './log'

// What the Super-Gru pane draws (super-pane.tsx), from the Super-Gru run file
// (skill/super-gru/references/run-file.md) and each epic's Gru run file and
// ticket files (../README.md). Pure: the poller reads the disk.

const DEFAULT_WORKERS = 4
const DEFAULT_PARALLEL = 1

/** A Super-Gru run file's name; its settings file (`super-<id>.settings.json`) is not one. */
export const isSuperName = (name: string) =>
  name.startsWith('super-') && name.endsWith('.json') && !name.endsWith('.settings.json')
export const superIdOf = (name: string) => name.slice('super-'.length, -'.json'.length)
export const superSettingsName = (launchId: string) => `super-${launchId}.settings.json`

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const flag = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_WORKERS ? v : null

/** The name of the first Super-Gru run file, by name, whose `session` is `session`, else null. */
export function ownSuper(session: string, files: Record<string, string>): string | null {
  for (const name of Object.keys(files).filter(isSuperName).sort()) {
    const run = parse(files[name])
    if (run !== null && run.session === session && Array.isArray(run.epics)) return name
  }

  return null
}

/**
 * The settings of a Super-Gru run: the settings file's value, else the run
 * file's, else the default. A field of the wrong type reads as absent.
 */
export function superSettingsOf(run: Record<string, unknown> | null, text: string | undefined): SuperSettings {
  const s = parse(text)
  const r = run?.settings !== null && typeof run?.settings === 'object' ? (run.settings as Record<string, unknown>) : null

  return {
    maxWorkers: count(s?.maxWorkers) ?? count(r?.maxWorkers) ?? DEFAULT_WORKERS,
    parallel: count(s?.parallel) ?? count(r?.parallel) ?? DEFAULT_PARALLEL,
    followUps: flag(s?.followUps) ?? flag(r?.followUps) ?? true,
    decideForMe: flag(s?.decideForMe) ?? flag(r?.decideForMe) ?? true,
  }
}

/** The Gru run file an epic's Gru writes: `run-<launch>.json`, the launch being the epic. */
export const gruRunName = (launch: string) => `run-${launch}.json`

/** The tickets of each epic of a Super-Gru run file: the files a poll reads for its board. */
export function superTickets(name: string, files: Record<string, string>): string[] {
  const run = parse(files[name])
  if (run === null || !Array.isArray(run.epics)) return []
  const grus = (run.grus ?? {}) as Record<string, Record<string, unknown> | undefined>

  return run.epics.flatMap(epic => {
    if (typeof epic !== 'string') return []
    const gru = parse(files[gruRunName(str(grus[epic]?.launch) ?? epic)])

    return Array.isArray(gru?.tickets) ? gru.tickets.filter((id): id is string => typeof id === 'string') : []
  })
}

const GRU_STATES = new Set(['queued', 'live', 'reported', 'ended'])

/**
 * One epic's row: its tickets from its Gru's run file, each ticket's stage
 * from its own file. All closed reads `done`; any blocked, `blocked`; a Gru
 * not started yet, `waiting`; a Gru that reported or ended with no run file
 * left, `done` with no count; else `in work`.
 */
function rowOf(epic: string, gru: Record<string, unknown> | undefined, files: Record<string, string>): { row: SuperRow; looks: SuperLook[] } {
  const launch = str(gru?.launch) ?? epic
  const gruState = typeof gru?.state === 'string' && GRU_STATES.has(gru.state) ? gru.state : 'queued'
  const runFile = parse(files[gruRunName(launch)])
  const tickets = Array.isArray(runFile?.tickets)
    ? [...new Set(runFile.tickets.filter((id): id is string => typeof id === 'string'))]
    : null
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
          : isEnded && tickets === null
            ? 'done'
            : 'in work'
  const looks = blocked.map(t => {
    const last = logOf(files[logName(t.id)]).at(-1)?.text ?? null

    return { epic, id: t.id, title: str(t.file?.title), waits: last ?? 'no reason in its log yet' }
  })

  return {
    row: {
      epic,
      state,
      done: total === null ? null : done,
      total,
      gru: gruState === 'queued' ? null : str(gru?.session) ?? launch,
      gruState: gruState as SuperRow['gruState'],
    },
    looks,
  }
}

/** The board of the Super-Gru run file `name`, or null when it does not parse. */
export function buildSuper(name: string, files: Record<string, string>, epicTitles: ReadonlyMap<string, string>, now: number): SuperBoard | null {
  const run = parse(files[name])
  if (run === null || !Array.isArray(run.epics)) return null
  const launchId = superIdOf(name)
  const grus = (run.grus !== null && typeof run.grus === 'object' ? run.grus : {}) as Record<string, Record<string, unknown> | undefined>
  const epics = [...new Set(run.epics.filter((e): e is string => typeof e === 'string'))]
  const built = epics.map(epic => rowOf(epic, grus[epic], files))

  return {
    launchId,
    session: str(run.session) ?? '',
    rows: built.map(b => ({ ...b.row, title: epicTitles.get(b.row.epic) ?? null })),
    looks: built.flatMap(b => b.looks),
    settings: superSettingsOf(run, files[superSettingsName(launchId)]),
    readAt: now,
  }
}

/** The files a Super-Gru board reads beyond the run files: its settings, and each epic's tickets' files and logs. */
export function superReads(name: string, files: Record<string, string>): string[] {
  return [
    superSettingsName(superIdOf(name)),
    ...superTickets(name, files).flatMap(id => [`${id}.json`, logName(id)]),
  ]
}
