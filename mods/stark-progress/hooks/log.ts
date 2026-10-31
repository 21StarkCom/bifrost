import type { LogDay, LogEntry, LogView } from '../types'

// What a pane's Log tab draws, from the contract's log files (../README.md):
// the big steps a worker or Gru did, each one line in plain words. Pure: the
// poller reads the disk. The writer words each line; the mod only keeps it to
// one line of 20 words, newest first.

/** The most words a line shows; a longer line is cut, with `…` at the cut. */
export const LOG_WORDS = 20
/** The most lines a Log tab shows: the newest. */
export const LOG_SHOWN = 50

/** A ticket's log file. */
export const logName = (id: string) => `${id}.log.jsonl`
/** A Gru run's log file. */
export const runLogName = (launchId: string) => `run-${launchId}.log.jsonl`

/** One line of a log file, read: when, and the words kept to one line of 20. */
export type LogLine = { at: number; text: string }

/** A writer's words as one line of at most LOG_WORDS words: each run of white space or control characters (C0 and C1) is one space. */
export function plain(text: string): string {
  // A control character (a terminal escape, say, or the one-byte CSI U+009B) would draw as noise in the pane.
  const words = text.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().split(' ').filter(w => w !== '')

  return words.length > LOG_WORDS ? `${words.slice(0, LOG_WORDS).join(' ')}…` : words.join(' ')
}

/**
 * A log file's lines, in file order. A writer appends one whole JSON object a
 * line; a line that does not parse (a write not yet whole), or has no words or
 * no valid `at`, is skipped.
 */
export function logOf(text: string | undefined): LogLine[] {
  if (!text) return []
  const lines: LogLine[] = []
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      continue
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const { at, text: words } = value as Record<string, unknown>
    const ms = typeof at === 'string' ? Date.parse(at) : Number.NaN
    const kept = typeof words === 'string' ? plain(words) : ''
    if (Number.isFinite(ms) && kept !== '') lines.push({ at: ms, text: kept })
  }

  return lines
}

const two = (n: number) => String(n).padStart(2, '0')
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/** `Today`, `Yesterday`, or `Thu 29 Oct`, in local time. */
export function dayOf(ms: number, now: number): string {
  const d = new Date(ms)
  const today = new Date(now)
  if (dayKey(d) === dayKey(today)) return 'Today'
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday'

  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/**
 * One log file and whose steps it holds: `Gru`, a ticket's name, or null in a
 * pane of one ticket. `isRun` marks Gru's own log, so a ticket whose name reads
 * `Gru` never takes Gru's color.
 */
export type LogSource = { who: string | null; isRun?: boolean; text: string | undefined }

/**
 * The Log tab: every source's lines merged, newest first (a later line of one
 * file first on a tie), the newest LOG_SHOWN of them, in days. A day is named
 * unless every line shown is today's.
 */
export function buildLog(sources: readonly LogSource[], now: number): LogView {
  const all: (LogLine & { who: string | null; isRun: boolean; order: number })[] = []
  for (const source of sources) {
    for (const line of logOf(source.text)) {
      all.push({ ...line, who: source.who, isRun: source.isRun === true, order: all.length })
    }
  }
  all.sort((a, b) => b.at - a.at || b.order - a.order)
  const shown = all.slice(0, LOG_SHOWN)
  const days: LogDay[] = []
  for (const line of shown) {
    const d = new Date(line.at)
    const clock = `${two(d.getHours())}:${two(d.getMinutes())}`
    const entry: LogEntry = { at: line.at, clock, who: line.who, isRun: line.isRun, text: line.text }
    const label = dayOf(line.at, now)
    const last = days[days.length - 1]
    if (last !== undefined && last.label === label) last.entries.push(entry)
    else days.push({ label, entries: [entry] })
  }
  // Today alone needs no name over it; one older day does, or its times read as today's.
  if (days.length === 1 && days[0]?.label === 'Today') days[0].label = null

  return { days, older: all.length - shown.length }
}
