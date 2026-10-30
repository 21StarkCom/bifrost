export type DeckOption = {
  id: string
  label: string
  detail?: string
}

export type DeckItem = {
  id: string
  title: string
  // Markdown: what it is, why it matters, the catch.
  explain: string
  facts?: string[]
  options: DeckOption[]
  // The option id Claude recommends, marked "my pick".
  recommended?: string
}

export type Deck = {
  id: string
  title: string
  intro?: string
  // What the person asks Claude to do with the answers; ends the message.
  outro?: string
  items: DeckItem[]
}

export type Answer = {
  picks: string[]
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'decision-deck': {
      // null until Claude presents a deck with the present tool.
      deck: Shaped<Deck | null>
      // An item's index, or the item count for the page of all answers.
      cursor: number
      // Keyed `<deck id>-<item id>`.
      answers: Shaped<Record<string, Answer>>
      // Deck id to the time its answers were sent.
      sent: Shaped<Record<string, string>>
    }
  }
}
