import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { buildBoard } from './board'
import { ANSWER } from './github-fixture'
import { paletteFor } from './pane'

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

/**
 * The color and weight of a state word: `find` returns the outer Text first,
 * and a state with no time is the outer Text's whole text, so the inner,
 * colored one is the Text that carries a color.
 */
const inkOf = async (
  pane: { findAll: (q: { type: string; text: RegExp }) => Promise<{ props: Record<string, unknown> }[]> },
  text: RegExp,
) => {
  const inner = (await pane.findAll({ type: 'Text', text })).find(t => t.props.color !== undefined)

  return inner === undefined ? undefined : { color: inner.props.color, bold: inner.props.bold }
}

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
  { session, root, mtimes = {}, env = {} }: { session: string; root: string; mtimes?: Record<string, number>; env?: Record<string, string> },
) {
  const seen = {
    reads: [] as string[],
    runs: [] as string[][],
    opens: [] as string[],
    toasts: [] as string[],
    isPlaced: false,
    isMvFailing: false,
    /** What `hermod focus` answers. */
    hermod: { exitCode: 0, stderr: '' },
    /** What `alfred task show --json` answers: by default, no such ticket. */
    alfred: { exitCode: 1, stdout: '' },
    /** What `gh api graphql` answers. */
    gh: { exitCode: 1, stdout: '', stderr: 'gh: not set up in this test' },
  }
  const writes: Record<string, string> = {}
  mock.env(on, { HOME: '/h', ...env })
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
    value: Object.keys(disk).map(name => ({
      name,
      kind: 'file' as const,
      size: disk[name]?.length ?? 0,
      mtimeMs: mtimes[name] ?? T0,
      isLink: false,
    })),
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
    if (argv[0] === 'hermod') {
      return { value: { ...seen.hermod, stdout: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (argv[0] === 'alfred') {
      return { value: { ...seen.alfred, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (argv[0] === 'gh') return { value: { ...seen.gh, isStdoutTruncated: false, isStderrTruncated: false } }
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
  // No worktree is named for these tickets here, so git never runs: the processes
  // are one ask of alfred for the epic's title, over two polls, and the rename of
  // Gru's stats file, written once.
  expect(seen.runs).toEqual([
    ['alfred', 'task', 'show', 'STARK-10', '--json'],
    ['mv', '-f', `${DIR}/run-STARK-10.stats.json.tmp`, `${DIR}/run-STARK-10.stats.json`],
  ])
})

test("the Overview names the epic and the run's start; the Stats tab adds the start and each session's time", async ($, on) => {
  const iso = (minutesAgo: number) => new Date(T0 - minutesAgo * MIN).toISOString()
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1'] }),
    'STARK-1.json': ticket('STARK-1', 'pr'),
    // Gru's first step 2h10m ago: the run's start. A later step does not move it.
    'run-STARK-10.log.jsonl': `${JSON.stringify({ at: iso(130), text: 'Started 1 job.' })}\n${JSON.stringify({ at: iso(5), text: 'Checked a job.' })}\n`,
    'STARK-1.stats.json': JSON.stringify({ session: 'w', since: iso(120), updated: iso(1), openMs: 2 * 60 * MIN, busyMs: 90 * MIN }),
  }
  const seen = stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  seen.alfred = { exitCode: 0, stdout: JSON.stringify({ item: { kind: 'epic', name: 'EPIC: demo: read the words file aloud' } }) }
  // Stands for the engine beneath the mod's turn hooks.
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  // A turn of the main loop over three polls; a subagent's turn inside it adds nothing.
  await $.turn.start({ text: '', turnId: 't1' } as never)
  await clock.advance(1000)
  await $.turn.start({ text: '', turnId: 's1', agentId: 'a1' } as never)
  await clock.advance(1000)
  await $.turn.complete({ turnId: 's1', agentId: 'a1', reason: 'answer', answer: '', durationMs: 1000, isAborted: false } as never)
  await clock.advance(1000)
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: '', durationMs: 3000, isAborted: false } as never)
  await clock.advance(1000)
  await clock.advance(1000)

  const pane = await $.ui.mount(PANE)
  // alfred's title, less its `EPIC:` and `repo: ` leads.
  expect(await pane.find({ type: 'Text', text: /^Read the words file aloud$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^STARK-10 · 1 tickets · started \d\d:\d\d, 2h10m ago$/ })).toBeDefined()
  expect(seen.runs.filter(argv => argv[0] === 'alfred')).toHaveLength(1)

  await pane.press({ key: 'tab-stats' })
  expect(await pane.find({ type: 'Text', text: /The run started \d\d:\d\d, 2h10m ago\. Counted since \d\d:\d\d\.$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Time' })).toBeDefined()
  // Gru's own time, then the whole run's: Gru's added to the worker's 2h00m and 1h30m.
  expect(await pane.find({ type: 'Text', text: /^ {2}session time +0m +2h00m$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ {2}working time +0m +1h30m$/ })).toBeDefined()
  // Gru's file: time alone writes it when a shown minute changes, at the poll that makes 60 s open,
  // with the 2 s between the three polls inside its main-loop turn (the first poll counts no gap);
  // the subagent's turn inside it counts once.
  await clock.advance(60_000)
  const gru = JSON.parse(disk['run-STARK-10.stats.json'] ?? '{}')
  expect(gru.openMs).toBe(60_000)
  expect(gru.busyMs).toBe(2000)
})

test("a --tickets run's epic takes its title from the run file, and alfred is never asked; a failed ask is not repeated", async ($, on) => {
  const disk: Record<string, string> = {
    'run-GRU-7.json': JSON.stringify({ epic: 'STARK-1', session: 'gru', tickets: ['STARK-1'], titles: { 'STARK-1': '[bug] demo: say the names' } }),
  }
  const seen = stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/GRU-7' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/GRU-7', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: /^Say the names$/ })).toBeDefined()
  // No log: the start is when Gru's stats began, which this tab's first poll wrote.
  expect(await pane.find({ type: 'Text', text: /^demo · 1 tickets · started \d\d:\d\d, 0m ago$/ })).toBeDefined()
  expect(seen.runs.filter(argv => argv[0] === 'alfred')).toEqual([])

  // An epic alfred does not know: one ask, and no title line.
  disk['run-GRU-7.json'] = JSON.stringify({ epic: 'STARK-9', session: 'gru', tickets: ['STARK-1'] })
  await clock.advance(1000)
  await clock.advance(1000)
  await clock.advance(1000)
  expect(seen.runs.filter(argv => argv[0] === 'alfred')).toEqual([['alfred', 'task', 'show', 'STARK-9', '--json']])
  expect(await pane.find({ type: 'Text', text: /^Say the names$/ })).toBeUndefined()
  // The Stats tab names no start that only repeats `Counted since`.
  await pane.press({ key: 'tab-stats' })
  expect(await pane.find({ type: 'Text', text: /The run started/ })).toBeUndefined()
  // A failed ask is tried again 5 minutes later, and a title once found is kept.
  seen.alfred = { exitCode: 0, stdout: JSON.stringify({ item: { name: 'Read aloud' } }) }
  await clock.advance(5 * MIN)
  await clock.advance(1000)
  await clock.advance(10 * MIN)
  expect(seen.runs.filter(argv => argv[0] === 'alfred')).toHaveLength(2)
  await pane.press({ key: 'tab-overview' })
  expect(await pane.find({ type: 'Text', text: /^Read aloud$/ })).toBeDefined()
})

test('a background subagent that runs after the main turn ended counts as working time', async ($, on) => {
  const disk: Record<string, string> = { 'STARK-1.json': ticket('STARK-1', 'pr') }
  stage(on, disk, { session: 'w', root: WORKTREE })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: WORKTREE, surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  await $.turn.start({ text: '', turnId: 'bg', agentId: 'a1' } as never)
  for (let i = 0; i < 4; i++) await clock.advance(1000)
  await $.turn.complete({ turnId: 'bg', agentId: 'a1', reason: 'answer', answer: '', durationMs: 4000, isAborted: false } as never)
  // The minute that writes the file: the 4 s of the subagent's turn are working time.
  await clock.advance(60_000)
  expect(JSON.parse(disk['STARK-1.stats.json'] ?? '{}')).toMatchObject({ openMs: 60_000, busyMs: 4000 })
})

test('the pane draws the run: counts, a ticket worth a look, Up next, and a row opened to its detail', async ($, on) => {
  const iso = (minutesAgo: number) => new Date(T0 - minutesAgo * MIN).toISOString()
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({
      epic: 'STARK-10',
      session: 'gru',
      tickets: ['STARK-1', 'STARK-2', 'STARK-3', 'STARK-4'],
      titles: { 'STARK-4': 'bragi: speak the hints (slice 3 of 3)' },
    }),
    'STARK-1.json': ticket('STARK-1', 'closed', { title: 'bragi: say the names (slice 1 of 3)' }),
    'STARK-2.json': ticket('STARK-2', 'review', { title: 'bragi: read the words file (slice 2 of 3)' }),
    'STARK-2.beat.json': JSON.stringify({ lastActivity: iso(1), running: { tool: 'Bash', since: iso(1) }, minutes: [], recent: [] }),
    // A file that names no title.
    'STARK-3.json': ticket('STARK-3', 'pr', { updated: iso(120), title: undefined }),
  }
  stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: 'Gru · STARK-10' })).toBeDefined()
  // The terminal keeps its palette for a dark theme.
  expect((await pane.find({ type: 'Text', text: '● this run' }))?.props.color).toBe('#95d5b2')
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
  // A state is UPPERCASE in its own color with no emoji; its time stays as it is.
  expect(await pane.find({ type: 'Text', text: /^IN REVIEW · 10m$/ })).toBeDefined()
  expect(await inkOf(pane, /^IN REVIEW$/)).toMatchObject({ color: '#f4a6cd', bold: false })
  expect(await inkOf(pane, /^DONE$/)).toMatchObject({ color: '#95d5b2', bold: false })
  expect(await inkOf(pane, /^NOT STARTED$/)).toMatchObject({ color: '#a7adc2', bold: false })
  // Only a state that wants a look has an emoji, and draws bold.
  expect(await inkOf(pane, /^🐢 SLOW$/)).toMatchObject({ color: '#e9c46a', bold: true })
  expect(await pane.find({ type: 'Text', text: /^🐢 SLOW · 2h00m$/ })).toBeDefined()
  // A ticket reads `[id] name`: the id in its own color, then the name, dimmed on a done or not started row.
  expect(await pane.find({ type: 'Text', text: /^\[STARK-2\] Read the words file$/ })).toBeDefined()
  expect((await pane.find({ type: 'Text', text: /^\[STARK-2\]$/ }))?.props.color).toBe('#c9b3f5')
  expect((await pane.find({ type: 'Text', text: /^Read the words file$/ }))?.props.color).toBeUndefined()
  expect((await pane.find({ type: 'Text', text: /^Say the names$/ }))?.props.color).toBe('#b8bdd0')
  // A ticket with no file yet takes its title from the run file, in its row and in Up next.
  expect(await pane.find({ type: 'Text', text: /^\[STARK-4\] Speak the hints$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Start \[STARK-4\] Speak the hints$/ })).toBeDefined()
  // A file that names no title shows the id alone, in its row and in the box of tickets worth a look.
  expect(await pane.findAll({ type: 'Text', text: /^\[STARK-3\]$/ })).toHaveLength(4)
  expect(await pane.find({ type: 'Text', text: /^\[STARK-3\] / })).toBeUndefined()
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
  expect(await pane.find({ type: 'Text', text: 'bragi: speak the hints (slice 3 of 3)' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Its worker has not started yet.' })).toBeDefined()
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

/** The lines over the groups of a list, top to bottom, without their rule. */
const dividers = async (pane: { findAll: (q: { type: string; text: RegExp }) => Promise<{ text: string }[]> }) =>
  (await pane.findAll({ type: 'Text', text: /^── .+ · \d+ ─+$/ })).map(t => t.text.replace(/─+$/, ''))

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** The element of a drawn tree whose props carry `key`, and the element that holds it. */
const byKey = (node: unknown, key: string, parent?: Drawn): { node: Drawn; parent: Drawn | undefined } | undefined => {
  if (typeof node !== 'object' || node === null) return undefined
  const n = node as Drawn
  if (n.props?.key === key) return { node: n, parent }
  for (const child of n.children ?? []) {
    const hit = byKey(child, key, n)
    if (hit !== undefined) return hit
  }

  return undefined
}
const parentOf = (tree: unknown, key: string) => byKey(tree, key)?.parent

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
  expect(await pane.find({ type: 'Text', text: 'The ticket list and the GitHub tab keep the order of the run.' })).toBeDefined()
  await pane.press({ key: 'set-done-last' })
  expect(
    await pane.find({ type: 'Text', text: 'The ticket list shows in progress, then to do, then done, each under its own line. The GitHub tab shows open PRs, then merged, then closed.' }),
  ).toBeDefined()
  expect(store.doneLast).toBe(true)
  // Gru reads the run's settings file; this choice is the pane's alone.
  expect(seen.runs.filter(argv => argv[0] === 'mv' && argv[3]?.endsWith('.settings.json'))).toEqual([])

  await pane.press({ key: 'tab-overview' })
  // In progress, then to do, then done, each group in run order under its own line.
  expect(await listOrder(pane)).toEqual(['STARK-2', 'STARK-4', 'STARK-1', 'STARK-3'])
  expect(await dividers(pane)).toEqual(['── In progress · 1 ', '── To do · 1 ', '── Done · 2 '])

  await pane.press({ key: 'tab-settings' })
  await pane.press({ key: 'set-done-last' })
  expect(store.doneLast).toBe(false)
  await pane.press({ key: 'tab-overview' })
  expect(await listOrder(pane)).toEqual(['STARK-1', 'STARK-2', 'STARK-3', 'STARK-4'])
  // The run's order has no groups, so no line.
  expect(await dividers(pane)).toEqual([])
})

test("no state's color is the id's, in the terminal or in an app's theme", () => {
  const STATE_INKS = ['gray', 'starting', 'pr', 'review', 'merged', 'green', 'blocked', 'amber'] as const
  for (const surface of ['terminal', 'desktop'] as const) {
    const P = paletteFor(surface)
    const inks = STATE_INKS.map(k => P[k])
    expect(inks).not.toContain(P.id)
    // The app's `permission` is close to its `suggestion`, the id's color off the terminal.
    if (surface !== 'terminal') expect(inks).not.toContain('permission')
    // The six plain states each have their own color.
    expect(new Set(inks.slice(0, 6)).size).toBe(6)
  }
})

test('an empty group draws no line', async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-2'] }),
    'STARK-1.json': ticket('STARK-1', 'closed'),
    'STARK-2.json': ticket('STARK-2', 'pr'),
  }
  stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  mock.store(on, { doneLast: true })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const pane = await $.ui.mount(PANE)
  expect(await dividers(pane)).toEqual(['── In progress · 1 ', '── Done · 1 '])
  // The line runs to the pane's edge: 80 columns.
  expect((await pane.find({ type: 'Text', text: /^── Done · 1 ─+$/ }))?.text).toHaveLength(80)
})

test('each group line has an empty row above and below it, and an open row above a line adds no second one', async ($, on) => {
  stage(on, { ...DONE_LAST_RUN }, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  mock.store(on, { doneLast: true })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const pane = await $.ui.mount(PANE)
  for (const name of ['In progress', 'To do', 'Done']) expect((await pane.find({ key: `g${name}` }))?.props).toMatchObject({ marginY: 1 })

  // STARK-2, the last of In progress, opens: the line under it gives the one empty row.
  await pane.press({ key: 'row-STARK-2' })
  const last = byKey(await pane.drawn(), 'rSTARK-2')?.node
  expect(last?.children?.at(-1)).toMatchObject({ props: { marginBottom: 0 } })
  // STARK-1, the first of Done but not its last, keeps its own empty row.
  await pane.press({ key: 'row-STARK-1' })
  const first = byKey(await pane.drawn(), 'rSTARK-1')?.node
  expect(first?.children?.at(-1)).toMatchObject({ props: { marginBottom: 1 } })
})

test('with Done tickets last on, the GitHub tab groups the PRs: open and draft, then merged, then closed', async ($, on) => {
  const seen = stage(on, { ...GH_RUN }, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  seen.gh = { exitCode: 0, stdout: JSON.stringify(ANSWER), stderr: '' }
  seen.isPlaced = true
  mock.store(on, { doneLast: true })
  const clock = mock.clock(on, { now: Date.parse('2026-11-01T14:43:30Z') })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-github' })
  await clock.advance(1000)
  await clock.advance(1000)

  // #447 is a draft, so STARK-2 comes first; no PR is closed, so no Closed line.
  expect(await dividers(pane)).toEqual(['── Open · 1 ', '── Merged · 1 '])
  const cards = (await pane.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('gh-'))
  expect(cards).toEqual(['gh-STARK-2', 'gh-STARK-1'])
  // The lines and the PRs share one list with an empty row between each two.
  const tree = await pane.drawn()
  expect(parentOf(tree, 'gOpen')?.props?.gap).toBe(1)
  expect(parentOf(tree, 'ghSTARK-1')).toBe(parentOf(tree, 'gOpen'))
})

const GH_RUN: Record<string, string> = {
  'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-2', 'STARK-3'] }),
  'STARK-1.json': ticket('STARK-1', 'closed', { pr: 'https://github.com/21StarkCom/bifrost/pull/446' }),
  'STARK-2.json': ticket('STARK-2', 'review', { pr: 'https://github.com/21StarkCom/bifrost/pull/447' }),
  'STARK-3.json': ticket('STARK-3', 'ticket'),
}

test('the GitHub tab asks GitHub only while the pane is placed and shows it, once a minute, one call a repo', async ($, on) => {
  const seen = stage(on, { ...GH_RUN }, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  seen.gh = { exitCode: 0, stdout: JSON.stringify(ANSWER), stderr: '' }
  const clock = mock.clock(on, { now: T0 })
  const asks = () => seen.runs.filter(argv => argv[0] === 'gh')
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const pane = await $.ui.mount(PANE)
  // The Overview, placed: no ask.
  seen.isPlaced = true
  await clock.advance(1000)
  expect(asks()).toEqual([])

  // The GitHub tab, but the pane is not placed: no ask.
  seen.isPlaced = false
  await pane.press({ key: 'tab-github' })
  await clock.advance(5000)
  expect(asks()).toEqual([])

  // Placed: one call for the repo's two PRs at once, then one a minute.
  seen.isPlaced = true
  await clock.advance(1000)
  expect(asks()).toHaveLength(1)
  const query = asks()[0]?.[4] ?? ''
  expect(asks()[0]?.slice(0, 4)).toEqual(['gh', 'api', 'graphql', '-f'])
  expect(query.match(/p\d+: pullRequest/g)).toEqual(['p446: pullRequest', 'p447: pullRequest'])
  await clock.advance(30_000)
  expect(asks()).toHaveLength(1)
  await clock.advance(30_000)
  expect(asks()).toHaveLength(2)

  // Back to the Overview: no more asks.
  await pane.press({ key: 'tab-overview' })
  await clock.advance(120_000)
  expect(asks()).toHaveLength(2)
})

test("the GitHub tab draws each ticket's PR, its runs and its newest commit, and keeps the last answer when GitHub fails", async ($, on) => {
  const seen = stage(on, { ...GH_RUN }, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  seen.gh = { exitCode: 0, stdout: JSON.stringify(ANSWER), stderr: '' }
  seen.isPlaced = true
  // The fixture's time: #447's `ci` run started at 14:41:18 and still runs.
  const NOW = Date.parse('2026-11-01T14:43:30Z')
  const clock = mock.clock(on, { now: NOW })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-github' })
  await clock.advance(1000)
  await clock.advance(1000)

  expect(await pane.find({ type: 'Text', text: '2 PRs: 1 merged · 0 open · 1 draft · 0 closed' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'runs: 3 passed · 0 failing · 1 running' })).toBeDefined()
  // A count above 0 bold in its state's color, a 0 in the hint's.
  expect(await inkOf(pane, /^1 merged$/)).toMatchObject({ color: '#c5e384', bold: true })
  expect(await inkOf(pane, /^1 draft$/)).toMatchObject({ color: '#a7adc2', bold: true })
  expect(await inkOf(pane, /^0 open$/)).toMatchObject({ color: '#9ba1b8', bold: false })
  expect(await inkOf(pane, /^3 passed$/)).toMatchObject({ color: '#95d5b2', bold: true })
  expect(await inkOf(pane, /^0 failing$/)).toMatchObject({ color: '#9ba1b8', bold: false })
  expect(await inkOf(pane, /^1 running$/)).toMatchObject({ color: '#8ecae6', bold: true })
  expect(await pane.find({ type: 'Text', text: /^PR #446 MERGED · opened \d\d:\d\d · merged \d\d:\d\d · open 15m · \+681 −120$/ })).toBeDefined()
  expect(await inkOf(pane, /^MERGED$/)).toMatchObject({ color: '#c5e384' })
  expect(await inkOf(pane, /^DRAFT$/)).toMatchObject({ color: '#a7adc2' })
  // Lines added in green, lines removed in red.
  expect(await inkOf(pane, /^\+681$/)).toMatchObject({ color: '#95d5b2' })
  expect(await inkOf(pane, /^ −120$/)).toMatchObject({ color: '#ff8f87' })
  expect(await pane.find({ type: 'Text', text: /^✓ ci #1278 1m43s$/ })).toBeDefined()
  expect(await inkOf(pane, /^#1278 1m43s$/)).toMatchObject({ color: '#9ba1b8' })
  expect(await pane.find({ type: 'Text', text: /^● ci #1280 running 2m$/ })).toBeDefined()
  // The merged PR's runs on its merge commit; the draft has none.
  expect(await pane.findAll({ type: 'Text', text: 'After merge' })).toHaveLength(1)
  expect(await pane.find({ type: 'Text', text: /^✓ ci #1279 1m40s$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^3 · last \d\d:\d\d 0966587 chore\(changelog\)/ })).toBeDefined()
  expect(await inkOf(pane, /^0966587$/)).toMatchObject({ color: '#c9b3f5' })
  // Each Commits line fits the 80-column pane, less its 2-cell indent.
  for (const c of await pane.findAll({ type: 'Text', text: /^\d+ · last / })) expect([...c.text].length).toBeLessThanOrEqual(78 - 'After merge  '.length)
  // An empty row between two PRs; with Done tickets last off, no group lines.
  expect(parentOf(await pane.drawn(), 'ghSTARK-1')?.props?.gap).toBe(1)
  expect(await dividers(pane)).toEqual([])
  expect(await pane.find({ type: 'Text', text: 'No PR yet:' })).toBeDefined()
  // A name opens the PR's jobs and commits.
  await pane.press({ key: 'gh-STARK-1' })
  expect(await pane.find({ type: 'Text', text: /^ {2}✓ test 1m39s$/ })).toBeDefined()
  // Each commit stays on one line of the 80-column pane, less its 4-cell indent.
  const commits = await pane.findAll({ type: 'Text', text: /^[✓✕● ] \d\d:\d\d [0-9a-f]{7} / })
  expect(commits).toHaveLength(3)
  for (const c of commits) expect([...c.text].length).toBeLessThanOrEqual(76)

  // GitHub fails: the last answer stays, and the tab names the failure by its first line.
  seen.gh = { exitCode: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)\nmore' }
  await clock.advance(60_000)
  await clock.advance(1000)
  expect(await pane.find({ type: 'Text', text: /^PR #446 MERGED/ })).toBeDefined()
  expect(
    await pane.find({ type: 'Text', text: /^21StarkCom\/bifrost: GitHub did not answer at \d\d:\d\d: HTTP 502: Bad Gateway \(https:\/\/api\.github\.com\/graphql\)$/ }),
  ).toBeDefined()
})

const SURFACE = '0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D'

test("a ticket whose worker tab is open draws its id as a button that brings that tab to the front", async ($, on) => {
  const iso = (minutesAgo: number) => new Date(T0 - minutesAgo * MIN).toISOString()
  const beat = (updatedMin: number) =>
    JSON.stringify({ updated: iso(updatedMin), lastActivity: iso(1), running: null, minutes: [], recent: [], surface: SURFACE })
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-2'] }),
    'STARK-1.json': ticket('STARK-1', 'pr'),
    'STARK-1.beat.json': beat(1),
    // Its heartbeat is 5 minutes old: the tab is gone.
    'STARK-2.json': ticket('STARK-2', 'pr'),
    'STARK-2.beat.json': beat(5),
  }
  const seen = stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const pane = await $.ui.mount(PANE)

  // The open tab's id: dark on the lavender, as wide as `[STARK-1]`; the title beside it still opens the row.
  const chip = await pane.find({ type: 'Text', text: /^ STARK-1 $/ })
  expect(chip?.props).toMatchObject({ backgroundColor: '#c9b3f5', color: '#262626', bold: true })
  expect(await pane.find({ type: 'Text', text: /^\[STARK-1\]/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /^\[STARK-2\] Title STARK-2$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Select a name to see more, or a highlighted id to go to its tab.' })).toBeDefined()
  await pane.press({ key: 'row-STARK-1' })
  expect(await pane.find({ type: 'Text', text: /^In this step since/ })).toBeDefined()

  await pane.press({ key: 'tab-STARK-1' })
  expect(seen.runs).toContainEqual(['hermod', 'focus', SURFACE])
  expect(seen.toasts).toEqual([])
  // No button for a closed tab.
  expect((await pane.findAll({ type: 'Button' })).map(b => b.key)).not.toContain('tab-STARK-2')
})

test('a press on a tab that hermod cannot bring to the front says why', async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1'] }),
    'STARK-1.json': ticket('STARK-1', 'pr'),
    'STARK-1.beat.json': JSON.stringify({ updated: new Date(T0).toISOString(), lastActivity: null, running: null, minutes: [], recent: [], surface: SURFACE }),
  }
  const seen = stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  seen.hermod = { exitCode: 2, stderr: 'surface not found\nmore' }
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-STARK-1' })
  expect(seen.toasts).toEqual(['The tab of STARK-1 did not come to the front: surface not found'])
})

test("a worker's tab writes its cmux surface into its heartbeat, and a keep-alive once a minute with no call", async ($, on) => {
  const disk: Record<string, string> = { 'STARK-1.json': ticket('STARK-1', 'pr') }
  const seen = stage(on, disk, { session: 'w', root: WORKTREE, env: { CMUX_SURFACE_ID: SURFACE } })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: WORKTREE, surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const beatMoves = () => seen.runs.filter(argv => argv[0] === 'mv' && argv[3] === `${DIR}/STARK-1.beat.json`).length
  // The first poll says the tab is open, with no call yet.
  expect(beatMoves()).toBe(1)
  expect(JSON.parse(disk['STARK-1.beat.json'] ?? '{}')).toMatchObject({ surface: SURFACE, lastActivity: null })
  await clock.advance(30_000)
  expect(beatMoves()).toBe(1)
  await clock.advance(31_000)
  expect(beatMoves()).toBe(2)
  // 60 seconds after the first write, at the poll of T0 + 61 s.
  expect(JSON.parse(disk['STARK-1.beat.json'] ?? '{}').updated).toBe(new Date(T0 + 61_000).toISOString())
})

test("an idle second session in a worker's worktree never takes the heartbeat from the worker whose tab lives", async ($, on) => {
  const OTHER = '11111111-2222-4333-8444-555555555555'
  const workerBeat = (at: number) =>
    JSON.stringify({ id: 'STARK-1', session: 'worker', updated: new Date(at).toISOString(), lastActivity: null, running: null, minutes: [], recent: [], surface: OTHER })
  const disk: Record<string, string> = { 'STARK-1.json': ticket('STARK-1', 'pr'), 'STARK-1.beat.json': workerBeat(T0) }
  const seen = stage(on, disk, { session: 'second', root: WORKTREE, env: { CMUX_SURFACE_ID: SURFACE } })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: WORKTREE, surface: 'terminal', isInteractive: true })
  const beatMoves = () => seen.runs.filter(argv => argv[0] === 'mv' && argv[3] === `${DIR}/STARK-1.beat.json`).length
  await clock.advance(1000)
  await clock.advance(61_000)
  // The worker's own keep-alive comes in time: the second session writes nothing.
  disk['STARK-1.beat.json'] = workerBeat(T0 + 62_000)
  await clock.advance(61_000)
  expect(beatMoves()).toBe(0)
  expect(JSON.parse(disk['STARK-1.beat.json'] ?? '{}').surface).toBe(OTHER)
  // The worker's tab closed 3 minutes ago: the heartbeat is no one's, and this tab's keep-alive takes it.
  await clock.advance(120_000)
  expect(beatMoves()).toBe(1)
  expect(JSON.parse(disk['STARK-1.beat.json'] ?? '{}')).toMatchObject({ session: 'second', surface: SURFACE })
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
  // The first poll wrote the keep-alive: the call's start waits out the 5 seconds after it.
  await clock.advance(1000)
  expect(JSON.parse(disk['STARK-1.beat.json'] ?? '{}').running).toBe(null)
  await clock.advance(4000)
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
  expect(await pane.find({ type: 'Text', text: 'PR OPEN · 10m' })).toBeDefined()
  expect(await inkOf(pane, /^PR OPEN$/)).toMatchObject({ color: '#a5b4fc', bold: false })
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
  expect(await pane.find({ type: 'Text', text: '✋ HELD · merge · 10m' })).toBeDefined()
  expect(await inkOf(pane, /^✋ HELD$/)).toMatchObject({ color: '#e9c46a', bold: true })
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
  expect((await pane.find({ type: 'Text', text: clockAt(3) }))?.props.tabular).toBe(true)
  expect(texts[at('The change is now in the main code.') - 1]).toBe('Say the names')
  expect(texts[at('Made the change and asked for a check.') - 1]).toBe('Read the words file')
  expect(texts[at('Read the job.') - 1]).toBe('Say the names')
  // A ticket's step names it as its row does: `[id] name`, the id in its own color.
  expect(texts).toContain('[STARK-1] Say the names')
  expect((await pane.find({ type: 'Text', text: /^\[STARK-2\]$/ }))?.props.color).toBe('#c9b3f5')
  expect(texts).not.toContain('Another run.')
  expect(seen.reads).not.toContain(`${DIR}/run-STARK-20.log.jsonl`)
})

test("only Gru's own steps take Gru's color, even when a ticket's name reads Gru", async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1'] }),
    'run-STARK-10.log.jsonl': logFile([5, 'Started 1 job.']),
    'STARK-1.json': ticket('STARK-1', 'pr', { title: 'gru' }),
    'STARK-1.log.jsonl': logFile([2, 'Read the job.']),
  }
  stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-log' })
  const names = (await pane.findAll({ type: 'Text', text: /^Gru$/ })).map(t => t.props.color)
  // Newest first: the ticket's step, then Gru's own.
  expect(names).toEqual(['#b8bdd0', '#8ecae6'])
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

test('a poll reads a log again only once it grew, and then shows the new step', async ($, on) => {
  const disk: Record<string, string> = {
    'STARK-1.json': ticket('STARK-1', 'pr'),
    'STARK-1.log.jsonl': logFile([30, 'Read the job.']),
  }
  const seen = stage(on, disk, { session: 'w', root: WORKTREE })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: WORKTREE, surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  await clock.advance(1000)
  const logReads = () => seen.reads.filter(p => p === `${DIR}/STARK-1.log.jsonl`).length
  expect(logReads()).toBe(1)

  disk['STARK-1.log.jsonl'] += logFile([1, 'Made the change.'])
  await clock.advance(1000)
  expect(logReads()).toBe(2)
  const pane = await $.ui.mount(TICKET_PANE)
  await pane.press({ key: 'tab-log' })
  expect(await pane.find({ type: 'Text', text: 'Made the change.' })).toBeDefined()
})

test('the Gru pane draws on the desktop surface too, and a press there writes the run settings', async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-2'] }),
    'STARK-1.json': ticket('STARK-1', 'pr', { title: 'bragi: read the words file (slice 2 of 3)' }),
  }
  stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ type: 'Text', text: 'Gru · STARK-10' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '0 of 2 done · 1 in progress · 1 not started' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /draws in the terminal/ })).toBeUndefined()
  // The app's own theme, light or dark: theme keys, never the terminal's dark-only hex palette.
  expect((await pane.find({ type: 'Text', text: '● this run' }))?.props.color).toBe('success')
  expect((await pane.find({ type: 'Text', text: '0 of 2 done · 1 in progress · 1 not started' }))?.props.color).toBe('inactive')
  // A bar takes its tone's theme key too: not started subtle, a moving PR the app's accent.
  expect((await pane.findAll({ type: 'Text', text: /^ █/ })).map(n => n.props.color)).toEqual(['subtle', 'suggestion'])
  // A ticket's id takes the app's accent; its name keeps the app's text color.
  expect((await pane.find({ type: 'Text', text: /^\[STARK-1\]$/ }))?.props.color).toBe('suggestion')
  expect((await pane.find({ type: 'Text', text: /^Read the words file$/ }))?.props.color).toBeUndefined()
  // The station words line up over the track only in a face of one width.
  expect((await pane.find({ type: 'Text', text: /^ +ticket PR +review/ }))?.props.mono).toBe(true)
  await pane.press({ key: 'tab-settings' })
  // A setting's value draws in a frame: a Button that is not plain.
  expect((await pane.find({ type: 'Button', key: 'set-decide' }))?.props.plain).toBeUndefined()
  await pane.press({ key: 'set-decide' })
  expect(JSON.parse(disk['run-STARK-10.settings.json'] ?? '{}')).toMatchObject({ decideForMe: false })
})

test('the ticket pane draws its ticket on the desktop surface', async ($, on) => {
  const disk: Record<string, string> = { 'STARK-1.json': ticket('STARK-1', 'pr', { title: 'bragi: read the words file' }) }
  stage(on, disk, { session: 'w', root: WORKTREE })
  const clock = mock.clock(on, { now: T0 })
  await $.session.start({ cwd: WORKTREE, surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount({ ...TICKET_PANE, surface: 'desktop' })
  expect(await pane.find({ type: 'Text', text: 'Read the words file' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'PR OPEN · 10m' })).toBeDefined()
  // The desktop takes theme keys, so a state follows the app's light or dark theme.
  expect(await inkOf(pane, /^PR OPEN$/)).toMatchObject({ color: 'planMode' })
  expect(await pane.find({ type: 'Text', text: /draws in the terminal/ })).toBeUndefined()
  expect((await pane.find({ type: 'Text', text: 'STARK-1 · bragi' }))?.props.color).toBe('inactive')
  expect((await pane.find({ type: 'Text', text: /^ +ticket PR +review/ }))?.props.mono).toBe(true)
})

/** The four counts a model request reports, and the model that answered. */
const usageOf = (model: string, input: number, output: number, cacheRead: number, cacheWrite: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  model,
})

/**
 * The engine's own answers beneath the mod for the events the stats count:
 * each model request answers with the usage the test queued, each prompt and
 * skill enters as sent, and a Bash `false` fails.
 */
function engineAnswers(on: On, usages: ReturnType<typeof usageOf>[]) {
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: usages.shift() ?? null }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('command.run', () => ({ text: '' }))
  on('tool.call', (_$, e) => (e.tool === 'Bash' && e.command === 'false' ? { result: {}, isError: true } : { result: {} }))
}

/** One model request, read to its end as the engine reads it. */
async function request(stream: AsyncGenerator<unknown, unknown> & { result: Promise<unknown> }) {
  for await (const _ of stream) {
    // The request streams its chunks; the stats read only its end.
  }
  await stream.result
}

/** A stats file a worker or Gru wrote, as the mod writes it. */
const statsText = (session: string, fields: Record<string, unknown>) =>
  JSON.stringify({
    session,
    since: new Date(T0 - 60 * MIN).toISOString(),
    updated: new Date(T0 - MIN).toISOString(),
    model: null,
    effort: null,
    requests: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    models: {},
    prompts: { operator: 0, peer: 0, other: 0 },
    sent: 0,
    launches: 0,
    reviews: 0,
    tools: {},
    git: null,
    ...fields,
  })

test("a worker's tab counts its requests, prompts, calls and reviews, writes its stats file, and drops it with its ticket file", async ($, on) => {
  const disk: Record<string, string> = { 'STARK-1.json': ticket('STARK-1', 'review', { pr: 'https://github.com/o/r/pull/9' }) }
  const seen = stage(on, disk, { session: 'w', root: WORKTREE })
  const clock = mock.clock(on, { now: T0 })
  engineAnswers(on, [usageOf('claude-opus-5-5', 1200, 3400, 56_000, 7800), usageOf('claude-haiku-5-5', 10, 20, 30, 40)])
  await $.session.start({ cwd: WORKTREE, surface: 'terminal', isInteractive: true })

  await request($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 1 }))
  // A subagent's request adds its tokens, and leaves the main loop's model and effort.
  await request($.turn.step({ turnId: 't2', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'a1' }))
  await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'unblocked', wait: false, origin: { kind: 'peer' } })
  await $.prompt.submit({ text: 'a task ended', wait: false, isMeta: true, origin: { kind: 'task-notification' } })
  await $.tool.call({ tool: 'Bash', command: "hermod msg send --to gru --kind note -- 'done'" })
  await $.tool.call({ tool: 'Bash', command: 'false' })
  await $.tool.call({ tool: 'Read', file_path: '/r/a.ts' })
  // A review round typed, and one the model runs with the Skill tool; another skill or command is none.
  await $.command.run(command('code-review'))
  await $.command.run(command('simplify'))
  await $.tool.call({ tool: 'Skill', skill: 'code-review', args: 'xhigh --fix' })
  await $.tool.call({ tool: 'Skill', skill: 'simplify' })
  await clock.advance(1000)

  const written = JSON.parse(disk['STARK-1.stats.json'] ?? '{}')
  expect(written).toMatchObject({
    session: 'w',
    model: 'claude-opus-5-5',
    effort: 'xhigh',
    requests: 2,
    tokens: { input: 1210, output: 3420, cacheRead: 56_030, cacheWrite: 7840 },
    prompts: { operator: 1, peer: 1, other: 1 },
    sent: 1,
    launches: 0,
    reviews: 2,
    tools: { Bash: { calls: 2, fails: 1 }, Read: { calls: 1, fails: 0 }, Skill: { calls: 2, fails: 0 } },
  })
  expect(written.models['claude-haiku-5-5']).toEqual({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40, requests: 1 })

  const pane = await $.ui.mount(TICKET_PANE)
  expect(await pane.find({ type: 'Text', text: /^Stats$/ })).toBeDefined()
  await pane.press({ key: 'tab-stats' })
  expect(await pane.find({ type: 'Text', text: '📊 Stats for STARK-1' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Counted since \d\d:\d\d\.$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ {2}input +1,210$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ {2}cache read +56k$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ {2}PRs opened +1$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ {2}PRs merged +0$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ {2}prompts from you +1$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ {2}Bash +2 calls · 1 failed$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'claude-opus-5-5 · xhigh' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '  claude-haiku-5-5: 1 request, 20 output tokens' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ {2}Read +1 call$/ })).toBeDefined()
  // Git cannot read this worktree here: no change reads 0, with no sign.
  expect(await pane.find({ type: 'Text', text: /^ {2}lines added +0$/ })).toBeDefined()
  // One column: no head row, no Gru.
  expect(await pane.find({ type: 'Text', text: /Whole run/ })).toBeUndefined()

  delete disk['STARK-1.json']
  await clock.advance(1000)
  expect(seen.runs).toContainEqual(['rm', '-f', `${DIR}/STARK-1.stats.json`])
})

test('a relaunch on the same ticket adds its counts to the ones the stats file held, and reads that file once', async ($, on) => {
  const kept = statsText('old', {
    model: 'claude-opus-5-5',
    effort: 'high',
    requests: 5,
    tokens: { input: 500, output: 600, cacheRead: 700, cacheWrite: 800 },
    tools: { Bash: { calls: 4, fails: 1 } },
    git: { added: 12, removed: 3, commits: 2 },
  })
  const disk: Record<string, string> = { 'STARK-1.json': ticket('STARK-1', 'pr'), 'STARK-1.stats.json': kept }
  const seen = stage(on, disk, { session: 'w', root: WORKTREE })
  const clock = mock.clock(on, { now: T0 })
  engineAnswers(on, [usageOf('claude-opus-5-5', 1, 2, 3, 4)])
  await $.session.start({ cwd: WORKTREE, surface: 'terminal', isInteractive: true })
  await request($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 }))
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(1000)
  await clock.advance(1000)
  await clock.advance(5000)

  const written = JSON.parse(disk['STARK-1.stats.json'] ?? '{}')
  expect(written).toMatchObject({
    session: 'w',
    since: new Date(T0 - 60 * MIN).toISOString(),
    effort: 'medium',
    requests: 6,
    tokens: { input: 501, output: 602, cacheRead: 703, cacheWrite: 804 },
    tools: { Bash: { calls: 5, fails: 1 } },
    // Git cannot read this worktree here: the lines the file kept stand.
    git: { added: 12, removed: 3, commits: 2 },
  })
  expect(seen.reads.filter(path => path.endsWith('STARK-1.stats.json'))).toHaveLength(1)
})

test("Gru's tab writes its own stats file, and the Gru pane's Stats tab adds each ticket's to Gru's", async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-2', 'STARK-3'] }),
    'STARK-1.json': ticket('STARK-1', 'closed', { pr: 'https://github.com/o/r/pull/1' }),
    'STARK-1.stats.json': statsText('w1', {
      model: 'claude-opus-5-5',
      effort: 'xhigh',
      requests: 40,
      tokens: { input: 9000, output: 30_000, cacheRead: 2_000_000, cacheWrite: 90_000 },
      models: { 'claude-opus-5-5': { input: 9000, output: 30_000, cacheRead: 2_000_000, cacheWrite: 90_000, requests: 40 } },
      prompts: { operator: 0, peer: 2, other: 1 },
      sent: 3,
      reviews: 1,
      tools: { Bash: { calls: 30, fails: 2 }, Edit: { calls: 12, fails: 0 } },
      git: { added: 234, removed: 20, commits: 3 },
    }),
    // A Codex worker: a ticket file, and no stats file.
    'STARK-2.json': ticket('STARK-2', 'pr', { pr: 'https://github.com/o/r/pull/2' }),
  }
  const seen = stage(on, disk, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  const clock = mock.clock(on, { now: T0 })
  engineAnswers(on, [usageOf('claude-opus-5-5', 1000, 2000, 300_000, 4000)])
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await request($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 }))
  await $.prompt.submit({ text: '/gru start STARK-10', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Bash', command: 'valkyrie minion STARK-1 --json' })
  await $.tool.call({ tool: 'Bash', command: 'valkyrie minion STARK-2 --agent codex --json' })
  await clock.advance(1000)

  expect(JSON.parse(disk['run-STARK-10.stats.json'] ?? '{}')).toMatchObject({
    session: 'gru',
    requests: 1,
    launches: 2,
    prompts: { operator: 1, peer: 0, other: 0 },
    git: null,
  })

  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-stats' })
  expect(await pane.find({ type: 'Text', text: '📊 Stats for STARK-10' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ +Gru +Whole run$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ {2}input +1,000 +10k$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ {2}cache read +300k +2\.3M$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ {2}lines added +— +\+234$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ {2}PRs opened +— +2$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ {2}PRs merged +— +1$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ {2}workers launched +2 +2$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ {2}from other sessions +0 +2$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Most used tools, whole run' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^ {2}Bash +32 calls · 2 failed$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'claude-opus-5-5 · high' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'claude-opus-5-5 · xhigh' })).toBeDefined()
  // STARK-2 started on Codex and wrote no stats; STARK-3 has not started, so it has nothing to count.
  expect(
    await pane.find({ type: 'Text', text: 'One ticket has no stats: a Codex worker, a session without the mod, or no worker in this run.' }),
  ).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '[STARK-2]' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '[STARK-3]' })).toBeUndefined()

  // Gru deletes its run file at the end: its stats file goes with it.
  delete disk['run-STARK-10.json']
  await clock.advance(1000)
  expect(seen.runs).toContainEqual(['rm', '-f', `${DIR}/run-STARK-10.stats.json`])
})

test('/gru-board in another session reads the stats files and writes none of its own', async ($, on) => {
  const disk: Record<string, string> = {
    'run-GRU-5.json': JSON.stringify({ epic: 'GRU-5', session: 'gru', tickets: ['STARK-1'] }),
    'STARK-1.json': ticket('STARK-1', 'pr'),
  }
  const seen = stage(on, disk, { session: 'other', root: '/r' })
  const clock = mock.clock(on, { now: T0 })
  engineAnswers(on, [usageOf('claude-opus-5-5', 1, 2, 3, 4)])
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  await request($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 }))
  await $.command.run(command('gru-board'))
  await clock.advance(1000)

  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-stats' })
  expect(
    await pane.find({ type: 'Text', text: "No stats yet. The mod counts in Gru's tab and in each worker's tab, once each has the mod." }),
  ).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '[STARK-1]' })).toBeDefined()
  // This session is neither Gru's nor a worker's: it writes no stats file.
  expect(seen.runs.filter(argv => argv[0] === 'mv')).toEqual([])
  expect(Object.keys(disk).filter(name => name.endsWith('.stats.json'))).toEqual([])
})

test('after a reload, a /gru-board tab keeps showing its run, drawn from the files as they are now', async ($, on) => {
  const old: Record<string, string> = {
    'run-GRU-5.json': JSON.stringify({ epic: 'GRU-5', session: 'gru', tickets: ['STARK-1'] }),
    'STARK-1.json': ticket('STARK-1', 'pr'),
    'STARK-1.stats.json': statsText('w1', { requests: 1, tokens: { input: 7, output: 0, cacheRead: 0, cacheWrite: 0 } }),
  }
  // What the load before the reload drew, still in the session's state.
  const stale = buildBoard('other', '', T0 - MIN, old, new Map(), {})
  const disk: Record<string, string> = {
    ...old,
    'STARK-1.stats.json': statsText('w1', { requests: 9, tokens: { input: 4321, output: 0, cacheRead: 0, cacheWrite: 0 } }),
  }
  stage(on, disk, { session: 'other', root: '/r' })
  let isSeeded = false
  on('state.get', (_$, e, next) => {
    if (e.key !== 'board' || isSeeded) return next(e)
    isSeeded = true
    return { value: { value: { shape: 'board-7', value: stale }, version: 1 } }
  })
  const clock = mock.clock(on, { now: T0 })
  // No /gru-board in this load: the reload started the module over.
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-stats' })
  expect(await pane.find({ type: 'Text', text: /^ {2}input +0 +4,321$/ })).toBeDefined()
})

test('the Stats tab draws on the desktop surface too', async ($, on) => {
  const disk: Record<string, string> = { 'STARK-1.json': ticket('STARK-1', 'pr') }
  stage(on, disk, { session: 'w', root: WORKTREE })
  const clock = mock.clock(on, { now: T0 })
  engineAnswers(on, [usageOf('claude-opus-5-5', 1, 2, 3, 4)])
  await $.session.start({ cwd: WORKTREE, surface: 'desktop', isInteractive: true })
  await request($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 }))
  await clock.advance(1000)

  const pane = await $.ui.mount({ ...TICKET_PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-stats' })
  const row = await pane.find({ type: 'Text', text: /^ {2}output +2$/ })
  // The columns line up in the desktop's fixed-width face.
  expect(row?.props.mono).toBe(true)
})

test("a PR number GitHub does not know keeps the repo's other PRs and names the error", async ($, on) => {
  const seen = stage(on, { ...GH_RUN }, { session: 'gru', root: '/r/.claude/worktrees/STARK-10' })
  // `gh` exits 1 on a GraphQL error, yet prints the PRs it found.
  const { p446 } = ANSWER.data.repository
  seen.gh = {
    exitCode: 1,
    stdout: JSON.stringify({ data: { repository: { p446, p447: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'p447'] }] }),
    stderr: 'gh: Could not resolve to a PullRequest with the number of 447.',
  }
  seen.isPlaced = true
  const clock = mock.clock(on, { now: Date.parse('2026-11-01T14:43:30Z') })
  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'tab-github' })
  await clock.advance(1000)
  await clock.advance(1000)

  expect(await pane.find({ type: 'Text', text: /^PR #446 MERGED/ })).toBeDefined()
  expect(
    await pane.find({
      type: 'Text',
      text: /^21StarkCom\/bifrost: GitHub answered at \d\d:\d\d with an error: gh: Could not resolve to a PullRequest with the number of 447\.$/,
    }),
  ).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Waiting for GitHub:' })).toBeDefined()
})
