import type { PaneTab, SuperBoard, SuperRow, SuperSettings, SuperState } from '../types'
import { clockOf, MAX_WORKERS } from './board'
import { choice, cut, settingRow, tabBar, toggle } from './pane'
import type { UI } from './pane'

// The Super-Gru pane, in Super-Gru's own tab: one row for each epic, the
// blocked tickets worth a look (Overview), and the run's settings (Settings).
// The model is super.ts's.

export type SuperPaneView = {
  board: SuperBoard | null
  tab: PaneTab
  setTab: (tab: PaneTab) => unknown
  /** A change made from the settings as they are when it is written, so two quick presses both count. */
  set: (change: (s: SuperSettings) => Partial<SuperSettings>) => unknown
}

const ICON: Record<SuperState, string> = { waiting: '⏳', 'in work': '🚧', blocked: '⛔', done: '✅' }

/** `done 3/3`, `blocked 1/2`, or the state alone with no run file to count. */
export const stateWords = (r: Pick<SuperRow, 'state' | 'done' | 'total'>) =>
  r.total === null ? r.state : `${r.state} ${r.done ?? 0}/${r.total}`

function overview(ui: UI, w: number, b: SuperBoard) {
  const { Box, Text, P } = ui
  const idWidth = Math.max(...b.rows.map(r => r.epic.length), 4) + 2
  const stateWidth = Math.max(...b.rows.map(r => stateWords(r).length), 5) + 2
  const tone = (s: SuperState) => (s === 'done' ? P.green : s === 'blocked' ? P.blocked : s === 'in work' ? P.blue : P.gray)

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>{`Super-Gru · ${b.launchId}`}</Text>
        <Text color={P.text}>{`${b.rows.filter(r => r.state === 'done').length} of ${b.rows.length} epics done`}</Text>
      </Box>
      <Box flexDirection="column">
        {b.rows.map(r => {
          const gru = r.gru === null ? 'no Gru yet' : `Gru ${r.gru} ${r.gruState}`
          const room = w - 3 - idWidth - stateWidth - gru.length - 2

          return (
            <Text key={`e-${r.epic}`} wrap="truncate-end">
              {`${ICON[r.state]} `}
              <Text bold>{r.epic.padEnd(idWidth)}</Text>
              <Text color={tone(r.state)}>{stateWords(r).padEnd(stateWidth)}</Text>
              <Text color={P.text}>{gru}</Text>
              {r.title === null || room < 8 ? '' : <Text color={P.hint}>{`  ${cut(r.title, room)}`}</Text>}
            </Text>
          )
        })}
      </Box>
      {b.looks.length === 0 ? (
        <Text color={P.green}>🌿 Nothing needs you right now.</Text>
      ) : (
        <Box flexDirection="column" borderStyle="round" borderColor={P.amber} paddingX={1}>
          <Text bold color={P.amber}>
            🙋 Worth a look
          </Text>
          {b.looks.map(l => (
            <Text key={`l-${l.id}`}>{`${l.id} (${l.epic}) is blocked: ${l.waits}`}</Text>
          ))}
        </Box>
      )}
      <Text color={P.hint}>{`Read from ~/.cache/stark-progress at ${clockOf(b.readAt)}.`}</Text>
    </Box>
  )
}

function settings(ui: UI, w: number, b: SuperBoard, view: SuperPaneView) {
  const { Box, Text, P } = ui
  const s = b.settings
  const row = (label: string, control: ReturnType<typeof toggle>, about: string) => settingRow(ui, w, label, control, about)
  // A launch above MAX_WORKERS steps down into range, and + never lowers it.
  const stepper = (key: 'maxWorkers' | 'parallel') => (
    <Box columnGap={1}>
      {choice(ui, `${key}-fewer`, '−', () =>
        view.set(now => ({ [key]: Math.max(1, Math.min(MAX_WORKERS, now[key] - 1)) })),
      )}
      <Text>{String(s[key])}</Text>
      {choice(ui, `${key}-more`, '+', () =>
        view.set(now => ({ [key]: Math.max(now[key], Math.min(MAX_WORKERS, now[key] + 1)) })),
      )}
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>{`Settings for ${b.launchId}`}</Text>
        <Text color={P.text}>Super-Gru reads these before it starts each Gru. Select a value to change it.</Text>
      </Box>
      {row('Workers at once', stepper('maxWorkers'), `Each Gru keeps up to ${s.maxWorkers} Minions alive at once.`)}
      {row('Grus at once', stepper('parallel'), `Super-Gru runs up to ${s.parallel} Gru${s.parallel === 1 ? '' : 's'} at once.`)}
      {row(
        'Pick up follow-ups',
        toggle(ui, 'follow-ups', s.followUps, () => view.set(now => ({ followUps: !now.followUps }))),
        s.followUps ? 'A follow-up a Minion files joins its epic.' : 'A follow-up waits, named in the report.',
      )}
      {row(
        'Decide for me',
        toggle(ui, 'decide', s.decideForMe, () => view.set(now => ({ decideForMe: !now.decideForMe }))),
        s.decideForMe
          ? 'Each Gru splits a ticket or adds a blocking ticket on its own.'
          : 'Each Gru holds a split or a blocking ticket, and asks in its report.',
      )}
    </Box>
  )
}

export function drawSuperPane(ui: UI, w: number, view: SuperPaneView) {
  const { Box, Text, P } = ui
  const b = view.board
  if (b === null) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>No Super-Gru run</Text>
        <Text color={P.text}>The board shows a run once its super file is in ~/.cache/stark-progress.</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      {tabBar(ui, view.tab, view.setTab, ['overview', 'settings'])}
      {view.tab === 'settings' ? settings(ui, w, b, view) : overview(ui, w, b)}
    </Box>
  )
}
