import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cell, GitSignal, GruSettings, PaneTab, Row, Seg, Tone } from '../types'
import { beatFile, callEnded, callStarted, newBeat, seedBeat } from './beat'
import { buildBoard, pickRun, runsOf, settingsName } from './board'
import { readGit } from './git'
import { drawPane } from './pane'
import { buildView, isRunName, ownRun, ticketOf, worktreeOf } from './view'

// The state contract is in ../README.md.
const POLL_MS = 1000
const GIT_MS = 30_000
const BEAT_MS = 5000
const PANE = 'gru-board'
const PANE_TITLE = 'Gru'

const view = atom({ plugin: 'stark-progress', key: 'view' } as const, null, { shape: 'view-2' })
const board = atom({ plugin: 'stark-progress', key: 'board' } as const, null, { shape: 'board-1' })
const tabAtom = atom({ plugin: 'stark-progress', key: 'tab' } as const, 'overview' as PaneTab)
const focusAtom = atom({ plugin: 'stark-progress', key: 'focus' } as const, '')
const pickAtom = atom({ plugin: 'stark-progress', key: 'pick' } as const, '')

// The pane's run: Gru's tab shows its own; a session that asked for the pane
// with /gru-board shows the most recently active run, or the one `r` picked.
let isBoardWanted = false
let isPaneOpened = false
let stateDir = ''
let pollNow: () => Promise<void> = async () => {}

// A worker's own tab keeps its heartbeat here; a reload starts it over and
// seeds it from the file this session wrote.
let beat = newBeat()
let isWorker = false
let isSeeded = false
let isDirty = false
let lastFlush = 0
let calls = 0
const gitCache = new Map<string, { at: number; signal: GitSignal | null; isReading: boolean }>()

/**
 * Git's last signal for a worktree. One older than GIT_MS starts a new read in
 * the background, so a slow or hung git never holds the poll: a later poll
 * draws what the read found.
 */
function gitFor($: EngineInterface, dir: string, now: number): GitSignal | null {
  const hit = gitCache.get(dir)
  if (hit === undefined || (!hit.isReading && now - hit.at >= GIT_MS)) {
    gitCache.set(dir, { at: now, signal: hit?.signal ?? null, isReading: true })
    void readGit($, dir)
      .catch(() => null)
      .then(signal => gitCache.set(dir, { at: now, signal, isReading: false }))
  }
  // Drop the worktrees no row has asked for in a while (a finished run's).
  for (const [key, entry] of gitCache) {
    if (!entry.isReading && now - entry.at >= 10 * GIT_MS) gitCache.delete(key)
  }

  return gitCache.get(dir)?.signal ?? null
}

/** Whole JSON, written to a `.tmp` beside it and renamed over it, as the contract asks. */
async function writeWhole($: EngineInterface, path: string, text: string): Promise<void> {
  await $.fs.write(`${path}.tmp`, text)
  // `run` resolves on any exit code: a rename that failed left the old file in place.
  const moved = await $.process.run(['mv', '-f', `${path}.tmp`, path])
  if (moved.exitCode !== 0) throw new Error(`mv exited ${moved.exitCode}: ${moved.stderr.trim()}`)
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
  let lastBoard = 'null'
  // Settings presses apply one at a time, each over the one before it.
  let settingsWrites: Promise<void> = Promise.resolve()
  let isPolling = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'gru-board',
      description: "Open the Gru board: a calm view of a Gru run's tickets, and the settings Gru reads",
    })
    const home = await $.env.get('HOME')
    if (!home) return next(e)
    const dir = `${home}/.cache/stark-progress`
    stateDir = dir

    const poll = async () => {
      // A slow tick must not overlap the next one and write an older view last.
      if (isPolling) return
      isPolling = true
      try {
        const now = await $.clock.now()
        const listed = await $.fs.list(dir).catch(() => [])
        const jsons = listed.filter(f => f.kind === 'file' && f.name.endsWith('.json'))
        const names = new Set(jsons.map(f => f.name))
        const mtimes = new Map(jsons.map(f => [f.name, f.mtimeMs]))
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
        // The pane's run, when this tab shows the pane: its tickets and its settings file.
        let pick = await read($, pickAtom)
        const runs = run !== null || isBoardWanted ? runsOf(files, mtimes) : []
        const shown = pickRun(runs, session, pick)
        // Outside Gru's own run, the pane stays on the run it chose until `r` or
        // that run's end: which run is most active changes as other runs' files do.
        if (shown !== undefined && shown.session !== session && shown.launchId !== pick) {
          pick = shown.launchId
          await update($, pickAtom, () => shown.launchId)
        }
        const wanted = [
          ...new Set([...(run !== null ? run.tickets : own === null ? [] : [own]), ...(shown?.tickets ?? [])]),
        ]
        await Promise.all([
          ...wanted.flatMap(id => [load(`${id}.json`), load(`${id}.beat.json`)]),
          ...(shown === undefined ? [] : [load(settingsName(shown.launchId))]),
        ])

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
        for (const id of wanted) {
          const worktree = worktreeOf(id, files[`${id}.json`], root)
          git[id] = worktree === null ? null : gitFor($, worktree, now)
        }

        // Gru's tab opens the pane once, the first time its run is found.
        if (run !== null && !isPaneOpened) {
          isPaneOpened = true
          void $.ui.open({ id: PANE, title: PANE_TITLE }).catch(() => undefined)
        }
        // No run to show (Gru deleted its run file at the end) clears the
        // pane, so it never keeps drawing a finished run as live.
        const shownBoard = shown === undefined ? null : buildBoard(session, pick, now, files, mtimes, git)
        // Draw again when a file changed, or once a minute for the times.
        const boardKey =
          shownBoard === null ? 'null' : JSON.stringify([{ ...shownBoard, readAt: 0 }, Math.floor(now / 60_000)])
        if (boardKey !== lastBoard) {
          lastBoard = boardKey
          await update($, board, () => shownBoard)
        }

        const fresh = buildView(root, session, now, files, git)
        const key = JSON.stringify(fresh)
        if (key === last) return
        last = key
        await update($, view, () => fresh)
      } finally {
        isPolling = false
      }
    }
    pollNow = poll
    $.clock.every(POLL_MS, poll)

    return next(e)
  })

  on('command.run', { command: 'gru-board' }, async $ => {
    isBoardWanted = true
    await pollNow()
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true, closeOnEscape: true })

    return { text: opened.isPlaced ? 'The Gru board is open.' : `The Gru board waits: ${opened.reason}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>The Gru board draws in the terminal.</Text>
    }
    const ui = $.ui.resolve(e)
    const shown = await read($, board)

    return drawPane(ui, Math.max(e.props.bodyColumns, 40), {
      board: shown,
      tab: await read($, tabAtom),
      focus: await read($, focusAtom),
      setTab: tab => update($, tabAtom, () => tab),
      setFocus: id => update($, focusAtom, () => id),
      pick: async launchId => {
        await update($, pickAtom, () => launchId)
        await pollNow()
      },
      // The whole settings, written as one file, as the contract asks; Gru reads it before each launch.
      // Each press reads the board as it is now, not as this render saw it, so quick presses all count,
      // and writes only to the run the operator saw.
      set: (change: (s: GruSettings) => Partial<GruSettings>) => {
        const seen = shown?.launchId
        settingsWrites = settingsWrites.catch(() => undefined).then(async () => {
          const current = await read($, board)
          if (current === null || stateDir === '') return
          if (current.launchId !== seen) {
            await $.ui.toast('The board moved to another run. Press again.')
            return
          }
          const settings: GruSettings = { ...current.settings, ...change(current.settings) }
          try {
            await writeWhole($, `${stateDir}/${settingsName(current.launchId)}`, `${JSON.stringify(settings, null, 2)}\n`)
          } catch {
            await $.ui.toast('The settings were not saved.')
            return
          }
          await update($, board, b => (b !== null && b.launchId === current.launchId ? { ...b, settings } : b))
          await pollNow()
        })

        return settingsWrites
      },
    })
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
      // A deny (a guard or a refused permission) is a failed call too.
      callEnded(beat, key, result.isError === true || result.deny !== undefined, await $.clock.now())

      return result
    } catch (err) {
      callEnded(beat, key, true, await $.clock.now())
      throw err
    } finally {
      // The end changes the file too (`running`, the counts): a flush that
      // ran while the call ran must not be the last one.
      isDirty = true
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, view)
    if (e.props.hasSurvey || current === null || current.rows.length === 0) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    // Gru's tab: the pane holds the run. One line stands in while the pane is not placed.
    if (current.heading !== null) {
      const isPlaced = (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
      if (isPlaced) return next(e)
      // The pane may show another run (`r`); this line is always this tab's own.
      const shown = await read($, board)
      const closed = current.rows.filter(r => r.stage === 'closed').length
      const epic = shown?.isOwn === true ? shown.epic : (current.heading.split(' · ')[1] ?? '')

      return (
        <Text wrap="truncate-end">
          <Text bold>{`Gru · ${epic}`}</Text>
          <Text dimColor>{` · ${closed} of ${current.rows.length} done · /gru-board opens the board`}</Text>
        </Text>
      )
    }
    const width = Math.max(...current.rows.map(tailWidth)) + 2
    const idWidth = Math.max(...current.rows.map(r => r.id.length)) + 1
    const inStageWidth = Math.max(6, ...current.rows.map(r => r.inStage.length))

    // A worker's tab: its one row, with no heading and no legend.
    return (
      <Box flexDirection="column">
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
            {r.inStage.padStart(inStageWidth)}
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
