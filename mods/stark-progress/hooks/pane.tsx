import type { Elements } from 'claude-code'

import type { Board, BoardRow, BoardTone, Cell, GruSettings, LogView, PaneTab, StatsView } from '../types'
import { clockOf, MAX_WORKERS, stepCounts } from './board'
import { dayOf } from './log'
import { grouped, short } from './stats'
import { bar, STAGES, STATION_LABELS } from './view'

// The Gru pane: a calm board of one run (Overview) and the run's settings
// that Gru reads before each launch (Settings). The model is board.ts's. The
// ticket pane (ticket-pane.tsx) draws with the parts this file exports.

export type Palette = Record<'text' | 'hint' | 'track' | 'blue' | 'green' | 'amber' | 'gray' | 'id', string>

/** The elements a pane draws with, and the palette of the surface it draws on. */
export type UI = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'> & { P: Palette }

// The terminal's, for its dark theme. Contrast on the pane's #262626 (WCAG):
// text 8.1:1, id 8.1:1, gray 6.8:1, hint 5.9:1; track 3.5:1 for lines and
// rings alone, which carry no words. The id's lavender is no tone's color, so
// a ticket's id never reads as its state.
const TERMINAL: Palette = {
  text: '#b8bdd0',
  hint: '#9ba1b8',
  track: '#727894',
  blue: '#8ecae6',
  green: '#95d5b2',
  amber: '#e9c46a',
  gray: '#a7adc2',
  id: '#c9b3f5',
}

// Every other surface (the desktop app's Code tab, VS Code, mobile) draws in its own light or dark
// theme: theme keys follow it, as the band's colors do. On the desktop's light theme, on the pane's
// white, inactive measured 5.7:1, success 6.6:1 and warning 7.4:1. Its suggestion is its accent: blue
// in the active window, and gray, as all of the app's accent, in an inactive one.
const THEMED: Palette = {
  text: 'inactive',
  hint: 'inactive',
  track: 'subtle',
  blue: 'suggestion',
  green: 'success',
  amber: 'warning',
  gray: 'inactive',
  id: 'suggestion',
}

export const paletteFor = (surface: string): Palette => (surface === 'terminal' ? TERMINAL : THEMED)

const TONE: Record<BoardTone, keyof Palette> = { done: 'green', move: 'blue', warn: 'amber', idle: 'gray', none: 'track' }
const toneOf = (P: Palette, tone: BoardTone) => P[TONE[tone]]

export type PaneView = {
  board: Board | null
  tab: PaneTab
  focus: string
  setTab: (tab: PaneTab) => unknown
  setFocus: (id: string) => unknown
  /** The pane's own choice: done tickets listed last. */
  doneLast: boolean
  flipDoneLast: () => unknown
  pick: (launchId: string) => unknown
  /** A change made from the settings as they are when it is written, so two quick presses both count. */
  set: (change: (s: GruSettings) => Partial<GruSettings>) => unknown
}

export const cut = (words: string, room: number) => (words.length > room ? `${words.slice(0, Math.max(room - 1, 1))}…` : words)

/**
 * A ticket as `[STARK-n] Title`: the id in its own color, then the name in the
 * text's, cut to fit `room` cells. A ticket no file names yet shows its id alone.
 */
export function ticketLabel(ui: UI, id: string, name: string, room: number, how: { bold?: boolean; dim?: boolean } = {}) {
  const { Text, P } = ui
  const tag = `[${id}]`
  // The title takes what the id and its space leave; with too little room for even `X…`, the id stands alone.
  const left = room - tag.length - 1
  const title = name === '' || left < 2 ? '' : cut(name, left)

  return (
    <Text bold={how.bold}>
      <Text color={P.id}>{tag}</Text>
      {title !== '' && ' '}
      {title !== '' && <Text color={how.dim ? P.text : undefined}>{title}</Text>}
    </Text>
  )
}

/** The length of one track segment at a width, leaving room for a status after the track. */
export const segFor = (w: number) => Math.max(2, Math.min(6, Math.floor((w - 2 - 5 - 2 - 24) / 4)))

/** The words over the stations, each cut to fit before the next. */
export function stationHeader(seg: number): string {
  const cells: string[] = Array.from({ length: STAGES.length * (seg + 1) }, () => ' ')
  STATION_LABELS.forEach((label, i) => [...label.slice(0, seg)].forEach((ch, k) => (cells[i * (seg + 1) + k] = ch)))

  return cells.join('').trimEnd()
}

/** A ticket's line: ● stations passed, ◉ the one it is at, ○ the ones to come. */
export function line(ui: UI, r: Pick<BoardRow, 'at' | 'tone'>, seg: number) {
  const { Text, P } = ui
  const color = toneOf(P, r.tone)

  return (
    <Text mono>
      {STAGES.map((_, i) => (
        <Text key={`s${i}`}>
          {i < r.at ? <Text color={color}>●</Text> : i === r.at ? <Text bold color={color}>◉</Text> : <Text color={P.track}>○</Text>}
          {i < STAGES.length - 1 &&
            (i < r.at ? <Text color={color}>{'━'.repeat(seg)}</Text> : <Text color={P.track}>{'┄'.repeat(seg)}</Text>)}
        </Text>
      ))}
    </Text>
  )
}

const CELL_INK: Record<Cell['kind'], keyof Palette> = {
  milestone: 'green',
  busy: 'text',
  fail: 'amber',
  running: 'hint',
  quiet: 'track',
  none: 'track',
}
const inkOf = (P: Palette, kind: Cell['kind']) => P[CELL_INK[kind]]

/** The legend's words for each mark; a blank cell has no mark to show. */
const MARKS: { kind: Cell['kind']; ch: string; words: string }[] = [
  { kind: 'milestone', ch: '◆', words: 'milestone' },
  { kind: 'busy', ch: '▃', words: 'tool calls per 5 min' },
  { kind: 'fail', ch: '✕', words: 'most calls failed' },
  { kind: 'running', ch: '─', words: 'one long call' },
  { kind: 'quiet', ch: '·', words: 'no calls' },
  { kind: 'none', ch: '', words: 'blank: no heartbeat' },
]

/** The marks that say something happened in the hour. */
const ACTIVE: ReadonlySet<Cell['kind']> = new Set(['milestone', 'busy', 'fail', 'running'])

/** The band draws a failed 5 minutes as a bar in red; the pane draws `✕`, so a failure never rests on its color alone. */
const markOf = (c: Cell) => (c.kind === 'fail' ? '✕' : c.ch)

/**
 * A ticket's last hour, as the band drew it: 12 cells of 5 minutes, oldest
 * first, then a legend of the marks it shows. Nothing when the hour holds
 * no milestone, call or long call: a closed ticket's leftover heartbeat
 * would draw only dots.
 */
export function hour(ui: UI, cells: Cell[]) {
  const { Box, Text, P } = ui
  if (!cells.some(c => ACTIVE.has(c.kind))) return null
  const kinds = new Set(cells.map(c => c.kind))

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text mono>
        <Text color={P.hint}>{'Last hour  '}</Text>
        {cells.map((c, i) => (
          <Text key={`c${i}`} color={inkOf(P, c.kind)}>
            {markOf(c)}
          </Text>
        ))}
        <Text color={P.hint}>{'  now'}</Text>
      </Text>
      <Box flexWrap="wrap" columnGap={2}>
        {MARKS.filter(m => kinds.has(m.kind)).map(m => (
          <Text key={`m${m.kind}`}>
            {m.ch !== '' && <Text color={inkOf(P, m.kind)}>{`${m.ch} `}</Text>}
            <Text color={P.hint}>{m.words}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  )
}

const STEP_LABEL = 'not started  '.length
const MIN_BAR = 20

/**
 * The tickets at each step, one bar a step on one scale: the full width is
 * all the run's tickets, so a bar grows as its step fills and never rescales.
 * The count comes before the bar, right-aligned in a column as wide as the
 * run's ticket count; the ones worth a look follow the bar. The scale leaves
 * room for the longest note the run can have, so a full bar keeps its note; a
 * pane too narrow for that gives the bar the whole line.
 */
function graph(ui: UI, w: number, rows: BoardRow[]) {
  const { Text, P } = ui
  const digits = String(rows.length).length
  const bare = w - STEP_LABEL - digits - 1
  const withNote = bare - ` · ${rows.length} worth a look`.length
  const room = Math.max(withNote >= MIN_BAR ? withNote : bare, 1)

  return stepCounts(rows).map(s => {
    const drawn = bar(s.count, rows.length, room)
    const ink = s.count === 0 ? P.hint : P.text
    // The box of tickets worth a look names each one, so a line without room for the whole note drops it, never cuts it.
    const left = bare - [...drawn].length
    const note = ` · ${s.looks} worth a look`
    const look = s.looks === 0 || note.length > left ? '' : note

    return (
      <Text key={`g${s.label}`} mono>
        <Text color={ink}>{`${s.label.padEnd(STEP_LABEL)}${String(s.count).padStart(digits)}`}</Text>
        {drawn !== '' && <Text color={toneOf(P, s.tone)}>{` ${drawn}`}</Text>}
        {look !== '' && <Text color={P.amber}>{look}</Text>}
      </Text>
    )
  })
}

function overview(ui: UI, w: number, board: Board, view: PaneView) {
  const { Box, Button, Text, P } = ui
  const rows = board.rows
  const names = new Map(rows.map(r => [r.id, r.name]))
  const looks = rows.filter(r => r.attention !== null)
  // The list keeps the run's order, or puts the done tickets last in that order.
  const listed = view.doneLast ? [...rows.filter(r => r.tone !== 'done'), ...rows.filter(r => r.tone === 'done')] : rows
  const seg = segFor(w)
  // `r` steps through the other runs by launch id, so with three or more each one is reached.
  const others = [...board.others].sort((a, b) => a.launchId.localeCompare(b.launchId))
  const next = others.find(o => o.launchId.localeCompare(board.launchId) > 0) ?? others[0]

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Box justifyContent="space-between" columnGap={1}>
          <Text bold>{`Gru · ${board.epic}`}</Text>
          <Text color={P.green}>{board.isOwn ? '● this run' : '● live'}</Text>
        </Box>
        <Text color={P.text}>
          {`${board.repos.length > 0 ? board.repos.join(' + ') : board.launchId} · ${rows.length} tickets`}
        </Text>
      </Box>

      <Box flexDirection="column">
        <Text color={P.text}>
          {`${board.done} of ${rows.length} done · ${board.inProgress} in progress · ${board.notStarted} not started`}
        </Text>
        {graph(ui, w, rows)}
      </Box>

      {looks.length === 0 ? (
        <Text color={P.green}>🌿 Nothing needs you right now.</Text>
      ) : (
        <Box flexDirection="column" borderStyle="round" borderColor={P.amber} paddingX={1}>
          <Text bold color={P.amber}>
            {looks.length === 1 ? '🙋 1 ticket is worth a look' : `🙋 ${looks.length} tickets are worth a look`}
          </Text>
          {looks.map(r => (
            <Box key={`a${r.id}`} flexDirection="column" marginTop={1}>
              {ticketLabel(ui, r.id, r.name, w - 4)}
              <Text color={P.text}>{r.attention}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box flexDirection="column">
        <Text bold>🚇 Where each ticket is</Text>
        <Text mono color={P.hint}>{`  ${stationHeader(seg)}`}</Text>
        {listed.map(r => {
          const isOpen = view.focus === r.id
          const isQuiet = r.tone === 'done' || r.tone === 'none'

          return (
            <Box key={`r${r.id}`} flexDirection="column">
              <Button key={`row-${r.id}`} plain onPress={() => view.setFocus(isOpen ? '' : r.id)}>
                {ticketLabel(ui, r.id, r.name, w - 1, { bold: isOpen, dim: isQuiet })}
              </Button>
              <Box columnGap={2} paddingLeft={2}>
                <Box flexShrink={0}>{line(ui, r, seg)}</Box>
                <Text color={r.tone === 'warn' ? P.amber : P.text}>{`${r.emoji} ${r.status}`}</Text>
              </Box>
              {isOpen && (
                <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
                  {r.detail.map((words, i) => (
                    <Text key={`d${i}`} color={P.text}>
                      {words}
                    </Text>
                  ))}
                  {hour(ui, r.cells)}
                </Box>
              )}
            </Box>
          )
        })}
        {view.focus === '' && <Text color={P.hint}>Select a name to see more.</Text>}
      </Box>

      {board.next.length > 0 && (
        <Box flexDirection="column">
          <Text bold>👉 Up next</Text>
          {board.next.map(id => (
            <Text key={`n${id}`}>
              {'Start '}
              {ticketLabel(ui, id, names.get(id) ?? '', w - 'Start '.length)}
            </Text>
          ))}
          {/* A `--tickets` run's epic is its first ticket, which no one closes as an epic. */}
          {!rows.some(r => r.id === board.epic) && (
            <Text color={P.text}>{`Then close ${board.epic} once all ${rows.length} tickets close.`}</Text>
          )}
        </Box>
      )}

      {next !== undefined && (
        <Box columnGap={1}>
          <Text color={P.hint}>{`Also running: ${board.others.map(o => o.epic).join(', ')}.`}</Text>
          <Button key="switch" plain hotkey="r" onPress={() => view.pick(next.launchId)}>
            <Text color={P.text}>{`show ${next.epic}`}</Text>
          </Button>
        </Box>
      )}
      <Text color={P.hint}>{`Read from ~/.cache/stark-progress at ${clockOf(board.readAt)}.`}</Text>
    </Box>
  )
}

// A setting's value draws in a frame, so it reads as a control: a native button
// on the desktop, `[ ● On ]` in the terminal.

/** A setting's on and off value, which a press flips. */
export const toggle = (ui: UI, key: string, on: boolean, onPress: () => unknown) => {
  const { Button, Text, P } = ui

  return (
    <Button key={`set-${key}`} onPress={onPress}>
      {on ? <Text color={P.green}>● On</Text> : <Text color={P.gray}>○ Off</Text>}
    </Button>
  )
}

/** A setting's value as words, which a press changes. */
export const choice = (ui: UI, key: string, words: string, onPress: () => unknown) => {
  const { Button, Text, P } = ui

  return (
    <Button key={`set-${key}`} onPress={onPress}>
      <Text color={P.blue}>{words}</Text>
    </Button>
  )
}

/** One setting: its label and control on a line, and what it does below. */
export const settingRow = (ui: UI, w: number, label: string, control: ReturnType<typeof toggle>, about: string) => {
  const { Box, Text, P } = ui

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" width={w} columnGap={1}>
        <Text>{label}</Text>
        {control}
      </Box>
      {/* A wrapped line keeps the indent. */}
      <Box paddingLeft={3}>
        <Text color={P.text}>{about}</Text>
      </Box>
    </Box>
  )
}

/** The pane's four tabs, each with its hotkey. */
export function tabBar(ui: UI, tab: PaneTab, setTab: (tab: PaneTab) => unknown) {
  const { Box, Button, Text, P } = ui
  const tabs = [
    ['overview', 'o', 'Overview'],
    ['log', 'l', 'Log'],
    ['stats', 't', 'Stats'],
    ['settings', 's', 'Settings'],
  ] as const

  return (
    <Box columnGap={3}>
      {tabs.map(([id, hotkey, label]) => (
        <Button key={`tab-${id}`} plain hotkey={hotkey} onPress={() => setTab(id)}>
          {tab === id ? (
            <Text bold underline>
              {label}
            </Text>
          ) : (
            <Text color={P.text}>{label}</Text>
          )}
        </Button>
      ))}
    </Box>
  )
}

/**
 * A Log tab: the big steps, newest first, each after its local time. In the
 * Gru pane each step names whose it is (`Gru`, or a ticket's name) on a line
 * above its words. `empty` says who writes the steps, and `files` names the
 * files that hold every step, the older ones the tab leaves out included.
 */
export function logTab(ui: UI, w: number, log: LogView, empty: string, files: string) {
  const { Box, Text, P } = ui
  const steps = log.days.reduce((n, d) => n + d.entries.length, 0)

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>📜 What got done</Text>
        <Text color={P.text}>
          {steps === 0 ? empty : 'The big steps, newest first, each told in plain words by whoever did it.'}
        </Text>
      </Box>
      {log.days.map((day, d) => (
        <Box key={`day${d}`} flexDirection="column">
          {day.label !== null && <Text bold>{day.label}</Text>}
          {day.entries.map((s, i) => (
            <Box key={`s${d}-${i}`} columnGap={2}>
              <Box flexShrink={0}>
                {/* Digits of one width, so each step's words start in one column. */}
                <Text tabular color={P.hint}>
                  {s.clock}
                </Text>
              </Box>
              <Box flexDirection="column">
                {s.id !== null
                  ? ticketLabel(ui, s.id, s.who ?? '', w - 7, { dim: true })
                  : s.who !== null && <Text color={s.isRun ? P.blue : P.text}>{cut(s.who, w - 7)}</Text>}
                <Text>{s.text}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      ))}
      {log.older > 0 && (
        <Text color={P.hint}>
          {`${log.older === 1 ? '1 older step is' : `${log.older} older steps are`} not shown. Every step is in ${files}.`}
        </Text>
      )}
    </Box>
  )
}

// A Stats tab: a table of counts, one column in the ticket pane and two in
// the Gru pane (Gru's own, and the whole run's), then the tools with the most
// calls and each session's model and effort. The model is stats.ts's.

const STAT_LABEL = 'from other sessions  '.length
const STAT_GAP = 2

/** When the counts began: `12:03`, or `Thu 29 Oct 12:03` on an earlier day. */
const sinceOf = (since: number, now: number) => {
  const day = dayOf(since, now)

  return day === 'Today' ? clockOf(since) : `${day} ${clockOf(since)}`
}

/** The started tickets that wrote no stats, named by id. */
function missingLine(ui: UI, w: number, missing: readonly string[]) {
  const { Box, Text, P } = ui

  return (
    <Box flexDirection="column">
      <Text color={P.hint}>
        {`${missing.length === 1 ? 'One ticket has' : `${missing.length} tickets have`} no stats: a Codex worker, a session without the mod, or no worker in this run.`}
      </Text>
      <Box flexWrap="wrap" columnGap={1} paddingLeft={2}>
        {missing.map(id => (
          <Box key={`x${id}`}>{ticketLabel(ui, id, '', w)}</Box>
        ))}
      </Box>
    </Box>
  )
}

/**
 * A Stats tab. `who` says whose counts these are, `empty` what to read before
 * any stats file exists, and `now` dates when the counts began.
 */
export function statsTab(ui: UI, w: number, view: StatsView, now: number, words: { title: string; who: string; empty: string }) {
  const { Box, Text, P } = ui
  if (view.since === null && view.sessions.length === 0) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{`📊 ${words.title}`}</Text>
        <Text color={P.text}>{words.empty}</Text>
        {view.missing.length > 0 && missingLine(ui, w, view.missing)}
      </Box>
    )
  }
  // Each column is as wide as its head or its widest value; the values right-align in it.
  const cols = Math.max(view.columns.length, 1)
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(view.columns[i]?.length ?? 0, ...view.groups.flatMap(g => g.rows.map(r => r.values[i]?.length ?? 0))),
  )
  const cells = (values: readonly string[]) => values.map((v, i) => v.padStart((widths[i] ?? 0) + STAT_GAP)).join('')

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>{`📊 ${words.title}`}</Text>
        <Text color={P.text}>
          {`${words.who}${view.since === null ? '' : ` Counted since ${sinceOf(view.since, now)}.`}`}
        </Text>
      </Box>

      <Box flexDirection="column">
        {view.columns.length > 0 && (
          <Text mono bold>
            {`${''.padEnd(STAT_LABEL)}${cells(view.columns)}`}
          </Text>
        )}
        {view.groups.map(g => (
          <Box key={`g${g.title}`} flexDirection="column">
            <Text bold>{g.title}</Text>
            {g.rows.map(r => (
              <Text key={`r${g.title}${r.label}`} mono>
                <Text color={P.text}>{`  ${r.label}`.padEnd(STAT_LABEL)}</Text>
                <Text>{cells(r.values)}</Text>
              </Text>
            ))}
          </Box>
        ))}
      </Box>

      {view.tools.length > 0 && (
        <Box flexDirection="column">
          <Text bold>{view.columns.length > 0 ? 'Most used tools, whole run' : 'Most used tools'}</Text>
          {view.tools.map(t => {
            // A long name (an MCP tool's) pushes its count right rather than lose its end too soon.
            const name = `  ${cut(t.name, Math.max(STAT_LABEL - 4, w - 28))}`

            return (
              <Text key={`t${t.name}`} mono>
                <Text color={P.text}>{name.padEnd(Math.max(STAT_LABEL, name.length + STAT_GAP))}</Text>
                <Text>{`${grouped(t.calls)} calls`}</Text>
                {t.fails > 0 && <Text color={P.amber}>{` · ${grouped(t.fails)} failed`}</Text>}
              </Text>
            )
          })}
        </Box>
      )}

      <Box flexDirection="column">
        <Text bold>Model and effort</Text>
        {view.sessions.map(s => (
          <Box key={`s${s.id ?? 'own'}`} columnGap={1} paddingLeft={2}>
            {s.id === null ? (
              <Text color={P.blue}>{view.columns.length > 0 ? 'Gru' : 'This session'}</Text>
            ) : (
              ticketLabel(ui, s.id, '', w)
            )}
            <Text color={P.text}>{s.words}</Text>
          </Box>
        ))}
        {view.models.map(m => (
          <Text key={`m${m.id}`} color={P.hint}>
            {`  ${m.id}: ${grouped(m.requests)} requests, ${short(m.output)} output tokens`}
          </Text>
        ))}
      </Box>

      {view.missing.length > 0 && missingLine(ui, w, view.missing)}
    </Box>
  )
}

function settings(ui: UI, w: number, board: Board, view: PaneView) {
  const { Box, Text, P } = ui
  const s = board.settings
  const step = (key: string, sign: string, onPress: () => unknown) => choice(ui, key, sign, onPress)
  const row = (label: string, control: ReturnType<typeof toggle>, about: string) => settingRow(ui, w, label, control, about)

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>{`Settings for ${board.epic}`}</Text>
        <Text color={P.text}>Gru reads these before each launch. Select a value to change it.</Text>
      </Box>
      {row(
        'Decide for me',
        toggle(ui, 'decide', s.decideForMe, () => view.set(now => ({ decideForMe: !now.decideForMe }))),
        s.decideForMe
          ? 'Gru splits a ticket across repos and adds a blocking ticket on its own.'
          : 'Gru holds a split or a blocking ticket, and asks you in its report.',
      )}
      {row(
        'Workers at once',
        <Box columnGap={1}>
          {/* A launch above MAX_WORKERS steps down into range, and + never lowers it. */}
          {step('fewer', '−', () => view.set(now => ({ maxWorkers: Math.max(1, Math.min(MAX_WORKERS, now.maxWorkers - 1)) })))}
          <Text>{String(s.maxWorkers)}</Text>
          {step('more', '+', () =>
            view.set(now => ({ maxWorkers: Math.max(now.maxWorkers, Math.min(MAX_WORKERS, now.maxWorkers + 1)) })),
          )}
        </Box>,
        `Gru keeps up to ${s.maxWorkers} Minions alive at once.`,
      )}
      {row(
        'Pick up follow-ups',
        toggle(ui, 'follow-ups', s.followUps, () => view.set(now => ({ followUps: !now.followUps }))),
        s.followUps ? 'A follow-up a Minion files joins this run.' : 'A follow-up waits on the board, named in the report.',
      )}
      {row(
        'Worker type',
        choice(ui, 'agent', s.minionAgent, () => view.set(now => ({ minionAgent: now.minionAgent === 'claude' ? 'codex' : 'claude' }))),
        `Each new Minion runs on ${s.minionAgent}.`,
      )}
      <Box flexDirection="column">
        <Text bold>This pane</Text>
        <Text color={P.text}>Only this pane uses this setting, in every run. Gru does not read it.</Text>
      </Box>
      {row(
        'Done tickets last',
        toggle(ui, 'done-last', view.doneLast, view.flipDoneLast),
        view.doneLast ? 'The ticket list shows the done tickets at the bottom.' : 'The ticket list keeps the order of the run.',
      )}
    </Box>
  )
}

export function drawPane(ui: UI, w: number, view: PaneView) {
  const { Box, Text, P } = ui
  const board = view.board
  if (board === null) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>No Gru run yet</Text>
        <Text color={P.text}>The board shows a run once its file is in ~/.cache/stark-progress.</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      {tabBar(ui, view.tab, view.setTab)}
      {view.tab === 'settings'
        ? settings(ui, w, board, view)
        : view.tab === 'log'
          ? logTab(
              ui,
              w,
              board.log,
              'No step yet. Gru and each worker add one line here at each big step.',
              `~/.cache/stark-progress/run-${board.launchId}.log.jsonl and each ticket's .log.jsonl`,
            )
          : view.tab === 'stats'
            ? statsTab(ui, w, board.stats, board.readAt, {
                title: `Stats for ${board.epic}`,
                who: "Gru's own counts, and the whole run's: Gru's and each ticket's, added.",
                empty: "No stats yet. The mod counts in Gru's tab and in each worker's tab, once each has the mod.",
              })
            : overview(ui, w, board, view)}
    </Box>
  )
}
