export type Stage = 'ticket' | 'pr' | 'review' | 'merged' | 'closed' | 'blocked'

/** The spine step a ticket's settings hold, while they hold one. */
export type Hold = 'merge' | 'release'

/** `~/.cache/stark-progress/<STARK-n>.json`, one per ticket. */
export type TicketFile = {
  id: string
  title: string
  stage: Stage
  pr: string | null
  updated: string
  /** The worker's worktree, from the spine's command; absent in a v1 file. */
  worktree?: string | null
  /** The step its settings hold; absent or null when none does. */
  hold?: Hold | null
}

/**
 * `~/.cache/stark-progress/<STARK-n>.settings.json`, the ticket's settings:
 * the ticket pane writes it, and the worker reads it before its review, its
 * merge and its release. A field that is absent or of the wrong type takes
 * its default.
 */
export type TicketSettings = {
  mergeOnGreen: boolean
  reviewDepth: 'by-change' | 'deep'
  release: 'run' | 'stop'
}

/** `~/.cache/stark-progress/run-<id>.json`, one per Gru run. */
export type RunFile = {
  epic: string
  session: string
  tickets: string[]
  /** The launch's `--max-workers` and Minion runtime; absent in a v1 file. */
  maxWorkers?: number
  minionAgent?: 'claude' | 'codex'
}

/**
 * `~/.cache/stark-progress/run-<id>.settings.json`, the run's settings: the
 * pane writes it, and Gru reads it before each launch. An absent field keeps
 * the launch's value.
 */
export type GruSettings = {
  decideForMe: boolean
  maxWorkers: number
  followUps: boolean
  minionAgent: 'claude' | 'codex'
}

/** One minute of a heartbeat: `at` is the minute since the epoch. */
export type BeatMinute = { at: number; calls: number; fails: number }

/**
 * `~/.cache/stark-progress/<STARK-n>.beat.json`, the activity of a worker's own
 * Claude session. The mod writes it, in that session alone.
 */
export type BeatFile = {
  id: string
  session: string
  updated: string
  /** The last time a tool call started or ended. */
  lastActivity: string | null
  /** The oldest tool call still running. */
  running: { tool: string; since: string } | null
  /** Calls and failures per minute, for the last 60 minutes. */
  minutes: BeatMinute[]
  /** The outcomes of the last 10 calls that ended, oldest first: `true` failed. */
  recent: boolean[]
}

/** What git says of a worktree: commit times since its base (ms), and the diff size against it. */
export type GitSignal = { commits: number[]; added: number; removed: number }

export type Tone = 'good' | 'warn' | 'bad' | 'dim'

export type Verdict = {
  word: 'done' | 'blocked' | 'held' | 'idle' | 'moving' | 'slow' | 'stalled' | 'waiting'
  text: string
  tone: Tone
}

/** One piece of the stage track: done stages, the stages to come, or the current stage in its verdict's tone. */
export type Seg = { ch: string; tone: 'done' | 'todo' | Tone }

/** One 5-minute cell of a row's timeline. */
export type Cell = { ch: string; kind: 'none' | 'quiet' | 'busy' | 'fail' | 'milestone' | 'running' }

export type Row = {
  id: string
  title: string
  stage: Stage
  inStage: string
  track: Seg[]
  cells: Cell[]
  verdict: Verdict
  failed: string | null
  diff: string | null
}

export type Count = { label: string; tone: Tone }

/** What the band draws: a Gru run's rows with a header and a legend, or a worker's one row. */
export type View = { heading: string | null; counts: Count[]; hasLegend: boolean; rows: Row[] }

/** The color a ticket draws in on the Gru pane. */
export type BoardTone = 'done' | 'move' | 'warn' | 'idle' | 'none'

/** A ticket on the Gru pane: the band's row read calmly, with its detail. */
export type BoardRow = {
  id: string
  /** The title without its `repo: ` lead and `(slice n of m)` tail. */
  name: string
  repo: string | null
  slice: string | null
  /** The station it is at: -1 not started, 5 past the last. */
  at: number
  tone: BoardTone
  emoji: string
  status: string
  /** Why it is worth a look, or null. */
  attention: string | null
  /** The lines its row shows opened. */
  detail: string[]
}

/** What the Gru pane draws: one run, its counts, and its settings. */
export type Board = {
  launchId: string
  epic: string
  /** True when the run is this session's own: Gru's tab. */
  isOwn: boolean
  repos: string[]
  rows: BoardRow[]
  /** Closed tickets, as the band counts them. */
  done: number
  inProgress: number
  notStarted: number
  /** The tickets with no file yet, in run order. */
  next: string[]
  /** The other runs with a change in the last hour. */
  others: { launchId: string; epic: string }[]
  settings: GruSettings
  readAt: number
}

/** What the ticket pane draws: a worker's own ticket, read as the Gru pane reads it, and its settings. */
export type TicketBoard = {
  id: string
  /** The title without its `[tag]`, `repo: ` lead and `(slice n of m)` tail. */
  name: string
  repo: string | null
  slice: string | null
  /** The epic of a Gru run that lists the ticket, or null. */
  epic: string | null
  /** The station it is at: 5 past the last. */
  at: number
  tone: BoardTone
  emoji: string
  status: string
  hold: Hold | null
  /** Why it is worth a look, or null. */
  attention: string | null
  /** The tool calls, failures, diff size and commits, one line each. */
  activity: string[]
  /** The next spine step, or null once the ticket is closed. */
  next: string | null
  settings: TicketSettings
  readAt: number
}

export type PaneTab = 'overview' | 'settings'

declare module 'claude-code' {
  interface PluginState {
    'stark-progress': {
      view: Shaped<View | null>
      board: Shaped<Board | null>
      tab: PaneTab
      /** The ticket whose row is open on the pane, or ''. */
      focus: string
      /** The launch id the pane shows, or '' for this tab's own or the most active run. */
      pick: string
      /** The ticket pane's model, in a worker's own tab. */
      ticket: Shaped<TicketBoard | null>
      ticketTab: PaneTab
    }
  }
}
