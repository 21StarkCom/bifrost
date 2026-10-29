import type { EngineInterface } from 'claude-code'

import type { GitSignal } from '../types'

// What git says of a worker's worktree: its commits since the branch base and
// its diff size against that base, committed and not.
const BASES = ['origin/HEAD', 'origin/main', 'main']
const TIMEOUT_MS = 5000

/** `3 files changed, 120 insertions(+), 14 deletions(-)` → added and removed lines. */
export function parseShortstat(text: string): { added: number; removed: number } {
  const added = /(\d+) insertions?\(\+\)/.exec(text)?.[1]
  const removed = /(\d+) deletions?\(-\)/.exec(text)?.[1]

  return { added: Number(added ?? 0), removed: Number(removed ?? 0) }
}

/** The worktree's signal, or null when git cannot read it (gone, not a repo, no base). */
export async function readGit($: EngineInterface, dir: string): Promise<GitSignal | null> {
  const git = (...args: string[]) =>
    $.process.run(['git', '-C', dir, ...args], { timeoutMs: TIMEOUT_MS }).catch(() => null)

  let base = ''
  for (const ref of BASES) {
    const found = await git('merge-base', 'HEAD', ref)
    if (found?.exitCode === 0 && found.stdout.trim() !== '') {
      base = found.stdout.trim()
      break
    }
  }
  if (base === '') return null

  const [log, diff] = await Promise.all([git('log', '--format=%ct', `${base}..HEAD`), git('diff', '--shortstat', base)])
  if (log?.exitCode !== 0 || diff?.exitCode !== 0) return null
  const commits = log.stdout
    .split('\n')
    .map(line => Number(line.trim()) * 1000)
    .filter(ms => Number.isFinite(ms) && ms > 0)

  return { commits, ...parseShortstat(diff.stdout) }
}
