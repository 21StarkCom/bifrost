import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cell, GitSignal, Row, Seg, Tone } from '../types'
import { beatFile, callEnded, callStarted, newBeat, seedBeat } from './beat'
import { readGit } from './git'
import { buildView, isRunName, ownRun, ticketOf, worktreeOf } from './view'

// The state contract is in ../README.md.
const POLL_MS = 1000
const GIT_MS = 30_000
const BEAT_MS = 5000

const view = atom({ plugin: 'stark-progress', key: 'view' } as const, null, { shape: 'view-2' })

// A worker's own tab keeps its heartbeat here; a reload starts it over and
// seeds it from the file this session wrote.
let beat = newBeat()
let isWorker = false
let isSeeded = false
let isDirty = false
let lastFlush = 0
let calls = 0
const gitCache = new Map<string, { at: number; signal: GitSignal | null }>()

/** Git's signal for a worktree, read at most once per GIT_MS. */
async function gitFor($: EngineInterface, dir: string, now: number): Promise<GitSignal | null> {
  const hit = gitCache.get(dir)
  if (hit !== undefined && now - hit.at < GIT_MS) return hit.signal
  const signal = await readGit($, dir)
  gitCache.set(dir, { at: now, signal })

  return signal
}

/** Whole JSON, written to a `.tmp` beside it and renamed over it, as the contract asks. */
async function writeWhole($: EngineInterface, path: string, text: string): Promise<void> {
  await $.fs.write(`${path}.tmp`, text)
  await $.process.run(['mv', '-f', `${path}.tmp`, path])
}

const paint = (tone: Tone) =>
  tone === 'good' ? 'success' : tone === 'warn' ? 'warning' : tone === 'bad' ? 'error' : 'subtle'

const segColor = (s: Seg) => (s.tone === 'done' ? 'suggestion' : s.tone === 'todo' ? 'subtle' : paint(s.tone))

const cellColor = (c: Cell) =>
  c.kind === 'milestone' ? 'success' : c.kind === 'fail' ? 'error' : c.kind === 'busy' ? 'text' : 'subtle'

/** The plain width of a row's verdict part, so the titles line up. */
const tailWidth = (r: Row) =>
  r.verdict.text.length + (r.failed === null ? 0 : r.failed.length + 3) + (r.diff === null ? 0 : r.diff.length + 3)

export const register: Register = on => {
  let last = ''
  let isPolling = false

  on('session.start', async ($, e, next) => {
    const home = await $.env.get('HOME')
    if (!home) return next(e)
    const dir = `${home}/.cache/stark-progress`

    $.clock.every(POLL_MS, async () => {
      // A slow tick must not overlap the next one and write an older view last.
      if (isPolling) return
      isPolling = true
      try {
        const now = await $.clock.now()
        const listed = await $.fs.list(dir).catch(() => [])
        const names = new Set(listed.filter(f => f.kind === 'file' && f.name.endsWith('.json')).map(f => f.name))
        const files: Record<string, string> = {}
        const load = async (name: string) => {
          if (!names.has(name)) return
          const text = await $.fs.read(`${dir}/${name}`).catch(() => undefined)
          if (typeof text === 'string') files[name] = text
        }

        // The run files first; then only the files this tab draws, so a
        // directory of old tickets costs a listing, not a read of each.
        const [root, session] = await Promise.all([$.session.root(), $.session.id()])
        await Promise.all([...names].filter(isRunName).map(load))
        const run = ownRun(session, files)
        const own = run === null ? ticketOf(root) : null
        isWorker = own !== null
        const wanted = run !== null ? run.tickets : own === null ? [] : [own]
        await Promise.all(wanted.flatMap(id => [load(`${id}.json`), load(`${id}.beat.json`)]))

        // A worker's own tab writes its heartbeat while its ticket's file
        // exists, draws its own row from memory, and removes the heartbeat
        // once the file is gone (Agnes deletes it at stand-down).
        if (own !== null) {
          const name = `${own}.beat.json`
          if (!isSeeded) {
            isSeeded = true
            seedBeat(beat, files[name], session)
          }
          if (files[`${own}.json`] !== undefined) {
            const text = JSON.stringify(beatFile(beat, own, session, now))
            files[name] = text
            if (isDirty && now - lastFlush >= BEAT_MS) {
              isDirty = false
              lastFlush = now
              await writeWhole($, `${dir}/${name}`, text).catch(() => undefined)
            }
          } else if (names.has(name)) {
            await $.process.run(['rm', '-f', `${dir}/${name}`]).catch(() => undefined)
          }
        }

        const git: Record<string, GitSignal | null> = {}
        await Promise.all(
          wanted.map(async id => {
            const worktree = worktreeOf(id, files[`${id}.json`], root)
            git[id] = worktree === null ? null : await gitFor($, worktree, now)
          }),
        )

        const fresh = buildView(root, session, now, files, git)
        const key = JSON.stringify(fresh)
        if (key === last) return
        last = key
        await update($, view, () => fresh)
      } finally {
        isPolling = false
      }
    })

    return next(e)
  })

  // The heartbeat: each tool call's start and end, subagents' included, in a
  // worker's own tab only.
  on('tool.call', async ($, e, next) => {
    if (!isWorker) return next(e)
    calls += 1
    const key = e.tool_use_id ?? `call-${calls}`
    callStarted(beat, key, e.tool, await $.clock.now())
    isDirty = true
    try {
      const result = await next(e)
      callEnded(beat, key, result.isError === true, await $.clock.now())

      return result
    } catch (err) {
      callEnded(beat, key, true, await $.clock.now())
      throw err
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, view)
    if (e.props.hasSurvey || current === null || current.rows.length === 0) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(...current.rows.map(tailWidth)) + 2
    const idWidth = Math.max(...current.rows.map(r => r.id.length)) + 1

    return (
      <Box flexDirection="column">
        {current.heading === null ? null : (
          <Text wrap="truncate-end">
            <Text bold>{current.heading}</Text>
            {current.counts.map(c => (
              <Text key={c.label} color={paint(c.tone)}>{` · ${c.label}`}</Text>
            ))}
          </Text>
        )}
        {current.hasLegend ? (
          <Text dimColor wrap="truncate-end">
            <Text color="success">◆</Text>
            {' milestone   ▃ tool calls per 5 min   '}
            <Text color="error">▃</Text>
            {' most calls failed   ─ one long call   · no calls'}
          </Text>
        ) : null}
        {current.rows.map(r => (
          <Text key={r.id} wrap="truncate-end">
            {r.id.padEnd(idWidth)}
            {r.track.map((s, i) => (
              <Text key={`t${i}`} color={segColor(s)}>
                {s.ch}
              </Text>
            ))}
            {' '}
            {r.stage.padEnd(7)}
            {r.inStage.padStart(6)}
            {'  '}
            {r.cells.map((c, i) => (
              <Text key={`c${i}`} color={cellColor(c)}>
                {c.ch}
              </Text>
            ))}
            {'  '}
            <Text color={paint(r.verdict.tone)}>{r.verdict.text}</Text>
            {r.failed === null ? null : <Text color="error">{` · ${r.failed}`}</Text>}
            {r.diff === null ? null : <Text dimColor>{` · ${r.diff}`}</Text>}
            {' '.repeat(Math.max(1, width - tailWidth(r)))}
            <Text dimColor>{r.title}</Text>
          </Text>
        ))}
      </Box>
    )
  })
}
