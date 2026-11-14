import type { EpicGithub, EpicStats, GithubEvent, PaneTab, SuperBoard, SuperRow, SuperSettings, SuperState } from '../types'
import { clockOf, MAX_WORKERS } from './board'
import { superLogName } from './log'
import {
  choice,
  countsText,
  cut,
  divider,
  githubFoot,
  githubHead,
  logTab,
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
import { bar, dur } from './view'

// The Super-Gru pane, in Super-Gru's own tab: the epics in groups by state,
// with the blocked tickets worth a look (Overview), the steps of Super-Gru
// and of each Gru (Log), the counts of the whole run (Mega stats), the PR
// activity of every epic (GitHub), and the run's settings (Settings). The
// model is super.ts's. Each tab fits a pane of 64 columns, the width of a
// docked pane on a laptop, with no count cut.

/** The Super-Gru pane's tabs, in order; its Stats tab is `Mega stats`. */
export const SUPER_TABS: readonly PaneTab[] = ['overview', 'log', 'stats', 'github', 'settings']

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

/** `done 3/3`, `blocked 1/2`, or the state alone with no run file to count. */
export const stateWords = (r: Pick<SuperRow, 'state' | 'done' | 'total'>) =>
  r.total === null ? r.state : `${r.state} ${r.done ?? 0}/${r.total}`

/** The Overview's groups, in order: the state each one holds, and its name. */
const GROUPS: readonly (readonly [SuperState, string])[] = [
  ['blocked', 'Blocked'],
  ['in work', 'In work'],
  ['waiting', 'Waiting'],
  ['done', 'Done'],
]

/** The widest bar of an epic's tickets done, and the narrowest a narrow pane leaves it. */
const BAR_MAX = 24
const BAR_MIN = 8

/** The words after an epic's bar: `10 of 12 done`, its blocked count, and its Gru's state; null with no ticket list. */
const progressWords = (r: SuperRow) =>
  r.total === null
    ? null
    : { done: `${r.done ?? 0} of ${r.total} done`, blocked: r.blocked > 0 ? ` · ${r.blocked} blocked` : '', gru: ` · Gru ${r.gruState}` }

/**
 * An epic in work or blocked: a bar of its tickets done of its total, then
 * the words. Every bar of the Overview has one width, so two bars compare.
 */
function progress(ui: UI, r: SuperRow, barWidth: number) {
  const { Text, P } = ui
  const words = progressWords(r)
  if (words === null) return <Text color={P.text}>{`no ticket list yet · Gru ${r.gruState}`}</Text>
  const filled = bar(r.done ?? 0, r.total ?? 0, barWidth)

  return (
    <Text mono wrap="truncate-end">
      <Text color={P.green}>{filled}</Text>
      <Text color={P.track}>{'─'.repeat(Math.max(barWidth - [...filled].length, 0))}</Text>
      <Text color={P.text}>{`  ${words.done}`}</Text>
      {words.blocked !== '' && (
        <Text bold color={P.blocked}>
          {words.blocked}
        </Text>
      )}
      <Text color={P.text}>{words.gru}</Text>
    </Text>
  )
}

/**
 * One epic: `[STARK-n] <title>`, its id padded so every title starts in one
 * column, the title cut only at the pane's edge. An epic in work or blocked
 * adds its bar below; a waiting or done one is one line, in the dim text.
 */
function epicRow(ui: UI, w: number, r: SuperRow, idWidth: number, barWidth: number) {
  const { Box, Text, P } = ui
  const isQuiet = r.state === 'waiting' || r.state === 'done'
  const title = r.title === null ? '' : cut(r.title, Math.max(w - idWidth - 1, 2))

  return (
    <Box key={`e-${r.epic}`} flexDirection="column">
      <Text wrap="truncate-end">
        <Text color={P.id}>{`[${r.epic}]`.padEnd(idWidth)}</Text>
        {title !== '' && <Text color={isQuiet ? P.text : undefined}>{` ${title}`}</Text>}
      </Text>
      {!isQuiet && <Box paddingLeft={2}>{progress(ui, r, barWidth)}</Box>}
    </Box>
  )
}

function overview(ui: UI, w: number, b: SuperBoard) {
  const { Box, Text, P } = ui
  const count = (state: SuperState) => b.rows.filter(r => r.state === state).length
  const counts = (['in work', 'blocked', 'waiting'] as const)
    .filter(state => count(state) > 0)
    .map(state => ` · ${count(state)} ${state}`)
    .join('')
  // `[` and `]` around the widest id.
  const idWidth = Math.max(...b.rows.map(r => r.epic.length + 2), 6)
  // The bar takes what the longest words leave after the indent and the gap, BAR_MIN to BAR_MAX cells.
  const longest = Math.max(
    0,
    ...b.rows.map(progressWords).map(p => (p === null ? 0 : p.done.length + p.blocked.length + p.gru.length)),
  )
  const barWidth = Math.max(BAR_MIN, Math.min(BAR_MAX, w - 2 - 2 - longest))

  return (
    <Box flexDirection="column" gap={1}>
      {/* One column with no gap: each group's line brings its own empty row above and below it. */}
      <Box flexDirection="column">
        <Text bold>{`Super-Gru · ${b.launchId}`}</Text>
        <Text color={P.text}>{`${count('done')} of ${b.rows.length} epics done${counts}`}</Text>
        {GROUPS.flatMap(([state, name]) => {
          const rows = b.rows.filter(r => r.state === state)

          return rows.length === 0
            ? []
            : [divider(ui, w, name, rows.length, true), ...rows.map(r => epicRow(ui, w, r, idWidth, barWidth))]
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

/** The columns of the `By epic` table a narrow pane drops, in order: `calls`, then `output`. */
const EPIC_DROPS = [3, 2] as const

/**
 * One row for each epic with a Gru: its tickets done, and its Gru's and its
 * workers' counts, added. A table wider than the pane drops EPIC_DROPS' columns.
 */
function epicTable(ui: UI, w: number, rows: readonly EpicStats[]) {
  const { Box, Text, P } = ui
  if (rows.length === 0) return null
  // An epic with no ticket list (a Gru that ended before this tab kept its files) has no counts: `—`, never a 0.
  const cells = rows.map(r => r.total === null ? EPIC_HEADS.map(() => '—') : [
    `${r.done ?? 0}/${r.total}`,
    dur(r.busyMs),
    short(r.output),
    short(r.calls),
    r.added === 0 && r.removed === 0 ? '0' : `+${short(r.added)} −${short(r.removed)}`,
    `${r.merged}/${r.prs}`,
  ])
  const idWidth = Math.max(...rows.map(r => r.epic.length)) + 2
  // Each column is as wide as its head or its widest value; the values right-align in it.
  const widths = EPIC_HEADS.map((h, i) => Math.max(h.length, ...cells.map(c => c[i]?.length ?? 0)))
  const wide = (cols: readonly number[]) => 2 + idWidth + cols.reduce((n, i) => n + (widths[i] ?? 0) + 2, 0)
  let cols: readonly number[] = EPIC_HEADS.map((_, i) => i)
  for (const drop of EPIC_DROPS) if (wide(cols) > w) cols = cols.filter(i => i !== drop)
  const line = (values: readonly string[]) => cols.map(i => (values[i] ?? '').padStart((widths[i] ?? 0) + 2)).join('')

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

/** The epics whose Gru started: an epic with no Gru yet has no counts and no PR to draw. */
const startedOf = (b: SuperBoard) => new Set(b.rows.filter(r => r.gruState !== 'queued').map(r => r.epic))

/** The Mega stats tab: the Gru pane's Stats table in four columns, then one row for each epic with a Gru. */
function megaStats(ui: UI, w: number, b: SuperBoard) {
  const started = startedOf(b)

  return statsTab(ui, w, b.stats, b.readAt, {
    title: `Mega stats for ${b.launchId}`,
    who: `Super-Gru's own counts, its Grus', its workers', and the whole run's: ${counted(b.rows.length, 'epic')}, ${counted(b.tickets, 'ticket')}.`,
    empty: "No stats yet. The mod counts in Super-Gru's tab, in each Gru's tab and in each worker's tab, once each has the mod.",
    after: epicTable(ui, w, b.epicStats.filter(e => started.has(e.epic))),
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

/** An epic's PR counts in the order the GitHub tab names them, each with its word and its color. */
const epicCounts = (e: EpicGithub) =>
  [
    [e.merged, 'merged', 'merged'],
    [e.open, 'open', 'pr'],
    [e.draft, 'draft', 'gray'],
    [e.closed, 'closed', 'blocked'],
  ] as const

/**
 * One epic's line under `By epic`: its PRs by state, with no count of 0, then
 * their size and its failing count. A line wider than the pane puts the size
 * and the failing count on a second line, under the counts.
 */
function epicPrs(ui: UI, w: number, e: EpicGithub, idWidth: number, isListed: boolean) {
  const { Box, Text, P } = ui
  const lead = `  ${e.epic.padEnd(idWidth)}`
  if (e.ids.length === 0) {
    // An epic with no ticket list (its Gru ended before this tab kept its files) may have PRs: never `no PR yet`.
    return (
      <Text key={`ge${e.epic}`} wrap="truncate-end">
        <Text bold>{lead}</Text>
        <Text color={P.hint}>{!isListed ? 'no ticket list' : e.waiting > 0 ? 'waiting for GitHub' : 'no PR yet'}</Text>
      </Text>
    )
  }
  const counts = epicCounts(e).filter(([n]) => n > 0)
  const prs = `${e.ids.length === 1 ? '1 PR' : `${e.ids.length} PRs`}: `
  const size = `+${grouped(e.added)} −${grouped(e.removed)}`
  const failing = e.failing > 0 ? ` · ✕ ${e.failing} failing` : ''
  const countsWide = prs.length + counts.reduce((n, [k, word], i) => n + `${k} ${word}`.length + (i > 0 ? 3 : 0), 0)
  const isSplit = lead.length + countsWide + 2 + size.length + failing.length > w
  const tail = (
    <Text>
      <Text color={P.green}>{`+${grouped(e.added)}`}</Text>
      <Text color={P.blocked}>{` −${grouped(e.removed)}`}</Text>
      {failing !== '' && (
        <Text bold color={P.blocked}>
          {failing}
        </Text>
      )}
    </Text>
  )

  return (
    <Box key={`ge${e.epic}`} flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold>{lead}</Text>
        {countsText(ui, prs, counts)}
        {!isSplit && '  '}
        {!isSplit && tail}
      </Text>
      {isSplit && (
        <Text wrap="truncate-end">
          {' '.repeat(lead.length)}
          {tail}
        </Text>
      )}
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
  const started = startedOf(b)
  const unlisted = new Set(b.rows.filter(r => r.total === null).map(r => r.epic))
  const idWidth = Math.max(...g.epics.map(e => e.epic.length), 4) + 2
  const size = (
    <Text color={P.text}>
      <Text color={P.green}>{`+${grouped(g.added)}`}</Text>
      <Text color={P.blocked}>{` −${grouped(g.removed)}`}</Text>
      {` in ${counted(g.commits, 'commit')}`}
    </Text>
  )

  return (
    <Box flexDirection="column" gap={1}>
      {githubHead(
        ui,
        gh,
        '🐙 GitHub activity',
        b.endedAt === null ? 'The tab asks again each minute while it is open.' : 'The run ended: the tab asks no more.',
        size,
      )}

      {c.prs > 0 && (
        <Box flexDirection="column">
          <Text bold>By epic</Text>
          {g.epics.filter(e => started.has(e.epic)).map(e => epicPrs(ui, w, e, idWidth, !unlisted.has(e.epic)))}
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

      {githubFoot(ui, w, gh)}
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
        : view.tab === 'log'
          ? logTab(
              ui,
              w,
              b.log,
              "No steps yet. Super-Gru writes its own steps, and each Gru writes its run's.",
              `~/.cache/stark-progress/${superLogName(b.launchId)} and each live Gru's run log`,
            )
          : view.tab === 'stats'
            ? megaStats(ui, w, b)
            : view.tab === 'github'
              ? github(ui, w, b, view)
              : overview(ui, w, b)}
    </Box>
  )
}
