export type Stage = 'ticket' | 'pr' | 'review' | 'merged' | 'closed' | 'blocked'

/** `~/.cache/stark-progress/<STARK-n>.json`, one per ticket. */
export type TicketFile = {
  id: string
  title: string
  stage: Stage
  pr: string | null
  updated: string
}

/** `~/.cache/stark-progress/run-<id>.json`, one per Gru run. */
export type RunFile = {
  epic: string
  session: string
  tickets: string[]
}

export type Row = { id: string; title: string; stage: Stage }

/** What the band draws: a Gru run's rows, or a worker's one row. */
export type View = { heading: string | null; rows: Row[] }

declare module 'claude-code' {
  interface PluginState {
    'stark-progress': { view: View | null }
  }
}
