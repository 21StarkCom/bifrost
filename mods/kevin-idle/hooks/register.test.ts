import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { WAKE_TEXT, configPaths, idleSeconds, isKevinRoot } from './register'

const KEVIN_ROOT = '/r/.claude/worktrees/KEVIN-bifrost-1'
const MINUTE = 60_000
const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] }

/** A session in `root` whose config holds `config`; returns the prompts the mod submitted. */
function session(on: On, root: string, config: string | null) {
  const submitted: string[] = []
  mock.env(on, { HOME: '/h' })
  on('session.root', () => ({ value: root }))
  on('fs.read', ($, e) => {
    if (config === null || e.path !== '/h/.claude/code-review/config.json') return { deny: 'ENOENT' }
    return { value: config }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.compose', () => ({ sections: [] }))
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  return submitted
}

const start = ($: Engine) => $.session.start({ cwd: '/r', surface: null, isInteractive: true })
const turn = async ($: Engine, id: string) => {
  await $.turn.start({ text: '', turnId: id })
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, turnId: id, isAborted: false })
}

test('only a KEVIN-<repo>-<n> worktree is a Kevin', () => {
  expect(isKevinRoot(KEVIN_ROOT)).toBe(true)
  expect(isKevinRoot(`${KEVIN_ROOT}/`)).toBe(true)
  expect(isKevinRoot('/r/.claude/worktrees/STARK-12')).toBe(false)
  expect(isKevinRoot('/r/.claude/worktrees/KEVIN-bifrost')).toBe(false)
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
  const submitted = session(on, KEVIN_ROOT, '{"kevin":{"idle_seconds":600}}')
  await start($)
  expect((await $.prompt.compose(COMPOSE)).sections.map(s => s.text)).toEqual([
    expect.stringContaining('kevin.idle_seconds 600'),
  ])

  await clock.advance(9 * MINUTE)
  expect(submitted).toEqual([])
  await turn($, 't1')
  await clock.advance(9 * MINUTE)
  expect(submitted).toEqual([])
  await clock.advance(2 * MINUTE)
  expect(submitted).toEqual([WAKE_TEXT])
  await clock.advance(8 * MINUTE)
  expect(submitted).toEqual([WAKE_TEXT])
  // This harness's submit starts no turn, as when another hook refuses the
  // wake: it goes again a whole period later, never sooner.
  await clock.advance(2 * MINUTE)
  expect(submitted).toEqual([WAKE_TEXT, WAKE_TEXT])
})

test('a turn still running is never idle', async ($, on) => {
  const clock = mock.clock(on)
  const submitted = session(on, KEVIN_ROOT, null)
  await start($)
  await $.turn.start({ text: '', turnId: 't1' })
  await clock.advance(3 * 60 * MINUTE)
  expect(submitted).toEqual([])
})

test('any other session is left alone', async ($, on) => {
  const clock = mock.clock(on)
  const submitted = session(on, '/r/.claude/worktrees/STARK-12', null)
  await start($)
  await clock.advance(3 * 60 * MINUTE)
  expect(submitted).toEqual([])
  expect((await $.prompt.compose(COMPOSE)).sections).toEqual([])
})
