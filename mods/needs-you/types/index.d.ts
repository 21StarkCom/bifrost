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

// One line asked since the operator's last message, and what the operator gave it so far.
export type Row = {
  // The row's name for the session. Its field's key is built on it, so a
  // field never moves to another row when a row above it leaves.
  id: string
  ask: Ask
  // null is no side picked yet.
  answer: Answer | null
  // The operator's own words for the line, as typed; '' is none.
  words: string
  // The field's `value` and a count in its key. Both change only when the mod
  // draws the field again on purpose: after Enter, which empties a field, and
  // for a row that a dropped message put back. A field keeps the person's own text while
  // its value stays the same, so a fast key never meets an older value.
  field: { value: string; rev: number }
}

declare module 'claude-code' {
  interface PluginState {
    'needs-you': {
      // The lines asked since the operator's last message, oldest first; that
      // message, or Send, empties it.
      asks: Shaped<Row[]>
    }
  }
}
