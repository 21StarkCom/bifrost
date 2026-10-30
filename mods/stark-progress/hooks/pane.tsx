import type { Elements } from 'claude-code'

import type { Board, BoardRow, BoardTone, GruSettings, PaneTab } from '../types'
import { clockOf, MAX_WORKERS } from './board'
import { STAGES } from './view'

// The Gru pane: a calm board of one run (Overview) and the run's settings
// that Gru reads before each launch (Settings). The model is board.ts's.
type UI = Elements['terminal']

// Contrast on the pane's #262626 (WCAG): text 8.1:1, gray 6.8:1, hint 5.9:1;
// track 3.5:1 for lines and rings alone, which carry no words.
const P = {
  text: '#b8bdd0',
  hint: '#9ba1b8',
  track: '#727894',
  blue: '#8ecae6',
  green: '#95d5b2',
  amber: '#e9c46a',
  gray: '#a7adc2',
}

const TONE: Record<BoardTone, string> = {
  done: P.green,
  move: P.blue,
  warn: P.amber,
  idle: P.gray,
  none: P.track,
}

export type PaneView = {
  board: Board | null
  tab: PaneTab
  focus: string
  setTab: (tab: PaneTab) => unknown
  setFocus: (id: string) => unknown
  pick: (launchId: string) => unknown
  /** A change made from the settings as they are when it is written, so two quick presses both count. */
  set: (change: (s: GruSettings) => Partial<GruSettings>) => unknown
}

const cut = (words: string, room: number) => (words.length > room ? `${words.slice(0, Math.max(room - 1, 1))}…` : words)

/** The words over the stations, each cut to fit before the next. */
function stationHeader(seg: number): string {
  const labels = ['ticket', 'PR', 'review', 'merge', 'done']
  const cells: string[] = Array.from({ length: STAGES.length * (seg + 1) }, () => ' ')
  labels.forEach((label, i) => [...label.slice(0, seg)].forEach((ch, k) => (cells[i * (seg + 1) + k] = ch)))

  return cells.join('').trimEnd()
}

/** A ticket's line: ● stations passed, ◉ the one it is at, ○ the ones to come. */
function line(ui: UI, r: BoardRow, seg: number) {
  const { Text } = ui
  const color = TONE[r.tone]

  return (
    <Text>
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

function overview(ui: UI, w: number, board: Board, view: PaneView) {
  const { Box, Button, Text } = ui
  const rows = board.rows
  const looks = rows.filter(r => r.attention !== null)
  const seg = Math.max(2, Math.min(6, Math.floor((w - 2 - 5 - 2 - 24) / 4)))
  const segment = Math.max(Math.floor((w - (rows.length - 1)) / Math.max(rows.length, 1)), 1)
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
        <Text>
          {rows.map((r, i) => (
            <Text key={`b${r.id}`} color={TONE[r.tone]}>
              {'━'.repeat(segment) + (i < rows.length - 1 ? ' ' : '')}
            </Text>
          ))}
        </Text>
        <Text color={P.text}>
          {`${board.done} of ${rows.length} done · ${board.inProgress} in progress · ${board.notStarted} not started`}
        </Text>
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
              <Text>{cut(r.name, w - 4)}</Text>
              <Text color={P.text}>{r.attention}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box flexDirection="column">
        <Text bold>🚇 Where each ticket is</Text>
        <Text color={P.hint}>{`  ${stationHeader(seg)}`}</Text>
        {rows.map(r => {
          const isOpen = view.focus === r.id
          const isQuiet = r.tone === 'done' || r.tone === 'none'

          return (
            <Box key={`r${r.id}`} flexDirection="column">
              <Button key={`row-${r.id}`} plain onPress={() => view.setFocus(isOpen ? '' : r.id)}>
                {isQuiet ? (
                  <Text bold={isOpen} color={P.text}>
                    {cut(r.name, w - 1)}
                  </Text>
                ) : (
                  <Text bold={isOpen}>{cut(r.name, w - 1)}</Text>
                )}
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
            <Text key={`n${id}`}>{`Start ${id}`}</Text>
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

function settings(ui: UI, w: number, board: Board, view: PaneView) {
  const { Box, Button, Text } = ui
  const s = board.settings

  const toggle = (key: string, on: boolean, onPress: () => unknown) => (
    <Button key={`set-${key}`} plain onPress={onPress}>
      {on ? <Text color={P.green}>● On</Text> : <Text color={P.gray}>○ Off</Text>}
    </Button>
  )
  const step = (key: string, sign: string, onPress: () => unknown) => (
    <Button key={`set-${key}`} plain onPress={onPress}>
      <Text color={P.blue}>{sign}</Text>
    </Button>
  )
  const row = (label: string, control: ReturnType<typeof toggle>, about: string) => (
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

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>{`Settings for ${board.epic}`}</Text>
        <Text color={P.text}>Gru reads these before each launch. Select a value to change it.</Text>
      </Box>
      {row(
        'Decide for me',
        toggle('decide', s.decideForMe, () => view.set(now => ({ decideForMe: !now.decideForMe }))),
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
        toggle('follow-ups', s.followUps, () => view.set(now => ({ followUps: !now.followUps }))),
        s.followUps ? 'A follow-up a Minion files joins this run.' : 'A follow-up waits on the board, named in the report.',
      )}
      {row(
        'Worker type',
        <Button key="set-agent" plain onPress={() => view.set(now => ({ minionAgent: now.minionAgent === 'claude' ? 'codex' : 'claude' }))}>
          <Text color={P.blue}>{s.minionAgent}</Text>
        </Button>,
        `Each new Minion runs on ${s.minionAgent}.`,
      )}
    </Box>
  )
}

export function drawPane(ui: UI, w: number, view: PaneView) {
  const { Box, Button, Text } = ui
  const board = view.board
  if (board === null) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>No Gru run yet</Text>
        <Text color={P.text}>The board shows a run once its file is in ~/.cache/stark-progress.</Text>
      </Box>
    )
  }
  const tabs = [
    ['overview', 'o', 'Overview'],
    ['settings', 's', 'Settings'],
  ] as const

  return (
    <Box flexDirection="column" gap={1}>
      <Box columnGap={3}>
        {tabs.map(([id, hotkey, label]) => (
          <Button key={`tab-${id}`} plain hotkey={hotkey} onPress={() => view.setTab(id)}>
            {view.tab === id ? (
              <Text bold underline>
                {label}
              </Text>
            ) : (
              <Text color={P.text}>{label}</Text>
            )}
          </Button>
        ))}
      </Box>
      {view.tab === 'settings' ? settings(ui, w, board, view) : overview(ui, w, board, view)}
    </Box>
  )
}
