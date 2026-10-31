// The tags the root rules allow on a question that ends a turn.
export type Kind = 'GO' | 'Yours' | 'Your hands' | 'Design approval'

// One `Needs you (<tag>): <question>` line.
export type Ask = {
  kind: Kind
  // The tag as written, such as `Yours: clouds`.
  tag: string
  question: string
  // The words after "I recommend", without the end stop.
  pick?: string
}

// The operator's answer to one line: the yes side or the no side.
export type Answer = 'yes' | 'no'

// The lines one turn ended on, and the answers so far.
export type Asks = {
  turnId: string
  items: Ask[]
  // One per item; null is no answer yet.
  answers: (Answer | null)[]
}

declare module 'claude-code' {
  interface PluginState {
    'needs-you': {
      // null until a main-loop turn ends on Needs you lines.
      asks: Shaped<Asks | null>
    }
  }
}
