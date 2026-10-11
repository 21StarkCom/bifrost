import type { PromptComposeSection, Register } from 'claude-code'

// The wake skill/kevin's "Idle out" answers; the waker tools/kevin_idle.ts sends the same text.
export const WAKE_TEXT = 'kevin idle check'
// tools/stark_config_lib.ts's DEFAULT_KEVIN, which this module cannot import.
const DEFAULT_IDLE_SECONDS = 7200
const POLL_MS = 60 * 1000
const KEVIN_NAME = /^KEVIN-[A-Za-z0-9_-]+-\d+$/

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

export const register: Register = on => {
  let section: PromptComposeSection | null = null
  let isBusy = false
  // When the last wake went out: a wake that never became a turn (another hook
  // refused it) goes again a period later, not never.
  let wakeMs = 0
  let lastMs = 0

  on('session.start', async ($, e, next) => {
    if (!isKevinRoot(await $.session.root())) return next(e)
    const [assetRoot, home] = await Promise.all([$.env.get('STARK_ASSET_ROOT'), $.env.get('HOME')])
    let text: string | undefined
    for (const path of configPaths(assetRoot, home)) {
      text = await $.fs.read(path).catch(() => undefined)
      if (typeof text === 'string') break
    }
    const seconds = idleSeconds(text)
    section = armed(seconds)
    lastMs = await $.clock.now()

    $.clock.every(POLL_MS, async () => {
      const now = await $.clock.now()
      if (isBusy || now - Math.max(lastMs, wakeMs) < seconds * 1000) return
      // Once per idle period: the wake's own turn restarts the clock.
      wakeMs = now
      await $.prompt.submit({ text: WAKE_TEXT })
    })

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    isBusy = true
    lastMs = await $.clock.now()

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn ends inside the main one; only the main loop's end is idle.
    if (e.agentId === undefined) {
      isBusy = false
      lastMs = await $.clock.now()
    }

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return section === null ? composed : { sections: [...composed.sections, section] }
  })
}
