import type { SuperBoard, SuperLook, SuperRow, SuperSettings, SuperState } from '../types'
import { launched, MAX_WORKERS, parse } from './board'
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

/** An epic's Gru: its launch id (the epic while none is written), and its run file's tickets, or null with no run file. */
function epicRun(epic: string, gru: Record<string, unknown> | undefined, files: Record<string, string>) {
  const launch = str(gru?.launch) ?? epic
  const runFile = parse(files[gruRunName(launch)])
  const tickets = Array.isArray(runFile?.tickets)
    ? [...new Set(runFile.tickets.filter((id): id is string => typeof id === 'string'))]
    : null

  return { launch, tickets }
}

/** The tickets of each epic of a Super-Gru run file: the files a poll reads for its board. */
export function superTickets(name: string, files: Record<string, string>): string[] {
  const s = superRunOf(files[name])

  return s === null ? [] : s.epics.flatMap(epic => epicRun(epic, s.grus[epic], files).tickets ?? [])
}

const GRU_STATES = new Set(['queued', 'live', 'reported', 'ended'])

/**
 * One epic's row: its tickets from its Gru's run file, each ticket's stage
 * from its own file. All closed reads `done`; any blocked, `blocked`; a Gru
 * not started yet, `waiting`; a Gru that reported or ended with no run file
 * left, `done` with no count; else `in work`.
 */
function rowOf(
  epic: string,
  gru: Record<string, unknown> | undefined,
  files: Record<string, string>,
): { row: Omit<SuperRow, 'title'>; looks: SuperLook[] } {
  const { launch, tickets } = epicRun(epic, gru, files)
  const gruState = typeof gru?.state === 'string' && GRU_STATES.has(gru.state) ? gru.state : 'queued'
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
      // A session id's first 8 characters name it; a launch id shows whole.
      gru: gruState === 'queued' ? null : (str(gru?.session)?.slice(0, 8) ?? launch),
      gruState: gruState as SuperRow['gruState'],
    },
    looks,
  }
}

/** The board of the Super-Gru run file `name`, or null when it does not parse. */
export function buildSuper(name: string, files: Record<string, string>, epicTitles: ReadonlyMap<string, string>, now: number): SuperBoard | null {
  const s = superRunOf(files[name])
  if (s === null) return null
  const launchId = superIdOf(name)
  const built = s.epics.map(epic => rowOf(epic, s.grus[epic], files))

  return {
    launchId,
    rows: built.map(b => ({ ...b.row, title: epicTitles.get(b.row.epic) ?? null })),
    looks: built.flatMap(b => b.looks),
    settings: superSettingsOf(s.run, files[superSettingsName(launchId)]),
    readAt: now,
  }
}

/** The files a Super-Gru board reads beyond the run files: its settings file, and each epic's tickets' files. */
export function superReads(name: string, files: Record<string, string>): string[] {
  return [superSettingsName(superIdOf(name)), ...superTickets(name, files).map(id => `${id}.json`)]
}

/** The logs a Super-Gru board reads once its tickets' files are in: each blocked ticket's, for what it waits on. */
export function superLogs(name: string, files: Record<string, string>): string[] {
  return superTickets(name, files)
    .filter(id => parse(files[`${id}.json`])?.stage === 'blocked')
    .map(logName)
}
