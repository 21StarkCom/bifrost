import { expect, test } from 'claude-code/testing'
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

test('a malformed file draws nothing rather than throwing', () => {
  expect(buildView('/r', 'gru', { 'run-x.json': '{' })).toBe(null)
})
