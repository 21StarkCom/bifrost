import { atom, read, update } from 'claude-code'
import type { PromptComposeSection, Register, StateDollar } from 'claude-code'

import type { Idle } from '../types'

// The wake skill/kevin's "Idle out" answers; the waker tools/kevin_idle.ts sends the same text.
export const WAKE_TEXT = 'kevin idle check'
// tools/stark_config_lib.ts's DEFAULT_KEVIN, which this module cannot import.
const DEFAULT_IDLE_SECONDS = 7200
const POLL_MS = 60 * 1000
const KEVIN_NAME = /^KEVIN-[A-Za-z0-9_-]+-\d+$/

// The band's bar is the operator's status-line gauge (idavoll's statusline
// bar): a rail, CELLS cells fading light to dark red, the rest dim.
export const CELLS = 10
const LIGHT = [248, 168, 168]
const DARK = [139, 0, 0]
const RAIL = '#d0d0d0'
const EMPTY = '#8a8a8a'

const idle = atom({ plugin: 'kevin-idle', key: 'idle' } as const, null)

/** What tells Kevin the mod is armed and at what threshold, so he starts no waker of his own. */
export function armed(idleSeconds: number): PromptComposeSection {
  return {
    id: 'kevin-idle:armed',
    scope: 'session',
    text:
      `kevin-idle: the kevin-idle mod is armed in this session, at kevin.idle_seconds ${idleSeconds}. ` +
      `It sends you \`${WAKE_TEXT}\` once you have gone ${idleSeconds} seconds without a turn, so start no ` +
      'idle waker of your own.',
  }
}

/** A Claude Kevin stands in a worktree named for his launch id, `KEVIN-<repo>-<n>`. */
export function isKevinRoot(root: string): boolean {
  return KEVIN_NAME.test(root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '')
}

/** The stark config's paths, as tools/asset_root_lib.ts's assetConfigPath probes them, flat first. */
export function configPaths(assetRoot: string | undefined, home: string | undefined): string[] {
  if (assetRoot) return [`${assetRoot}/config.json`, `${assetRoot}/global/config.json`]

  return home ? [`${home}/.claude/code-review/config.json`] : []
}

/** `kevin.idle_seconds` from the config's text when it is a whole number of seconds, at least 1; else the default. */
export function idleSeconds(text: string | undefined): number {
  try {
    const value: unknown = JSON.parse(text ?? '').kevin?.idle_seconds

    return Number.isInteger(value) && (value as number) >= 1 ? (value as number) : DEFAULT_IDLE_SECONDS
  } catch {
    return DEFAULT_IDLE_SECONDS
  }
}

/** Filled cells, rounded down: the bar is full only once the wake is due. */
export function filled(state: Idle): number {
  const share = (state.now - state.since) / (state.seconds * 1000)

  return Math.min(CELLS, Math.max(0, Math.floor(share * CELLS)))
}

/** Cell `i`'s colour, `#rrggbb`, from LIGHT at the first cell to DARK at the last. */
export function shade(i: number): string {
  const hex = (a: number, b: number) =>
    Math.round(a + ((b - a) * i) / (CELLS - 1))
      .toString(16)
      .padStart(2, '0')

  return `#${LIGHT.map((a, k) => hex(a, DARK[k]!)).join('')}`
}

/** Whole minutes as the status line writes them: `<1m`, `48m`, `1h05m`, `2h`. */
export function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const rest = minutes % 60

  return `${Math.floor(minutes / 60)}h${rest === 0 ? '' : `${String(rest).padStart(2, '0')}m`}`
}

/** Local `HH:MM` of an epoch time. */
export function clockTime(ms: number): string {
  const at = new Date(ms)

  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** Publishes the band's state; a write redraws the band. */
async function publish($: StateDollar, value: Idle | null): Promise<void> {
  await update($, idle, () => value)
}

export const register: Register = on => {
  let isKevin = false
  let seconds = DEFAULT_IDLE_SECONDS
  let section: PromptComposeSection | null = null
  let isBusy = false
  // When the last wake went out: a wake that never became a turn (another hook
  // refused it) goes again a period later, not never.
  let wakeMs = 0
  let lastMs = 0

  // What the band draws as of `now`: nothing while a turn runs.
  const idleAt = (now: number): Idle | null => (isBusy ? null : { since: Math.max(lastMs, wakeMs), seconds, now })

  on('session.start', async ($, e, next) => {
    if (!isKevinRoot(await $.session.root())) return next(e)
    isKevin = true
    const [assetRoot, home] = await Promise.all([$.env.get('STARK_ASSET_ROOT'), $.env.get('HOME')])
    let text: string | undefined
    for (const path of configPaths(assetRoot, home)) {
      text = await $.fs.read(path).catch(() => undefined)
      if (typeof text === 'string') break
    }
    seconds = idleSeconds(text)
    section = armed(seconds)
    lastMs = await $.clock.now()
    await publish($, idleAt(lastMs))

    $.clock.every(POLL_MS, async () => {
      const now = await $.clock.now()
      if (isBusy || now - Math.max(lastMs, wakeMs) < seconds * 1000) return publish($, idleAt(now))
      // Once per idle period: the wake's own turn restarts the clock.
      wakeMs = now
      await publish($, idleAt(now))
      await $.prompt.submit({ text: WAKE_TEXT })
    })

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    isBusy = true
    lastMs = await $.clock.now()
    if (isKevin) await publish($, idleAt(lastMs))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn ends inside the main one; only the main loop's end is idle.
    if (e.agentId === undefined) {
      isBusy = false
      lastMs = await $.clock.now()
      if (isKevin) await publish($, idleAt(lastMs))
    }

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return section === null ? composed : { sections: [...composed.sections, section] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, idle)
    if (e.props.hasSurvey || state === null) return next(e)

    const { Text } = $.ui.resolve(e)
    const n = filled(state)

    return (
      <Text key="kevin-idle">
        <Text color={shade(0)}>IDLE</Text> <Text color={RAIL}>▐</Text>
        {Array.from({ length: n }, (_, i) => (
          <Text key={`cell-${i}`} color={shade(i)}>
            █
          </Text>
        ))}
        <Text color={EMPTY}>{'░'.repeat(CELLS - n)}</Text>
        <Text color={RAIL}>▌</Text> {duration(state.now - state.since)} / {duration(state.seconds * 1000)}{' '}
        <Text dimColor>· wakes {clockTime(state.since + state.seconds * 1000)}</Text>
      </Text>
    )
  })
}
