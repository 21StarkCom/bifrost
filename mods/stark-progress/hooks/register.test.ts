import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const T0 = Date.parse('2026-10-29T12:00:00Z')
const MIN = 60_000
const DIR = '/h/.cache/stark-progress'
const BAND = {
  plugin: 'stark-progress',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 140, scroll: { offset: 0, bodyRows: 19 }, view: {} },
} as const

const ticket = (id: string, stage: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, title: `title ${id}`, stage, pr: null, updated: new Date(T0 - 10 * MIN).toISOString(), ...extra })

const nameOf = (path: string) => path.slice(DIR.length + 1)

const PANE = {
  plugin: 'stark-progress',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'gru-board',
  props: { title: 'Gru', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

const TICKET_PANE = {
  ...PANE,
  requestId: 'ticket-board',
  props: { ...PANE.props, title: 'STARK-1' },
} as const

/** A run of the command in the composer, as a person types it. */
const command = (name: string) => ({
  command: name,
  args: '',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
})

/** Each pane opened so far, placed or not as `isPlaced` says, as `$.ui.panes()` lists them. */
const panesOf = (opens: string[], isPlaced: boolean) =>
  [...new Set(opens)].map(id => ({ id, title: id, isShown: isPlaced, isFocused: false, isPlaced }))

/**
 * A session over `disk`: its id and root, the files' times, the `.tmp` and
 * `mv` a whole write needs, and its panes placed or not.
 */
function stage(
  on: On,
  disk: Record<string, string>,
  { session, root, mtimes = {} }: { session: string; root: string; mtimes?: Record<string, number> },
) {
  const seen = { reads: [] as string[], runs: [] as string[][], opens: [] as string[], toasts: [] as string[], isPlaced: false, isMvFailing: false }
  const writes: Record<string, string> = {}
  mock.env(on, { HOME: '/h' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.root', () => ({ value: root }))
  on('session.id', () => ({ value: session }))
  on('ui.open', (_$, e) => {
    seen.opens.push(e.id)
    return { value: seen.isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'the terminal is narrow' } }
  })
  on('ui.panes', () => ({ value: panesOf(seen.opens, seen.isPlaced) }))
  // Stands for the engine's own drawing, where the mod hands a site on.
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))
  on('fs.list', () => ({
    value: Object.keys(disk).map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: mtimes[name] ?? T0, isLink: false })),
  }))
  on('fs.read', (_$, e) => {
    seen.reads.push(e.path)
    const text = disk[nameOf(e.path)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    writes[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    seen.runs.push(argv)
    const isMoved = argv[0] === 'mv' && !seen.isMvFailing
    if (isMoved) disk[nameOf(argv[3] ?? '')] = writes[argv[2] ?? ''] ?? ''
    return { value: { exitCode: isMoved ? 0 : 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })

  return seen
}

test("Gru's tab opens the pane once, and the band keeps one line only while the pane is not placed", async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-13631'] }),
    'STARK-1.json': ticket('STARK-1', 'review'),
    'STARK-2.json': ticket('STARK-2', 'closed'),
    'STARK-13631.json': ticket('STARK-13631', 'pr'),
  }
  const seen = stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })

  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  await clock.advance(1000)
  expect(seen.opens).toEqual(['gru-board'])

  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: 'Gru · STARK-10 · 0 of 2 done · /gru-board opens the board' })).toBeDefined()
  // No band rows and no legend in Gru's tab: the pane holds the run.
  expect(await band.find({ type: 'Text', text: /◆ milestone|STARK-1 / })).toBeUndefined()
  await band.unmount()

  seen.isPlaced = true
  const placed = await $.ui.mount(BAND)
  expect(await placed.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await placed.find({ type: 'Text', text: /\/gru-board/ })).toBeUndefined()

  // Only the run's own files are read: STARK-2 is not in the run.
  expect([...new Set(seen.reads)].sort()).toEqual([
    `${DIR}/STARK-1.json`,
    `${DIR}/STARK-13631.json`,
    `${DIR}/run-STARK-10.json`,
  ])
  // No worktree is named for these tickets here, so git never runs.
  expect(seen.runs).toEqual([])
})

test('the pane draws the run: counts, a ticket worth a look, Up next, and a row opened to its detail', async ($, on) => {
  const iso = (minutesAgo: number) => new Date(T0 - minutesAgo * MIN).toISOString()
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({
      epic: 'STARK-10',
      session: 'gru',
      tickets: ['STARK-1', 'STARK-2', 'STARK-3', 'STARK-4'],
    }),
    'STARK-1.json': ticket('STARK-1', 'closed', { title: 'bragi: say the names (slice 1 of 3)' }),
    'STARK-2.json': ticket('STARK-2', 'review', { title: 'bragi: read the words file (slice 2 of 3)' }),
    'STARK-2.beat.json': JSON.stringify({ lastActivity: iso(1), running: { tool: 'Bash', since: iso(1) }, minutes: [], recent: [] }),
    'STARK-3.json': ticket('STARK-3', 'pr', { updated: iso(120) }),
  }
  stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: 'Gru · STARK-10' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'bragi · 4 tickets' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '1 of 4 done · 2 in progress · 1 not started' })).toBeDefined()
  // The graph: the count, then a bar, 48 cells all 4 tickets (80 less the label, the count, a space and the longest note), and the stalled PR named worth a look.
  expect(await pane.find({ type: 'Text', text: `not started  1 ${'█'.repeat(12)}` })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'ticket       0' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: `PR           1 ${'█'.repeat(12)} · 1 worth a look` })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: `review       1 ${'█'.repeat(12)}` })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'merge        0' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: `done         1 ${'█'.repeat(12)}` })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '🙋 1 ticket is worth a look' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'no stage change or commit for 2h00m' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '👀 in review · 10m' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Start STARK-4' })).toBeDefined()
  // A name loses its repo lead and slice tail; the row's detail keeps the title whole.
  expect(await pane.find({ type: 'Text', text: 'Read the words file' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Running Bash for 1m.' })).toBeUndefined()
  await pane.press({ key: 'row-STARK-2' })
  expect(await pane.find({ type: 'Text', text: 'Running Bash for 1m.' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'This is slice 2 of 3.' })).toBeDefined()
  // Its last hour: quiet, its stage change 10 minutes ago, and the Bash call running for the last minute.
  expect(await pane.find({ type: 'Text', text: 'Last hour  ·········◆·─  now' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '◆ milestone' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '─ one long call' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '· no calls' })).toBeDefined()
  // The legend names only the marks the hour shows.
  expect(await pane.find({ type: 'Text', text: '▃ tool calls per 5 min' })).toBeUndefined()
  // A ticket with no file has no heartbeat and no milestone, so its detail draws no hour.
  await pane.press({ key: 'row-STARK-4' })
  expect(await pane.find({ type: 'Text', text: /^Last hour/ })).toBeUndefined()
  // Counts and elapsed times only: nothing forecasts the time left.
  expect(await pane.find({ type: 'Text', text: /left|ETA|~\d/ })).toBeUndefined()
})

test("a ticket's hour marks calls, a failed 5 minutes and blanks, and an hour with nothing in it draws none", async ($, on) => {
  const iso = (minutesAgo: number) => new Date(T0 - minutesAgo * MIN).toISOString()
  const at = (minutesAgo: number) => Math.floor((T0 - minutesAgo * MIN) / MIN)
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-2', 'STARK-3'] }),
    // Calls 3 minutes ago, mostly failed calls 8 minutes ago, its stage change outside the hour.
    'STARK-1.json': ticket('STARK-1', 'pr', { updated: iso(120) }),
    'STARK-1.beat.json': JSON.stringify({
      lastActivity: iso(3),
      running: null,
      minutes: [
        { at: at(3), calls: 13, fails: 0 },
        { at: at(8), calls: 10, fails: 8 },
      ],
      recent: [],
    }),
    // Closed hours ago; its heartbeat stays behind.
    'STARK-2.json': ticket('STARK-2', 'closed', { updated: iso(180) }),
    'STARK-2.beat.json': JSON.stringify({ lastActivity: iso(170), running: null, minutes: [], recent: [] }),
    // No heartbeat, a stage change 20 minutes ago.
    'STARK-3.json': ticket('STARK-3', 'review', { updated: iso(20) }),
  }
  stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const pane = await $.ui.mount(PANE)

  await pane.press({ key: 'row-STARK-1' })
  expect(await pane.find({ type: 'Text', text: 'Last hour  ··········✕▃  now' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '▃ tool calls per 5 min' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '✕ most calls failed' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '· no calls' })).toBeDefined()

  await pane.press({ key: 'row-STARK-2' })
  expect(await pane.find({ type: 'Text', text: /^Last hour/ })).toBeUndefined()

  await pane.press({ key: 'row-STARK-3' })
  expect(await pane.find({ type: 'Text', text: `Last hour  ${' '.repeat(7)}◆${' '.repeat(4)}  now` })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'blank: no heartbeat' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '· no calls' })).toBeUndefined()
})

/** The ticket rows of "Where each ticket is", top to bottom. */
const listOrder = async (pane: { findAll: (q: { type: string }) => Promise<{ key: string | undefined }[]> }) =>
  (await pane.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(key => key.startsWith('row-')).map(key => key.slice('row-'.length))

const DONE_LAST_RUN: Record<string, string> = {
  'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-2', 'STARK-3', 'STARK-4'] }),
  'STARK-1.json': ticket('STARK-1', 'closed'),
  'STARK-2.json': ticket('STARK-2', 'review'),
  'STARK-3.json': ticket('STARK-3', 'closed'),
}

test('Done tickets last lists the done tickets at the bottom, kept in the store and never in the run settings', async ($, on) => {
  const seen = stage(on, { ...DONE_LAST_RUN }, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  // The plugin's store, in memory, read back below.
  const store: Record<string, unknown> = {}
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const pane = await $.ui.mount(PANE)
  expect(await listOrder(pane)).toEqual(['STARK-1', 'STARK-2', 'STARK-3', 'STARK-4'])

  await pane.press({ key: 'tab-settings' })
  expect(await pane.find({ type: 'Text', text: 'This pane' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'The ticket list keeps the order of the run.' })).toBeDefined()
  await pane.press({ key: 'set-done-last' })
  expect(await pane.find({ type: 'Text', text: 'The ticket list shows the done tickets at the bottom.' })).toBeDefined()
  expect(store.doneLast).toBe(true)
  // Gru reads the run's settings file; this choice is the pane's alone.
  expect(seen.runs.filter(argv => argv[0] === 'mv')).toEqual([])

  await pane.press({ key: 'tab-overview' })
  // The open tickets in run order, then the done ones in run order.
  expect(await listOrder(pane)).toEqual(['STARK-2', 'STARK-4', 'STARK-1', 'STARK-3'])

  await pane.press({ key: 'tab-settings' })
  await pane.press({ key: 'set-done-last' })
  expect(store.doneLast).toBe(false)
  await pane.press({ key: 'tab-overview' })
  expect(await listOrder(pane)).toEqual(['STARK-1', 'STARK-2', 'STARK-3', 'STARK-4'])
})

test('a new session starts with the choice the store kept', async ($, on) => {
  stage(on, { ...DONE_LAST_RUN }, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  mock.store(on, { doneLast: true })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const pane = await $.ui.mount(PANE)
  expect(await listOrder(pane)).toEqual(['STARK-2', 'STARK-4', 'STARK-1', 'STARK-3'])
})

test('a store that cannot be read, or holds no true or false, leaves Done tickets last Off', async ($, on) => {
  stage(on, { ...DONE_LAST_RUN }, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  on('store.get', () => {
    throw new Error('EIO')
  })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  expect(await listOrder(await $.ui.mount(PANE))).toEqual(['STARK-1', 'STARK-2', 'STARK-3', 'STARK-4'])
})

test('a stored value that is not true or false reads as Off', async ($, on) => {
  stage(on, { ...DONE_LAST_RUN }, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  mock.store(on, { doneLast: 'yes' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  expect(await listOrder(await $.ui.mount(PANE))).toEqual(['STARK-1', 'STARK-2', 'STARK-3', 'STARK-4'])
})

test('a store write that fails keeps the press on screen and says the choice was not saved', async ($, on) => {
  const seen = stage(on, { ...DONE_LAST_RUN }, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => {
    throw new Error('ENOSPC')
  })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-settings' })
  await pane.press({ key: 'set-done-last' })
  expect(seen.toasts).toEqual(['The choice was not saved.'])
  await pane.press({ key: 'tab-overview' })
  expect(await listOrder(pane)).toEqual(['STARK-2', 'STARK-4', 'STARK-1', 'STARK-3'])
})

test('a full bar keeps its note: all tickets at one step, one of them worth a look', async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-2'] }),
    'STARK-1.json': ticket('STARK-1', 'pr'),
    'STARK-2.json': ticket('STARK-2', 'pr', { updated: new Date(T0 - 120 * MIN).toISOString() }),
  }
  stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount(PANE)
  // 80 columns: the label, the count, 48 cells of bar and the note fill the line and no more.
  expect(await pane.find({ type: 'Text', text: `PR           2 ${'█'.repeat(48)} · 1 worth a look` })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'not started  0' })).toBeDefined()
})

test('the counts line up on the right in a column as wide as the run count', async ($, on) => {
  const tickets = Array.from({ length: 10 }, (_, i) => `STARK-${i + 1}`)
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets }),
    'STARK-1.json': ticket('STARK-1', 'closed'),
  }
  stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount(PANE)
  // 46 cells are all 10 tickets: 80 less the label, two digits, a space and ` · 10 worth a look`.
  expect(await pane.find({ type: 'Text', text: `not started   9 ${'█'.repeat(41)}▍` })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'ticket        0' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: `done          1 ${'█'.repeat(4)}▋` })).toBeDefined()
})

test('a pane too narrow for a 20-cell bar and the note gives the bar the whole line and drops the note', async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-2'] }),
    'STARK-1.json': ticket('STARK-1', 'pr'),
    'STARK-2.json': ticket('STARK-2', 'pr', { updated: new Date(T0 - 120 * MIN).toISOString() }),
  }
  stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 40 } })
  // 40 columns: 25 cells are all 2 tickets (40 less the label, the count and a space), so the full bar leaves no room for its note.
  expect(await pane.find({ type: 'Text', text: `PR           2 ${'█'.repeat(25)}` })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /· 1 worth a look/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: '🙋 1 ticket is worth a look' })).toBeDefined()
})

test('a settings press writes the run settings file whole, and the pane reads it back', async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1'], maxWorkers: 4 }),
    'STARK-1.json': ticket('STARK-1', 'pr'),
  }
  const seen = stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-settings' })
  // The launch's value, from the run file, until the settings file says otherwise.
  expect(await pane.find({ type: 'Text', text: 'Gru keeps up to 4 Minions alive at once.' })).toBeDefined()
  expect(disk['run-STARK-10.settings.json']).toBeUndefined()

  await pane.press({ key: 'set-more' })
  await pane.press({ key: 'set-decide' })
  expect(seen.runs).toContainEqual(['mv', '-f', `${DIR}/run-STARK-10.settings.json.tmp`, `${DIR}/run-STARK-10.settings.json`])
  expect(JSON.parse(disk['run-STARK-10.settings.json'] ?? '{}')).toEqual({
    decideForMe: false,
    maxWorkers: 5,
    followUps: true,
    minionAgent: 'claude',
  })
  expect(await pane.find({ type: 'Text', text: 'Gru keeps up to 5 Minions alive at once.' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Gru holds a split or a blocking ticket/ })).toBeDefined()
  // A run file is never read as a settings file, nor the other way round.
  expect(await pane.find({ type: 'Text', text: 'Settings for STARK-10' })).toBeDefined()
})

test('two quick settings presses both count, and a failed rename says the settings were not saved', async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1'], maxWorkers: 3 }),
    'STARK-1.json': ticket('STARK-1', 'pr'),
  }
  const seen = stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-settings' })
  await Promise.all([pane.press({ key: 'set-more' }), pane.press({ key: 'set-more' })])
  expect(JSON.parse(disk['run-STARK-10.settings.json'] ?? '{}').maxWorkers).toBe(5)

  const before = disk['run-STARK-10.settings.json']
  seen.isMvFailing = true
  await pane.press({ key: 'set-decide' })
  expect(disk['run-STARK-10.settings.json']).toBe(before)
  expect(seen.toasts).toEqual(['The settings were not saved.'])
})

test("the pane clears once Gru's run file is gone, and the band names this tab's own run", async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1'] }),
    'run-STARK-20.json': JSON.stringify({ epic: 'STARK-20', session: 'other', tickets: ['STARK-21'] }),
    'STARK-1.json': ticket('STARK-1', 'pr'),
    'STARK-21.json': ticket('STARK-21', 'pr'),
  }
  stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  // The pane shows the other run; the band's line still names this tab's own.
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'switch' })
  expect(await pane.find({ type: 'Text', text: 'Gru · STARK-20' })).toBeDefined()
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /^Gru · STARK-10 · / })).toBeDefined()
  await band.unmount()
  await pane.unmount()

  // Step 6 deletes the run files: the pane no longer draws a finished run as live.
  delete disk['run-STARK-10.json']
  delete disk['run-STARK-20.json']
  await clock.advance(1000)
  const after = await $.ui.mount(PANE)
  expect(await after.find({ type: 'Text', text: 'No Gru run yet' })).toBeDefined()
})

test('/gru-board in another session shows the most recently active run, and r shows the next', async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru-a', tickets: ['STARK-11'] }),
    'run-STARK-20.json': JSON.stringify({ epic: 'STARK-20', session: 'gru-b', tickets: ['STARK-21'] }),
    'run-STARK-30.json': JSON.stringify({ epic: 'STARK-30', session: 'gru-c', tickets: [] }),
    'STARK-11.json': ticket('STARK-11', 'pr'),
    'STARK-21.json': ticket('STARK-21', 'review'),
  }
  // STARK-20 changed last; STARK-10 ten minutes ago; STARK-30 two days ago, so it is not running.
  const mtimes = {
    'run-STARK-10.json': T0 - 3 * 86_400_000,
    'STARK-11.json': T0 - 10 * MIN,
    'run-STARK-20.json': T0 - 3 * 86_400_000,
    'STARK-21.json': T0,
    'run-STARK-30.json': T0 - 2 * 86_400_000,
  }
  const seen = stage(on, disk, { session: 'me', root: '/r', mtimes })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  // Not Gru's tab: the pane waits until it is asked for.
  expect(seen.opens).toEqual([])

  await $.command.run(command('gru-board'))
  expect(seen.opens).toEqual(['gru-board'])
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: 'Gru · STARK-20' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Also running: STARK-10.' })).toBeDefined()
  await pane.press({ key: 'switch' })
  expect(await pane.find({ type: 'Text', text: 'Gru · STARK-10' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Also running: STARK-20.' })).toBeDefined()
})

test('outside Gru, the pane stays on its run while the other one gets busier, and a press writes to it', async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru-a', tickets: ['STARK-11'] }),
    'run-STARK-20.json': JSON.stringify({ epic: 'STARK-20', session: 'gru-b', tickets: ['STARK-21'] }),
    'STARK-11.json': ticket('STARK-11', 'pr'),
    'STARK-21.json': ticket('STARK-21', 'review'),
  }
  const mtimes: Record<string, number> = {
    'run-STARK-10.json': T0 - 86_400_000,
    'run-STARK-20.json': T0 - 86_400_000,
    'STARK-11.json': T0 - 10 * MIN,
    'STARK-21.json': T0,
  }
  stage(on, disk, { session: 'me', root: '/r', mtimes })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  await $.command.run(command('gru-board'))
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: 'Gru · STARK-20' })).toBeDefined()

  // STARK-10's worker writes its heartbeat: that run is now the most active one.
  mtimes['STARK-11.json'] = T0 + 2000
  await clock.advance(3000)
  expect(await pane.find({ type: 'Text', text: 'Gru · STARK-20' })).toBeDefined()

  await pane.press({ key: 'tab-settings' })
  await pane.press({ key: 'set-follow-ups' })
  expect(JSON.parse(disk['run-STARK-20.settings.json'] ?? '{}').followUps).toBe(false)
  expect(disk['run-STARK-10.settings.json']).toBeUndefined()
})

test("a worker's tab writes its heartbeat, reads git, draws its row, and drops the heartbeat with its ticket file", async ($, on) => {
  const worktree = '/r/.claude/worktrees/STARK-1'
  const disk: Record<string, string> = { 'STARK-1.json': ticket('STARK-1', 'ticket', { worktree }) }
  const writes: Record<string, string> = {}
  const runs: string[][] = []
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: T0 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'gru-board' } }))
  on('session.root', () => ({ value: worktree }))
  on('session.id', () => ({ value: 's1' }))
  // The ticket pane opens by itself here, and stays unplaced: the band draws the row.
  on('ui.open', () => ({ value: { isPlaced: false as const, reason: 'the terminal is narrow' } }))
  on('ui.panes', () => ({ value: [] }))
  on('fs.list', () => ({
    value: Object.keys(disk).map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_$, e) => {
    const text = disk[nameOf(e.path)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    writes[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    runs.push(argv)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'mv') {
      disk[nameOf(argv[3] ?? '')] = writes[argv[2] ?? ''] ?? ''
      return ok('')
    }
    if (argv[0] === 'rm') {
      delete disk[nameOf(argv[2] ?? '')]
      return ok('')
    }
    if (argv[3] === 'merge-base') return ok('abc123\n')
    if (argv[3] === 'log') return ok(`${(T0 - 2 * MIN) / 1000}\n`)
    if (argv[3] === 'diff') return ok(' 2 files changed, 40 insertions(+), 3 deletions(-)\n')
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', (_$, e) => (e.tool === 'Bash' && e.command === 'false' ? { result: {}, isError: true } : { result: {} }))

  await $.session.start({ cwd: worktree, surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  await $.tool.call({ tool: 'Bash', command: 'false' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(5000)

  const written = JSON.parse(disk['STARK-1.beat.json'] ?? '{}')
  expect(written.session).toBe('s1')
  expect(written.recent).toEqual([true, false])
  expect(written.minutes).toEqual([{ at: Math.floor((T0 + 1000) / MIN), calls: 2, fails: 1 }])
  expect(runs).toContainEqual(['git', '-C', worktree, 'merge-base', 'HEAD', 'origin/HEAD'])
  expect(runs.filter(r => r[3] === 'merge-base')).toHaveLength(1)

  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /STARK-1 +◉┄○┄○┄○┄○ ticket +10m .*moving · \+40 −3 +title STARK-1/ })).toBeDefined()

  delete disk['STARK-1.json']
  await clock.advance(1000)
  expect(runs).toContainEqual(['rm', '-f', `${DIR}/STARK-1.beat.json`])
  expect(disk['STARK-1.beat.json']).toBe(undefined)
})

test('a call that ends after a flush is flushed again, and a deny counts as a failure', async ($, on) => {
  const worktree = '/r/.claude/worktrees/STARK-1'
  const disk: Record<string, string> = { 'STARK-1.json': ticket('STARK-1', 'pr') }
  const writes: Record<string, string> = {}
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: T0 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'gru-board' } }))
  on('session.root', () => ({ value: worktree }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.list', () => ({
    value: Object.keys(disk).map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_$, e) => {
    const text = disk[nameOf(e.path)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    writes[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    if (argv[0] === 'mv') disk[nameOf(argv[3] ?? '')] = writes[argv[2] ?? ''] ?? ''
    return { value: { exitCode: argv[0] === 'mv' ? 0 : 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  let release = () => {}
  on('tool.call', async (_$, e) => {
    const command = e.tool === 'Bash' ? e.command : ''
    if (command === 'sleep') await new Promise<void>(resolve => (release = resolve))
    return command === 'denied' ? { deny: 'no' } : { result: {} }
  })

  await $.session.start({ cwd: worktree, surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const pending = $.tool.call({ tool: 'Bash', command: 'sleep' })
  await clock.advance(1000)
  expect(JSON.parse(disk['STARK-1.beat.json'] ?? '{}').running?.tool).toBe('Bash')

  // No later call starts: the end alone must reach the file.
  release()
  await pending
  await clock.advance(5000)
  expect(JSON.parse(disk['STARK-1.beat.json'] ?? '{}').running).toBe(null)

  await $.tool.call({ tool: 'Bash', command: 'denied' }).catch(() => undefined)
  await clock.advance(5000)
  expect(JSON.parse(disk['STARK-1.beat.json'] ?? '{}').recent).toEqual([false, true])
})

test('a git read that hangs never holds the poll: the row draws without a diff size', async ($, on) => {
  const worktree = '/r/.claude/worktrees/STARK-1'
  const disk: Record<string, string> = { 'STARK-1.json': ticket('STARK-1', 'pr', { worktree }) }
  let gitReads = 0
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: T0 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'gru-board' } }))
  on('session.root', () => ({ value: worktree }))
  on('session.id', () => ({ value: 's1' }))
  on('ui.open', () => ({ value: { isPlaced: false as const, reason: 'the terminal is narrow' } }))
  on('ui.panes', () => ({ value: [] }))
  on('fs.list', () => ({
    value: Object.keys(disk).map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_$, e) => {
    const text = disk[nameOf(e.path)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('process.run', () => {
    gitReads += 1
    return new Promise<never>(() => undefined)
  })

  await $.session.start({ cwd: worktree, surface: 'terminal', isInteractive: true })
  await clock.advance(3000)

  const band = await $.ui.mount(BAND)
  const row = await band.find({ type: 'Text', text: /^STARK-1 ●━◉┄○┄○┄○ pr +10m/ })
  expect(row).toBeDefined()
  expect(row?.text).not.toMatch(/\+\d+ −\d+/)
  // One read runs; no poll starts another while it hangs.
  expect(gitReads).toBe(1)
})

const WORKTREE = '/r/.claude/worktrees/STARK-1'

test("a worker's tab opens the ticket pane once, and its band row draws only while the pane is not placed", async ($, on) => {
  const disk: Record<string, string> = { 'STARK-1.json': ticket('STARK-1', 'pr') }
  const seen = stage(on, disk, { session: 'w', root: WORKTREE })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: WORKTREE, surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  await clock.advance(1000)
  // The ticket pane, once, and never the Gru pane.
  expect(seen.opens).toEqual(['ticket-board'])

  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /^STARK-1 +●━◉┄○┄○┄○ pr +10m/ })).toBeDefined()
  await band.unmount()

  seen.isPlaced = true
  const placed = await $.ui.mount(BAND)
  expect(await placed.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await placed.find({ type: 'Text', text: /STARK-1/ })).toBeUndefined()
})

test('the ticket pane draws the whole ticket: name, epic, track, activity and the next step', async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-2'] }),
    'STARK-1.json': ticket('STARK-1', 'pr', { title: 'bragi: read the words file (slice 2 of 3)' }),
    'STARK-1.beat.json': JSON.stringify({
      session: 'w',
      lastActivity: new Date(T0 - MIN).toISOString(),
      running: null,
      minutes: [{ at: Math.floor(T0 / MIN) - 2, calls: 4, fails: 0 }],
      recent: [false, false],
    }),
  }
  stage(on, disk, { session: 'w', root: WORKTREE })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: WORKTREE, surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount(TICKET_PANE)
  expect(await pane.find({ type: 'Text', text: 'Read the words file' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'STARK-1 · bragi · slice 2 of 3' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Part of STARK-10' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '🔨 PR open · 10m' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '🌿 Nothing needs you right now.' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '4 tool calls in the last 15 minutes.' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '0 of the last 2 calls failed.' })).toBeDefined()
  // Its last hour, as the Gru pane draws an opened row: the stage change 10 minutes ago, then 4 calls 2 minutes ago.
  expect(await pane.find({ type: 'Text', text: 'Last hour  ·········◆·▁  now' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '◆ milestone' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '▃ tool calls per 5 min' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '· no calls' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Review the PR.' })).toBeDefined()
  // Counts and elapsed times only: nothing forecasts the time left.
  expect(await pane.find({ type: 'Text', text: /left|ETA|~\d/ })).toBeUndefined()

  // No emoji in Settings.
  await pane.press({ key: 'tab-settings' })
  expect(await pane.find({ type: 'Text', text: 'Settings for STARK-1' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'by what the PR changes' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /left|ETA|~\d|\p{Extended_Pictographic}/u })).toBeUndefined()
})

test("a ticket settings press writes the ticket's settings file whole, and quick presses all count", async ($, on) => {
  const disk: Record<string, string> = { 'STARK-1.json': ticket('STARK-1', 'review') }
  const seen = stage(on, disk, { session: 'w', root: WORKTREE })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: WORKTREE, surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount(TICKET_PANE)
  await pane.press({ key: 'tab-settings' })
  expect(disk['STARK-1.settings.json']).toBeUndefined()

  await Promise.all([pane.press({ key: 'set-merge' }), pane.press({ key: 'set-review' }), pane.press({ key: 'set-release' })])
  expect(seen.runs).toContainEqual(['mv', '-f', `${DIR}/STARK-1.settings.json.tmp`, `${DIR}/STARK-1.settings.json`])
  expect(JSON.parse(disk['STARK-1.settings.json'] ?? '{}')).toEqual({ mergeOnGreen: false, reviewDepth: 'deep', release: 'stop' })
  expect(await pane.find({ type: 'Text', text: 'deep' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'stop before publish' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /The worker holds the merge/ })).toBeDefined()
  // A settings file is never read as the ticket's file: its stage stands.
  await clock.advance(1000)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /^STARK-1 +●━●━◉┄○┄○ review/ })).toBeDefined()
  await band.unmount()

  const before = disk['STARK-1.settings.json']
  seen.isMvFailing = true
  await pane.press({ key: 'set-merge' })
  expect(disk['STARK-1.settings.json']).toBe(before)
  expect(seen.toasts).toEqual(['The settings were not saved.'])
})

test('a held ticket reads as worth a look in the ticket pane and on the Gru pane', async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1'] }),
    'STARK-1.json': ticket('STARK-1', 'review', { hold: 'merge' }),
  }
  stage(on, disk, { session: 'w', root: WORKTREE })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: WORKTREE, surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount(TICKET_PANE)
  expect(await pane.find({ type: 'Text', text: '🙋 Worth a look' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Held by your settings: merge' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Set Merge when checks pass to On/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Wait for your merge OK.' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '✋ held · merge · 10m' })).toBeDefined()
  await pane.unmount()

  await $.command.run(command('gru-board'))
  const gru = await $.ui.mount(PANE)
  expect(await gru.find({ type: 'Text', text: '🙋 1 ticket is worth a look' })).toBeDefined()
  expect(await gru.find({ type: 'Text', text: 'held by its settings: merge' })).toBeDefined()
})

test('/ticket-board opens the ticket pane in a worker tab', async ($, on) => {
  const disk: Record<string, string> = { 'STARK-1.json': ticket('STARK-1', 'pr') }
  const seen = stage(on, disk, { session: 'w', root: WORKTREE })
  seen.isPlaced = true
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: WORKTREE, surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const result = await $.command.run(command('ticket-board'))
  expect(result.text).toBe('The ticket pane for STARK-1 is open.')
  expect(seen.opens).toEqual(['ticket-board', 'ticket-board'])
})

test('/ticket-board in a tab with no ticket opens nothing', async ($, on) => {
  const seen = stage(on, { 'STARK-1.json': ticket('STARK-1', 'pr') }, { session: 'me', root: '/r' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const result = await $.command.run(command('ticket-board'))
  expect(result.text).toMatch(/^This tab has no ticket/)
  expect(seen.opens).toEqual([])
})

test("/ticket-board in Gru's tab opens nothing: its worktree is named for the epic, not a ticket it works", async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1'] }),
    'STARK-10.json': ticket('STARK-10', 'pr'),
  }
  const seen = stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const result = await $.command.run(command('ticket-board'))
  expect(result.text).toMatch(/^This tab has no ticket/)
  expect(seen.opens).toEqual(['gru-board'])
})

/** A log file's text: one `{at, text}` a line, `minutesAgo` before T0. */
const logFile = (...steps: [number, string][]) =>
  steps.map(([minutesAgo, text]) => `${JSON.stringify({ at: new Date(T0 - minutesAgo * MIN).toISOString(), text })}\n`).join('')
/** T0 less `minutesAgo`, as the Log tab writes a local time. */
const clockAt = (minutesAgo: number) => {
  const d = new Date(T0 - minutesAgo * MIN)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

test("the ticket pane's Log tab shows the ticket's steps newest first", async ($, on) => {
  const long = 'Taught the board to show a list of the big steps each helper did, in short and plain words, one a line.'
  const disk: Record<string, string> = {
    'STARK-1.json': ticket('STARK-1', 'pr'),
    'STARK-1.log.jsonl': `${logFile([30, 'Read the job: show what each helper did, in plain words.'], [12, long])}{"at": "2026-10`,
    // Another ticket's log is not this tab's to read.
    'STARK-2.log.jsonl': logFile([5, 'Not this ticket.']),
  }
  const seen = stage(on, disk, { session: 'w', root: WORKTREE })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: WORKTREE, surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount(TICKET_PANE)
  expect(await pane.find({ type: 'Text', text: /^Log$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '📜 What got done' })).toBeUndefined()
  await pane.press({ key: 'tab-log' })
  expect(await pane.find({ type: 'Text', text: '📜 What got done' })).toBeDefined()
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text)
  const cutLong = `${long.split(' ').slice(0, 20).join(' ')}…`
  // Newest first, each after its local time; a line past 20 words is cut at the 20th.
  expect(texts.indexOf(cutLong)).toBeGreaterThan(-1)
  expect(texts.indexOf(cutLong)).toBeLessThan(texts.indexOf('Read the job: show what each helper did, in plain words.'))
  expect(texts[texts.indexOf(cutLong) - 1]).toBe(clockAt(12))
  expect(texts[texts.indexOf('Read the job: show what each helper did, in plain words.') - 1]).toBe(clockAt(30))
  // A half-written last line draws nothing, and the ticket pane names no one: every step is its worker's.
  expect(texts.filter(t => /^\d\d:\d\d$/.test(t))).toHaveLength(2)
  expect(texts).not.toContain('Not this ticket.')
  expect(texts).not.toContain('Gru')
  expect(seen.reads).toContain(`${DIR}/STARK-1.log.jsonl`)
  expect(seen.reads).not.toContain(`${DIR}/STARK-2.log.jsonl`)
  // Counts and elapsed times only: nothing forecasts the time left.
  expect(await pane.find({ type: 'Text', text: /left|ETA|~\d/ })).toBeUndefined()
})

test("the ticket pane's Log tab says who writes the steps before the first one", async ($, on) => {
  stage(on, { 'STARK-1.json': ticket('STARK-1', 'ticket') }, { session: 'w', root: WORKTREE })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: WORKTREE, surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount(TICKET_PANE)
  await pane.press({ key: 'tab-log' })
  expect(await pane.find({ type: 'Text', text: 'No step yet. The worker adds one line here at each big step.' })).toBeDefined()
})

test("the Gru pane's Log tab merges Gru's steps and each ticket's, newest first, each named for whose it is", async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-2'] }),
    'run-STARK-10.log.jsonl': logFile([50, 'Started 2 jobs, with 2 helpers at once.'], [3, 'Checked the names job is really done.']),
    'STARK-1.json': ticket('STARK-1', 'closed', { title: 'bragi: say the names (slice 1 of 3)' }),
    'STARK-1.log.jsonl': logFile([45, 'Read the job.'], [8, 'The change is now in the main code.']),
    'STARK-2.json': ticket('STARK-2', 'pr', { title: 'bragi: read the words file (slice 2 of 3)' }),
    'STARK-2.log.jsonl': logFile([20, 'Made the change and asked for a check.']),
    // Another run's log is not this pane's to read.
    'run-STARK-20.log.jsonl': logFile([1, 'Another run.']),
  }
  const seen = stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-log' })
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text)
  const order = [
    'Checked the names job is really done.',
    'The change is now in the main code.',
    'Made the change and asked for a check.',
    'Read the job.',
    'Started 2 jobs, with 2 helpers at once.',
  ].map(words => texts.indexOf(words))
  expect(order.every(i => i >= 0)).toBe(true)
  expect([...order].sort((a, b) => a - b)).toEqual(order)
  // Each step names whose it is over its words, after its local time.
  const at = (words: string) => texts.indexOf(words)
  expect([texts[at('Checked the names job is really done.') - 2], texts[at('Checked the names job is really done.') - 1]]).toEqual([
    clockAt(3),
    'Gru',
  ])
  expect(texts[at('The change is now in the main code.') - 1]).toBe('Say the names')
  expect(texts[at('Made the change and asked for a check.') - 1]).toBe('Read the words file')
  expect(texts[at('Read the job.') - 1]).toBe('Say the names')
  expect(texts).not.toContain('Another run.')
  expect(seen.reads).not.toContain(`${DIR}/run-STARK-20.log.jsonl`)
})

test('the Gru pane counts the steps it leaves out, and names the files that hold them', async ($, on) => {
  const steps = Array.from({ length: 52 }, (_, i): [number, string] => [60 - i, `Step ${i + 1}.`])
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1'] }),
    'run-STARK-10.log.jsonl': logFile(...steps),
  }
  stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-log' })
  expect(await pane.find({ type: 'Text', text: /^Step 52\.$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Step 3\.$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Step 2\.$/ })).toBeUndefined()
  expect(
    await pane.find({
      type: 'Text',
      text: "2 older steps are not shown. Every step is in ~/.cache/stark-progress/run-STARK-10.log.jsonl and each ticket's .log.jsonl.",
    }),
  ).toBeDefined()
})

test("a run's log counts as its activity: /gru-board shows the run whose log changed last", async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru-a', tickets: ['STARK-1'] }),
    'run-STARK-20.json': JSON.stringify({ epic: 'STARK-20', session: 'gru-b', tickets: ['STARK-2'] }),
    'run-STARK-20.log.jsonl': logFile([1, 'Started 1 job.']),
  }
  const mtimes = { 'run-STARK-10.json': T0 - 10 * MIN, 'run-STARK-20.json': T0 - 20 * MIN, 'run-STARK-20.log.jsonl': T0 - MIN }
  stage(on, disk, { session: 'other', root: '/r', mtimes })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  await $.command.run(command('gru-board'))

  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: 'Gru · STARK-20' })).toBeDefined()
})
