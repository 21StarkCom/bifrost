export type Option = {
  label: string
  detail?: string
}

// What the operator sent for one question: the indexes of the picked options
// and their own words.
export type Answer = {
  picks: number[]
  words: string
  // When the operator sent it, `HH:MM UTC`.
  at: string
}

// How an answer reached Claude: beside a tool result of its running turn,
// as a message of its own, or above the operator's typed prompt.
export type Route = 'turn' | 'message' | 'prompt'

export type Question = {
  // A short id the operator sees, such as Q1. Unique in the session.
  id: string
  question: string
  // Markdown: the context and why the answer matters.
  detail?: string
  options: Option[]
  multiSelect: boolean
  // The label of the option Claude recommends.
  recommended?: string
  state: 'open' | 'answered' | 'withdrawn'
  // Set once the operator sends an answer.
  answer?: Answer
  // Set once the answer is on its way to Claude.
  read?: { at: string; route: Route }
}

// An answer the operator has started and not sent.
export type Draft = {
  picks: number[]
  words: string
}

declare module 'claude-code' {
  interface PluginState {
    interview: {
      // Every question of the session, in the order Claude asked them.
      questions: Shaped<Question[]>
      // Keyed by question id.
      drafts: Shaped<Record<string, Draft>>
      // The id of the question on screen, or '' for the list of all questions.
      cursor: string
      // True while a main-loop turn runs.
      working: boolean
    }
  }
}
