import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cell, GitSignal, GruSettings, PaneTab, Row, Seg, TicketSettings, Tone } from '../types'
import { beatFile, callEnded, callStarted, newBeat, seedBeat } from './beat'
import { buildBoard, launchIdOf, pickRun, runsOf, settingsName } from './board'
import { readGit } from './git'
import { logName, runLogName } from './log'
import { drawPane, paletteFor } from './pane'
import {
  addCall,
  addPrompt,
  addReview,
  addStats,
  addUsage,
  newStats,
  noteGit,
  noteModel,
  runStatsName,
  statsFile,
  statsName,
  statsOf,
} from './stats'
import { buildTicket, ticketSettingsName, ticketSettingsOf } from './ticket'
import { drawTicketPane } from './ticket-pane'
import { buildView, isRunName, ownRun, ticketOf, worktreeOf } from './view'

// The state contract is in ../README.md.
const POLL_MS = 1000
const GIT_MS = 30_000
const BEAT_MS = 5000
const PANE = 'gru-board'
const PANE_TITLE = 'Gru'
const TICKET_PANE = 'ticket-board'

const view = atom({ plugin: 'stark-progress', key: 'view' } as const, null, { shape: 'view-2' })
const board = atom({ plugin: 'stark-progress', key: 'board' } as const, null, { shape: 'board-5' })
const tabAtom = atom({ plugin: 'stark-progress', key: 'tab' } as const, 'overview' as PaneTab)
const focusAtom = atom({ plugin: 'stark-progress', key: 'focus' } as const, '')
const pickAtom = atom({ plugin: 'stark-progress', key: 'pick' } as const, '')
const doneLastAtom = atom({ plugin: 'stark-progress', key: 'doneLast' } as const, false)
/** The `$.store` key that keeps the pane's doneLast choice across sessions. */
const DONE_LAST = 'doneLast'
const ticketAtom = atom({ plugin: 'stark-progress', key: 'ticket' } as const, null, { shape: 'ticket-5' })
const ticketTabAtom = atom({ plugin: 'stark-progress', key: 'ticketTab' } as const, 'overview' as PaneTab)

// The pane's run: Gru's tab shows its own; a session that asked for the pane
// with /gru-board shows the most recently active run, or the one `r` picked.
let isBoardWanted = false
let isPaneOpened = false
// A worker's own tab: its ticket, and whether the ticket pane opened by itself yet.
let ownTicket: string | null = null
let isTicketPaneOpened = false
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

// Every session counts its stats in memory from its start; a worker's tab and
// Gru's tab write them to their stats file, seeded once from what that file
// held, so a reload or a relaunch keeps the total. A reload starts it over.
let stats = newStats()
let isStatsDirty = false
let lastStatsFlush = 0
/** This tab's stats file and the file it lives beside (the ticket's or the run's), once found. */
let statsAnchor: { base: string; name: string } | null = null
/** Each stats file this tab wrote, by the file it lives beside, so each goes once that file does. */
const statsWritten = new Map<string, string>()
let statsSeededFor = ''
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
  // The first poll of each load always draws: after a reload, the session's
  // state still holds what the last load drew, which may be old.
  let last = ''
  let lastBoard = ''
  let lastTicket = ''
  // Settings presses apply one at a time, each over the one before it.
  let settingsWrites: Promise<void> = Promise.resolve()
  let ticketWrites: Promise<void> = Promise.resolve()
  let doneLastWrites: Promise<void> = Promise.resolve()
  let isPolling = false
  let polling: Promise<void> = Promise.resolve()
  // A log only grows, and a poll reads it each second: keep its text until its size or time changes.
  const logReads = new Map<string, { stamp: string; text: string }>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'gru-board',
      description: "Open the Gru board: a calm view of a Gru run's tickets, and the settings Gru reads",
    })
    await $.command.register({
      name: 'ticket-board',
      description: "Open the ticket pane in a Minion's or Agnes's tab: its ticket, and the settings its worker reads",
    })
    // The pane's own choice outlives the session; a store that cannot be read leaves the default.
    // It loads in the background, so no session waits on it, and a press queues behind it.
    doneLastWrites = doneLastWrites.catch(() => undefined).then(async () => {
      const stored = await $.store.get(DONE_LAST).catch(() => undefined)
      if (typeof stored === 'boolean') await update($, doneLastAtom, () => stored)
    })
    const home = await $.env.get('HOME')
    if (!home) return next(e)
    const dir = `${home}/.cache/stark-progress`
    stateDir = dir

    const poll = async () => {
      // A slow tick must not overlap the next one and write an older view last.
      // A caller that finds one reading waits for it, so `pollNow` never returns early.
      if (isPolling) return polling
      isPolling = true
      polling = tick().finally(() => {
        isPolling = false
      })

      return polling
    }
    const tick = async () => {
      const now = await $.clock.now()
      const listed = await $.fs.list(dir).catch(() => [])
      // A log file is JSON Lines (`.jsonl`); every other file is whole JSON.
      const jsons = listed.filter(f => f.kind === 'file' && (f.name.endsWith('.json') || f.name.endsWith('.jsonl')))
      const names = new Set(jsons.map(f => f.name))
      const mtimes = new Map(jsons.map(f => [f.name, f.mtimeMs]))
      const stamps = new Map(jsons.map(f => [f.name, `${f.size}:${f.mtimeMs}`]))
      for (const name of logReads.keys()) if (!names.has(name)) logReads.delete(name)
      const files: Record<string, string> = {}
      const load = async (name: string) => {
        if (!names.has(name)) return
        const isLog = name.endsWith('.jsonl')
        const kept = isLog ? logReads.get(name) : undefined
        if (kept !== undefined && kept.stamp === stamps.get(name)) {
          files[name] = kept.text
          return
        }
        const text = await $.fs.read(`${dir}/${name}`).catch(() => undefined)
        if (typeof text !== 'string') return
        files[name] = text
        if (isLog) logReads.set(name, { stamp: stamps.get(name) ?? '', text })
      }

      // The run files first; then only the files this tab draws, so a
      // directory of old tickets costs a listing, not a read of each.
      const [root, session] = await Promise.all([$.session.root(), $.session.id()])
      await Promise.all([...names].filter(isRunName).map(load))
      const run = ownRun(session, files)
      const own = run === null ? ticketOf(root) : null
      isWorker = own !== null
      ownTicket = own
      // A reload starts the module's own variables over: a board in the
      // session's state says this tab asked for it with /gru-board.
      if (!isBoardWanted && (await read($, board)) !== null) isBoardWanted = true
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
      // This tab's stats file: a worker's ticket's, or Gru's run's.
      statsAnchor =
        own !== null
          ? { base: `${own}.json`, name: statsName(own) }
          : run !== null
            ? { base: run.name, name: runStatsName(launchIdOf(run.name)) }
            : null
      const reads = new Set([
        ...wanted.flatMap(id => [`${id}.json`, `${id}.beat.json`, logName(id), statsName(id)]),
        ...(shown === undefined ? [] : [settingsName(shown.launchId), runLogName(shown.launchId), runStatsName(shown.launchId)]),
        ...(own === null ? [] : [ticketSettingsName(own)]),
        ...(statsAnchor === null ? [] : [statsAnchor.name]),
      ])
      // This tab's own stats file is read once, for the seed: its counts are in memory after that.
      reads.delete(statsSeededFor)
      await Promise.all([...reads].map(load))

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

      // This tab's stats file, written as the heartbeat is: while the file it
      // lives beside exists, at most once every BEAT_MS, and removed with it.
      // Gru's tab outlives its run file, and then no longer knows its run: so
      // each stats file it wrote is kept in mind until it goes.
      for (const [name, base] of statsWritten) {
        if (names.has(base)) continue
        if (names.has(name)) await $.process.run(['rm', '-f', `${dir}/${name}`]).catch(() => undefined)
        else statsWritten.delete(name)
      }
      if (statsAnchor !== null) {
        const { base, name } = statsAnchor
        // A stats file listed but not read this poll waits for the next: a seed without it would overwrite its total.
        const isUnread = statsSeededFor !== name && names.has(name) && files[name] === undefined
        if (names.has(base) && !isUnread) {
          statsWritten.set(name, base)
          if (statsSeededFor !== name) {
            // A new run in the same tab starts its counts over: the last run's are its own file's.
            if (statsSeededFor !== '') stats = { ...newStats(), model: stats.model, effort: stats.effort }
            statsSeededFor = name
            const kept = statsOf(files[name])
            if (kept !== null) stats = addStats(kept, stats)
            isStatsDirty = true
          }
          // A worker keeps its last git signal, so its lines and commits outlive its worktree.
          if (own !== null && noteGit(stats, git[own] ?? null)) isStatsDirty = true
          const text = JSON.stringify(statsFile(stats, session, now))
          files[name] = text
          if (isStatsDirty && now - lastStatsFlush >= BEAT_MS) {
            isStatsDirty = false
            lastStatsFlush = now
            await writeWhole($, `${dir}/${name}`, text).catch(() => {
              isStatsDirty = true
            })
          }
        } else if (!names.has(base) && names.has(name) && !statsWritten.has(name)) {
          // One an earlier load of the mod wrote, whose file is gone (Agnes deletes her ticket's at stand-down).
          await $.process.run(['rm', '-f', `${dir}/${name}`]).catch(() => undefined)
        }
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

      // A worker's tab opens the ticket pane once, the first time its ticket's file is found.
      if (own !== null && files[`${own}.json`] !== undefined && !isTicketPaneOpened) {
        isTicketPaneOpened = true
        void $.ui.open({ id: TICKET_PANE, title: own }).catch(() => undefined)
      }
      const shownTicket = own === null ? null : buildTicket(own, now, files, mtimes, git[own] ?? null)
      const ticketKey =
        shownTicket === null ? 'null' : JSON.stringify([{ ...shownTicket, readAt: 0 }, Math.floor(now / 60_000)])
      if (ticketKey !== lastTicket) {
        lastTicket = ticketKey
        await update($, ticketAtom, () => shownTicket)
      }

      const fresh = buildView(root, session, now, files, git)
      const key = JSON.stringify(fresh)
      if (key === last) return
      last = key
      await update($, view, () => fresh)
    }
    // A command or a press waits for a poll already reading, which may have read
    // before its write, then polls again.
    pollNow = async () => {
      await polling.catch(() => undefined)
      await poll()
    }
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const ui = { Box, Text, Button, P: paletteFor(e.surface) }
    const shown = await read($, board)

    return drawPane(ui, Math.max(e.props.bodyColumns, 40), {
      board: shown,
      tab: await read($, tabAtom),
      focus: await read($, focusAtom),
      setTab: tab => update($, tabAtom, () => tab),
      setFocus: id => update($, focusAtom, () => id),
      doneLast: await read($, doneLastAtom),
      // The pane's own choice, kept in the plugin's store, never in the run's settings file: Gru does not read it.
      // Presses apply one at a time, after the load, so the store ends on the value the pane shows.
      flipDoneLast: () => {
        doneLastWrites = doneLastWrites.catch(() => undefined).then(async () => {
          const isLast = await update($, doneLastAtom, now => !now)
          try {
            await $.store.set(DONE_LAST, isLast)
          } catch {
            await $.ui.toast('The choice was not saved.')
          }
        })

        return doneLastWrites
      },
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

  on('command.run', { command: 'ticket-board' }, async $ => {
    await pollNow()
    if (ownTicket === null) {
      return { text: "This tab has no ticket: /ticket-board opens in a Minion's or Agnes's tab, whose worktree is named for its ticket." }
    }
    const opened = await $.ui.open({ id: TICKET_PANE, title: ownTicket, focus: true, closeOnEscape: true })

    return { text: opened.isPlaced ? `The ticket pane for ${ownTicket} is open.` : `The ticket pane waits: ${opened.reason}.` }
  })

  on('ui.render', { component: 'Pane', requestId: TICKET_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const ui = { Box, Text, Button, P: paletteFor(e.surface) }
    const shown = await read($, ticketAtom)

    return drawTicketPane(ui, Math.max(e.props.bodyColumns, 40), {
      ticket: shown,
      tab: await read($, ticketTabAtom),
      setTab: tab => update($, ticketTabAtom, () => tab),
      // The whole settings, written as one file, as the contract asks; the worker reads it at three
      // steps of the spine. Each press reads the file as it is now, after the presses before it.
      set: (change: (s: TicketSettings) => Partial<TicketSettings>) => {
        const id = shown?.id
        ticketWrites = ticketWrites.catch(() => undefined).then(async () => {
          if (id === undefined || stateDir === '') return
          const path = `${stateDir}/${ticketSettingsName(id)}`
          const before = ticketSettingsOf(await $.fs.read(path).catch(() => undefined))
          const settings: TicketSettings = { ...before, ...change(before) }
          try {
            await writeWhole($, path, `${JSON.stringify(settings, null, 2)}\n`)
          } catch {
            await $.ui.toast('The settings were not saved.')
            return
          }
          await update($, ticketAtom, t => (t !== null && t.id === id ? { ...t, settings } : t))
          await pollNow()
        })

        return ticketWrites
      },
    })
  })

  // Each tool call, subagents' included: it counts in the stats of every
  // session, and its start and end make the heartbeat in a worker's own tab.
  on('tool.call', async ($, e, next) => {
    const isBeat = isWorker
    calls += 1
    const key = e.tool_use_id ?? `call-${calls}`
    if (isBeat) {
      callStarted(beat, key, e.tool, await $.clock.now())
      isDirty = true
    }
    let isFailed = true
    try {
      const result = await next(e)
      // A deny (a guard or a refused permission) is a failed call too.
      isFailed = result.isError === true || result.deny !== undefined

      return result
    } finally {
      const now = await $.clock.now()
      const call = {
        tool: e.tool,
        command: e.tool === 'Bash' ? e.command : undefined,
        skill: e.tool === 'Skill' ? e.skill : undefined,
        hasMessage: e.tool === 'SendMessage' && typeof e.message === 'string' && e.message !== '',
      }
      addCall(stats, call, isFailed, now)
      isStatsDirty = true
      if (isBeat) {
        callEnded(beat, key, isFailed, now)
        // The end changes the file too (`running`, the counts): a flush that
        // ran while the call ran must not be the last one.
        isDirty = true
      }
    }
  })

  // Each model request, the main loop's and its subagents': its tokens, and
  // the main loop's model and effort. A request cut off before its response
  // counts nothing.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) noteModel(stats, e.model, e.effort)
    const response = yield* next(e)
    addUsage(stats, response.usage, await $.clock.now())
    isStatsDirty = true

    return response
  })

  // Each prompt that entered, by where it came from: the operator, another
  // session, or neither.
  on('prompt.submit', async ($, e, next) => {
    const entered = await next(e)
    if (entered.drop === undefined) {
      addPrompt(stats, e.origin.kind, e.isMeta === true, await $.clock.now())
      isStatsDirty = true
    }

    return entered
  })

  // A review round the operator typed: /code-review. (`skill.prompt` would
  // see both forms, but a built-in plugin above the mod passes it on past
  // this tier; the model's own run is a Skill tool call, counted in addCall.)
  on('command.run', { command: 'code-review' }, async ($, e, next) => {
    const ran = await next(e)
    addReview(stats, await $.clock.now())
    isStatsDirty = true

    return ran
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
    // A worker's tab: the ticket pane holds the ticket. Its one row stands in while the pane is not placed.
    if ((await $.ui.panes()).some(p => p.id === TICKET_PANE && p.isPlaced)) return next(e)
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
