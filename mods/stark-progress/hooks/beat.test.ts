import { expect, test } from 'claude-code/testing'
import { beatFile, callEnded, callStarted, newBeat, seedBeat } from './beat'
import { parseShortstat } from './git'

const T0 = Date.parse('2026-10-29T12:00:00Z')
const MIN = 60_000

test('a heartbeat counts calls and failures per minute, the last ten outcomes and the oldest running call', () => {
  const b = newBeat()
  callStarted(b, 'a', 'Bash', T0)
  callStarted(b, 'b', 'Agent', T0 + 1000)
  callEnded(b, 'a', true, T0 + 2000)
  for (let i = 0; i < 12; i++) {
    callStarted(b, `c${i}`, 'Read', T0 + MIN)
    callEnded(b, `c${i}`, false, T0 + MIN + 10)
  }
  const file = beatFile(b, 'STARK-1', 's', T0 + MIN + 20)
  expect(file.minutes).toEqual([
    { at: T0 / MIN, calls: 1, fails: 1 },
    { at: T0 / MIN + 1, calls: 12, fails: 0 },
  ])
  expect(file.recent).toEqual(Array(10).fill(false))
  expect(file.running).toEqual({ tool: 'Agent', since: new Date(T0 + 1000).toISOString() })
  expect(file.lastActivity).toBe(new Date(T0 + MIN + 10).toISOString())
})

test('a heartbeat drops minutes older than an hour', () => {
  const b = newBeat()
  callStarted(b, 'a', 'Bash', T0)
  callEnded(b, 'a', false, T0)
  expect(beatFile(b, 'STARK-1', 's', T0 + 59 * MIN).minutes).toHaveLength(1)
  expect(beatFile(b, 'STARK-1', 's', T0 + 60 * MIN).minutes).toHaveLength(0)
})

test("a reload takes back its own session's heartbeat, and no other", () => {
  const text = JSON.stringify({
    session: 's',
    lastActivity: new Date(T0).toISOString(),
    minutes: [{ at: 5, calls: 2, fails: 1 }],
    recent: [true, false],
  })
  const mine = newBeat()
  seedBeat(mine, text, 's')
  expect(mine.lastActivity).toBe(T0)
  expect(mine.minutes.get(5)).toEqual({ at: 5, calls: 2, fails: 1 })
  expect(mine.recent).toEqual([true, false])

  const other = newBeat()
  seedBeat(other, text, 'another')
  seedBeat(other, '{', 'another')
  expect(other.lastActivity).toBe(null)
  expect(other.minutes.size).toBe(0)
})

test('git --shortstat reads as added and removed lines', () => {
  expect(parseShortstat(' 3 files changed, 120 insertions(+), 14 deletions(-)\n')).toEqual({ added: 120, removed: 14 })
  expect(parseShortstat(' 1 file changed, 1 insertion(+)\n')).toEqual({ added: 1, removed: 0 })
  expect(parseShortstat('')).toEqual({ added: 0, removed: 0 })
})
