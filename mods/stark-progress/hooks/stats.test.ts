import { expect, test } from 'claude-code/testing'

import {
  addCall,
  addPrompt,
  addReview,
  addStats,
  addUsage,
  bashCounts,
  newStats,
  noteGit,
  noteModel,
  promptKind,
  runStats,
  runStatsName,
  short,
  statsFile,
  statsName,
  statsOf,
  ticketStats,
} from './stats'
import type { Stats } from './stats'

const T0 = Date.parse('2026-10-29T12:00:00Z')
const MIN = 60_000
const usage = (model: string, input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  model,
})
const rowOf = (view: { groups: { rows: { label: string; values: string[] }[] }[] }, label: string) =>
  view.groups.flatMap(g => g.rows).find(r => r.label === label)?.values
const file = (s: Stats, session = 's') => JSON.stringify(statsFile(s, session, T0))

test('a stats file is named for its ticket or its run', () => {
  expect(statsName('STARK-1')).toBe('STARK-1.stats.json')
  expect(runStatsName('GRU-7')).toBe('run-GRU-7.stats.json')
})

test('each model request adds its tokens to the total and to its model, and the main loop names the model and effort', () => {
  const s = newStats()
  addUsage(s, usage('claude-opus-5-5', 10, 20, 300, 40), T0)
  addUsage(s, usage('claude-haiku-5-5', 1, 2, 3, 4), T0 + MIN)
  // A request cut off before its response carries no usage, and counts nothing.
  addUsage(s, null, T0 + 2 * MIN)
  noteModel(s, 'claude-opus-5-5', 'xhigh')
  expect(s.requests).toBe(2)
  expect(s.tokens).toEqual({ input: 11, output: 22, cacheRead: 303, cacheWrite: 44 })
  expect(s.models['claude-haiku-5-5']).toEqual({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, requests: 1 })
  expect(s.since).toBe(T0)
  expect([s.model, s.effort]).toEqual(['claude-opus-5-5', 'xhigh'])
  // A model with no effort setting has none; a number reads as its digits.
  noteModel(s, 'claude-haiku-5-5', undefined)
  expect(s.effort).toBe(null)
  noteModel(s, 'claude-opus-5-5', 32000)
  expect(s.effort).toBe('32000')
})

test("a prompt is the operator's, another session's, or neither, by its origin", () => {
  expect(promptKind('composer', false)).toBe('operator')
  expect(promptKind('bridge', false)).toBe('operator')
  expect(promptKind('slack-ping', false)).toBe('operator')
  // A prompt the person does not see as typed is never theirs.
  expect(promptKind('composer', true)).toBe('other')
  expect(promptKind('peer', false)).toBe('peer')
  expect(promptKind('peer-send-message', true)).toBe('peer')
  expect(promptKind('coordinator', false)).toBe('peer')
  expect(promptKind('projects-relay', false)).toBe('peer')
  expect(promptKind('task-notification', false)).toBe('other')
  expect(promptKind('plugin', false)).toBe('other')
  expect(promptKind('unclassified', false)).toBe('other')
  const s = newStats()
  addPrompt(s, 'composer', false, T0)
  addPrompt(s, 'peer', false, T0)
  addPrompt(s, 'scheduled-trigger', false, T0)
  expect(s.prompts).toEqual({ operator: 1, peer: 1, other: 1 })
})

test('a Bash command counts its messages to other sessions, its worker launches and its Codex reviews', () => {
  expect(bashCounts("hermod msg send --to gru --kind note -- 'done'")).toEqual({ sent: 1, launches: 0, reviews: 0 })
  expect(bashCounts('hermod msg reply -- ok && hermod msg ack')).toEqual({ sent: 1, launches: 0, reviews: 0 })
  expect(bashCounts('cd ~/Code/x && valkyrie minion STARK-1 --json; valkyrie minion STARK-2 --json')).toEqual({
    sent: 0,
    launches: 2,
    reviews: 0,
  })
  expect(bashCounts('valkyrie agnes STARK-3 --new-tab')).toEqual({ sent: 0, launches: 1, reviews: 0 })
  expect(bashCounts('codex review --base main')).toEqual({ sent: 0, launches: 0, reviews: 1 })
  expect(bashCounts('codex exec review --base main -c model_reasoning_effort=high')).toEqual({ sent: 0, launches: 0, reviews: 1 })
  // A `--help` run does nothing, and a word inside another word is not the tool.
  expect(bashCounts('valkyrie minion --help')).toEqual({ sent: 0, launches: 0, reviews: 0 })
  expect(bashCounts('hermod msg peers && myvalkyrie minion x && hermod msg ls')).toEqual({ sent: 0, launches: 0, reviews: 0 })
  // A `-h` in another command of the line does not stop this one.
  expect(bashCounts('valkyrie minion STARK-1 --json; du -h .')).toEqual({ sent: 0, launches: 1, reviews: 0 })
  // A tool named in a quoted string or a here-document is not run.
  expect(bashCounts('git commit -m "docs: launch with valkyrie minion STARK-1; then hermod msg send"')).toEqual({
    sent: 0,
    launches: 0,
    reviews: 0,
  })
  expect(bashCounts("git commit -F - <<'EOF' && valkyrie agnes STARK-4\nvalkyrie minion STARK-1\nEOF\ncodex review")).toEqual({
    sent: 0,
    launches: 1,
    reviews: 1,
  })
})

test('a tool call counts under its tool, and only a call that did not fail counts what it does', () => {
  const s = newStats()
  addCall(s, { tool: 'Bash', command: 'valkyrie minion STARK-1' }, false, T0)
  addCall(s, { tool: 'Bash', command: 'valkyrie minion STARK-2' }, true, T0)
  addCall(s, { tool: 'SendMessage', hasMessage: true }, false, T0)
  // A SendMessage call with only notify_when_idle sends no message.
  addCall(s, { tool: 'SendMessage', hasMessage: false }, false, T0)
  addCall(s, { tool: 'Read' }, false, T0)
  // The model's own review round is a Skill call; a plugin's code-review counts too, another skill does not.
  addCall(s, { tool: 'Skill', skill: 'code-review' }, false, T0)
  addCall(s, { tool: 'Skill', skill: 'review-kit:code-review' }, false, T0)
  addCall(s, { tool: 'Skill', skill: 'code-review' }, true, T0)
  addCall(s, { tool: 'Skill', skill: 'simplify' }, false, T0)
  // And one the operator typed.
  addReview(s, T0)
  expect(s.tools).toEqual({
    Bash: { calls: 2, fails: 1 },
    SendMessage: { calls: 2, fails: 0 },
    Read: { calls: 1, fails: 0 },
    Skill: { calls: 4, fails: 1 },
  })
  expect([s.launches, s.sent, s.reviews]).toEqual([1, 1, 3])
})

test('a worker keeps its last git signal, and a read that failed changes nothing', () => {
  const s = newStats()
  expect(noteGit(s, { commits: [T0, T0 + MIN], added: 40, removed: 3 })).toBe(true)
  expect(noteGit(s, { commits: [T0, T0 + MIN], added: 40, removed: 3 })).toBe(false)
  expect(noteGit(s, null)).toBe(false)
  expect(s.git).toEqual({ added: 40, removed: 3, commits: 2 })
})

test('a stats file reads back whole, and fields of the wrong type read as zero or absent', () => {
  const s = newStats()
  addUsage(s, usage('claude-opus-5-5', 10, 20, 30, 40), T0)
  addCall(s, { tool: 'Bash', command: 'ls' }, true, T0)
  addPrompt(s, 'composer', false, T0)
  noteModel(s, 'claude-opus-5-5', 'high')
  noteGit(s, { commits: [T0], added: 5, removed: 1 })
  expect(statsOf(file(s, 'w1'))).toEqual({ ...s, session: 'w1' })
  expect(statsOf(undefined)).toBe(null)
  expect(statsOf('{ half')).toBe(null)
  expect(statsOf('[1, 2]')).toBe(null)
  const odd = statsOf(
    JSON.stringify({ requests: 'many', tokens: { input: -4, output: 7 }, prompts: 3, tools: { Bash: { calls: '2' } }, model: 9, git: 'yes' }),
  )
  expect(odd?.requests).toBe(0)
  expect(odd?.tokens).toEqual({ input: 0, output: 7, cacheRead: 0, cacheWrite: 0 })
  expect(odd?.prompts).toEqual({ operator: 0, peer: 0, other: 0 })
  expect(odd?.tools).toEqual({ Bash: { calls: 0, fails: 0 } })
  expect(odd?.model).toBe(null)
  // A `git` that is no object is absent, not zero lines.
  expect(odd?.git).toBe(null)
  expect(statsOf(JSON.stringify({ git: { added: 'many', removed: 2 } }))?.git).toEqual({ added: 0, removed: 2, commits: 0 })
  expect(odd?.since).toBe(null)
})

test('a seed adds the counts the file held to the new ones, keeps the earlier start and the newer model', () => {
  const kept = newStats()
  addUsage(kept, usage('claude-opus-5-5', 100, 200), T0 - 60 * MIN)
  addCall(kept, { tool: 'Bash', command: 'ls' }, false, T0 - 60 * MIN)
  noteModel(kept, 'claude-opus-5-5', 'high')
  noteGit(kept, { commits: [T0], added: 9, removed: 2 })
  const fresh = newStats()
  addUsage(fresh, usage('claude-opus-5-5', 1, 2), T0)
  addCall(fresh, { tool: 'Bash', command: 'ls' }, true, T0)
  addCall(fresh, { tool: 'Edit' }, false, T0)
  noteModel(fresh, 'claude-sonnet-5-5', 'medium')
  const both = addStats(kept, fresh)
  expect(both.tokens).toEqual({ input: 101, output: 202, cacheRead: 0, cacheWrite: 0 })
  expect(both.models['claude-opus-5-5']?.requests).toBe(2)
  expect(both.tools).toEqual({ Bash: { calls: 2, fails: 1 }, Edit: { calls: 1, fails: 0 } })
  expect(both.since).toBe(T0 - 60 * MIN)
  expect([both.model, both.effort]).toEqual(['claude-sonnet-5-5', 'medium'])
  // No git read yet in the new session: the kept signal stands.
  expect(both.git).toEqual({ added: 9, removed: 2, commits: 1 })
  // A session with no request yet keeps the model and effort the file held.
  expect([addStats(kept, newStats()).model, addStats(kept, newStats()).effort]).toEqual(['claude-opus-5-5', 'high'])
})

test('a count reads short in a column', () => {
  expect(short(0)).toBe('0')
  expect(short(9999)).toBe('9,999')
  expect(short(12_345)).toBe('12.3k')
  expect(short(40_000)).toBe('40k')
  expect(short(123_456)).toBe('123k')
  expect(short(1_234_567)).toBe('1.2M')
  expect(short(2_500_000_000)).toBe('2.5B')
  // A count that rounds up to the next unit takes it.
  expect(short(999_999)).toBe('1M')
  expect(short(999_600_000)).toBe('1B')
})

test("the ticket pane's stats are its worker's counts, its lines from git, and its PR from the ticket file", () => {
  const s = newStats()
  addUsage(s, usage('claude-opus-5-5', 1200, 3400, 56_000, 7800), T0)
  addCall(s, { tool: 'Bash', command: 'ls' }, false, T0)
  addCall(s, { tool: 'Bash', command: 'false' }, true, T0)
  addCall(s, { tool: 'Read' }, false, T0)
  addReview(s, T0)
  noteModel(s, 'claude-opus-5-5', 'xhigh')
  noteGit(s, { commits: [T0], added: 10, removed: 1 })
  const files = {
    'STARK-1.json': JSON.stringify({ id: 'STARK-1', stage: 'merged', pr: 'https://github.com/o/r/pull/7' }),
    'STARK-1.stats.json': file(s),
  }
  // The live git signal wins over the one the file kept.
  const view = ticketStats(files, 'STARK-1', { commits: [T0, T0], added: 234, removed: 20 })
  expect(view.columns).toEqual([])
  expect(rowOf(view, 'input')).toEqual(['1,200'])
  expect(rowOf(view, 'cache read')).toEqual(['56k'])
  expect(rowOf(view, 'lines added')).toEqual(['+234'])
  expect(rowOf(view, 'lines removed')).toEqual(['−20'])
  expect(rowOf(view, 'commits')).toEqual(['2'])
  expect(rowOf(view, 'PRs opened')).toEqual(['1'])
  expect(rowOf(view, 'PRs merged')).toEqual(['1'])
  expect(rowOf(view, 'review rounds')).toEqual(['1'])
  expect(rowOf(view, 'tools used')).toEqual(['2'])
  expect(rowOf(view, 'tool calls')).toEqual(['3'])
  expect(rowOf(view, 'failed calls')).toEqual(['1'])
  expect(view.tools).toEqual([
    { name: 'Bash', calls: 2, fails: 1 },
    { name: 'Read', calls: 1, fails: 0 },
  ])
  expect(view.sessions).toEqual([{ id: null, words: 'claude-opus-5-5 · xhigh' }])
  expect(view.since).toBe(T0)
  // Once the worktree is gone, the lines and commits the file kept stand.
  expect(rowOf(ticketStats(files, 'STARK-1', null), 'lines added')).toEqual(['+10'])
})

test("the Gru pane's stats are Gru's own column and the whole run's, which adds each ticket's", () => {
  const gru = newStats()
  addUsage(gru, usage('claude-opus-5-5', 100, 200, 3000, 400), T0 - 30 * MIN)
  addCall(gru, { tool: 'Bash', command: 'valkyrie minion STARK-1 --json' }, false, T0)
  addCall(gru, { tool: 'Bash', command: 'valkyrie minion STARK-2 --json' }, false, T0)
  addPrompt(gru, 'composer', false, T0)
  addPrompt(gru, 'peer', false, T0)
  noteModel(gru, 'claude-opus-5-5', 'high')
  const one = newStats()
  addUsage(one, usage('claude-opus-5-5', 10, 20, 300, 40), T0 - 10 * MIN)
  addCall(one, { tool: 'Bash', command: "hermod msg send --to gru -- 'done'" }, false, T0)
  addCall(one, { tool: 'Edit' }, false, T0)
  addReview(one, T0)
  noteModel(one, 'claude-opus-5-5', 'xhigh')
  noteGit(one, { commits: [T0, T0, T0], added: 50, removed: 5 })
  const files: Record<string, string> = {
    'run-STARK-10.stats.json': file(gru, 'gru'),
    'STARK-1.json': JSON.stringify({ id: 'STARK-1', stage: 'closed', pr: 'https://github.com/o/r/pull/1' }),
    'STARK-1.stats.json': file(one, 'w1'),
    // Started on Codex: a ticket file and a PR, with no stats file.
    'STARK-2.json': JSON.stringify({ id: 'STARK-2', stage: 'pr', pr: 'https://github.com/o/r/pull/2' }),
    // Gru stamped it closed with no PR: it counts no merge.
    'STARK-4.json': JSON.stringify({ id: 'STARK-4', stage: 'closed', pr: null }),
  }
  // STARK-3 has not started: it is not missing, it has nothing to count yet.
  const view = runStats(files, 'STARK-10', ['STARK-1', 'STARK-2', 'STARK-3', 'STARK-4'], {
    'STARK-2': { commits: [T0], added: 7, removed: 0 },
  })
  expect(view.columns).toEqual(['Gru', 'Whole run'])
  expect(rowOf(view, 'input')).toEqual(['100', '110'])
  expect(rowOf(view, 'output')).toEqual(['200', '220'])
  expect(rowOf(view, 'cache read')).toEqual(['3,000', '3,300'])
  expect(rowOf(view, 'cache write')).toEqual(['400', '440'])
  expect(rowOf(view, 'model requests')).toEqual(['1', '2'])
  // Gru writes no code: its lines, commits and PRs read `—`.
  expect(rowOf(view, 'lines added')).toEqual(['—', '+57'])
  expect(rowOf(view, 'lines removed')).toEqual(['—', '−5'])
  expect(rowOf(view, 'commits')).toEqual(['—', '4'])
  expect(rowOf(view, 'PRs opened')).toEqual(['—', '2'])
  expect(rowOf(view, 'PRs merged')).toEqual(['—', '1'])
  expect(rowOf(view, 'review rounds')).toEqual(['0', '1'])
  expect(rowOf(view, 'tools used')).toEqual(['1', '2'])
  expect(rowOf(view, 'tool calls')).toEqual(['2', '4'])
  expect(rowOf(view, 'prompts from you')).toEqual(['1', '1'])
  expect(rowOf(view, 'from other sessions')).toEqual(['1', '1'])
  expect(rowOf(view, 'messages sent')).toEqual(['0', '1'])
  expect(rowOf(view, 'workers launched')).toEqual(['2', '2'])
  expect(view.sessions).toEqual([
    { id: null, words: 'claude-opus-5-5 · high' },
    { id: 'STARK-1', words: 'claude-opus-5-5 · xhigh' },
  ])
  expect(view.models).toEqual([{ id: 'claude-opus-5-5', requests: 2, output: 220 }])
  // A started ticket with no stats: a Codex worker's, or one Gru found closed and no worker ran.
  expect(view.missing).toEqual(['STARK-2', 'STARK-4'])
  expect(view.since).toBe(T0 - 30 * MIN)
})

test('a run with no stats file yet has nothing counted and no start', () => {
  const view = runStats({ 'STARK-1.json': JSON.stringify({ id: 'STARK-1', stage: 'ticket' }) }, 'GRU-1', ['STARK-1'], {})
  expect(view.since).toBe(null)
  expect(view.sessions).toEqual([])
  expect(view.missing).toEqual(['STARK-1'])
})
