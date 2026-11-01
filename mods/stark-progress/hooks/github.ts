import type { GithubCommit, GithubPr, GithubRun, GithubView, Mark } from '../types'

// What the Gru pane's GitHub tab draws: each ticket's PR, its Actions runs
// and its commits, from one `gh api graphql` answer a repo. Pure: register.tsx
// runs `gh` and keeps the answers. Times and durations only, never a forecast.

/** A PR a ticket file names: `https://github.com/<owner>/<repo>/pull/<n>`. */
export type PrRef = { owner: string; repo: string; number: number }

const PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/

/** A ticket file's PR, or null when its `pr` is no GitHub PR URL. */
export function prRefOf(url: unknown): PrRef | null {
  const m = typeof url === 'string' ? PR_URL.exec(url) : null

  return m === null ? null : { owner: m[1] ?? '', repo: m[2] ?? '', number: Number(m[3]) }
}

/** The key of a repo's answer: `owner/repo`. */
export const repoKey = (r: Pick<PrRef, 'owner' | 'repo'>) => `${r.owner}/${r.repo}`

/** The most commits a PR shows; the count says how many it has. */
export const COMMITS_SHOWN = 10

const SUITE = `fragment suite on CheckSuite {
  status conclusion
  workflowRun { runNumber url createdAt updatedAt workflow { name } }
  checkRuns(first: 30) { nodes { name status conclusion startedAt completedAt } }
}`

const PR_FIELDS = `number title state isDraft createdAt mergedAt closedAt additions deletions url
  commits(last: ${COMMITS_SHOWN}) { totalCount nodes { commit { abbreviatedOid messageHeadline authoredDate statusCheckRollup { state } } } }
  head: commits(last: 1) { nodes { commit { checkSuites(first: 20) { nodes { ...suite } } } } }
  mergeCommit { abbreviatedOid checkSuites(first: 20) { nodes { ...suite } } }`

/**
 * One query for all of a repo's PRs, one alias a PR (`p<n>`). The owner and
 * repo come from a URL that PR_URL matched, so they hold no quote.
 */
export function githubQuery(owner: string, repo: string, numbers: readonly number[]): string {
  const prs = [...new Set(numbers)].map(n => `p${n}: pullRequest(number: ${n}) { ${PR_FIELDS} }`).join('\n')

  return `query { repository(owner: "${owner}", name: "${repo}") {\n${prs}\n} }\n${SUITE}`
}

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const list = (v: unknown): unknown[] => (Array.isArray(obj(v).nodes) ? (obj(v).nodes as unknown[]) : [])
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const time = (v: unknown): number | null => {
  const ms = typeof v === 'string' ? Date.parse(v) : Number.NaN

  return Number.isFinite(ms) ? ms : null
}

/** A suite's or a check run's mark: by its status, then, once completed, by its conclusion. */
export function markOf(status: unknown, conclusion: unknown): Mark {
  if (status === 'IN_PROGRESS') return '●'
  if (status !== 'COMPLETED') return '○'
  if (conclusion === 'SUCCESS') return '✓'
  if (conclusion === 'FAILURE' || conclusion === 'TIMED_OUT' || conclusion === 'STARTUP_FAILURE' || conclusion === 'ACTION_REQUIRED') {
    return '✕'
  }

  return '–'
}

/** A commit's mark from its status rollup; none without checks. */
export function rollupMark(state: unknown): Mark | null {
  if (state === 'SUCCESS') return '✓'
  if (state === 'FAILURE' || state === 'ERROR') return '✕'
  if (state === 'PENDING' || state === 'EXPECTED') return '●'

  return null
}

/** The workflow runs of a commit's check suites; a suite of another app, with no workflow run, is not one. */
function runsOf(suites: unknown): GithubRun[] {
  return list(suites).flatMap(raw => {
    const s = obj(raw)
    const run = obj(s.workflowRun)
    const name = str(obj(run.workflow).name)
    const created = time(run.createdAt)
    if (name === null || created === null) return []
    const done = s.status === 'COMPLETED'

    return [
      {
        name,
        number: num(run.runNumber),
        url: str(run.url) ?? '',
        mark: markOf(s.status, s.conclusion),
        started: created,
        ended: done ? (time(run.updatedAt) ?? created) : null,
        jobs: list(s.checkRuns).map(j => {
          const job = obj(j)
          const started = time(job.startedAt)

          return {
            name: str(job.name) ?? '',
            mark: markOf(job.status, job.conclusion),
            started,
            ended: job.status === 'COMPLETED' ? time(job.completedAt) : null,
          }
        }),
      },
    ]
  })
}

/** One PR of a repo's answer, or null when GitHub gave none (a wrong number). */
function prOf(raw: unknown): GithubPr | null {
  const p = obj(raw)
  const created = time(p.createdAt)
  if (typeof p.number !== 'number' || created === null) return null
  const commits: GithubCommit[] = list(p.commits)
    .map(n => obj(obj(n).commit))
    .map(c => ({
      oid: str(c.abbreviatedOid) ?? '',
      headline: str(c.messageHeadline) ?? '',
      at: time(c.authoredDate),
      mark: rollupMark(obj(c.statusCheckRollup).state),
    }))
    .reverse()
  const head = obj(list(p.head)[0]).commit
  const state = p.state === 'MERGED' ? 'MERGED' : p.state === 'CLOSED' ? 'CLOSED' : p.isDraft === true ? 'DRAFT' : 'OPEN'

  return {
    number: p.number,
    title: str(p.title) ?? '',
    url: str(p.url) ?? '',
    state,
    created,
    merged: time(p.mergedAt),
    closed: time(p.closedAt),
    additions: num(p.additions),
    deletions: num(p.deletions),
    commitCount: num(obj(p.commits).totalCount),
    commits,
    runs: runsOf(obj(obj(head).checkSuites)),
    mergeRuns: runsOf(obj(obj(p.mergeCommit).checkSuites)),
  }
}

/** A repo's answer: its PRs by number. A body that is no answer (an error, half a write) gives null. */
export function parseGithub(stdout: string): Map<number, GithubPr> | null {
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    return null
  }
  const repo = obj(obj(obj(value).data).repository)
  if (Object.keys(repo).length === 0) return null
  const prs = new Map<number, GithubPr>()
  for (const raw of Object.values(repo)) {
    const pr = prOf(raw)
    if (pr !== null) prs.set(pr.number, pr)
  }

  return prs
}

/** `45s`, `1m43s`, `1h02m`: a duration to the second under an hour. */
export function secs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`

  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

/** One repo's last good answer, when it came, and its last failure. */
export type RepoAnswer = { at: number | null; prs: Map<number, GithubPr>; error: string | null }

/**
 * The GitHub tab: the run's tickets with a PR in run order, each with its PR
 * from its repo's answer, the tickets with no PR, the counts, and the time of
 * the oldest answer drawn.
 */
export function buildGithub(
  tickets: readonly { id: string; name: string; pr: unknown }[],
  answers: ReadonlyMap<string, RepoAnswer>,
): GithubView {
  const prs: GithubView['prs'] = []
  const noPr: string[] = []
  const waiting: string[] = []
  const times: number[] = []
  const repos = new Set<string>()
  for (const t of tickets) {
    const ref = prRefOf(t.pr)
    if (ref === null) {
      noPr.push(t.id)
      continue
    }
    repos.add(repoKey(ref))
    const answer = answers.get(repoKey(ref))
    const pr = answer?.prs.get(ref.number)
    if (answer?.at != null && pr !== undefined) times.push(answer.at)
    if (pr === undefined) waiting.push(t.id)
    else prs.push({ id: t.id, name: t.name, repo: repoKey(ref), pr })
  }
  const all = prs.map(p => p.pr)
  const runs = all.flatMap(p => p.runs)
  // Only this run's repos: the answers outlive a run, and another run's failure is no line of this one.
  const errors = [...repos].flatMap(k => {
    const error = answers.get(k)?.error
    return error == null ? [] : [error]
  })

  return {
    prs,
    noPr,
    waiting,
    counts: {
      prs: all.length,
      merged: all.filter(p => p.state === 'MERGED').length,
      open: all.filter(p => p.state === 'OPEN').length,
      draft: all.filter(p => p.state === 'DRAFT').length,
      closed: all.filter(p => p.state === 'CLOSED').length,
      passed: runs.filter(r => r.mark === '✓').length,
      failing: runs.filter(r => r.mark === '✕').length,
      running: runs.filter(r => r.mark === '●').length,
    },
    readAt: times.length === 0 ? null : Math.min(...times),
    errors,
  }
}
