import { expect, test } from 'claude-code/testing'

import { buildBoard, nameOf, runsOf, settingsOf, startOf, stepCounts } from './board'
import { isRunName } from './view'

const T0 = Date.parse('2026-10-29T12:00:00Z')
const MIN = 60_000
const iso = (minutesAgo: number) => new Date(T0 - minutesAgo * MIN).toISOString()
const ticket = (id: string, stage: string, minutesAgo = 10, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, title: `demo: work on ${id}`, stage, pr: null, updated: iso(minutesAgo), ...extra })

test('a settings file is never a run file', () => {
  expect(isRunName('run-STARK-10.json')).toBe(true)
  expect(isRunName('run-STARK-10.settings.json')).toBe(false)
  const files = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 's', tickets: ['STARK-1'] }),
    'run-STARK-10.settings.json': JSON.stringify({ maxWorkers: 2 }),
  }
  // The settings file is the newest, and still no run.
  const mtimes = new Map([['run-STARK-10.json', T0 - MIN], ['run-STARK-10.settings.json', T0]])
  expect(runsOf(files, mtimes).map(r => r.launchId)).toEqual(['STARK-10'])
})

test('the most recently active run comes first, by its ticket files and heartbeats', () => {
  const files = {
    'run-GRU-1.json': JSON.stringify({ epic: 'STARK-1', session: 'a', tickets: ['STARK-2'] }),
    'run-STARK-5.json': JSON.stringify({ epic: 'STARK-5', session: 'b', tickets: ['STARK-6', 'STARK-6'] }),
  }
  const mtimes = new Map([
    ['run-GRU-1.json', T0],
    ['run-STARK-5.json', T0 - 60 * MIN],
    ['STARK-6.beat.json', T0 + MIN],
  ])
  const runs = runsOf(files, mtimes)
  expect(runs.map(r => [r.launchId, r.epic])).toEqual([['STARK-5', 'STARK-5'], ['GRU-1', 'STARK-1']])
  expect(runs[0]?.tickets).toEqual(['STARK-6'])
})

test("settings take the file's value, else the launch's, else the default; a wrong type reads as absent", () => {
  const [run] = runsOf(
    { 'run-X.json': JSON.stringify({ epic: 'X', session: 's', tickets: [], maxWorkers: 5, minionAgent: 'codex' }) },
    new Map(),
  )
  if (run === undefined) throw new Error('no run')
  expect(settingsOf(run, undefined)).toEqual({ decideForMe: true, maxWorkers: 5, followUps: true, minionAgent: 'codex' })
  expect(settingsOf(run, '{ not json')).toEqual(settingsOf(run, undefined))
  expect(settingsOf(run, JSON.stringify({ decideForMe: false, maxWorkers: 2, followUps: 'yes', minionAgent: 'gpt' }))).toEqual({
    decideForMe: false,
    maxWorkers: 2,
    followUps: true,
    minionAgent: 'codex',
  })
  // Out of range reads as absent too.
  expect(settingsOf(run, JSON.stringify({ maxWorkers: 9 })).maxWorkers).toBe(5)
  // A launch above the pane's range keeps its N; it is not read as the default.
  const [wide] = runsOf({ 'run-W.json': JSON.stringify({ epic: 'W', session: 's', tickets: [], maxWorkers: 10 }) }, new Map())
  if (wide === undefined) throw new Error('no run')
  expect(settingsOf(wide, undefined).maxWorkers).toBe(10)
  const [v1] = runsOf({ 'run-Y.json': JSON.stringify({ epic: 'Y', session: 's', tickets: [] }) }, new Map())
  if (v1 === undefined) throw new Error('no run')
  expect(settingsOf(v1, undefined)).toEqual({ decideForMe: true, maxWorkers: 3, followUps: true, minionAgent: 'claude' })
})

test("a ticket's name comes from its file, else the run file's titles, else it has none", () => {
  const files: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({
      epic: 'STARK-10',
      session: 'gru',
      tickets: ['STARK-1', 'STARK-2', 'STARK-3', 'STARK-4', 'STARK-5'],
      titles: {
        'STARK-1': 'demo: the launch title',
        'STARK-2': 'bragi: speak the hints (slice 2 of 3)',
        'STARK-4': 42,
        'STARK-9': 'not in this run',
      },
    }),
    // The worker's title wins over the one Gru wrote at launch.
    'STARK-1.json': ticket('STARK-1', 'pr'),
    // A file that names no title, and no title in the run file.
    'STARK-3.json': JSON.stringify({ id: 'STARK-3', stage: 'pr', pr: null, updated: iso(10) }),
  }
  const [run] = runsOf(files, new Map())
  expect(run?.titles).toEqual({ 'STARK-1': 'demo: the launch title', 'STARK-2': 'bragi: speak the hints (slice 2 of 3)' })
  const board = buildBoard('gru', '', T0, files, new Map(), {})
  if (board === null) throw new Error('no board')
  const by = (id: string) => board.rows.find(r => r.id === id)
  expect(by('STARK-1')).toMatchObject({ name: 'Work on STARK-1', repo: 'demo' })
  // A ticket with no file yet takes its name, repo and slice from the run file; its detail keeps the whole title.
  expect(by('STARK-2')).toMatchObject({ name: 'Speak the hints', repo: 'bragi', slice: 'slice 2 of 3', tone: 'none' })
  expect(by('STARK-2')?.detail).toEqual(['bragi: speak the hints (slice 2 of 3)', 'Its worker has not started yet.'])
  expect(board.repos).toEqual(['demo', 'bragi'])
  // No title anywhere, or one of the wrong type: no name, so the pane shows the id alone.
  expect(by('STARK-3')?.name).toBe('')
  expect(by('STARK-3')?.detail[0]).toMatch(/^In this step since/)
  expect(by('STARK-4')).toMatchObject({ name: '', detail: ['Its worker has not started yet.'] })
  expect(by('STARK-5')?.name).toBe('')
})

test('a ticket id that names a built-in object key reads no title from the run file', () => {
  const files = { 'run-X.json': JSON.stringify({ epic: 'X', session: 'gru', tickets: ['toString', 'constructor'], titles: {} }) }
  const board = buildBoard('gru', '', T0, files, new Map(), {})
  expect(board?.rows.map(r => r.name)).toEqual(['', ''])
})

test("a run starts at its log's oldest line, else when Gru's stats began, else never", () => {
  const line = (min: number) => JSON.stringify({ at: new Date(T0 - min * MIN).toISOString(), text: 'a step' })
  const gru = JSON.stringify({ session: 'g', since: new Date(T0 - 30 * MIN).toISOString() })
  // Lines are not in time order: the oldest wins, and a line that does not parse is skipped.
  expect(startOf(`${line(5)}\n{ half\n${line(90)}\n`, gru)).toBe(T0 - 90 * MIN)
  expect(startOf(undefined, gru)).toBe(T0 - 30 * MIN)
  expect(startOf('{ half', undefined)).toBe(null)
})

test("an epic's title drops its `EPIC:` lead too", () => {
  expect(nameOf('EPIC: goldfinger: agents list, open and use a menu bar icon').name).toBe('Agents list, open and use a menu bar icon')
  expect(nameOf('epic: demo (slice 1 of 2)')).toEqual({ name: 'Demo', repo: null, slice: 'slice 1 of 2' })
  expect(nameOf('EPIC: [bug] demo: say the names')).toEqual({ name: 'Say the names', repo: 'demo', slice: null })
})

test('a name drops the repo lead and the slice tail', () => {
  expect(nameOf('bragi: speech-to-text hints from the words file (slice 4 of 7)')).toEqual({
    name: 'Speech-to-text hints from the words file',
    repo: 'bragi',
    slice: 'slice 4 of 7',
  })
  expect(nameOf('Add the export command')).toEqual({ name: 'Add the export command', repo: null, slice: null })
  // A kind tag before the repo lead goes too; the row's detail keeps the whole title.
  expect(nameOf('[bug] bragi: Google ends 1 in 9 Hebrew streams')).toEqual({
    name: 'Google ends 1 in 9 Hebrew streams',
    repo: 'bragi',
    slice: null,
  })
})

test('each verdict reads calmly, and the ones worth a look say why', () => {
  const files: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({
      epic: 'STARK-10',
      session: 'gru',
      tickets: ['STARK-1', 'STARK-2', 'STARK-3', 'STARK-4', 'STARK-5', 'STARK-6', 'STARK-7'],
    }),
    'STARK-1.json': ticket('STARK-1', 'closed'),
    'STARK-2.json': ticket('STARK-2', 'review'),
    'STARK-3.json': ticket('STARK-3', 'pr', 120),
    'STARK-4.json': ticket('STARK-4', 'blocked', 41, { pr: 'https://github.com/acme/demo/pull/4' }),
    'STARK-5.json': ticket('STARK-5', 'pr'),
    'STARK-5.beat.json': JSON.stringify({ lastActivity: iso(20), running: null, minutes: [], recent: [] }),
    'STARK-6.json': ticket('STARK-6', 'pr'),
    'STARK-6.beat.json': JSON.stringify({
      lastActivity: iso(1),
      running: null,
      minutes: [],
      recent: [true, true, true, true, true, true, false, false, false, false],
    }),
  }
  const board = buildBoard('gru', '', T0, files, new Map(), {})
  if (board === null) throw new Error('no board')
  const by = (id: string) => board.rows.find(r => r.id === id)
  expect(by('STARK-1')).toMatchObject({ tone: 'done', state: 'done', status: '', at: 5, attention: null })
  expect(by('STARK-2')).toMatchObject({ tone: 'move', state: 'review', status: '10m', at: 2, attention: null })
  // Stalled is slow that is worth a look.
  expect(by('STARK-3')).toMatchObject({ tone: 'warn', state: 'slow', status: '2h00m', attention: 'no stage change or commit for 2h00m' })
  // A blocked ticket with a PR stopped at the PR station.
  expect(by('STARK-4')).toMatchObject({ tone: 'warn', state: 'blocked', status: '41m', at: 1, attention: 'blocked for 41m' })
  expect(by('STARK-5')).toMatchObject({ tone: 'idle', state: 'quiet', status: '20m', attention: 'no tool call for 20m' })
  // A ticket whose calls fail keeps its step's state; the box says why it is worth a look.
  expect(by('STARK-6')).toMatchObject({ tone: 'warn', state: 'pr', attention: '6 of the last 10 calls failed' })
  expect(by('STARK-7')).toMatchObject({ tone: 'none', state: 'todo', status: '', at: -1 })
  expect([board.done, board.inProgress, board.notStarted]).toEqual([1, 5, 1])
  expect(board.next).toEqual(['STARK-7'])
  expect(board.isOwn).toBe(true)
  expect(board.rows.map(r => `${r.state} ${r.status} ${r.attention ?? ''}`).join(' ')).not.toMatch(/left|ETA|~\d/)
})

test('a held ticket is worth a look, even while its worker is quiet', () => {
  const files: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-2'] }),
    'STARK-1.json': ticket('STARK-1', 'review', 120, { hold: 'merge' }),
    'STARK-1.beat.json': JSON.stringify({ lastActivity: iso(40), running: null, minutes: [], recent: [] }),
    'STARK-2.json': ticket('STARK-2', 'merged', 3, { hold: 'release' }),
  }
  const board = buildBoard('gru', '', T0, files, new Map(), {})
  if (board === null) throw new Error('no board')
  expect(board.rows[0]).toMatchObject({
    tone: 'warn',
    state: 'held',
    status: 'merge · 2h00m',
    at: 2,
    attention: 'held by its settings: merge',
  })
  expect(board.rows[1]).toMatchObject({ at: 3, attention: 'held by its settings: release' })
})

test('each step has its own state, and slow, a long call and no call each read apart', () => {
  const beat = (lastMin: number, running: { tool: string; since: string } | null, updatedMin = 0) =>
    JSON.stringify({ updated: iso(updatedMin), lastActivity: iso(lastMin), running, minutes: [], recent: [] })
  const files: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({
      epic: 'STARK-10',
      session: 'gru',
      tickets: ['STARK-1', 'STARK-2', 'STARK-3', 'STARK-4', 'STARK-5', 'STARK-6', 'STARK-7'],
    }),
    // Its session died in a call 25 min ago: the heartbeat stopped, so the call never ends. Quiet, not a long call.
    'STARK-7.json': ticket('STARK-7', 'review', 30),
    'STARK-7.beat.json': beat(25, { tool: 'Bash', since: iso(25) }, 25),
    'STARK-1.json': ticket('STARK-1', 'ticket', 30),
    'STARK-2.json': ticket('STARK-2', 'pr', 0),
    'STARK-3.json': ticket('STARK-3', 'merged', 5),
    // 50 min with no stage change or commit: slow, and not yet worth a look.
    'STARK-4.json': ticket('STARK-4', 'pr', 50),
    'STARK-4.beat.json': beat(1, null),
    // One Bash call has run 25 min, with no other: a long call, not a quiet worker.
    'STARK-5.json': ticket('STARK-5', 'review', 30),
    'STARK-5.beat.json': beat(25, { tool: 'Bash', since: iso(25) }),
    'STARK-6.json': ticket('STARK-6', 'review', 30),
    'STARK-6.beat.json': beat(25, null),
  }
  const board = buildBoard('gru', '', T0, files, new Map(), {})
  if (board === null) throw new Error('no board')
  const by = (id: string) => board.rows.find(r => r.id === id)
  expect(by('STARK-1')).toMatchObject({ state: 'starting', status: '30m', tone: 'move' })
  expect(by('STARK-2')).toMatchObject({ state: 'pr', status: '0m' })
  expect(by('STARK-3')).toMatchObject({ state: 'merged', status: '5m' })
  expect(by('STARK-4')).toMatchObject({ state: 'slow', status: '50m', tone: 'warn', attention: null })
  expect(by('STARK-5')).toMatchObject({ state: 'running', status: '25m', tone: 'idle', attention: 'one Bash call has run for 25m' })
  expect(by('STARK-6')).toMatchObject({ state: 'quiet', status: '25m', tone: 'idle', attention: 'no tool call for 25m' })
  expect(by('STARK-7')).toMatchObject({ state: 'quiet', status: '25m', attention: 'no tool call for 25m' })
})

test("a ticket's tab is open while its heartbeat is under 3 minutes old and names a cmux surface", () => {
  const SURFACE = '0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D'
  const beat = (updatedMin: number, surface: unknown) =>
    JSON.stringify({ updated: iso(updatedMin), lastActivity: iso(1), running: null, minutes: [], recent: [], surface })
  const files: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({
      epic: 'STARK-10',
      session: 'gru',
      tickets: ['STARK-1', 'STARK-2', 'STARK-3', 'STARK-4', 'STARK-5'],
    }),
    'STARK-1.json': ticket('STARK-1', 'pr'),
    'STARK-1.beat.json': beat(2, SURFACE),
    // A heartbeat 3 min old: the tab closed, or its session ended.
    'STARK-2.json': ticket('STARK-2', 'pr'),
    'STARK-2.beat.json': beat(3, SURFACE),
    // Outside cmux, and a heartbeat from before the surface, name no tab.
    'STARK-3.json': ticket('STARK-3', 'pr'),
    'STARK-3.beat.json': beat(0, null),
    'STARK-4.json': ticket('STARK-4', 'pr'),
    'STARK-4.beat.json': JSON.stringify({ updated: iso(0), lastActivity: iso(1), running: null, minutes: [], recent: [] }),
    // A value that is no surface id never reaches hermod: it could read as a flag.
    'STARK-5.json': ticket('STARK-5', 'pr'),
    'STARK-5.beat.json': beat(0, '--help'),
  }
  const board = buildBoard('gru', '', T0, files, new Map(), {})
  expect(board?.rows.map(r => r.tab)).toEqual([SURFACE, null, null, null, null])
})

test("a closed ticket's call still marked running is stale: no long call in its hour, no Running line", () => {
  const files = (stage: string) => ({
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 's', tickets: ['STARK-1'] }),
    'STARK-1.json': ticket('STARK-1', stage, 30),
    'STARK-1.beat.json': JSON.stringify({ lastActivity: iso(25), running: { tool: 'Bash', since: iso(25) }, minutes: [], recent: [] }),
  })
  const closed = buildBoard('s', '', T0, files('closed'), new Map(), {})?.rows[0]
  expect(closed?.cells.some(c => c.kind === 'running')).toBe(false)
  expect(closed?.detail.some(line => line.startsWith('Running'))).toBe(false)
  expect(closed?.detail).toContain('Last tool call 25m ago.')
  // The same heartbeat on an open ticket is a real long call.
  const open = buildBoard('s', '', T0, files('review'), new Map(), {})?.rows[0]
  expect(open?.cells.some(c => c.kind === 'running')).toBe(true)
  expect(open?.detail).toContain('Running Bash for 25m.')
})

test('the graph counts each ticket at its step, and the ones worth a look there', () => {
  const steps = stepCounts([
    { at: -1, tone: 'none', attention: null },
    { at: 5, tone: 'done', attention: null },
    { at: 2, tone: 'move', attention: null },
    { at: 1, tone: 'warn', attention: 'blocked' },
    // A ticket file whose stage is no station counts at the first one.
    { at: -1, tone: 'idle', attention: 'no tool call for 20m' },
    { at: 3, tone: 'warn', attention: 'held by its settings: merge' },
  ])
  expect(steps.map(s => [s.label, s.count, s.looks])).toEqual([
    ['not started', 1, 0],
    ['ticket', 1, 1],
    ['PR', 1, 1],
    ['review', 1, 0],
    ['merge', 1, 1],
    ['done', 1, 0],
  ])
  expect(stepCounts([]).every(s => s.count === 0)).toBe(true)
})
