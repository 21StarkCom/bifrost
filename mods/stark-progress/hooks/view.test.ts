import { expect, test } from 'claude-code/testing'
import { bar, buildView, dur, row, timeline, track, verdict, worktreeOf } from './view'

const NOW = Date.parse('2026-10-29T12:00:00Z')
const MIN = 60_000
const ago = (min: number) => new Date(NOW - min * MIN).toISOString()
const minute = (min: number) => Math.floor((NOW - min * MIN) / MIN)

const ticket = (id: string, stage: string, updatedMin = 10, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, title: `title ${id}`, stage, pr: null, updated: ago(updatedMin), ...extra })

const beat = (fields: Record<string, unknown>) =>
  JSON.stringify({ id: 'STARK-1', session: 's', updated: ago(0), lastActivity: ago(1), running: null, minutes: [], recent: [], ...fields })

const chars = (cells: { ch: string }[]) => cells.map(c => c.ch).join('')

test('durations read as minutes, then hours and minutes', () => {
  expect(dur(7 * MIN)).toBe('7m')
  expect(dur(125 * MIN)).toBe('2h05m')
  expect(dur(-5)).toBe('0m')
})

test('the track is a station per stage, the current one in its tone', () => {
  expect(chars(track('ticket', false, 'good'))).toBe('◉┄○┄○┄○┄○')
  expect(chars(track('review', true, 'good'))).toBe('●━●━◉┄○┄○')
  expect(chars(track('closed', true, 'good'))).toBe('●━●━●━●━●')
  expect(chars(track('blocked', true, 'bad'))).toBe('●━✕┄○┄○┄○')
  expect(chars(track('blocked', false, 'bad'))).toBe('✕┄○┄○┄○┄○')
  expect(track('review', true, 'bad')[4]).toEqual({ ch: '◉', tone: 'bad' })
  expect(track('review', true, 'good')[0]).toEqual({ ch: '●', tone: 'done' })
  expect(track('closed', true, 'good').every(s => s.tone === 'good')).toBe(true)
})

test('the verdict follows the milestone age, and idle wins over it', () => {
  const t = { title: '', stage: 'ticket' as const, pr: null, updated: NOW - 10 * MIN, hold: null }
  const b = (lastMin: number, running: { tool: string; since: number } | null = null) => ({
    lastActivity: NOW - lastMin * MIN,
    running,
    minutes: new Map(),
    recent: [],
  })
  expect(verdict(null, null, [], NOW).word).toBe('waiting')
  expect(verdict({ ...t, stage: 'closed' }, null, [], NOW).text).toBe('done')
  expect(verdict({ ...t, stage: 'blocked' }, null, [], NOW).text).toBe('blocked 10m')
  expect(verdict(t, null, [NOW - 44 * MIN], NOW).text).toBe('moving')
  expect(verdict(t, null, [NOW - 45 * MIN], NOW).text).toBe('slow 45m')
  expect(verdict(t, null, [NOW - 100 * MIN, NOW - 95 * MIN], NOW)).toEqual({ word: 'stalled', text: 'stalled 1h35m', tone: 'bad' })
  expect(verdict(t, b(14), [NOW - 100 * MIN], NOW).word).toBe('stalled')
  expect(verdict(t, b(15), [NOW - 100 * MIN], NOW)).toEqual({ word: 'idle', text: 'idle 15m', tone: 'warn' })
  expect(verdict(t, b(22, { tool: 'Bash', since: NOW - 22 * MIN }), [NOW], NOW).text).toBe('idle 22m · in Bash')
})

test('a hold reads as held, over idle and stalled, and never over closed or blocked', () => {
  const t = { title: '', stage: 'review' as const, pr: null, updated: NOW - 100 * MIN, hold: 'merge' as const }
  const quiet = { lastActivity: NOW - 30 * MIN, running: null, minutes: new Map(), recent: [] }
  expect(verdict(t, quiet, [NOW - 100 * MIN], NOW)).toEqual({ word: 'held', text: 'held · merge', tone: 'warn' })
  expect(verdict({ ...t, stage: 'closed' }, null, [], NOW).word).toBe('done')
  expect(verdict({ ...t, stage: 'blocked' }, null, [], NOW).word).toBe('blocked')
  // A hold of the wrong type reads as no hold.
  const files = { 'STARK-1.json': ticket('STARK-1', 'merged', 5, { hold: 'lunch' }) }
  expect(row('STARK-1', files, null, NOW).verdict.word).not.toBe('held')
  const held = { 'STARK-1.json': ticket('STARK-1', 'merged', 5, { hold: 'release' }) }
  expect(row('STARK-1', held, null, NOW).verdict.text).toBe('held · release')
})

test('a graph bar is its share of the width, in eighths of a cell, and a count above 0 always shows', () => {
  expect(bar(0, 4, 10)).toBe('')
  expect(bar(4, 4, 10)).toBe('██████████')
  expect(bar(1, 4, 10)).toBe('██▌')
  expect(bar(3, 8, 5)).toBe('█▉')
  expect(bar(1, 74, 10)).toBe('▏')
  expect(bar(1, 1000, 10)).toBe('▏')
})

test('the timeline draws bars, failures, milestones, a long call, quiet and no data', () => {
  const minutes = new Map([
    [minute(1), { at: minute(1), calls: 3, fails: 0 }],
    [minute(6), { at: minute(6), calls: 40, fails: 30 }],
    [minute(11), { at: minute(11), calls: 13, fails: 0 }],
  ])
  const b = { lastActivity: NOW, running: { tool: 'Bash', since: NOW - 27 * MIN }, minutes, recent: [] }
  const cells = timeline(b, [NOW - 52 * MIN], NOW)
  expect(cells).toHaveLength(12)
  // Oldest first: the milestone 52 min ago, the long call from 27 min ago, then the calls.
  expect(chars(cells)).toBe('·◆····───▃▆▁')
  expect(cells[1]).toEqual({ ch: '◆', kind: 'milestone' })
  expect(cells[11]).toEqual({ ch: '▁', kind: 'busy' })
  expect(cells[10]).toEqual({ ch: '▆', kind: 'fail' })
  expect(cells[9]).toEqual({ ch: '▃', kind: 'busy' })
  expect(cells[6]).toEqual({ ch: '─', kind: 'running' })
  expect(cells[3]).toEqual({ ch: '·', kind: 'quiet' })
  expect(chars(timeline(null, [NOW - 2 * MIN], NOW))).toBe(`${' '.repeat(11)}◆`)
})

test('a row tags 5 of the last 10 calls failed and shows the diff', () => {
  const files = {
    'STARK-1.json': ticket('STARK-1', 'ticket', 30),
    'STARK-1.beat.json': beat({ recent: [true, true, false, false, true, false, true, false, true, false, false] }),
  }
  const r = row('STARK-1', files, { commits: [NOW - 5 * MIN], added: 120, removed: 14 }, NOW)
  expect(r.verdict.text).toBe('moving')
  expect(r.failed).toBe(null)
  expect(r.inStage).toBe('30m')
  expect(r.diff).toBe('+120 −14')

  const worse = { ...files, 'STARK-1.beat.json': beat({ recent: [true, true, true, true, true, false, false, false, false, false] }) }
  expect(row('STARK-1', worse, null, NOW).failed).toBe('5/10 failed')
  expect(row('STARK-1', worse, null, NOW).diff).toBe(null)
})

test('a worktree counts only when its folder is named for the ticket', () => {
  const own = ticket('STARK-1', 'pr', 1, { worktree: '/r/.claude/worktrees/STARK-1' })
  const gru = ticket('STARK-1', 'blocked', 1, { worktree: '/r/.claude/worktrees/STARK-10' })
  expect(worktreeOf('STARK-1', own, '/r/.claude/worktrees/STARK-10')).toBe('/r/.claude/worktrees/STARK-1')
  expect(worktreeOf('STARK-1', gru, '/r/.claude/worktrees/STARK-10')).toBe(null)
  expect(worktreeOf('STARK-1', gru, '/c/.worktrees/STARK-1')).toBe('/c/.worktrees/STARK-1')
  expect(worktreeOf('STARK-1', undefined, '/r')).toBe(null)
  // The spine's command run from a subfolder of the worktree still counts.
  const sub = ticket('STARK-1', 'pr', 1, { worktree: '/r/.claude/worktrees/STARK-1/mods/x' })
  expect(worktreeOf('STARK-1', sub, '/r')).toBe('/r/.claude/worktrees/STARK-1')
})

test("a worker's worktree shows its own row, once its file exists", () => {
  const files = { 'STARK-1.json': ticket('STARK-1', 'review'), 'STARK-2.json': ticket('STARK-2', 'pr') }
  const v = buildView('/r/.claude/worktrees/STARK-1', 's', NOW, files, {})
  expect(v?.heading).toBe(null)
  expect(v?.hasLegend).toBe(false)
  expect(v?.rows.map(r => [r.id, r.stage, r.verdict.text])).toEqual([['STARK-1', 'review', 'moving']])
  expect(buildView('/r/.claude/worktrees/STARK-9', 's', NOW, files, {})).toBe(null)
})

test("Gru's tab shows its run with a legend, counting the rows that need a look", () => {
  const files = {
    'run-GRU-1.json': JSON.stringify({ epic: 'STARK-10', session: 'gru', tickets: ['STARK-1', 'STARK-2', 'STARK-3', 'STARK-4'] }),
    'run-GRU-2.json': JSON.stringify({ epic: 'STARK-20', session: 'other', tickets: ['STARK-5'] }),
    'STARK-1.json': ticket('STARK-1', 'closed'),
    'STARK-2.json': ticket('STARK-2', 'ticket', 120),
    'STARK-3.json': ticket('STARK-3', 'blocked', 3),
  }
  const v = buildView('/r/.claude/worktrees/STARK-10', 'gru', NOW, files, {})
  expect(v?.heading).toBe('Gru · STARK-10 · 1/4 closed')
  expect(v?.hasLegend).toBe(true)
  expect(v?.counts).toEqual([
    { label: '1 stalled', tone: 'bad' },
    { label: '1 blocked', tone: 'bad' },
  ])
  expect(v?.rows.map(r => r.verdict.text)).toEqual(['done', 'stalled 2h00m', 'blocked 3m', 'no file yet'])
  expect(buildView('/r', 'nobody', NOW, files, {})).toBe(null)
})

test('a malformed file draws nothing, and fields of the wrong type read as absent', () => {
  expect(buildView('/r', 'gru', NOW, { 'run-x.json': '{' }, {})).toBe(null)
  const files = {
    'run-GRU-1.json': JSON.stringify({ epic: 7, session: 'gru', tickets: ['STARK-1', 'STARK-1', 3] }),
    'STARK-1.json': JSON.stringify({ id: 'STARK-1', title: { x: 1 }, stage: 'nonsense', updated: 5 }),
    'STARK-1.beat.json': '{"minutes": [{"at": "x"}], "recent": [1, true], "running": {"tool": 3}}',
  }
  const v = buildView('/r', 'gru', NOW, files, {})
  expect(v?.heading).toBe('Gru ·  · 0/1 closed')
  expect(v?.rows.map(r => [r.id, r.title, r.stage, r.verdict.text])).toEqual([['STARK-1', '', 'ticket', 'no time yet']])
  expect(chars(v?.rows[0]?.cells ?? [])).toBe('·'.repeat(12))
})
