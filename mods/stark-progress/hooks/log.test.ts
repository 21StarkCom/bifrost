import { expect, test } from 'claude-code/testing'

import { buildLog, dayOf, LOG_SHOWN, logName, logOf, plain, runLogName } from './log'

// Local times, so the day names hold in any time zone.
const NOW = new Date(2026, 9, 29, 12, 0).getTime()
const MIN = 60_000
const iso = (ms: number) => new Date(ms).toISOString()
const line = (minutesAgo: number, text: unknown) => JSON.stringify({ at: iso(NOW - minutesAgo * MIN), text })
const jsonl = (...lines: string[]) => `${lines.join('\n')}\n`

test('a log file is named for its ticket or its run', () => {
  expect(logName('STARK-1')).toBe('STARK-1.log.jsonl')
  expect(runLogName('GRU-7')).toBe('run-GRU-7.log.jsonl')
})

test('a line keeps 20 words on one line, and a longer one is cut with …', () => {
  expect(plain('  Made the board\n show a\tlog.  ')).toBe('Made the board show a log.')
  // A control character, a terminal escape say, is white space.
  expect(plain('Fixed\u001b[31m the colors')).toBe('Fixed [31m the colors')
  const twenty = Array.from({ length: 20 }, (_, i) => `w${i + 1}`)
  expect(plain(twenty.join(' '))).toBe(twenty.join(' '))
  expect(plain([...twenty, 'w21', 'w22'].join(' '))).toBe(`${twenty.join(' ')}…`)
  expect(plain(' \n ')).toBe('')
})

test('a line that does not parse, or has no words or no valid time, is skipped', () => {
  const text = [
    line(30, 'Read the job.'),
    '{"at": "2026-10-29T',
    'not json',
    JSON.stringify([1, 2]),
    JSON.stringify({ at: 'yesterday', text: 'No valid time.' }),
    JSON.stringify({ at: iso(NOW), text: 42 }),
    line(20, '   '),
    '',
    line(10, 'Opened the change for review.'),
  ].join('\n')
  expect(logOf(text)).toEqual([
    { at: NOW - 30 * MIN, text: 'Read the job.' },
    { at: NOW - 10 * MIN, text: 'Opened the change for review.' },
  ])
  expect(logOf(undefined)).toEqual([])
  expect(logOf('')).toEqual([])
})

test("the Gru pane's log merges every file, newest first, a later line first on a tie, each named for whose step it is", () => {
  const log = buildLog(
    [
      { who: 'Gru', text: jsonl(line(50, 'Started 2 jobs.'), line(5, 'Checked the first job is really done.')) },
      { who: 'Say the names', text: jsonl(line(40, 'Read the job.'), line(5, 'The change is now in the main code.')) },
      { who: 'Read the words file', text: undefined },
    ],
    NOW,
  )
  expect(log.older).toBe(0)
  expect(log.days).toHaveLength(1)
  // One day needs no name over it.
  expect(log.days[0]?.label).toBeNull()
  expect(log.days[0]?.entries.map(e => [e.who, e.text])).toEqual([
    ['Say the names', 'The change is now in the main code.'],
    ['Gru', 'Checked the first job is really done.'],
    ['Say the names', 'Read the job.'],
    ['Gru', 'Started 2 jobs.'],
  ])
  expect(log.days[0]?.entries[0]?.clock).toBe('11:55')
})

test('a log over more than one day names each day: Today, Yesterday, then the date', () => {
  const day = 24 * 60
  const log = buildLog(
    [{ who: null, text: jsonl(line(2 * day + 60, 'Read the job.'), line(day, 'Made the change.'), line(1, 'Marked the job done.')) }],
    NOW,
  )
  expect(log.days.map(d => d.label)).toEqual(['Today', 'Yesterday', 'Tue 27 Oct'])
  expect(log.days.map(d => d.entries.map(e => e.text))).toEqual([['Marked the job done.'], ['Made the change.'], ['Read the job.']])
  expect(log.days[2]?.entries[0]?.clock).toBe('11:00')
  expect(dayOf(NOW, NOW)).toBe('Today')
})

test('the tab shows the 50 newest steps and counts the older ones', () => {
  const lines = Array.from({ length: LOG_SHOWN + 3 }, (_, i) => line(LOG_SHOWN + 3 - i, `Step ${i + 1}.`))
  const log = buildLog([{ who: null, text: jsonl(...lines) }], NOW)
  const shown = log.days.flatMap(d => d.entries)
  expect(shown).toHaveLength(LOG_SHOWN)
  expect(shown[0]?.text).toBe(`Step ${LOG_SHOWN + 3}.`)
  expect(shown.at(-1)?.text).toBe('Step 4.')
  expect(log.older).toBe(3)
})
