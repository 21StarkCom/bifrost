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

test("Gru's tab draws its run, the legend and only the tickets it lists", async ($, on) => {
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-13631'] }),
    'STARK-1.json': ticket('STARK-1', 'review'),
    'STARK-2.json': ticket('STARK-2', 'closed'),
    'STARK-13631.json': ticket('STARK-13631', 'pr'),
  }
  const reads: string[] = []
  const runs: string[][] = []
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: T0 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/r/.claude/worktrees/STARK-10' }))
  on('session.id', () => ({ value: 'gru' }))
  on('fs.list', () => ({
    value: Object.keys(disk).map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_$, e) => {
    reads.push(e.path)
    const text = disk[nameOf(e.path)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: 'Gru · STARK-10 · 0/2 closed' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /◆ milestone/ })).toBeDefined()
  // Ids pad to the longest, with a space before the track.
  expect(await band.find({ type: 'Text', text: /^STARK-1 {5}●━●━◉┄○┄○ review +10m/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^STARK-13631 ●━◉┄○┄○┄○ pr +10m/ })).toBeDefined()
  expect([...reads].sort()).toEqual([`${DIR}/STARK-1.json`, `${DIR}/STARK-13631.json`, `${DIR}/run-STARK-10.json`])
  // No worktree is named for these tickets here, so git never runs.
  expect(runs).toEqual([])
})

test("a worker's tab writes its heartbeat, reads git, draws its row, and drops the heartbeat with its ticket file", async ($, on) => {
  const worktree = '/r/.claude/worktrees/STARK-1'
  const disk: Record<string, string> = { 'STARK-1.json': ticket('STARK-1', 'ticket', { worktree }) }
  const writes: Record<string, string> = {}
  const runs: string[][] = []
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: T0 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
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
