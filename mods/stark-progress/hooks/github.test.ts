import { expect, test } from 'claude-code/testing'

import { buildGithub, githubQuery, markOf, parseGithub, prRefOf, repoKey, rollupMark, secs } from './github'
import type { RepoAnswer } from './github'
import { ANSWER } from './github-fixture'

test('a ticket file names a PR by its GitHub URL, and nothing else is one', () => {
  expect(prRefOf('https://github.com/21StarkCom/bifrost/pull/446')).toEqual({ owner: '21StarkCom', repo: 'bifrost', number: 446 })
  expect(prRefOf('https://github.com/a/b.c/pull/7/files')).toEqual({ owner: 'a', repo: 'b.c', number: 7 })
  expect(prRefOf('https://gitlab.com/a/b/pull/7')).toBe(null)
  expect(prRefOf('https://github.com/a/b"){x}/pull/7')).toBe(null)
  expect(prRefOf(null)).toBe(null)
  expect(repoKey({ owner: 'a', repo: 'b' })).toBe('a/b')
})

test('one query a repo, one alias a PR, each PR once', () => {
  const q = githubQuery('21StarkCom', 'bifrost', [446, 447, 446])
  expect(q).toMatch(/^query \{ repository\(owner: "21StarkCom", name: "bifrost"\) \{/)
  expect(q.match(/p\d+: pullRequest\(number: \d+\)/g)).toEqual(['p446: pullRequest(number: 446)', 'p447: pullRequest(number: 447)'])
  expect(q).toContain('fragment suite on CheckSuite')
})

test('a mark for each status and conclusion GitHub gives, and for each rollup', () => {
  expect(markOf('IN_PROGRESS', null)).toBe('●')
  for (const status of ['QUEUED', 'REQUESTED', 'WAITING', 'PENDING']) expect(markOf(status, null)).toBe('○')
  expect(markOf('COMPLETED', 'SUCCESS')).toBe('✓')
  for (const c of ['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED']) expect(markOf('COMPLETED', c)).toBe('✕')
  for (const c of ['CANCELLED', 'SKIPPED', 'NEUTRAL', 'STALE']) expect(markOf('COMPLETED', c)).toBe('–')
  expect(rollupMark('SUCCESS')).toBe('✓')
  expect(rollupMark('FAILURE')).toBe('✕')
  expect(rollupMark('ERROR')).toBe('✕')
  expect(rollupMark('PENDING')).toBe('●')
  expect(rollupMark('EXPECTED')).toBe('●')
  expect(rollupMark(undefined)).toBe(null)
})

test('a real answer reads as each PR, its runs on the head and the merge commit, and its commits', () => {
  const prs = parseGithub(JSON.stringify(ANSWER))
  if (prs === null) throw new Error('no answer')
  const merged = prs.get(446)
  expect(merged).toMatchObject({ state: 'MERGED', additions: 681, deletions: 120, commitCount: 3 })
  expect(merged?.merged).toBe(Date.parse('2026-11-01T14:17:01Z'))
  // Another app's suites (no workflow run) are not runs.
  expect(merged?.runs.map(r => [r.mark, r.name, r.number])).toEqual([
    ['✓', 'ci', 1278],
    ['✓', 'secret-scan', 580],
  ])
  const ci = merged?.runs[0]
  expect(ci === undefined ? '' : secs((ci.ended ?? 0) - ci.started)).toBe('1m43s')
  expect(ci?.jobs.map(j => j.name)).toEqual(['test', 'actionlint', 'secret scan (tree)', 'typecheck'])
  expect(merged?.mergeRuns.map(r => r.name)).toEqual(['ci', 'secret-scan'])
  // Newest commit first.
  expect(merged?.commits[0]?.headline).toMatch(/^chore\(changelog\)/)
  expect(merged?.commits[0]?.mark).toBe('✓')

  const draft = prs.get(447)
  expect(draft).toMatchObject({ state: 'DRAFT', merged: null, commitCount: 1 })
  expect(draft?.runs.map(r => [r.mark, r.name, r.ended])).toEqual([
    ['●', 'ci', null],
    ['✓', 'secret-scan', Date.parse('2026-11-01T14:41:30Z')],
  ])
  expect(draft?.mergeRuns).toEqual([])
})

test('an answer that is no answer reads as none', () => {
  expect(parseGithub('')).toBe(null)
  expect(parseGithub('{ half')).toBe(null)
  expect(parseGithub(JSON.stringify({ errors: [{ message: 'Bad credentials' }] }))).toBe(null)
  // A PR number GitHub does not know is no PR.
  expect(parseGithub(JSON.stringify({ data: { repository: { p9: null } } }))?.size).toBe(0)
})

test('durations: seconds under a minute, then minutes and seconds, then hours and minutes', () => {
  expect([secs(45_000), secs(103_000), secs(3_720_000), secs(-5)]).toEqual(['45s', '1m43s', '1h02m', '0s'])
})

test("the tab lists each ticket's PR in run order, the ones GitHub has not answered, and the ones with none", () => {
  const prs = parseGithub(JSON.stringify(ANSWER)) ?? new Map()
  const answers = new Map<string, RepoAnswer>([['21StarkCom/bifrost', { at: 1000, prs, error: null }]])
  const view = buildGithub(
    [
      { id: 'STARK-2', name: 'Draft one', pr: 'https://github.com/21StarkCom/bifrost/pull/447' },
      { id: 'STARK-1', name: 'Merged one', pr: 'https://github.com/21StarkCom/bifrost/pull/446' },
      { id: 'STARK-3', name: 'No PR', pr: null },
      { id: 'STARK-4', name: 'Other repo', pr: 'https://github.com/21StarkCom/idun/pull/9' },
    ],
    answers,
  )
  expect(view.prs.map(p => [p.id, p.pr.number])).toEqual([
    ['STARK-2', 447],
    ['STARK-1', 446],
  ])
  expect(view.noPr).toEqual(['STARK-3'])
  expect(view.waiting).toEqual(['STARK-4'])
  // Head-commit runs only: one in progress, none failing; the runs after a merge never count.
  expect(view.counts).toEqual({ prs: 2, merged: 1, open: 0, draft: 1, closed: 0, failing: 0, running: 1 })
  expect(view.readAt).toBe(1000)

  // A repo whose last ask failed keeps its last answer and names the failure.
  const failed = new Map<string, RepoAnswer>([['21StarkCom/bifrost', { at: 1000, prs, error: '21StarkCom/bifrost: GitHub did not answer at 12:05: timed out' }]])
  const kept = buildGithub([{ id: 'STARK-1', name: '', pr: 'https://github.com/21StarkCom/bifrost/pull/446' }], failed)
  expect(kept.prs).toHaveLength(1)
  expect(kept.errors).toEqual(['21StarkCom/bifrost: GitHub did not answer at 12:05: timed out'])
})
