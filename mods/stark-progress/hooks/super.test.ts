import { expect, test } from 'claude-code/testing'

import type { GithubPr } from '../types'
import { parseGithub } from './github'
import type { RepoAnswer } from './github'
import { ANSWER } from './github-fixture'
import { isRunName } from './view'
import { buildSuper, isSuperName, ownSuper, rememberSuper, superLogs, superReads, superSettingsOf } from './super'
import { stateWords } from './super-pane'

const T0 = Date.parse('2026-11-13T12:00:00Z')
const ticket = (id: string, stage: string) =>
  JSON.stringify({ id, title: `title ${id}`, stage, pr: null, updated: new Date(T0).toISOString() })

/** Epic A with 3 of 3 tickets closed; epic B with 1 of 2 closed and 1 blocked. */
const TWO_EPICS: Record<string, string> = {
  'super-SUPER-1.json': JSON.stringify({
    session: 'sg',
    epics: ['STARK-1', 'STARK-2'],
    grus: {
      'STARK-1': { launch: 'STARK-1', session: 'gru-a-session', state: 'reported' },
      'STARK-2': { launch: 'STARK-2', session: 'gru-b-session', state: 'live' },
    },
    settings: { maxWorkers: 4, parallel: 1, minionAgent: 'claude', followUps: true, decideForMe: true },
  }),
  'run-STARK-1.json': JSON.stringify({ epic: 'STARK-1', session: 'gru-a-session', tickets: ['STARK-11', 'STARK-12', 'STARK-13'] }),
  'run-STARK-2.json': JSON.stringify({ epic: 'STARK-2', session: 'gru-b-session', tickets: ['STARK-21', 'STARK-22'] }),
  'STARK-11.json': ticket('STARK-11', 'closed'),
  'STARK-12.json': ticket('STARK-12', 'closed'),
  'STARK-13.json': ticket('STARK-13', 'closed'),
  'STARK-21.json': ticket('STARK-21', 'closed'),
  'STARK-22.json': ticket('STARK-22', 'blocked'),
  'STARK-22.log.jsonl': `${JSON.stringify({ at: new Date(T0).toISOString(), text: 'Stopped: the job needs a change in another project first.' })}\n`,
}

test('a super file is neither a run file nor its own settings, stats or log file', () => {
  expect(isSuperName('super-SUPER-1.json')).toBe(true)
  expect(isSuperName('super-SUPER-1.settings.json')).toBe(false)
  expect(isSuperName('super-SUPER-1.stats.json')).toBe(false)
  expect(isSuperName('super-SUPER-1.log.jsonl')).toBe(false)
  expect(isRunName('super-SUPER-1.json')).toBe(false)
  expect(ownSuper('sg', TWO_EPICS)).toBe('super-SUPER-1.json')
  expect(ownSuper('other', TWO_EPICS)).toBeNull()
})

test('two epics: A reads done 3/3, B reads blocked 1/2, and its blocked ticket is worth a look', () => {
  const b = buildSuper('super-SUPER-1.json', TWO_EPICS, new Map([['STARK-2', 'epic B']]), T0)
  expect(b?.rows.map(stateWords)).toEqual(['done 3/3', 'blocked 1/2'])
  expect(b?.rows.map(r => [r.blocked, r.title])).toEqual([[0, null], [1, 'Epic B']])
  expect(b?.looks).toEqual([
    { epic: 'STARK-2', id: 'STARK-22', waits: 'Stopped: the job needs a change in another project first.' },
  ])
})

test('a queued epic waits; an ended Gru whose run file is gone reads done with no count; a live Gru with no run file is in work', () => {
  const files = {
    'super-SUPER-5.json': JSON.stringify({
      session: 'sg',
      epics: ['STARK-5', 'STARK-6', 'STARK-18456'],
      grus: {
        'STARK-5': { launch: 'STARK-5', session: 'x', state: 'ended' },
        'STARK-6': { launch: null, session: null, state: 'queued' },
        'STARK-18456': { launch: 'STARK-18456', session: null, state: 'live' },
      },
    }),
  }
  const b = buildSuper('super-SUPER-5.json', files, new Map(), T0)
  expect(b?.rows.map(stateWords)).toEqual(['done', 'waiting', 'in work'])
  expect(b?.rows.map(r => [r.gruState, r.total])).toEqual([['ended', null], ['queued', null], ['live', null]])
  expect(b?.looks).toEqual([])
})

test("an epic's title loses its `EPIC:`, `[tag]` and `repo: ` leads, as the Gru pane names its epic", () => {
  const titles = new Map([
    ['STARK-1', 'lumiere: cutouts that work on any subject'],
    ['STARK-2', 'EPIC: [infra] lumiere video and audio'],
  ])
  expect(buildSuper('super-SUPER-1.json', TWO_EPICS, titles, T0)?.rows.map(r => r.title)).toEqual([
    'Cutouts that work on any subject',
    'Lumiere video and audio',
  ])
})

const line = (minutesAgo: number, text: string) => `${JSON.stringify({ at: new Date(T0 - minutesAgo * 60_000).toISOString(), text })}\n`

test("the Log tab merges Super-Gru's own steps and each Gru's, newest first, and keeps a Gru's steps once its log is gone", () => {
  const files: Record<string, string> = {
    ...TWO_EPICS,
    'super-SUPER-1.log.jsonl': line(50, 'Started the Gru for the export work.') + line(5, 'The Gru for the export work finished.'),
    'run-STARK-1.log.jsonl': line(40, 'Sent a helper to add the export command.') + line(10, 'Checked the export command is really done.'),
    'run-STARK-2.log.jsonl': line(20, 'Sent a helper to cache the index.'),
  }
  const titles = new Map([['STARK-1', 'bifrost: export the reading list']])
  const steps = (b: ReturnType<typeof buildSuper>) =>
    b?.log.days.flatMap(d => d.entries.map(e => [e.who, e.id, e.isRun, e.text])) ?? []
  expect(steps(buildSuper('super-SUPER-1.json', files, titles, T0))).toEqual([
    ['Super-Gru', null, true, 'The Gru for the export work finished.'],
    ['Export the reading list', 'STARK-1', false, 'Checked the export command is really done.'],
    ['', 'STARK-2', false, 'Sent a helper to cache the index.'],
    ['Export the reading list', 'STARK-1', false, 'Sent a helper to add the export command.'],
    ['Super-Gru', null, true, 'Started the Gru for the export work.'],
  ])
  expect(superReads('super-SUPER-1.json', files)).toEqual(
    expect.arrayContaining(['super-SUPER-1.log.jsonl', 'run-STARK-1.log.jsonl', 'run-STARK-2.log.jsonl']),
  )

  // STARK-1's Gru ends: it deletes its run file and its log. The tab kept the log's lines.
  const memory = rememberSuper('super-SUPER-1.json', files, null)
  expect(memory?.epics['STARK-1']?.log).toBe(files['run-STARK-1.log.jsonl'])
  const gone: Record<string, string> = { ...files }
  delete gone['run-STARK-1.json']
  delete gone['run-STARK-1.log.jsonl']
  expect(rememberSuper('super-SUPER-1.json', gone, memory)).toEqual(memory)
  expect(steps(buildSuper('super-SUPER-1.json', gone, titles, T0, new Map(), memory))).toHaveLength(5)
  // Memory a build before 0.23.0 kept has no log: the epic still keeps its tickets.
  const old = { launchId: 'SUPER-1', epics: { 'STARK-1': { tickets: ['STARK-11'], titles: {}, gruStats: null } } }
  expect(steps(buildSuper('super-SUPER-1.json', gone, titles, T0, new Map(), old))).toHaveLength(3)
})

test('the tab keeps only the newest 50 lines of a Gru log', () => {
  const long = Array.from({ length: 60 }, (_, i) => line(60 - i, `Step ${i + 1}.`)).join('')
  const memory = rememberSuper('super-SUPER-1.json', { ...TWO_EPICS, 'run-STARK-1.log.jsonl': long }, null)
  const kept = (memory?.epics['STARK-1']?.log ?? '').trim().split('\n')
  expect(kept).toHaveLength(50)
  expect(JSON.parse(kept[0] ?? '{}').text).toBe('Step 11.')
})

test("settings take the settings file's value, else the run file's, else the default; a wrong type reads as absent", () => {
  const run = { settings: { maxWorkers: 2, parallel: 3, followUps: false } }
  expect(superSettingsOf(run, JSON.stringify({ maxWorkers: 5, decideForMe: false, parallel: 'two' }))).toEqual({
    maxWorkers: 5,
    parallel: 3,
    followUps: false,
    decideForMe: false,
  })
  expect(superSettingsOf(null, undefined)).toEqual({ maxWorkers: 4, parallel: 1, followUps: true, decideForMe: true })
})

test("a launch above the pane's range keeps its count; the settings file stays 1 to 8", () => {
  const run = { settings: { maxWorkers: 12, parallel: 10 } }
  expect(superSettingsOf(run, undefined)).toMatchObject({ maxWorkers: 12, parallel: 10 })
  expect(superSettingsOf(run, JSON.stringify({ parallel: 9, maxWorkers: 0 }))).toMatchObject({ maxWorkers: 12, parallel: 10 })
})

test("a super board reads its settings, stats and log files, each Gru's stats and log, each ticket's file and stats, then its blocked tickets' logs", () => {
  expect(superReads('super-SUPER-1.json', TWO_EPICS)).toEqual([
    'super-SUPER-1.settings.json',
    'super-SUPER-1.stats.json',
    'super-SUPER-1.log.jsonl',
    'run-STARK-1.stats.json',
    'run-STARK-1.log.jsonl',
    'run-STARK-2.stats.json',
    'run-STARK-2.log.jsonl',
    ...['STARK-11', 'STARK-12', 'STARK-13', 'STARK-21', 'STARK-22'].flatMap(id => [`${id}.json`, `${id}.stats.json`]),
  ])
  expect(superLogs('super-SUPER-1.json', TWO_EPICS)).toEqual(['STARK-22.log.jsonl'])
})

/** A stats file with these counts: `busy` minutes working, `out` output tokens, `bash` Bash calls, and a git signal. */
const stats = (session: string, o: { busy?: number; out?: number; bash?: number; git?: [number, number, number] | null; model?: string; effort?: string }) =>
  JSON.stringify({
    session,
    since: new Date(T0 - 60 * 60_000).toISOString(),
    updated: new Date(T0).toISOString(),
    model: o.model ?? 'claude-opus-5-5',
    effort: o.effort ?? 'xhigh',
    requests: 2,
    tokens: { input: 10, output: o.out ?? 0, cacheRead: 0, cacheWrite: 0 },
    models: { [o.model ?? 'claude-opus-5-5']: { input: 10, output: o.out ?? 0, cacheRead: 0, cacheWrite: 0, requests: 2 } },
    prompts: { operator: 0, peer: 1, other: 0 },
    sent: 1,
    launches: 0,
    reviews: 0,
    tools: { Bash: { calls: o.bash ?? 0, fails: 0 } },
    git: o.git === undefined || o.git === null ? null : { added: o.git[0], removed: o.git[1], commits: o.git[2] },
    openMs: (o.busy ?? 0) * 2 * 60_000,
    busyMs: (o.busy ?? 0) * 60_000,
  })

const WITH_STATS: Record<string, string> = {
  ...TWO_EPICS,
  'super-SUPER-1.stats.json': stats('sg', { busy: 5, out: 100, bash: 3, model: 'claude-opus-5-5', effort: 'high' }),
  'run-STARK-1.stats.json': stats('gru-a-session', { busy: 10, out: 1000, bash: 7 }),
  'STARK-11.json': ticket('STARK-11', 'closed').replace('"pr":null', '"pr":"https://github.com/21StarkCom/bifrost/pull/446"'),
  'STARK-11.stats.json': stats('w11', { busy: 30, out: 20_000, bash: 40, git: [120, 20, 2] }),
  'STARK-21.stats.json': stats('w21', { busy: 20, out: 5000, bash: 10, git: [30, 0, 1], effort: 'high' }),
}

test('Mega stats: four columns, a row for each epic, each Gru and each pair of worker model and effort, and the tickets with no stats', () => {
  const b = buildSuper('super-SUPER-1.json', WITH_STATS, new Map(), T0)
  if (b === null) throw new Error('no board')
  expect(b.stats.columns).toEqual(['Super-Gru', 'Grus', 'Workers', 'Whole run'])
  const row = (label: string) => b.stats.groups.flatMap(g => g.rows).find(r => r.label === label)?.values
  expect(row('working time')).toEqual(['5m', '10m', '50m', '1h05m'])
  expect(row('output')).toEqual(['100', '1,000', '25k', '26.1k'])
  expect(row('tool calls')).toEqual(['3', '7', '50', '60'])
  // Only workers write code: Super-Gru's and the Grus' lines read `—`.
  expect(row('lines added')).toEqual(['—', '—', '+150', '+150'])
  expect(row('PRs opened')).toEqual(['—', '—', '1', '1'])
  expect(row('PRs merged')).toEqual(['—', '—', '1', '1'])
  expect(b.stats.sessions.map(s => [s.who, s.words])).toEqual([
    ['Super-Gru', 'claude-opus-5-5 · high'],
    ['Gru STARK-1', 'claude-opus-5-5 · xhigh'],
    ['1 worker', 'claude-opus-5-5 · high'],
    ['1 worker', 'claude-opus-5-5 · xhigh'],
  ])
  expect(b.stats.missing).toEqual(['STARK-12', 'STARK-13', 'STARK-22'])
  expect(b.epicStats).toEqual([
    { epic: 'STARK-1', done: 3, total: 3, busyMs: 40 * 60_000, output: 21_000, calls: 47, added: 120, removed: 20, prs: 1, merged: 1 },
    { epic: 'STARK-2', done: 1, total: 2, busyMs: 20 * 60_000, output: 5000, calls: 10, added: 30, removed: 0, prs: 0, merged: 0 },
  ])
})

test("an ended Gru's epic keeps its tickets, their titles and its Gru's counts once its files are gone", () => {
  const live: Record<string, string> = { ...WITH_STATS, 'run-STARK-1.json': JSON.stringify({ epic: 'STARK-1', session: 'gru-a-session', tickets: ['STARK-11', 'STARK-12', 'STARK-13'], titles: { 'STARK-12': 'bifrost: a ticket with no file of its own' } }) }
  const memory = rememberSuper('super-SUPER-1.json', live, null)
  expect(memory?.epics['STARK-1']?.tickets).toEqual(['STARK-11', 'STARK-12', 'STARK-13'])
  expect(memory?.epics['STARK-1']?.titles).toEqual({ 'STARK-12': 'bifrost: a ticket with no file of its own' })
  expect(memory?.epics['STARK-1']?.gruStats).toBe(live['run-STARK-1.stats.json'])

  // The Gru deletes its run file, and its tab's mod its stats file; STARK-12's own file goes too.
  const gone: Record<string, string> = { ...live }
  delete gone['run-STARK-1.json']
  delete gone['run-STARK-1.stats.json']
  delete gone['STARK-12.json']
  // A poll with the files gone keeps what it had.
  expect(rememberSuper('super-SUPER-1.json', gone, memory)).toEqual(memory)
  const ended = buildSuper('super-SUPER-1.json', gone, new Map(), T0, new Map(), memory)
  expect(ended?.rows.map(stateWords)).toEqual(['done 2/3', 'blocked 1/2'])
  expect(ended?.epicStats[0]).toMatchObject({ epic: 'STARK-1', busyMs: 40 * 60_000, calls: 47 })
  expect(ended?.stats.sessions.map(s => s.who)).toContain('Gru STARK-1')
  expect(superReads('super-SUPER-1.json', gone, memory?.epics)).toContain('STARK-13.json')
  // A later run with this launch id, its Gru queued again: what was kept is the earlier run's, so the epic waits.
  const again: Record<string, string> = {
    ...gone,
    'super-SUPER-1.json': (gone['super-SUPER-1.json'] ?? '').replace('"state":"reported"', '"state":"queued"'),
  }
  expect(buildSuper('super-SUPER-1.json', again, new Map(), T0, new Map(), memory)?.rows.map(stateWords)).toEqual(['waiting', 'blocked 1/2'])
  expect(rememberSuper('super-SUPER-1.json', again, memory)?.epics['STARK-1']).toBeUndefined()
  // Without the memory, the ended epic has no count, as before.
  expect(buildSuper('super-SUPER-1.json', gone, new Map(), T0)?.rows.map(stateWords)).toEqual(['done', 'blocked 1/2'])
  // Another run's memory is not this run's.
  expect(rememberSuper('super-SUPER-1.json', gone, { launchId: 'SUPER-9', epics: memory?.epics ?? {} })?.epics).toEqual({
    'STARK-2': { tickets: ['STARK-21', 'STARK-22'], titles: {}, gruStats: null },
  })
})

/** Each repo's answer, from the real fixture, with #447's `ci` run failed when `failed` is set. */
function answers(failed: boolean): Map<string, RepoAnswer> {
  const prs = parseGithub(JSON.stringify(ANSWER)) ?? new Map<number, GithubPr>()
  const draft = prs.get(447)
  if (failed && draft !== undefined) {
    prs.set(447, { ...draft, runs: draft.runs.map(r => (r.name === 'ci' ? { ...r, mark: '✕' as const, ended: r.started + 90_000 } : r)) })
  }

  return new Map([['21StarkCom/bifrost', { at: T0, prs, error: null }]])
}

const WITH_PRS: Record<string, string> = {
  ...TWO_EPICS,
  'STARK-11.json': ticket('STARK-11', 'closed').replace('"pr":null', '"pr":"https://github.com/21StarkCom/bifrost/pull/446"'),
  'STARK-22.json': ticket('STARK-22', 'review').replace('"pr":null', '"pr":"https://github.com/21StarkCom/bifrost/pull/447"'),
}

test("GitHub: all PRs of all epics, each epic's by state and size, and the newest events first", () => {
  const g = buildSuper('super-SUPER-1.json', WITH_PRS, new Map(), T0, answers(false))?.github
  if (g === undefined) throw new Error('no board')
  expect(g.view.counts).toMatchObject({ prs: 2, merged: 1, draft: 1 })
  expect(g.view.prs.map(p => [p.id, p.name, p.pr.number])).toEqual([
    ['STARK-11', 'Title STARK-11', 446],
    ['STARK-22', 'Title STARK-22', 447],
  ])
  expect(g.epics.map(e => [e.epic, e.ids, e.merged, e.draft, e.added, e.failing])).toEqual([
    ['STARK-1', ['STARK-11'], 1, 0, 681, 0],
    ['STARK-2', ['STARK-22'], 0, 1, g.epics[1]?.added, 0],
  ])
  expect(g.view.noPr).toEqual(['STARK-12', 'STARK-13', 'STARK-21'])
  expect(g.failing).toEqual([])
  expect(g.added).toBe(g.view.prs.reduce((n, p) => n + p.pr.additions, 0))
  // Newest first; a running run is an event from its start; a merged PR names its merge.
  const at = g.activity.map(e => e.at)
  expect(at).toEqual([...at].sort((a, b) => b - a))
  expect(g.activity.some(e => e.kind === 'merged' && e.head === 'PR #446' && e.id === 'STARK-11')).toBe(true)
  expect(g.activity.some(e => e.kind === 'run' && e.mark === '●' && e.tail === 'started' && e.id === 'STARK-22')).toBe(true)
  expect(g.activity.find(e => e.kind === 'run' && e.head === 'ci #1278')?.tail).toBe('passed · 1m43s')
  expect(g.activity.length).toBeLessThanOrEqual(15)
})

test('GitHub: an open or draft PR with a failed head run is in the failing box, and its epic counts it', () => {
  const g = buildSuper('super-SUPER-1.json', WITH_PRS, new Map(), T0, answers(true))?.github
  expect(g?.failing.map(f => [f.id, f.number, f.runs])).toEqual([['STARK-22', 447, [expect.stringMatching(/^ci #\d+$/)]]])
  expect(g?.epics.map(e => e.failing)).toEqual([0, 1])
})

test('a ticket two epics list counts once, and an ended Gru that left a blocked ticket leaves its epic blocked', () => {
  const files: Record<string, string> = {
    ...TWO_EPICS,
    'run-STARK-2.json': JSON.stringify({ epic: 'STARK-2', session: 'gru-b-session', tickets: ['STARK-21', 'STARK-22', 'STARK-11'] }),
  }
  expect(buildSuper('super-SUPER-1.json', files, new Map(), T0)?.tickets).toBe(5)

  const memory = rememberSuper('super-SUPER-1.json', files, null)
  const gone: Record<string, string> = { ...files }
  delete gone['run-STARK-2.json']
  gone['super-SUPER-1.json'] = (gone['super-SUPER-1.json'] ?? '').replace('"state":"live"', '"state":"ended"')
  expect(buildSuper('super-SUPER-1.json', gone, new Map(), T0, new Map(), memory)?.rows.map(stateWords)).toEqual(['done 3/3', 'blocked 2/3'])
})
