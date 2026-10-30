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

/**
 * A session over `disk`: its id and root, the files' times, the `.tmp` and
 * `mv` a whole write needs, and the Gru pane placed or not.
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
  on('command.register', () => ({ value: { command: 'gru-board' } }))
  on('session.root', () => ({ value: root }))
  on('session.id', () => ({ value: session }))
  on('ui.open', (_$, e) => {
    seen.opens.push(e.id)
    return { value: seen.isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'the terminal is narrow' } }
  })
  on('ui.panes', () => ({
    value: seen.isPlaced ? [{ id: 'gru-board', title: 'Gru', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
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
  // Counts and elapsed times only: nothing forecasts the time left.
  expect(await pane.find({ type: 'Text', text: /left|ETA|~\d/ })).toBeUndefined()
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

  await $.command.run({
    command: 'gru-board',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
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
  await $.command.run({
    command: 'gru-board',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
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
