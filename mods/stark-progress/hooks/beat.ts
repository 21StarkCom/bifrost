import type { BeatFile, BeatMinute } from '../types'

// A worker's heartbeat, kept in memory from its tool calls and written as the
// contract's `<STARK-n>.beat.json` (../README.md).
const WINDOW_MIN = 60
export const RECENT = 10

export type Beat = {
  minutes: Map<number, BeatMinute>
  recent: boolean[]
  lastActivity: number | null
  running: Map<string, { tool: string; since: number }>
}

export function newBeat(): Beat {
  return { minutes: new Map(), recent: [], lastActivity: null, running: new Map() }
}

/**
 * After a reload, take back what this session wrote before it: the minutes,
 * the outcomes and the last activity (not the running calls, which the reload
 * lost). A file of another session, or a beat that has data already, is left.
 */
export function seedBeat(beat: Beat, text: string | undefined, session: string): void {
  let file: Partial<BeatFile> | null = null
  try {
    file = text === undefined ? null : (JSON.parse(text) as Partial<BeatFile> | null)
  } catch {
    return
  }
  if (file?.session !== session || beat.lastActivity !== null || beat.minutes.size > 0) return
  const { minutes, recent, lastActivity } = beatFields(file as Record<string, unknown>)
  beat.minutes = minutes
  beat.recent = recent.slice(-RECENT)
  beat.lastActivity = lastActivity
}

/**
 * The minutes, outcomes and last activity of a parsed heartbeat file; a field
 * of the wrong type reads as absent. The reload's seed and the view share it.
 */
export function beatFields(file: Record<string, unknown>): Pick<Beat, 'minutes' | 'recent' | 'lastActivity'> {
  const minutes = new Map<number, BeatMinute>()
  for (const m of Array.isArray(file.minutes) ? file.minutes : []) {
    const { at, calls, fails } = (m ?? {}) as Record<string, unknown>
    if (typeof at === 'number' && typeof calls === 'number') {
      minutes.set(at, { at, calls, fails: typeof fails === 'number' ? fails : 0 })
    }
  }
  const recent = Array.isArray(file.recent) ? file.recent.filter((x): x is boolean => typeof x === 'boolean') : []
  const last = typeof file.lastActivity === 'string' ? Date.parse(file.lastActivity) : Number.NaN

  return { minutes, recent, lastActivity: Number.isFinite(last) ? last : null }
}

/** A tool call started: it is running, and it is activity. */
export function callStarted(beat: Beat, key: string, tool: string, now: number): void {
  beat.running.set(key, { tool, since: now })
  beat.lastActivity = now
}

/** A tool call ended: it counts in the minute it ended, and among the last ten outcomes. */
export function callEnded(beat: Beat, key: string, isFailed: boolean, now: number): void {
  beat.running.delete(key)
  beat.lastActivity = now
  const at = Math.floor(now / 60_000)
  const minute = beat.minutes.get(at) ?? { at, calls: 0, fails: 0 }
  minute.calls += 1
  if (isFailed) minute.fails += 1
  beat.minutes.set(at, minute)
  beat.recent.push(isFailed)
  if (beat.recent.length > RECENT) beat.recent.splice(0, beat.recent.length - RECENT)
}

/** The file the contract names, with the minutes older than the window dropped. */
export function beatFile(beat: Beat, id: string, session: string, now: number): BeatFile {
  const oldest = Math.floor(now / 60_000) - WINDOW_MIN + 1
  for (const at of beat.minutes.keys()) if (at < oldest) beat.minutes.delete(at)
  let first: { tool: string; since: number } | null = null
  for (const call of beat.running.values()) if (first === null || call.since < first.since) first = call

  return {
    id,
    session,
    updated: new Date(now).toISOString(),
    lastActivity: beat.lastActivity === null ? null : new Date(beat.lastActivity).toISOString(),
    running: first === null ? null : { tool: first.tool, since: new Date(first.since).toISOString() },
    minutes: [...beat.minutes.values()].sort((a, b) => a.at - b.at),
    recent: [...beat.recent],
  }
}
