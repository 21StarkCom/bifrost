import type { GitSignal, Stage, TicketBoard, TicketSettings } from '../types'
import { beatFields } from './beat'
import { calm, callsOf, nameOf, parse, runsOf } from './board'
import { holdOf, row } from './view'

// What the ticket pane draws (ticket-pane.tsx), from the contract's files
// (../README.md): a worker's own ticket, read as the Gru pane reads a row, and
// the settings its worker reads. Pure: the poller reads the disk. Counts and
// elapsed times only, never a forecast.

export const ticketSettingsName = (id: string) => `${id}.settings.json`

/**
 * The settings the worker reads before its review, its merge and its release.
 * A field that is absent or of the wrong type takes its default.
 */
export function ticketSettingsOf(text: string | undefined): TicketSettings {
  const s = parse(text)

  return {
    mergeOnGreen: typeof s?.mergeOnGreen === 'boolean' ? s.mergeOnGreen : true,
    reviewDepth: s?.reviewDepth === 'deep' ? 'deep' : 'by-change',
    release: s?.release === 'stop' ? 'stop' : 'run',
  }
}

/** The next spine step at each stage; a closed ticket has none. */
const NEXT: Record<Stage, string | null> = {
  ticket: 'Open the PR.',
  pr: 'Review the PR.',
  review: 'Merge the PR.',
  merged: 'Release, or close the ticket.',
  blocked: 'Wait for the block to clear.',
  closed: null,
}

/** The ticket pane for `id`, or null while the ticket has no file. */
export function buildTicket(
  id: string,
  now: number,
  files: Record<string, string>,
  mtimes: ReadonlyMap<string, number>,
  git: GitSignal | null,
): TicketBoard | null {
  const text = files[`${id}.json`]
  if (text === undefined) return null
  const t = parse(text)
  const beat = parse(files[`${id}.beat.json`])
  const lastActivity = beat === null ? null : beatFields(beat).lastActivity
  const r = row(id, files, git, now)
  const reading = calm(r, true, lastActivity, now)
  // The verdict reads a hold only while the ticket is neither closed nor blocked.
  const hold = r.verdict.word === 'held' ? holdOf(t?.hold) : null
  const words = nameOf(typeof t?.title === 'string' && t.title !== '' ? t.title : id)
  // Only an epic's run (launched under the epic's own id) names a parent. A
  // `--tickets` run (launched as `GRU-n`) writes its first ticket as `epic`,
  // which is no parent of the others; and no ticket is part of itself.
  const run = runsOf(files, mtimes).find(run => run.tickets.includes(id) && run.epic === run.launchId && run.epic !== id)
  // A heartbeat with no call yet (a worker tab's own, before its first call) says so.
  const activity = beat === null || lastActivity === null ? ['No tool call yet.'] : callsOf(beat, now)
  if (git !== null && r.diff !== null) {
    activity.push(`${r.diff} in its worktree.`)
    activity.push(git.commits.length === 1 ? '1 commit since its base.' : `${git.commits.length} commits since its base.`)
  }

  return {
    ...reading,
    name: words.name || id,
    repo: words.repo,
    slice: words.slice,
    epic: run?.epic ?? null,
    hold,
    attention: hold === null ? reading.attention : `Held by your settings: ${hold}`,
    activity,
    next: hold === null ? NEXT[r.stage] : `Wait for your ${hold} OK.`,
    settings: ticketSettingsOf(files[ticketSettingsName(id)]),
    readAt: now,
  }
}
