import { expect, test } from 'claude-code/testing'

import { isRunName } from './view'
import { buildSuper, isSuperName, ownSuper, superReads, superSettingsOf } from './super'
import { stateWords } from './super-pane'

const T0 = Date.parse('2026-11-13T12:00:00Z')
const ticket = (id: string, stage: string) =>
  JSON.stringify({ id, title: `title ${id}`, stage, pr: null, updated: new Date(T0).toISOString() })

/** Epic A with 3 of 3 tickets closed; epic B with 1 of 2 closed and 1 blocked. */
const TWO_EPICS: Record<string, string> = {
  'super-SUPER-1.json': JSON.stringify({
    session: 'sg',
    epics: ['STARK-1', 'STARK-2'],
    grus: {
      'STARK-1': { launch: 'STARK-1', session: 'gru-a-session', state: 'reported' },
      'STARK-2': { launch: 'STARK-2', session: 'gru-b-session', state: 'live' },
    },
    settings: { maxWorkers: 4, parallel: 1, minionAgent: 'claude', followUps: true, decideForMe: true },
  }),
  'run-STARK-1.json': JSON.stringify({ epic: 'STARK-1', session: 'gru-a-session', tickets: ['STARK-11', 'STARK-12', 'STARK-13'] }),
  'run-STARK-2.json': JSON.stringify({ epic: 'STARK-2', session: 'gru-b-session', tickets: ['STARK-21', 'STARK-22'] }),
  'STARK-11.json': ticket('STARK-11', 'closed'),
  'STARK-12.json': ticket('STARK-12', 'closed'),
  'STARK-13.json': ticket('STARK-13', 'closed'),
  'STARK-21.json': ticket('STARK-21', 'closed'),
  'STARK-22.json': ticket('STARK-22', 'blocked'),
  'STARK-22.log.jsonl': `${JSON.stringify({ at: new Date(T0).toISOString(), text: 'Stopped: the job needs a change in another project first.' })}\n`,
}

test('a super file is neither a run file nor its own settings file', () => {
  expect(isSuperName('super-SUPER-1.json')).toBe(true)
  expect(isSuperName('super-SUPER-1.settings.json')).toBe(false)
  expect(isRunName('super-SUPER-1.json')).toBe(false)
  expect(ownSuper('sg', TWO_EPICS)).toBe('super-SUPER-1.json')
  expect(ownSuper('other', TWO_EPICS)).toBeNull()
})

test('two epics: A reads done 3/3, B reads blocked 1/2, and its blocked ticket is worth a look', () => {
  const b = buildSuper('super-SUPER-1.json', TWO_EPICS, new Map([['STARK-2', 'epic B']]), T0)
  expect(b?.rows.map(stateWords)).toEqual(['done 3/3', 'blocked 1/2'])
  expect(b?.rows.map(r => [r.gru, r.title])).toEqual([['gru-a-session', null], ['gru-b-session', 'epic B']])
  expect(b?.looks).toEqual([
    { epic: 'STARK-2', id: 'STARK-22', title: 'title STARK-22', waits: 'Stopped: the job needs a change in another project first.' },
  ])
})

test('a queued epic waits; an ended Gru whose run file is gone reads done with no count', () => {
  const files = {
    'super-SUPER-5.json': JSON.stringify({
      session: 'sg',
      epics: ['STARK-5', 'STARK-6'],
      grus: { 'STARK-5': { launch: 'STARK-5', session: 'x', state: 'ended' }, 'STARK-6': { launch: null, session: null, state: 'queued' } },
    }),
  }
  const b = buildSuper('super-SUPER-5.json', files, new Map(), T0)
  expect(b?.rows.map(stateWords)).toEqual(['done', 'waiting'])
  expect(b?.rows[1]?.gru).toBeNull()
  expect(b?.looks).toEqual([])
})

test("settings take the settings file's value, else the run file's, else the default; a wrong type reads as absent", () => {
  const run = { settings: { maxWorkers: 2, parallel: 3, followUps: false } }
  expect(superSettingsOf(run, JSON.stringify({ maxWorkers: 5, decideForMe: false, parallel: 'two' }))).toEqual({
    maxWorkers: 5,
    parallel: 3,
    followUps: false,
    decideForMe: false,
  })
  expect(superSettingsOf(null, undefined)).toEqual({ maxWorkers: 4, parallel: 1, followUps: true, decideForMe: true })
})

test("a super board reads its settings file and each epic's tickets' files and logs", () => {
  expect(superReads('super-SUPER-1.json', TWO_EPICS)).toEqual([
    'super-SUPER-1.settings.json',
    ...['STARK-11', 'STARK-12', 'STARK-13', 'STARK-21', 'STARK-22'].flatMap(id => [`${id}.json`, `${id}.log.jsonl`]),
  ])
})
