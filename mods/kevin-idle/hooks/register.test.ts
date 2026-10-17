import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { CELLS, WAKE_TEXT, armed, clockTime, configPaths, duration, filled, idleSeconds, isKevinRoot, shade } from './register'

// What `$.session.root()` answers at session.start in a Kevin, as measured on
// Claude Code 2.1.302: `idun kevin` runs `claude --worktree=KEVIN-<repo>-<n>`
// from the main checkout, and the root is the worktree that flag cuts.
const KEVIN_ROOT = '/Users/o/Code/bifrost/.claude/worktrees/KEVIN-bifrost-1'
const MINUTE = 60_000

/**
 * A session in `root` whose config holds `config`: `submitted` holds the text
 * of each prompt that entered, `contexts` the context each one carried.
 */
function session(on: On, root: string, config: string | null) {
  const submitted: string[] = []
  const contexts: (readonly string[])[] = []
  mock.env(on, { HOME: '/h' })
  on('session.root', () => ({ value: root }))
  on('fs.read', ($, e) => {
    if (config === null || e.path !== '/h/.claude/code-review/config.json') return { deny: 'ENOENT' }
    return { value: config }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    contexts.push(e.context ?? [])
    return { text: e.text }
  })
  return { submitted, contexts }
}

const start = ($: Engine) => $.session.start({ cwd: '/r', surface: null, isInteractive: true })
const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const
// The kickoff is a slash command, which the engine raises with `command` set.
const kickoff = { ...typed('/kevin from operator'), command: { name: 'kevin', args: 'from operator' } } as const
const fromPeer = (text: string) => ({ text, wait: false, origin: { kind: 'peer' } }) as const
const turn = async ($: Engine, id: string) => {
  await $.turn.start({ text: '', turnId: id })
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, turnId: id, isAborted: false })
}

test('only a KEVIN-<repo>-<n> worktree is a Kevin', () => {
  expect(isKevinRoot(KEVIN_ROOT)).toBe(true)
  expect(isKevinRoot(`${KEVIN_ROOT}/`)).toBe(true)
  expect(isKevinRoot('/Users/o/Code/bifrost')).toBe(false)
  expect(isKevinRoot('/r/.claude/worktrees/STARK-12')).toBe(false)
  expect(isKevinRoot('/r/.claude/worktrees/KEVIN-bifrost')).toBe(false)
})

test('every prompt a Kevin gets carries the note, his kickoff first', async ($, on) => {
  const { submitted, contexts } = session(on, KEVIN_ROOT, '{"kevin":{"idle_seconds":600}}')
  await start($)
  await $.prompt.submit(kickoff)
  await $.prompt.submit(fromPeer('status'))
  expect(submitted).toEqual(['/kevin from operator', 'status'])
  expect(contexts).toEqual([[armed(600)], [armed(600)]])
  expect(armed(600)).toContain('kevin.idle_seconds 600')
})

test('the config is found where the tools find it, and a bad threshold reads as two hours', () => {
  expect(configPaths('/a', '/h')).toEqual(['/a/config.json', '/a/global/config.json'])
  expect(configPaths(undefined, '/h')).toEqual(['/h/.claude/code-review/config.json'])
  expect(idleSeconds('{"kevin":{"idle_seconds":600}}')).toBe(600)
  for (const bad of [undefined, '{', '{}', '{"kevin":{"idle_seconds":0}}', '{"kevin":{"idle_seconds":"600"}}']) {
    expect(idleSeconds(bad)).toBe(7200)
  }
})

test('a Kevin is woken once at the configured threshold, and a turn restarts the clock', async ($, on) => {
  const clock = mock.clock(on)
  const { submitted, contexts } = session(on, KEVIN_ROOT, '{"kevin":{"idle_seconds":600}}')
  const wake = `${WAKE_TEXT}\n\n${armed(600)}`
  await start($)

  await clock.advance(9 * MINUTE)
  expect(submitted).toEqual([])
  await turn($, 't1')
  await clock.advance(9 * MINUTE)
  expect(submitted).toEqual([])
  await clock.advance(2 * MINUTE)
  expect(submitted).toEqual([wake])
  await clock.advance(8 * MINUTE)
  expect(submitted).toEqual([wake])
  // This harness's submit starts no turn, as when another hook refuses the
  // wake: it goes again a whole period later, never sooner.
  await clock.advance(2 * MINUTE)
  expect(submitted).toEqual([wake, wake])
  // The mod's own wake skips its own prompt.submit hook (as live: "skipped:
  // re-entry"), so the note is in its text and not in its context.
  expect(contexts).toEqual([[], []])
})

test('a turn still running is never idle', async ($, on) => {
  const clock = mock.clock(on)
  const { submitted } = session(on, KEVIN_ROOT, null)
  await start($)
  await $.turn.start({ text: '', turnId: 't1' })
  await clock.advance(3 * 60 * MINUTE)
  expect(submitted).toEqual([])
})

test('any other session is left alone', async ($, on) => {
  const clock = mock.clock(on)
  const { submitted, contexts } = session(on, '/r/.claude/worktrees/STARK-12', null)
  await start($)
  await clock.advance(3 * 60 * MINUTE)
  expect(submitted).toEqual([])
  await $.prompt.submit(typed('hello'))
  expect(contexts).toEqual([[]])
})

const BAND = {
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
} as const
const band = ($: Engine) => $.ui.mount({ plugin: 'kevin-idle', ...BAND })
const IDLE = { type: 'Text', text: /^IDLE / } as const

test('the bar fills by whole cells, full only once the wake is due', () => {
  const at = (minutes: number) => filled({ since: 0, seconds: 7200, now: minutes * MINUTE })
  expect([0, 11, 12, 48, 119, 120, 500].map(at)).toEqual([0, 0, 1, 4, 9, CELLS, CELLS])
  expect(filled({ since: 10, seconds: 60, now: 0 })).toBe(0)
})

test('the cells fade from light to dark red', () => {
  expect(shade(0)).toBe('#f8a8a8')
  expect(shade(CELLS - 1)).toBe('#8b0000')
  expect(shade(4)).toBe('#c85d5d')
})

test('durations read in whole minutes', () => {
  expect([0, 59_000, MINUTE, 48 * MINUTE, 65 * MINUTE, 72 * MINUTE, 120 * MINUTE].map(duration)).toEqual([
    '<1m',
    '<1m',
    '1m',
    '48m',
    '1h05m',
    '1h12m',
    '2h',
  ])
  expect(clockTime(new Date(2026, 9, 11, 9, 5).getTime())).toBe('09:05')
})

test('an idle Kevin sees the band, hidden while a turn runs and restarted after one', async ($, on) => {
  const clock = mock.clock(on)
  session(on, KEVIN_ROOT, '{"kevin":{"idle_seconds":600}}')
  await start($)
  const since = clock.now()

  await clock.advance(4 * MINUTE)
  let ui = await band($)
  const text = (await ui.find(IDLE))?.text
  expect(text).toContain('4m / 10m')
  expect(text).toContain(`wakes ${clockTime(since + 10 * MINUTE)}`)
  expect(await ui.findAll({ type: 'Text', text: /^█$/ })).toHaveLength(4)
  await ui.unmount()

  await $.turn.start({ text: '', turnId: 't1' })
  ui = await band($)
  expect(await ui.find(IDLE)).toBeUndefined()
  await ui.unmount()

  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, turnId: 't1', isAborted: false })
  ui = await band($)
  expect((await ui.find(IDLE))?.text).toContain('<1m / 10m')
  await ui.unmount()
})

test('the band yields to a survey and to a turn the engine says is running', async ($, on) => {
  const clock = mock.clock(on)
  session(on, KEVIN_ROOT, '{"kevin":{"idle_seconds":600}}')
  await start($)
  await clock.advance(4 * MINUTE)
  for (const flag of ['hasSurvey', 'isWorking'] as const) {
    const ui = await $.ui.mount({ plugin: 'kevin-idle', ...BAND, props: { ...BAND.props, [flag]: true } })
    expect(await ui.find(IDLE)).toBeUndefined()
    await ui.unmount()
  }
})

test('no band outside a Kevin session', async ($, on) => {
  const clock = mock.clock(on)
  session(on, '/r/.claude/worktrees/STARK-12', null)
  await start($)
  await clock.advance(5 * MINUTE)
  const ui = await band($)
  expect(await ui.find(IDLE)).toBeUndefined()
  await ui.unmount()
})
