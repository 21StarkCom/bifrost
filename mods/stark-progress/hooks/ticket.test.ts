import { expect, test } from 'claude-code/testing'

import { buildTicket, ticketSettingsName, ticketSettingsOf } from './ticket'

const T0 = Date.parse('2026-10-29T12:00:00Z')
const MIN = 60_000
const iso = (minutesAgo: number) => new Date(T0 - minutesAgo * MIN).toISOString()
const ticket = (stage: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id: 'STARK-1', title: '[bug] bragi: read the words file (slice 2 of 3)', stage, pr: null, updated: iso(10), ...extra })

test("the ticket's settings take their defaults when absent or of the wrong type", () => {
  const defaults = { mergeOnGreen: true, reviewDepth: 'by-change', release: 'run' }
  expect(ticketSettingsName('STARK-1')).toBe('STARK-1.settings.json')
  expect(ticketSettingsOf(undefined)).toEqual(defaults)
  expect(ticketSettingsOf('{ not json')).toEqual(defaults)
  expect(ticketSettingsOf(JSON.stringify({ mergeOnGreen: 'no', reviewDepth: 'deeper', release: false }))).toEqual(defaults)
  expect(ticketSettingsOf(JSON.stringify({ mergeOnGreen: false, reviewDepth: 'deep', release: 'stop' }))).toEqual({
    mergeOnGreen: false,
    reviewDepth: 'deep',
    release: 'stop',
  })
})

test('the ticket pane reads the name, the repo, the epic, the activity and the next step', () => {
  const files: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-2'] }),
    'STARK-1.json': ticket('pr'),
    'STARK-1.beat.json': JSON.stringify({
      lastActivity: iso(1),
      running: null,
      minutes: [{ at: Math.floor(T0 / MIN) - 2, calls: 7, fails: 1 }],
      recent: [false, true, false],
    }),
    'STARK-1.settings.json': JSON.stringify({ reviewDepth: 'deep' }),
  }
  const t = buildTicket('STARK-1', T0, files, new Map(), { commits: [T0 - 5 * MIN, T0 - 3 * MIN], added: 40, removed: 3 })
  expect(t).toMatchObject({
    id: 'STARK-1',
    name: 'Read the words file',
    repo: 'bragi',
    slice: 'slice 2 of 3',
    epic: 'STARK-10',
    at: 1,
    state: 'pr',
    status: '10m',
    hold: null,
    attention: null,
    next: 'Review the PR.',
    settings: { mergeOnGreen: true, reviewDepth: 'deep', release: 'run' },
  })
  expect(t?.activity).toEqual([
    'Last tool call 1m ago.',
    '7 tool calls in the last 15 minutes.',
    '1 of the last 3 calls failed.',
    '+40 −3 in its worktree.',
    '2 commits since its base.',
  ])
  // Its last hour, as the Gru pane's opened row reads it: the stage change, then a commit in each of the last two 5 minutes, whose marks win over the calls.
  expect(t?.cells.map(c => c.ch).join('')).toBe('·········◆◆◆')
  expect(buildTicket('STARK-9', T0, files, new Map(), null)).toBe(null)
})

test('the next step follows the stage, and a hold waits for your OK', () => {
  const next = (stage: string, extra: Record<string, unknown> = {}) =>
    buildTicket('STARK-1', T0, { 'STARK-1.json': ticket(stage, extra) }, new Map(), null)
  expect(next('ticket')?.next).toBe('Open the PR.')
  expect(next('review')?.next).toBe('Merge the PR.')
  expect(next('merged')?.next).toBe('Release, or close the ticket.')
  expect(next('blocked')).toMatchObject({ next: 'Wait for the block to clear.', attention: 'blocked for 10m' })
  expect(next('closed')).toMatchObject({ next: null, at: 5, state: 'done' })
  expect(next('review', { hold: 'merge' })).toMatchObject({
    hold: 'merge',
    next: 'Wait for your merge OK.',
    attention: 'Held by your settings: merge',
  })
  expect(next('merged', { hold: 'release' })?.next).toBe('Wait for your release OK.')
  // A closed ticket holds nothing, whatever its file says.
  expect(next('closed', { hold: 'release' })).toMatchObject({ hold: null, attention: null })
  // No heartbeat yet, and no epic: a `--tickets` run's epic is its first ticket.
  const own = buildTicket(
    'STARK-1',
    T0,
    { 'STARK-1.json': ticket('ticket'), 'run-STARK-1.json': JSON.stringify({ epic: 'STARK-1', session: 'g', tickets: ['STARK-1'] }) },
    new Map(),
    null,
  )
  expect(own).toMatchObject({ epic: null, activity: ['No tool call yet.'] })
  // A `--tickets` run, launched as `GRU-n`, names no epic for its other tickets either.
  const listed = buildTicket(
    'STARK-1',
    T0,
    { 'STARK-1.json': ticket('ticket'), 'run-GRU-3.json': JSON.stringify({ epic: 'STARK-7', session: 'g', tickets: ['STARK-7', 'STARK-1'] }) },
    new Map(),
    null,
  )
  expect(listed?.epic).toBe(null)
  // A worker tab's own heartbeat before its first call says the same.
  const quiet = JSON.stringify({ lastActivity: null, running: null, minutes: [], recent: [] })
  const fresh = buildTicket('STARK-1', T0, { 'STARK-1.json': ticket('ticket'), 'STARK-1.beat.json': quiet }, new Map(), null)
  expect(fresh?.activity).toEqual(['No tool call yet.'])
})

test("a ticket's start is its log's oldest line, else when its stats began, and its epic's title is alfred's or its row's", () => {
  const log = `${JSON.stringify({ at: iso(30), text: 'Opened the PR.' })}\n${JSON.stringify({ at: iso(90), text: 'Read the ticket.' })}\n`
  const stats = JSON.stringify({ session: 'w', since: iso(60), updated: iso(1) })
  const files: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'g', tickets: ['STARK-1'] }),
    'STARK-1.json': ticket('pr'),
    'STARK-1.stats.json': stats,
  }
  const titles = new Map([['STARK-10', 'EPIC: bragi: read the words file aloud']])
  expect(buildTicket('STARK-1', T0, files, new Map(), null, titles)).toMatchObject({
    epic: 'STARK-10',
    epicTitle: 'Read the words file aloud',
    started: T0 - 60 * MIN,
  })
  // The log's oldest line wins over the stats, in whatever order the lines are.
  expect(buildTicket('STARK-1', T0, { ...files, 'STARK-1.log.jsonl': log }, new Map(), null, titles)?.started).toBe(T0 - 90 * MIN)
  // No title known yet: the epic's id alone.
  expect(buildTicket('STARK-1', T0, files, new Map(), null)?.epicTitle).toBe(null)
  // An epic that is a ticket of its own run takes its row's name, and never alfred's.
  const listed = {
    ...files,
    'run-STARK-10.json': JSON.stringify({
      epic: 'STARK-10',
      session: 'g',
      tickets: ['STARK-10', 'STARK-1'],
      titles: { 'STARK-10': '[epic] Speak the hints' },
    }),
  }
  expect(buildTicket('STARK-1', T0, listed, new Map(), null, titles)?.epicTitle).toBe('Speak the hints')
})

test('a ticket with no title, no log and no stats has no name and no start: the pane shows its id alone', () => {
  const t = buildTicket('STARK-1', T0, { 'STARK-1.json': JSON.stringify({ id: 'STARK-1', stage: 'ticket' }) }, new Map(), null)
  expect(t).toMatchObject({ name: '', repo: null, slice: null, epic: null, epicTitle: null, started: null })
})
