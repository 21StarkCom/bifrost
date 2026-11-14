import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cell, GitSignal, GruSettings, PaneTab, Row, Seg, SuperMemory, SuperSettings, TicketSettings, Tone } from '../types'
import { beatFile, callEnded, callStarted, newBeat, seedBeat } from './beat'
import { buildBoard, clockOf, launchIdOf, parse, pickRun, runsOf, settingsName, tabIsLive } from './board'
import { readGit } from './git'
import { githubQuery, parseGithub, prRefOf, repoKey } from './github'
import type { PrRef, RepoAnswer } from './github'
import { logName, runLogName } from './log'
import { drawPane, paletteFor } from './pane'
import {
  addCall,
  addPrompt,
  addReview,
  addStats,
  addTime,
  addUsage,
  newStats,
  noteGit,
  noteModel,
  runStatsName,
  statsFile,
  statsName,
  statsOf,
  superStatsName,
} from './stats'
import {
  buildSuper,
  isSuperName,
  ownSuper,
  rememberSuper,
  superIdOf,
  superLogs,
  superReads,
  superSettingsName,
  superSettingsOf,
  superTickets,
} from './super'
import { drawSuperPane } from './super-pane'
import { buildTicket, epicRunOf, ticketSettingsName, ticketSettingsOf } from './ticket'
import { drawTicketPane } from './ticket-pane'
import { buildView, isRunName, ownRun, startsWorker, ticketOf, worktreeOf } from './view'

// The state contract is in ../README.md.
const POLL_MS = 1000
const GIT_MS = 30_000
const BEAT_MS = 5000
/** A worker's tab writes its heartbeat at least this often, with no call too, so the Gru pane sees the tab is open. */
const ALIVE_MS = 60_000
const PANE = 'gru-board'
const PANE_TITLE = 'Gru'
const TICKET_PANE = 'ticket-board'
const SUPER_PANE = 'super-board'

const view = atom({ plugin: 'stark-progress', key: 'view' } as const, null, { shape: 'view-2' })
const board = atom({ plugin: 'stark-progress', key: 'board' } as const, null, { shape: 'board-7' })
const tabAtom = atom({ plugin: 'stark-progress', key: 'tab' } as const, 'overview' as PaneTab)
const focusAtom = atom({ plugin: 'stark-progress', key: 'focus' } as const, '')
const ghFocusAtom = atom({ plugin: 'stark-progress', key: 'ghFocus' } as const, '')
const pickAtom = atom({ plugin: 'stark-progress', key: 'pick' } as const, '')
/** True once this tab ran /gru-board: only such a tab shows a run with no `r` press that is not its own. */
const wantedAtom = atom({ plugin: 'stark-progress', key: 'wanted' } as const, false)
/** The epic of this tab's own run, once found: Gru's tab names it after Gru deletes the run file. */
const ownEpicAtom = atom({ plugin: 'stark-progress', key: 'ownEpic' } as const, '')
const doneLastAtom = atom({ plugin: 'stark-progress', key: 'doneLast' } as const, false)
/** The `$.store` key that keeps the pane's doneLast choice across sessions. */
const DONE_LAST = 'doneLast'
const ticketAtom = atom({ plugin: 'stark-progress', key: 'ticket' } as const, null, { shape: 'ticket-7' })
const ticketTabAtom = atom({ plugin: 'stark-progress', key: 'ticketTab' } as const, 'overview' as PaneTab)
const superAtom = atom({ plugin: 'stark-progress', key: 'superBoard' } as const, null, { shape: 'super-3' })
const superTabAtom = atom({ plugin: 'stark-progress', key: 'superTab' } as const, 'overview' as PaneTab)
const superGhFocusAtom = atom({ plugin: 'stark-progress', key: 'superGhFocus' } as const, '')
/** What Super-Gru's tab kept of each epic's Gru: a Gru deletes its files at its end, and the board reads these after. */
const superMemoryAtom = atom({ plugin: 'stark-progress', key: 'superMemory' } as const, null, { shape: 'memory-1' })
/** The ticket whose file this worker's tab found, once found: its pane names the ticket's end after the file goes. */
const ownTicketAtom = atom({ plugin: 'stark-progress', key: 'ownTicket' } as const, '')
/** True once the person closed the ticket pane by hand in this session: only /ticket-board opens it again. */
const ticketClosedAtom = atom({ plugin: 'stark-progress', key: 'ticketClosed' } as const, false)

// The pane's run: Gru's tab shows its own; a session that asked for the pane
// with /gru-board shows the most recently active run, or the one `r` picked.
// Gru's tab never counts as asking: once its run file is gone, it shows no run.
let isBoardWanted = false
/** The name of this tab's own run file, once found: a poll that lists it but could not read it is no run's end. */
let ownRunFile = ''
let isPaneOpened = false
// A worker's own tab: its ticket, and whether the ticket pane opened by itself yet.
let ownTicket: string | null = null
let isTicketPaneOpened = false
/** Super-Gru's tab: whether its pane opened by itself yet. */
let isSuperPaneOpened = false
/** The name of this tab's own Super-Gru run file, once found: a poll that lists it but could not read it is no run's end. */
let ownSuperFile = ''
/** True once this load found its own Super-Gru run file gone: the pane keeps the last board, marked ended. */
let isSuperEnded = false
/** What this tab kept of each epic's Gru, as the session's state holds it; undefined until this load reads it. */
let superMemory: SuperMemory | null | undefined
/** superMemory as JSON, as this load last wrote it: a poll compares one string, not two. */
let superMemoryKey = ''
/** True while the last poll found this worker tab's own ticket file. */
let isOwnFileFound = false
/** The ownTicket atom's value as this load of the mod last wrote or read it, or null before the first poll. */
let ownTicketFound: string | null = null
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
/** This tab's cmux surface, from `CMUX_SURFACE_ID`; the heartbeat carries it, so the Gru pane can bring the tab to the front. */
let surface: string | null = null

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
/**
 * The last poll's time, for the session's open time; whether the main loop is
 * inside a turn now; and the subagents' turns running now, by turn id, which
 * count as working too (a background agent can run after the main turn ends).
 */
let lastTick = 0
let isTurning = false
const agentTurns = new Set<string>()
/** Each epic's title as alfred gave it, and when each epic was last asked: a failed ask is tried again after ASK_AGAIN_MS. */
const epicTitles = new Map<string, string>()
const epicsAsked = new Map<string, number>()
const ASK_AGAIN_MS = 5 * 60_000
/** A ticket id alfred knows: never a value that could read as a flag. */
const EPIC_ID = /^[A-Z][A-Z0-9]*-\d+$/

/**
 * Asks alfred for an epic's title in the background, and a later poll draws
 * the answer: for an epic that is no ticket of its run (whose own file or
 * run-file title names it). One answer is kept; a failed ask is tried again later.
 */
function askEpicTitle($: EngineInterface, epic: string, now: number) {
  const asked = epicsAsked.get(epic)
  if (!EPIC_ID.test(epic) || epicTitles.has(epic) || (asked !== undefined && now - asked < ASK_AGAIN_MS)) return
  epicsAsked.set(epic, now)
  void $.process
    .run(['alfred', 'task', 'show', epic, '--json'], { timeoutMs: 30_000 })
    .then(r => {
      const name = r.exitCode === 0 ? (parse(r.stdout)?.item as Record<string, unknown> | undefined)?.name : undefined
      if (typeof name === 'string' && name !== '') epicTitles.set(epic, name)
    })
    .catch(() => undefined)
}

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

/** The GitHub tab asks each repo once a minute while it is shown, and at once when it opens (if 10 s have passed). */
const GH_MS = 60_000
const GH_OPEN_MS = 10_000
const GH_TIMEOUT_MS = 30_000
/** Each repo's last good answer, its last failure, and its last ask, by `owner/repo`. */
const ghAnswers = new Map<string, RepoAnswer & { asked: number; isReading: boolean }>()
/** Whether the last poll found each pane's GitHub tab shown: a poll that finds one newly shown asks at once. */
let wasGithubShown = false
let wasSuperGithubShown = false

/**
 * Ask GitHub, in the background, for each repo of `refs` whose answer is due:
 * one `gh api graphql` call a repo, never two at once for one repo. A failure
 * keeps the last good answer and names itself.
 */
function askGithub($: EngineInterface, refs: readonly PrRef[], now: number, isNewlyShown: boolean): void {
  const byRepo = new Map<string, PrRef[]>()
  for (const ref of refs) byRepo.set(repoKey(ref), [...(byRepo.get(repoKey(ref)) ?? []), ref])
  for (const [key, prs] of byRepo) {
    const was = ghAnswers.get(key)
    const since = was === undefined ? Number.POSITIVE_INFINITY : now - was.asked
    if (was?.isReading === true || since < (isNewlyShown ? GH_OPEN_MS : GH_MS)) continue
    const kept = { at: was?.at ?? null, prs: was?.prs ?? new Map(), error: was?.error ?? null }
    ghAnswers.set(key, { ...kept, asked: now, isReading: true })
    const failed = (why: string) =>
      ghAnswers.set(key, { ...kept, error: `${key}: GitHub did not answer at ${clockOf(now)}: ${why}`, asked: now, isReading: false })
    const first = prs[0]
    if (first === undefined) continue
    const query = githubQuery(first.owner, first.repo, prs.map(p => p.number))
    void $.process
      .run(['gh', 'api', 'graphql', '-f', `query=${query}`], { timeoutMs: GH_TIMEOUT_MS })
      .then(r => {
        // `gh` exits 1 on any GraphQL error, a wrong PR number too, yet still prints the other PRs: keep them.
        const answer = parseGithub(r.stdout)
        const why = r.exitCode === 0 ? null : r.stderr.trim().split('\n')[0] || `gh exited ${r.exitCode}`
        if (answer === null) failed(why ?? 'no answer')
        else {
          const error = why === null ? null : `${key}: GitHub answered at ${clockOf(now)} with an error: ${why}`
          ghAnswers.set(key, { at: now, prs: answer, error, asked: now, isReading: false })
        }
      })
      .catch((err: unknown) => failed(err instanceof Error ? err.message : String(err)))
  }
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
  let lastSuper = ''
  // Settings presses apply one at a time, each over the one before it.
  let settingsWrites: Promise<void> = Promise.resolve()
  let ticketWrites: Promise<void> = Promise.resolve()
  let superWrites: Promise<void> = Promise.resolve()
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
    await $.command.register({
      name: 'super-board',
      description: "Open the Super-Gru board in Super-Gru's tab: one row for each epic, and the settings Super-Gru reads",
    })
    // The pane's own choice outlives the session; a store that cannot be read leaves the default.
    // It loads in the background, so no session waits on it, and a press queues behind it.
    doneLastWrites = doneLastWrites.catch(() => undefined).then(async () => {
      const stored = await $.store.get(DONE_LAST).catch(() => undefined)
      if (typeof stored === 'boolean') await update($, doneLastAtom, () => stored)
    })
    surface = (await $.env.get('CMUX_SURFACE_ID').catch(() => undefined)) || null
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
      // The time since the last poll: open, and busy while the main loop is in a turn.
      if (addTime(stats, lastTick === 0 ? 0 : now - lastTick, isTurning || agentTurns.size > 0, now)) isStatsDirty = true
      lastTick = now
      // A listing that failed is no file's end: the Super-Gru run ends only on a listing without its file.
      let isListed = true
      const listed = await $.fs.list(dir).catch(() => {
        isListed = false
        return []
      })
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
      await Promise.all([...names].filter(n => isRunName(n) || isSuperName(n)).map(load))
      // Super-Gru's tab: its run file, found by its session. One listed but not read leaves its pane as it is.
      const superName = ownSuper(session, files)
      if (superName !== null) {
        ownSuperFile = superName
        isSuperEnded = false
      }
      // What this tab kept of each epic's Gru: read once per load (a reload keeps it in the session's state).
      if (superMemory === undefined) superMemory = await read($, superMemoryAtom)
      const superKept = superName !== null && superMemory?.launchId === superIdOf(superName) ? superMemory.epics : {}
      const isSuperUnread = superName === null && ownSuperFile !== '' && names.has(ownSuperFile) && files[ownSuperFile] === undefined
      const run = ownRun(session, files)
      const own = run === null ? ticketOf(root) : null
      isWorker = own !== null
      ownTicket = own
      // A reload starts the module's own variables over: the session's state
      // says this tab asked with /gru-board. Gru's own board never does.
      if (!isBoardWanted && (await read($, wantedAtom))) isBoardWanted = true
      if (run !== null) {
        ownRunFile = run.name
        if (run.epic !== (await read($, ownEpicAtom))) await update($, ownEpicAtom, () => run.epic)
      }
      // Gru's run file, listed but not read (a read that failed), is not the run's end:
      // this poll leaves the pane and the band as they are, and picks no other run.
      const isOwnUnread = run === null && ownRunFile !== '' && names.has(ownRunFile) && files[ownRunFile] === undefined
      // The pane's run, when this tab shows the pane: its tickets and its settings file.
      let pick = await read($, pickAtom)
      const runs = (run !== null || isBoardWanted) && !isOwnUnread ? runsOf(files, mtimes) : []
      const shown = pickRun(runs, session, pick)
      // Outside Gru's own run, the pane stays on the run it chose until `r` or
      // that run's end: which run is most active changes as other runs' files do.
      if (shown !== undefined && shown.session !== session && shown.launchId !== pick) {
        pick = shown.launchId
        await update($, pickAtom, () => shown.launchId)
      }
      // The epic of the pane's run, and of a worker's epic run, when it is no ticket of its run.
      if (shown !== undefined && !shown.tickets.includes(shown.epic)) askEpicTitle($, shown.epic, now)
      const epicRun = own === null ? undefined : epicRunOf(own, files, mtimes)
      if (epicRun !== undefined && !epicRun.tickets.includes(epicRun.epic)) askEpicTitle($, epicRun.epic, now)
      const wanted = [
        ...new Set([...(run !== null ? run.tickets : own === null ? [] : [own]), ...(shown?.tickets ?? [])]),
      ]
      // This tab's stats file: a worker's ticket's, or Gru's run's.
      statsAnchor =
        own !== null
          ? { base: `${own}.json`, name: statsName(own) }
          : run !== null
            ? { base: run.name, name: runStatsName(launchIdOf(run.name)) }
            : superName !== null
              ? { base: superName, name: superStatsName(superIdOf(superName)) }
              : null
      const reads = new Set([
        ...wanted.flatMap(id => [`${id}.json`, `${id}.beat.json`, logName(id), statsName(id)]),
        ...(shown === undefined ? [] : [settingsName(shown.launchId), runLogName(shown.launchId), runStatsName(shown.launchId)]),
        ...(own === null ? [] : [ticketSettingsName(own)]),
        // An epic that is a ticket of its own run takes its title from its own file, as the Gru pane's does.
        ...(epicRun !== undefined && epicRun.tickets.includes(epicRun.epic) ? [`${epicRun.epic}.json`] : []),
        ...(statsAnchor === null ? [] : [statsAnchor.name]),
        ...(superName === null ? [] : superReads(superName, files, superKept)),
      ])
      // This tab's own stats file is read once, for the seed: its counts are in memory after that.
      reads.delete(statsSeededFor)
      await Promise.all([...reads].map(load))
      // Then the logs of the Super-Gru board's blocked tickets: their last line says what each waits on.
      if (superName !== null) await Promise.all(superLogs(superName, files, superKept).map(load))
      // Keep what each epic's Gru files say while they exist: the Gru deletes them at its end.
      if (superName !== null) {
        const remembered = rememberSuper(superName, files, superMemory)
        const key = JSON.stringify(remembered)
        if (key !== superMemoryKey) {
          superMemory = remembered
          superMemoryKey = key
          await update($, superMemoryAtom, () => remembered)
        }
      }
      // A worker's ticket file, listed but not read (a read that failed), is not the ticket's end:
      // this poll leaves the ticket pane, the band and the heartbeat as they are.
      const isTicketUnread = own !== null && names.has(`${own}.json`) && files[`${own}.json`] === undefined
      // The ticket this tab found keeps its end on the pane, but only while the tab stays in that ticket's
      // worktree: a session that moved to another one names no ticket's end until it finds that ticket's file.
      // The session's state is read once per load of the mod (a reload keeps it there), then kept in memory.
      const found = ownTicketFound ?? (await read($, ownTicketAtom))
      const isFound = own !== null && files[`${own}.json`] !== undefined
      isOwnFileFound = isFound
      const nowFound = isFound ? own : own === found ? found : ''
      if (nowFound !== found) await update($, ownTicketAtom, () => nowFound)
      ownTicketFound = nowFound

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
          // A keep-alive never takes the heartbeat from another session whose tab lives (a second session in the worktree).
          const onDisk = parse(files[name])
          const isMine = onDisk === null || onDisk.session === session || !tabIsLive(onDisk, now)
          const text = JSON.stringify(beatFile(beat, own, session, now, surface))
          files[name] = text
          // A call's change at most every BEAT_MS; with no call, a keep-alive every ALIVE_MS (the first poll's at once).
          if ((isDirty && now - lastFlush >= BEAT_MS) || (isMine && now - lastFlush >= ALIVE_MS)) {
            isDirty = false
            lastFlush = now
            await writeWhole($, `${dir}/${name}`, text).catch(() => undefined)
          }
        } else if (names.has(name) && !isTicketUnread) {
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

      // Super-Gru's tab opens its pane once, the first time its run file is found, and draws its epics.
      if (superName !== null && !isSuperPaneOpened) {
        isSuperPaneOpened = true
        void $.ui.open({ id: SUPER_PANE, title: 'Super-Gru' }).catch(() => undefined)
      }
      // Gru's tab opens the pane once, the first time its run is found.
      if (run !== null && !isPaneOpened) {
        isPaneOpened = true
        void $.ui.open({ id: PANE, title: PANE_TITLE }).catch(() => undefined)
      }

      // A GitHub tab asks GitHub only while its pane is placed and shows it: a closed pane asks nothing.
      // One ask serves both panes, so a repo's answer holds the PRs of each.
      const isGithubShown =
        shown !== undefined &&
        (await read($, tabAtom)) === 'github' &&
        (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
      const isSuperGithubShown =
        superName !== null &&
        (await read($, superTabAtom)) === 'github' &&
        (await $.ui.panes()).some(p => p.id === SUPER_PANE && p.isPlaced)
      if (isGithubShown || isSuperGithubShown) {
        const ids = new Set([
          ...(isGithubShown ? shown.tickets : []),
          ...(isSuperGithubShown && superName !== null ? superTickets(superName, files, superKept) : []),
        ])
        const refs = [...ids].flatMap(id => {
          const ref = prRefOf(parse(files[`${id}.json`])?.pr)
          return ref === null ? [] : [ref]
        })
        askGithub($, refs, now, (isGithubShown && !wasGithubShown) || (isSuperGithubShown && !wasSuperGithubShown))
      }
      wasGithubShown = isGithubShown
      wasSuperGithubShown = isSuperGithubShown

      // Super-Gru deleted its run file at its end: the pane keeps the last board, marked ended, and draws no more.
      const isSuperGone = isListed && superName === null && ownSuperFile !== '' && !names.has(ownSuperFile)
      if (isSuperGone) {
        if (!isSuperEnded) {
          isSuperEnded = true
          lastSuper = ''
          await update($, superAtom, b => (b === null || b.endedAt !== null ? b : { ...b, endedAt: now }))
          // The ended board keeps its counts; what was kept of each Gru is no later run's, even one with this launch id.
          superMemory = null
          superMemoryKey = 'null'
          await update($, superMemoryAtom, () => null)
        }
      } else {
        const shownSuper = superName === null ? null : buildSuper(superName, files, epicTitles, now, ghAnswers, superMemory ?? null)
        for (const r of shownSuper?.rows ?? []) if (r.title === null) askEpicTitle($, r.epic, now)
        const superKey = shownSuper === null ? 'null' : JSON.stringify([{ ...shownSuper, readAt: 0 }, Math.floor(now / 60_000)])
        // A listing that failed leaves the board as it is, as a run file it could not read does.
        if (superKey !== lastSuper && !isSuperUnread && isListed) {
          lastSuper = superKey
          // A tab with no run of its own keeps an ended board, in this load and after a reload.
          await update($, superAtom, b => (shownSuper === null && b !== null && b.endedAt !== null ? b : shownSuper))
        }
      }

      // No run to show (Gru deleted its run file at the end) clears the
      // pane, so it never keeps drawing a finished run as live.
      const shownBoard = shown === undefined ? null : buildBoard(session, pick, now, files, mtimes, git, epicTitles, ghAnswers)
      // Draw again when a file changed, or once a minute for the times.
      const boardKey =
        shownBoard === null ? 'null' : JSON.stringify([{ ...shownBoard, readAt: 0 }, Math.floor(now / 60_000)])
      if (boardKey !== lastBoard && !isOwnUnread) {
        lastBoard = boardKey
        await update($, board, () => shownBoard)
      }

      // A worker's tab opens the ticket pane once, the first time its ticket's file is found, unless the
      // person closed it. The engine counts this open as the mod's own: it waits below 144 columns.
      // The close is read once, not each second while it holds.
      if (own !== null && files[`${own}.json`] !== undefined && !isTicketPaneOpened) {
        isTicketPaneOpened = true
        if (!(await read($, ticketClosedAtom))) void $.ui.open({ id: TICKET_PANE, title: own }).catch(() => undefined)
      }
      const shownTicket = own === null ? null : buildTicket(own, now, files, mtimes, git[own] ?? null, epicTitles)
      const ticketKey =
        shownTicket === null ? 'null' : JSON.stringify([{ ...shownTicket, readAt: 0 }, Math.floor(now / 60_000)])
      if (ticketKey !== lastTicket && !isTicketUnread) {
        lastTicket = ticketKey
        await update($, ticketAtom, () => shownTicket)
      }

      const fresh = buildView(root, session, now, files, git)
      const key = JSON.stringify(fresh)
      if (key === last || isOwnUnread || isTicketUnread) return
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
    await update($, wantedAtom, () => true)
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
      ended: await read($, ownEpicAtom),
      tab: await read($, tabAtom),
      focus: await read($, focusAtom),
      setTab: tab => update($, tabAtom, () => tab),
      setFocus: id => update($, focusAtom, () => id),
      ghFocus: await read($, ghFocusAtom),
      setGhFocus: id => update($, ghFocusAtom, () => id),
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
      // The worker's own cmux tab, by the surface its heartbeat names, as the board is now.
      openTab: async id => {
        const tab = (await read($, board))?.rows.find(r => r.id === id)?.tab ?? null
        if (tab === null) {
          await $.ui.toast(`The tab of ${id} is not open.`)
          return
        }
        const focused = await $.process.run(['hermod', 'focus', tab], { timeoutMs: 10_000 }).catch((err: unknown) => ({
          exitCode: -1,
          stderr: err instanceof Error ? err.message : String(err),
        }))
        if (focused.exitCode !== 0) {
          const why = focused.stderr.trim().split('\n')[0] ?? ''
          await $.ui.toast(`The tab of ${id} did not come to the front${why === '' ? '.' : `: ${why}`}`)
        }
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
    await update($, ticketClosedAtom, () => false)
    const opened = await $.ui.open({ id: TICKET_PANE, title: ownTicket, focus: true, closeOnEscape: true })

    return { text: opened.isPlaced ? `The ticket pane for ${ownTicket} is open.` : `The ticket pane waits: ${opened.reason}.` }
  })

  on('ui.render', { component: 'Pane', requestId: TICKET_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const ui = { Box, Text, Button, P: paletteFor(e.surface) }
    const shown = await read($, ticketAtom)

    return drawTicketPane(ui, Math.max(e.props.bodyColumns, 40), {
      ticket: shown,
      ended: await read($, ownTicketAtom),
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

  on('command.run', { command: 'super-board' }, async $ => {
    await pollNow()
    if ((await read($, superAtom)) === null) {
      return { text: "This tab has no Super-Gru run: /super-board opens in Super-Gru's own tab, once its super file is written." }
    }
    const opened = await $.ui.open({ id: SUPER_PANE, title: 'Super-Gru', focus: true, closeOnEscape: true })

    return { text: opened.isPlaced ? 'The Super-Gru board is open.' : `The Super-Gru board waits: ${opened.reason}.` }
  })

  on('ui.render', { component: 'Pane', requestId: SUPER_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const ui = { Box, Text, Button, P: paletteFor(e.surface) }
    const shown = await read($, superAtom)

    return drawSuperPane(ui, Math.max(e.props.bodyColumns, 40), {
      board: shown,
      tab: await read($, superTabAtom),
      setTab: tab => update($, superTabAtom, () => tab),
      ghFocus: await read($, superGhFocusAtom),
      setGhFocus: id => update($, superGhFocusAtom, () => id),
      // The whole settings, written as one file. Each press reads the file as it is now, after the presses before it,
      // and writes only to the run the operator saw.
      set: (change: (s: SuperSettings) => Partial<SuperSettings>) => {
        const seen = shown?.launchId
        superWrites = superWrites.catch(() => undefined).then(async () => {
          const current = await read($, superAtom)
          // An ended run has no settings file left to write: Super-Gru reads none.
          if (current === null || current.endedAt !== null || stateDir === '') return
          if (current.launchId !== seen) {
            await $.ui.toast('The board moved to another run. Press again.')
            return
          }
          const path = `${stateDir}/${superSettingsName(current.launchId)}`
          const before = superSettingsOf({ settings: current.settings }, await $.fs.read(path).catch(() => undefined))
          const settings: SuperSettings = { ...before, ...change(before) }
          try {
            await writeWhole($, path, `${JSON.stringify(settings, null, 2)}\n`)
          } catch {
            await $.ui.toast('The settings were not saved.')
            return
          }
          await update($, superAtom, b => (b !== null && b.launchId === current.launchId ? { ...b, settings } : b))
          await pollNow()
        })

        return superWrites
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

  // The session's working time: while the main loop or a subagent is inside a turn, counted once however many run.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) isTurning = true
    else agentTurns.add(e.turnId)

    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) isTurning = false
    else agentTurns.delete(e.turnId)

    return next(e)
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

  // The person's own close of the ticket pane holds for the session, once the
  // pane is gone: a hook beneath that keeps it open leaves no close.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === TICKET_PANE && e.origin.kind === 'person' && !(await $.ui.panes()).some(p => p.id === TICKET_PANE)) {
      await update($, ticketClosedAtom, () => true)
    }

    return closed
  })

  on('prompt.submit', async ($, e, next) => {
    // A worker's tab opens its ticket pane here, once the prompt entered: the
    // engine places an open from this hook at any width when the person entered
    // the prompt, and a launch's first prompt counts. The poll's own open waits
    // below 144 columns. The prompt that starts the worker opens the pane before
    // the ticket's file exists; a later prompt opens it once the poll found that file.
    // Gru's tab, whose worktree is named for its epic, is no worker's tab, whatever its prompt.
    const own = ownRunFile === '' ? ticketOf(await $.session.root()) : null
    const isWorkerTab = own !== null && (startsWorker(e.text, e.command) || (own === ownTicket && isOwnFileFound))

    // Each prompt that entered, by where it came from: the operator, another
    // session, or neither. A dropped prompt starts no worker and opens no pane.
    const entered = await next(e)
    if (entered.drop !== undefined) return entered
    addPrompt(stats, e.origin.kind, e.isMeta === true, await $.clock.now())
    isStatsDirty = true

    if (isWorkerTab && !(await read($, ticketClosedAtom))) {
      const isPlaced = (await $.ui.panes()).some(p => p.id === TICKET_PANE && p.isPlaced)
      if (!isPlaced) {
        isTicketPaneOpened = true
        await $.ui.open({ id: TICKET_PANE, title: own }).catch(() => undefined)
      }
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
