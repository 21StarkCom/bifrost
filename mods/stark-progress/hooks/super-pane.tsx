import type { EpicStats, GithubEvent, PaneTab, SuperBoard, SuperRow, SuperSettings, SuperState } from '../types'
import { clockOf, MAX_WORKERS } from './board'
import {
  choice,
  countsText,
  cut,
  divider,
  markText,
  PR_INK,
  prCard,
  settingRow,
  sinceOf,
  statsTab,
  tabBar,
  ticketLabel,
  toggle,
} from './pane'
import type { UI } from './pane'
import { counted, grouped, short } from './stats'
import { dur } from './view'

// The Super-Gru pane, in Super-Gru's own tab: one row for each epic, the
// blocked tickets worth a look (Overview), the counts of the whole run (Mega
// stats), the PR activity of every epic (GitHub), and the run's settings
// (Settings). The model is super.ts's.

/** The Super-Gru pane's tabs, in order; its Stats tab is `Mega stats`. */
export const SUPER_TABS: readonly PaneTab[] = ['overview', 'stats', 'github', 'settings']

export type SuperPaneView = {
  board: SuperBoard | null
  tab: PaneTab
  setTab: (tab: PaneTab) => unknown
  /** The ticket whose PR is open on the GitHub tab, or ''. */
  ghFocus: string
  setGhFocus: (id: string) => unknown
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

/** The heads of the Mega stats tab's `By epic` table. */
const EPIC_HEADS = ['done', 'working', 'output', 'calls', 'lines', 'PRs merged'] as const

/** One row for each epic: its tickets done, and its Gru's and its workers' counts, added. */
function epicTable(ui: UI, rows: readonly EpicStats[]) {
  const { Box, Text, P } = ui
  if (rows.length === 0) return null
  const cells = rows.map(r => [
    r.total === null ? '—' : `${r.done ?? 0}/${r.total}`,
    dur(r.busyMs),
    short(r.output),
    short(r.calls),
    r.added === 0 && r.removed === 0 ? '0' : `+${short(r.added)} −${short(r.removed)}`,
    `${r.merged}/${r.prs}`,
  ])
  const idWidth = Math.max(...rows.map(r => r.epic.length)) + 2
  // Each column is as wide as its head or its widest value; the values right-align in it.
  const widths = EPIC_HEADS.map((h, i) => Math.max(h.length, ...cells.map(c => c[i]?.length ?? 0)))
  const line = (values: readonly string[]) => values.map((v, i) => v.padStart((widths[i] ?? 0) + 2)).join('')

  return (
    <Box flexDirection="column">
      <Text bold>By epic</Text>
      <Text mono color={P.hint} wrap="truncate-end">{`  ${''.padEnd(idWidth)}${line(EPIC_HEADS)}`}</Text>
      {rows.map((r, i) => (
        <Text key={`ep${r.epic}`} mono wrap="truncate-end">
          <Text bold>{`  ${r.epic.padEnd(idWidth)}`}</Text>
          <Text>{line(cells[i] ?? [])}</Text>
        </Text>
      ))}
    </Box>
  )
}

/** The Mega stats tab: the Gru pane's Stats table in four columns, then one row for each epic. */
function megaStats(ui: UI, w: number, b: SuperBoard) {
  const tickets = b.rows.reduce((n, r) => n + (r.total ?? 0), 0)

  return statsTab(ui, w, b.stats, b.readAt, {
    title: `Mega stats for ${b.launchId}`,
    who: `Super-Gru's own counts, its Grus', its workers', and the whole run's: ${counted(b.rows.length, 'epic')}, ${counted(tickets, 'ticket')}.`,
    empty: "No stats yet. The mod counts in Super-Gru's tab, in each Gru's tab and in each worker's tab, once each has the mod.",
    after: epicTable(ui, b.epicStats),
  })
}

/** A PR event's word, in its state's color. */
const PR_WORD: Record<'opened' | 'merged' | 'closed', readonly [string, keyof typeof PR_INK]> = {
  opened: ['OPENED', 'OPEN'],
  merged: ['MERGED', 'MERGED'],
  closed: ['CLOSED', 'CLOSED'],
}

/** `Latest activity`: each event's time, its ticket's id, then what happened. */
function activity(ui: UI, w: number, events: readonly GithubEvent[], now: number) {
  const { Box, Text, P } = ui
  const times = events.map(e => sinceOf(e.at, now))
  const timeWidth = Math.max(...times.map(t => t.length))
  const idWidth = Math.max(...events.map(e => e.id.length)) + 2

  return (
    <Box flexDirection="column">
      <Text bold>⚡ Latest activity</Text>
      {events.map((e, i) => {
        const lead = `  ${(times[i] ?? '').padEnd(timeWidth)}  `
        // A commit's headline takes what the time, the id, the mark and the short id leave.
        const room = w - lead.length - idWidth - 1 - 2 - e.head.length - 1
        const body =
          e.kind === 'commit' ? (
            <Text>
              {e.mark !== null && markText(ui, e.mark, `am${i}`)}
              {e.mark !== null && ' '}
              <Text color={P.id}>{e.head}</Text>
              <Text color={P.text}>{` ${cut(e.tail, Math.max(room, 2))}`}</Text>
            </Text>
          ) : e.kind === 'run' ? (
            <Text>
              {e.mark !== null && markText(ui, e.mark, `am${i}`)}
              <Text>{` ${e.head} `}</Text>
              <Text color={P.hint}>{e.tail}</Text>
            </Text>
          ) : (
            <Text>
              <Text>{`${e.head} `}</Text>
              <Text bold color={P[PR_INK[PR_WORD[e.kind][1]]]}>
                {PR_WORD[e.kind][0]}
              </Text>
            </Text>
          )

        return (
          <Text key={`a${i}`} wrap="truncate-end">
            <Text color={P.hint}>{lead}</Text>
            <Text color={P.id}>{`[${e.id}]`.padEnd(idWidth)}</Text>
            {' '}
            {body}
          </Text>
        )
      })}
    </Box>
  )
}

/**
 * The GitHub tab: the counts of all PRs and their size, each epic's PRs, the
 * open PRs with a failing check, the newest activity, then each PR's card,
 * grouped by epic.
 */
function github(ui: UI, w: number, b: SuperBoard, view: SuperPaneView) {
  const { Box, Text, P } = ui
  const g = b.github
  const gh = g.view
  const c = gh.counts
  const idWidth = Math.max(...g.epics.map(e => e.epic.length), 4) + 2
  const prsWord = (n: number) => (n === 1 ? '1 PR' : `${n} PRs`)

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>🐙 GitHub activity</Text>
        {c.prs === 0 ? (
          <Text color={P.text}>
            {gh.waiting.length > 0 ? 'Asking GitHub for the PRs.' : 'No ticket of this run has a PR yet.'}
          </Text>
        ) : (
          countsText(ui, `${prsWord(c.prs)}: `, [
            [c.merged, 'merged', 'merged'],
            [c.open, 'open', 'pr'],
            [c.draft, 'draft', 'gray'],
            [c.closed, 'closed', 'blocked'],
          ])
        )}
        {c.prs > 0 &&
          countsText(ui, 'runs: ', [
            [c.passed, 'passed', 'green'],
            [c.failing, 'failing', 'blocked'],
            [c.running, 'running', 'blue'],
            [c.queued, 'queued', 'gray'],
          ])}
        {c.prs > 0 && (
          <Text color={P.text}>
            <Text color={P.green}>{`+${grouped(g.added)}`}</Text>
            <Text color={P.blocked}>{` −${grouped(g.removed)}`}</Text>
            {` in ${counted(g.commits, 'commit')}`}
          </Text>
        )}
        {gh.readAt !== null && (
          <Text color={P.hint}>{`Read from GitHub at ${clockOf(gh.readAt)}. The tab asks again each minute while it is open.`}</Text>
        )}
        {gh.errors.map((e, i) => (
          <Text key={`e${i}`} color={P.amber}>
            {e}
          </Text>
        ))}
      </Box>

      {c.prs > 0 && (
        <Box flexDirection="column">
          <Text bold>By epic</Text>
          {g.epics.map(e => (
            <Text key={`ge${e.epic}`} wrap="truncate-end">
              <Text bold>{`  ${e.epic.padEnd(idWidth)}`}</Text>
              {e.ids.length === 0 ? (
                <Text color={P.hint}>no PR yet</Text>
              ) : (
                countsText(ui, `${prsWord(e.ids.length)}: `, [
                  [e.merged, 'merged', 'merged'],
                  [e.open, 'open', 'pr'],
                  [e.draft, 'draft', 'gray'],
                  [e.closed, 'closed', 'blocked'],
                ])
              )}
              {e.ids.length > 0 && <Text color={P.green}>{`  +${grouped(e.added)}`}</Text>}
              {e.ids.length > 0 && <Text color={P.blocked}>{` −${grouped(e.removed)}`}</Text>}
              {e.failing > 0 && <Text bold color={P.blocked}>{` · ✕ ${e.failing} failing`}</Text>}
            </Text>
          ))}
        </Box>
      )}

      {c.prs > 0 &&
        (g.failing.length === 0 ? (
          <Text color={P.green}>🌿 No open PR has a failing check.</Text>
        ) : (
          <Box flexDirection="column" borderStyle="round" borderColor={P.amber} paddingX={1}>
            <Text bold color={P.amber}>
              🙋 Failing checks
            </Text>
            {g.failing.map(f => (
              <Box key={`f${f.id}`} flexDirection="column">
                {ticketLabel(ui, f.id, f.name, w - 4)}
                <Text color={P.text}>
                  {`  PR #${f.number}: `}
                  <Text color={P.blocked}>{f.runs.map(r => `✕ ${r}`).join('  ')}</Text>
                </Text>
              </Box>
            ))}
          </Box>
        ))}

      {g.activity.length > 0 && activity(ui, w, g.activity, b.readAt)}

      {/* Each epic's PRs under its own line, with an empty row between two PRs. */}
      {gh.prs.length > 0 && (
        <Box flexDirection="column" gap={1}>
          {g.epics
            .filter(e => e.ids.length > 0)
            .flatMap(e => [
              divider(ui, w, e.epic, e.ids.length),
              ...gh.prs.filter(p => e.ids.includes(p.id)).map(item => prCard(ui, w, item, b.readAt, view)),
            ])}
          {view.ghFocus === '' && <Text color={P.hint}>Select a name to see each job and the newest commits.</Text>}
        </Box>
      )}

      {gh.waiting.length > 0 && (
        <Box flexDirection="column">
          <Text color={P.hint}>Waiting for GitHub:</Text>
          <Box flexWrap="wrap" columnGap={1} paddingLeft={2}>
            {gh.waiting.map(id => (
              <Box key={`w${id}`}>{ticketLabel(ui, id, '', w)}</Box>
            ))}
          </Box>
        </Box>
      )}
      {gh.noPr.length > 0 && (
        <Box flexDirection="column">
          <Text color={P.hint}>No PR yet:</Text>
          <Box flexWrap="wrap" columnGap={1} paddingLeft={2}>
            {gh.noPr.map(id => (
              <Box key={`n${id}`}>{ticketLabel(ui, id, '', w)}</Box>
            ))}
          </Box>
        </Box>
      )}
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

/** The line that says the run ended: the pane keeps the last board Super-Gru left. */
function endedLine(ui: UI, b: SuperBoard) {
  const { Text, P } = ui

  return b.endedAt === null ? null : (
    <Text color={P.amber}>{`The run ended at ${clockOf(b.endedAt)}. The pane keeps its last counts; it reads no more.`}</Text>
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
      {tabBar(ui, view.tab, view.setTab, SUPER_TABS, { stats: 'Mega stats' })}
      {endedLine(ui, b)}
      {view.tab === 'settings'
        ? b.endedAt !== null
          ? <Text color={P.text}>The run ended, and Super-Gru removed its settings file. Nothing reads a change now.</Text>
          : settings(ui, w, b, view)
        : view.tab === 'stats'
          ? megaStats(ui, w, b)
          : view.tab === 'github'
            ? github(ui, w, b, view)
            : overview(ui, w, b)}
    </Box>
  )
}
