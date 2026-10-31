import type { Hold, PaneTab, TicketBoard, TicketSettings } from '../types'
import { clockOf } from './board'
import { choice, cut, hour, line, P, segFor, settingRow, stationHeader, tabBar, toggle } from './pane'
import type { UI } from './pane'

// The ticket pane, in a Minion's or Agnes's own tab: one ticket, all of it at
// once (Overview), and the settings its worker reads before its review, its
// merge and its release (Settings). The model is ticket.ts's.

export type TicketPaneView = {
  ticket: TicketBoard | null
  tab: PaneTab
  setTab: (tab: PaneTab) => unknown
  /** A change made from the settings as they are when it is written, so two quick presses both count. */
  set: (change: (s: TicketSettings) => Partial<TicketSettings>) => unknown
}

/** What clears a hold, said where the hold is. */
const CLEARS: Record<Hold, string> = {
  merge: 'Set Merge when checks pass to On in Settings, and the worker merges.',
  release: 'Set Release to run the chain in Settings, and the worker publishes.',
}

function overview(ui: UI, w: number, t: TicketBoard) {
  const { Box, Text } = ui
  const seg = segFor(w)
  const about = [t.id, t.repo, t.slice].filter((words): words is string => words !== null).join(' · ')

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>{cut(t.name, w)}</Text>
        <Text color={P.text}>{about}</Text>
        {t.epic !== null && <Text color={P.text}>{`Part of ${t.epic}`}</Text>}
      </Box>

      <Box flexDirection="column">
        <Text bold>🚇 Where it is</Text>
        <Text color={P.hint}>{`  ${stationHeader(seg)}`}</Text>
        <Box columnGap={2} paddingLeft={2}>
          <Box flexShrink={0}>{line(ui, t, seg)}</Box>
          <Text color={t.tone === 'warn' ? P.amber : P.text}>{`${t.emoji} ${t.status}`}</Text>
        </Box>
      </Box>

      {t.attention === null ? (
        <Text color={P.green}>🌿 Nothing needs you right now.</Text>
      ) : (
        <Box flexDirection="column" borderStyle="round" borderColor={P.amber} paddingX={1}>
          <Text bold color={P.amber}>
            🙋 Worth a look
          </Text>
          <Text>{t.attention}</Text>
          {t.hold !== null && <Text color={P.text}>{CLEARS[t.hold]}</Text>}
        </Box>
      )}

      <Box flexDirection="column">
        <Text bold>🔧 Activity</Text>
        {t.activity.map((words, i) => (
          <Text key={`a${i}`} color={P.text}>
            {words}
          </Text>
        ))}
        {hour(ui, t.cells)}
      </Box>

      {t.next !== null && (
        <Box flexDirection="column">
          <Text bold>👉 Up next</Text>
          <Text>{t.next}</Text>
        </Box>
      )}
      <Text color={P.hint}>{`Read from ~/.cache/stark-progress at ${clockOf(t.readAt)}.`}</Text>
    </Box>
  )
}

function settings(ui: UI, w: number, t: TicketBoard, view: TicketPaneView) {
  const { Box, Text } = ui
  const s = t.settings

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>{`Settings for ${t.id}`}</Text>
        <Text color={P.text}>
          The worker reads these before its review, its merge and its release. Select a value to change it.
        </Text>
      </Box>
      {settingRow(
        ui,
        w,
        'Merge when checks pass',
        toggle(ui, 'merge', s.mergeOnGreen, () => view.set(now => ({ mergeOnGreen: !now.mergeOnGreen }))),
        s.mergeOnGreen
          ? 'The worker merges once the review and the checks pass.'
          : 'The worker holds the merge, and waits until you set this On.',
      )}
      {settingRow(
        ui,
        w,
        'Review depth',
        choice(ui, 'review', s.reviewDepth === 'deep' ? 'deep' : 'by what the PR changes', () =>
          view.set(now => ({ reviewDepth: now.reviewDepth === 'deep' ? 'by-change' : 'deep' })),
        ),
        s.reviewDepth === 'deep'
          ? 'A code PR gets /code-review xhigh, even after a live run.'
          : 'The review follows what the PR changes, as the worker spine says.',
      )}
      {settingRow(
        ui,
        w,
        'Release',
        choice(ui, 'release', s.release === 'stop' ? 'stop before publish' : 'run the chain', () =>
          view.set(now => ({ release: now.release === 'stop' ? 'run' : 'stop' })),
        ),
        s.release === 'stop'
          ? 'The worker stops before the release publishes, and waits until you set run the chain.'
          : "The worker runs the repo's release chain after the merge.",
      )}
    </Box>
  )
}

export function drawTicketPane(ui: UI, w: number, view: TicketPaneView) {
  const { Box, Text } = ui
  const t = view.ticket
  if (t === null) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>No ticket file yet</Text>
        <Text color={P.text}>The pane shows this tab's ticket once its file is in ~/.cache/stark-progress.</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      {tabBar(ui, view.tab, view.setTab)}
      {view.tab === 'settings' ? settings(ui, w, t, view) : overview(ui, w, t)}
    </Box>
  )
}
