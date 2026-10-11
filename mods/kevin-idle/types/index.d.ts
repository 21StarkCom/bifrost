/** The idle clock the band draws: idle since `since`, as of `now`, both epoch ms; the wake is due `seconds` after `since`. */
export type Idle = { since: number; seconds: number; now: number }

declare module 'claude-code' {
  interface PluginState {
    'kevin-idle': { idle: Idle | null }
  }
}
