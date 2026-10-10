import { expect, mock, test } from 'claude-code/testing'
import { bar, buildView } from './register'

const ticket = (id: string, stage: string) =>
  JSON.stringify({ id, title: `title ${id}`, stage, pr: null, updated: '2026-10-10T00:00:00Z' })

test('bar fills by stage and draws blocked empty', () => {
  expect(bar('ticket')).toBe('████' + '░'.repeat(16))
  expect(bar('closed')).toBe('█'.repeat(20))
  expect(bar('blocked')).toBe('░'.repeat(20))
})

test("a worker's worktree shows its own ticket", () => {
  const files = { 'STARK-1.json': ticket('STARK-1', 'review'), 'STARK-2.json': ticket('STARK-2', 'pr') }
  expect(buildView('/r/.claude/worktrees/STARK-1', 's', files)).toEqual({
    heading: null,
    rows: [{ id: 'STARK-1', title: 'title STARK-1', stage: 'review' }],
  })
  expect(buildView('/r/.claude/worktrees/STARK-9', 's', files)).toBe(null)
})

test("Gru's tab shows its own run, defaulting a ticket with no file to `ticket`", () => {
  const files = {
    'run-GRU-1.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-2'] }),
    'run-GRU-2.json': JSON.stringify({ epic: 'STARK-20', session: 'other', tickets: ['STARK-3'] }),
    'STARK-1.json': ticket('STARK-1', 'closed'),
  }
  expect(buildView('/r', 'gru', files)).toEqual({
    heading: 'Gru · STARK-10 · 1/2 closed',
    rows: [
      { id: 'STARK-1', title: 'title STARK-1', stage: 'closed' },
      { id: 'STARK-2', title: '', stage: 'ticket' },
    ],
  })
  expect(buildView('/r', 'nobody', files)).toBe(null)
})

test("Gru launched on an epic stands in a worktree named for it and still shows its run", () => {
  const files = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1'] }),
    'STARK-1.json': ticket('STARK-1', 'pr'),
  }
  expect(buildView('/r/.claude/worktrees/STARK-10', 'gru', files)).toEqual({
    heading: 'Gru · STARK-10 · 0/1 closed',
    rows: [{ id: 'STARK-1', title: 'title STARK-1', stage: 'pr' }],
  })
})

test('a malformed file draws nothing rather than throwing', () => {
  expect(buildView('/r', 'gru', { 'run-x.json': '{' })).toBe(null)
})

test('fields of the wrong type read as absent, and a ticket listed twice draws once', () => {
  const files = {
    'run-GRU-1.json': JSON.stringify({ epic: 7, session: 'gru', tickets: ['STARK-1', 'STARK-1', 3] }),
    'STARK-1.json': JSON.stringify({ id: 'STARK-1', title: { x: 1 }, stage: 3 }),
  }
  expect(buildView('/r', 'gru', files)).toEqual({
    heading: 'Gru ·  · 0/1 closed',
    rows: [{ id: 'STARK-1', title: '', stage: 'ticket' }],
  })
})

test("the poller publishes the tab's view from the run file and only the tickets it lists", async ($, on) => {
  const dir = '/h/.cache/stark-progress'
  const disk: Record<string, string> = {
    'run-STARK-10.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1'] }),
    'STARK-1.json': ticket('STARK-1', 'review'),
    'STARK-2.json': ticket('STARK-2', 'closed'),
  }
  const reads: string[] = []
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/r/.claude/worktrees/STARK-10' }))
  on('session.id', () => ({ value: 'gru' }))
  on('fs.list', () => ({
    value: Object.keys(disk).map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_$, e) => {
    reads.push(e.path)
    const text = disk[e.path.slice(dir.length + 1)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })

  await $.session.start({ cwd: '/r/.claude/worktrees/STARK-10', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const band = await $.ui.mount({
    plugin: 'stark-progress',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
  })
  expect(await band.find({ type: 'Text', text: 'Gru · STARK-10 · 0/1 closed' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /STARK-1 +review/ })).toBeDefined()
  expect([...reads].sort()).toEqual([`${dir}/STARK-1.json`, `${dir}/run-STARK-10.json`])
})
