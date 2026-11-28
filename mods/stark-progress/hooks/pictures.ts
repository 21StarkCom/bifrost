import type { Board, BoardRow, GithubPr, LogEntry, Mark, RowHour } from '../types'
import { clockOf } from './board'
import type { StepCount } from './board'
import type { Palette } from './pane'
import { base64, Canvas, CELL_H, CELL_W, png, rgb } from './pixels'
import type { Pt } from './pixels'
import { STAGES } from './view'

// The Gru pane's graphs as pictures, for a terminal that draws them (kitty,
// Ghostty, iTerm2): pixels.ts draws, this file says what. Pure. A picture
// holds marks only: every word and number stays text beside it, and each row a
// person selects stays a text Button, since a picture takes no press. Each
// has an `alt` that says the same in text, which a terminal with no pictures
// draws in its place. Counts and elapsed times only, never a forecast.

/** A picture for the terminal's Image element: a PNG file as base64, its box in cells, and its words. */
export type Picture = { png: string; columns: number; rows: number; alt: string }

const MIN = 60_000
const CACHE_MAX = 400
/** Each picture drawn, by what it shows: a poll a second redraws the pane, and most pictures have not changed. */
const cache = new Map<string, string>()

function shot(key: string, draw: () => Canvas): string {
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const file = base64(png(draw()))
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, file)

  return file
}

/** The color of each step of the Overview's graph, in the spine's order: each station's own state color. */
export const STEP_INK: readonly (keyof Palette)[] = ['gray', 'starting', 'pr', 'review', 'merged', 'green']

/** The tickets at each step as one bar: a part for each step with a ticket, as wide as its share. */
export function stepsPicture(P: Palette, columns: number, steps: readonly StepCount[]): Picture {
  const parts = steps.flatMap((s, i) => (s.count === 0 ? [] : [{ value: s.count, color: rgb(P[STEP_INK[i] ?? 'gray']), alpha: i === 0 ? 0.55 : 1 }]))

  return {
    columns,
    rows: 1,
    alt: steps.map(s => `${s.label} ${s.count}`).join(' · '),
    png: shot(`steps|${columns}|${steps.map(s => s.count).join(',')}`, () => {
      const cv = new Canvas(columns, 1)
      cv.pill(2, cv.w - 2, CELL_H / 2, 8, parts)

      return cv
    }),
  }
}

/** The rows a burn-up takes: odd, so all, half and 0 tickets fall on the centers of its first, middle and last row. */
export const BURN_ROWS = 5

/**
 * The run so far: the tickets done over time as a line with a soft fill, the
 * tickets started as a thinner line above it, and all the run's tickets as a
 * dashed line. Null before the run has a start, or a minute of time.
 */
export function burnUp(P: Palette, columns: number, board: Pick<Board, 'rows' | 'started' | 'readAt'>): (Picture & { start: number; end: number }) | null {
  const total = board.rows.length
  const begins = board.rows.flatMap(r => {
    // A ticket found closed has no start of its own: it started when it closed, at the latest.
    const at = r.started !== null && r.closed !== null ? Math.min(r.started, r.closed) : (r.started ?? r.closed)

    return at === null ? [] : [at]
  })
  const start = board.started ?? (begins.length > 0 ? Math.min(...begins) : null)
  // The picture changes once a minute: the poll's own second would draw a new one each time.
  const end = Math.floor(board.readAt / MIN) * MIN
  if (start === null || total === 0 || end - start < MIN) return null
  const inRun = (t: number) => Math.max(start, Math.min(t, end))
  const closes = board.rows.flatMap(r => (r.closed === null ? [] : [inRun(r.closed)])).sort((a, b) => a - b)
  const begun = begins.map(inRun).sort((a, b) => a - b)

  return {
    columns,
    rows: BURN_ROWS,
    start,
    end,
    alt: `${closes.length} of ${total} tickets done since ${clockOf(start)}.`,
    png: shot(`burn|${columns}|${total}|${start}|${end}|${closes.join(',')}|${begun.join(',')}`, () => {
      const cv = new Canvas(columns, BURN_ROWS)
      const x = (t: number) => 8 + ((t - start) / (end - start)) * (cv.w - 16)
      const y = (v: number) => CELL_H / 2 + (1 - v / total) * (cv.h - CELL_H)
      const stepped = (times: readonly number[]): Pt[] => [
        [x(start), y(0)],
        ...times.flatMap((t, i): Pt[] => [
          [x(t), y(i)],
          [x(t), y(i + 1)],
        ]),
        [x(end), y(times.length)],
      ]
      cv.rect(0, y(total / 2), cv.w, y(total / 2) + 1, rgb(P.track), 0.4)
      cv.rect(0, y(0), cv.w, y(0) + 1.5, rgb(P.track))
      cv.stroke([[x(start), y(total)], [x(end), y(total)]], 2, rgb(P.hint), [8, 6])
      const done = stepped(closes)
      cv.fillUnder(done, y(total), y(0), rgb(P.green), 0.45, 0.06)
      cv.stroke(stepped(begun), 2.5, rgb(P.blue))
      cv.stroke(done, 4, rgb(P.green))
      for (const [i, t] of closes.entries()) cv.dot(x(t), y(i + 1), 5, rgb(P.green))

      return cv
    }),
  }
}

/** The cells of a metro line's picture: a station every `seg + 1` cells, and a cell of room at each end for a ring. */
export const trackColumns = (seg: number) => (STAGES.length - 1) * (seg + 1) + 3

/**
 * A ticket's metro line: a dot at each station passed, a ring at the one it
 * is at, a small ring at each one to come, and a cross where a blocked ticket
 * stopped. `ink` is the line's color, as `#rrggbb`.
 */
export function trackPicture(P: Palette, seg: number, r: Pick<BoardRow, 'at' | 'state'>, ink: string): Picture {
  const isBlocked = r.state === 'blocked'
  const text = STAGES.map((_, i) => `${i < r.at ? '●' : i === r.at ? (isBlocked ? '✕' : '◉') : '○'}${i < STAGES.length - 1 ? (i < r.at ? '━' : '┄').repeat(seg) : ''}`)

  return {
    columns: trackColumns(seg),
    rows: 1,
    alt: text.join(''),
    png: shot(`track|${seg}|${r.at}|${isBlocked}|${ink}`, () => {
      const cv = new Canvas(trackColumns(seg), 1)
      const color = rgb(ink)
      const todo = rgb(P.track)
      const cy = CELL_H / 2
      const cx = (i: number) => (i * (seg + 1) + 1.5) * CELL_W
      // A line starts and ends at its stations' edges: it joins a passed dot, and leaves room for a ring or a cross.
      const edge = (i: number) => (i < r.at ? 6 : i === r.at ? 13 : 10)
      for (let i = 0; i < STAGES.length - 1; i++) {
        const line: Pt[] = [
          [cx(i) + edge(i), cy],
          [cx(i + 1) - edge(i + 1), cy],
        ]
        if (i < r.at) cv.stroke(line, 5, color)
        else cv.stroke(line, 2.5, todo, [7, 7])
      }
      for (let i = 0; i < STAGES.length; i++) {
        if (i < r.at) cv.dot(cx(i), cy, 7.5, color)
        else if (i > r.at) cv.ring(cx(i), cy, 7.5, 5, todo)
        else if (isBlocked) {
          cv.stroke([[cx(i) - 7, cy - 7], [cx(i) + 7, cy + 7]], 4, color)
          cv.stroke([[cx(i) - 7, cy + 7], [cx(i) + 7, cy - 7]], 4, color)
        } else {
          cv.ring(cx(i), cy, 11, 7, color)
          cv.dot(cx(i), cy, 3.5, color)
        }
      }

      return cv
    }),
  }
}

/** The scale of the run's hour pictures: the busiest minute of any row, up to the next 5, and 10 at the least. */
export const hourScale = (rows: readonly Pick<BoardRow, 'hour'>[]) =>
  Math.max(10, Math.ceil(Math.max(0, ...rows.flatMap(r => r.hour?.minutes.map(m => m.calls) ?? [])) / 5) * 5)

/** True when an hour has a call, a milestone or a running call to show. */
export const hasHour = (hour: RowHour | null): hour is RowHour =>
  hour !== null && (hour.runningFrom !== null || hour.marks.length > 0 || hour.minutes.some(m => m.calls > 0))

/** The rows of an hour's chart with an axis: odd, so the scale's top, half and 0 fall on row centers. */
export const HOUR_ROWS = 5

/**
 * A ticket's last hour, a bar a minute: the calls, the failed ones on top in
 * red, a green mark at each milestone, and a dashed line while one long call
 * runs. `rows` 2 is the strip under a row; HOUR_ROWS is the chart of an opened
 * row, with 0 and `max` on the centers of its last and first row.
 */
export function hourPicture(P: Palette, columns: number, rows: number, hour: RowHour, max: number, alt: string): Picture {
  return {
    columns,
    rows,
    alt,
    png: shot(`hour|${columns}|${rows}|${max}|${JSON.stringify(hour)}`, () => {
      const cv = new Canvas(columns, rows)
      const isChart = rows >= HOUR_ROWS
      const base = isChart ? cv.h - CELL_H / 2 : cv.h - 3
      const top = isChart ? CELL_H / 2 : 12
      const slot = cv.w / hour.minutes.length
      const track = rgb(P.track)
      if (isChart) for (const v of [0.5, 1]) cv.rect(0, base - v * (base - top), cv.w, base - v * (base - top) + 1, track, 0.4)
      cv.rect(0, base, cv.w, base + 1.5, track)
      for (const m of hour.marks) cv.rect((m + 0.5) * slot - 0.75, top - 6, (m + 0.5) * slot + 0.75, base, rgb(P.green), 0.45)
      for (const [m, minute] of hour.minutes.entries()) {
        if (minute.calls <= 0) continue
        const h = Math.max(3, (Math.min(minute.calls, max) / max) * (base - top))
        const failed = (Math.min(minute.fails, minute.calls) / minute.calls) * h
        cv.rect(m * slot + 1, base - h + failed, (m + 1) * slot - 1, base, rgb(P.blue))
        if (failed > 0) cv.rect(m * slot + 1, base - h, (m + 1) * slot - 1, base - h + failed, rgb(P.blocked))
      }
      if (hour.runningFrom !== null) {
        const y = base - (base - top) * 0.25
        cv.stroke([[hour.runningFrom * slot + 2, y], [cv.w - 2, y]], 3, rgb(P.amber), [10, 7])
      }
      for (const m of hour.marks) cv.dot((m + 0.5) * slot, top - 6, 4.5, rgb(P.green))

      return cv
    }),
  }
}

/** The colors of a share bar's parts after Gru's gray, in turn: each a state's color, so every one is in the palette. */
export const SHARE_INK: readonly (keyof Palette)[] = ['green', 'review', 'amber', 'blue', 'pr', 'merged', 'id']
/** The most parts a share bar names; the rest are one part. */
export const SHARE_PARTS = 6

/** The parts of a whole as one bar: `inks` is each part's color, as `#rrggbb`. */
export function sharePicture(columns: number, values: readonly number[], inks: readonly string[], alt: string): Picture {
  return {
    columns,
    rows: 1,
    alt,
    png: shot(`share|${columns}|${values.join(',')}|${inks.join(',')}`, () => {
      const cv = new Canvas(columns, 1)
      cv.pill(2, cv.w - 2, CELL_H / 2, 8, values.map((value, i) => ({ value, color: rgb(inks[i] ?? '#888888') })))

      return cv
    }),
  }
}

/** The colors a PR's time line takes, each as `#rrggbb`: its state's, each mark's, and a commit's with no checks. */
export type PrInks = { state: string; marks: Record<Mark, string>; plain: string }

/**
 * A PR's life on one line: from its first commit or its opening to its merge,
 * its close or now. A dot is a commit, in its checks' color; a ring is the
 * merge or the close; a bar under the line is an Actions run, from its start
 * to its end, in its mark's color.
 */
export function prPicture(P: Palette, columns: number, pr: GithubPr, now: number, inks: PrInks): Picture {
  const runs = [...pr.runs, ...pr.mergeRuns]
  const done = pr.merged ?? pr.closed
  // A running run ends at `now`, to the minute: the poll's own second would draw a new picture each time.
  const at = Math.ceil(now / MIN) * MIN
  const from = Math.min(pr.created, ...pr.commits.flatMap(c => (c.at === null ? [] : [c.at])))
  const to = Math.max(done ?? at, ...runs.map(r => r.ended ?? at), from + MIN)
  const key = `${pr.state}|${from}|${to}|${done}|${pr.commits.map(c => `${c.at}${c.mark}`).join(',')}|${runs.map(r => `${r.started}-${r.ended}${r.mark}`).join(',')}`

  return {
    columns,
    rows: 1,
    alt: `${pr.commitCount} commits, ${runs.length} runs.`,
    png: shot(`pr|${columns}|${key}|${inks.state}`, () => {
      const cv = new Canvas(columns, 1)
      const x = (t: number) => 8 + ((t - from) / (to - from)) * (cv.w - 16)
      const line = 10
      if (pr.created > from) cv.stroke([[x(from), line], [x(pr.created), line]], 2, rgb(P.track), [5, 5])
      cv.stroke([[x(pr.created), line], [x(done ?? at), line]], 2.5, rgb(inks.state))
      for (const c of pr.commits) if (c.at !== null) cv.dot(x(c.at), line, 4.5, rgb(c.mark === null ? inks.plain : inks.marks[c.mark]))
      if (done !== null) cv.ring(x(done), line, 8, 3.5, rgb(inks.state))
      // Two lanes: a run that starts while another one still draws takes the second, so neither hides the other.
      const lanes: number[] = []
      for (const r of [...runs].sort((a, b) => a.started - b.started || (b.ended ?? at) - (a.ended ?? at))) {
        const x0 = x(r.started)
        const x1 = Math.max(x(r.ended ?? at), x0 + 9)
        const free = lanes.findIndex(end => end <= x0)
        const lane = free < 0 ? Math.min(lanes.length, 1) : free
        lanes[lane] = x1 + 2
        cv.pill(x0, x1, 21 + lane * 8, 3, [{ value: 1, color: rgb(inks.marks[r.mark]) }])
      }

      return cv
    }),
  }
}

/**
 * The steps of a Log tab over time, on one line. With Gru's steps among them
 * (the Gru pane), Gru's draw above and the tickets' below; else (the ticket
 * pane) all draw on one line. Null with under two steps, or no time between them.
 */
export function logPicture(
  P: Palette,
  columns: number,
  entries: readonly Pick<LogEntry, 'at' | 'isRun'>[],
  now: number,
): (Picture & { start: number; isSplit: boolean }) | null {
  const start = Math.min(...entries.map(e => e.at))
  const end = Math.ceil(now / MIN) * MIN
  if (entries.length < 2 || now - start < MIN) return null
  const isSplit = entries.some(e => e.isRun)

  return {
    columns,
    rows: 1,
    start,
    isSplit,
    alt: `${entries.length} steps since ${clockOf(start)}.`,
    png: shot(`log|${columns}|${end}|${isSplit}|${entries.map(e => `${e.at}${e.isRun ? 'g' : 't'}`).join(',')}`, () => {
      const cv = new Canvas(columns, 1)
      const x = (t: number) => 8 + ((t - start) / (end - start)) * (cv.w - 16)
      for (const y of isSplit ? [10, 24] : [CELL_H / 2]) cv.rect(4, y - 0.5, cv.w - 4, y + 0.5, rgb(P.track), 0.6)
      for (const e of entries) cv.dot(x(e.at), isSplit ? (e.isRun ? 10 : 24) : CELL_H / 2, 4.5, rgb(e.isRun ? P.blue : P.id))

      return cv
    }),
  }
}

// The run clock: the time since the run started, as a clock of seven-segment digits.

/** The lit segments of each digit, of `abcdefg`: a the top, then clockwise, g the middle. */
const SEGMENTS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgecd', 'abc', 'abcdefg', 'abcdfg']
const CLOCK_ROWS = 3
/** A digit's box, its segments' thickness, and the room between two digits and beside a colon, in pixels. */
const DIGIT_W = 44
const DIGIT_H = 78
const THICK = 10
const DIGIT_GAP = 12
const COLON_W = 32
/** How faint a segment that is not lit draws: dark, so the lit figure stands out, yet each digit still reads as an `8` behind it. */
const GHOST = 0.07
/** The clock's own red, an LED's: 4.5:1 on the pane's #262626, and no state's color, so it never reads as an error. */
const CLOCK_INK = '#ff453a'

/** `1:02:03` as the clock's digits: `01:02:03`, the hours with a third digit past 99. Never a forecast: the time so far. */
export const clockWords = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))

  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':')
}

/** The Image key of the run clock, which a blit names to swap its picture each second. */
export const CLOCK_KEY = 'clock'

/**
 * The last picture of each kind that changes often (the clock each second, the
 * token board with each count): one of each, so they stay out of the cache
 * the other pictures share.
 */
const latest = new Map<string, { key: string; png: string }>()

function newest(kind: string, key: string, draw: () => string): string {
  const hit = latest.get(kind)
  if (hit?.key === key) return hit.png
  const file = draw()
  latest.set(kind, { key, png: file })

  return file
}

/** One segment: a bar with pointed ends, from `a` to `b`. */
function segment(cv: Canvas, a: Pt, b: Pt, ink: readonly [number, number, number], alpha: number): void {
  const r = THICK / 2
  const isFlat = a[1] === b[1]
  cv.poly(
    isFlat
      ? [[a[0], a[1]], [a[0] + r, a[1] - r], [b[0] - r, b[1] - r], [b[0], b[1]], [b[0] - r, b[1] + r], [a[0] + r, a[1] + r]]
      : [[a[0], a[1]], [a[0] + r, a[1] + r], [b[0] + r, b[1] - r], [b[0], b[1]], [b[0] - r, b[1] - r], [a[0] - r, a[1] + r]],
    ink,
    alpha,
  )
}

/**
 * The run's time so far as `88:88:88`: hours, minutes and seconds in
 * seven-segment digits, each segment that is not lit drawn faint behind.
 */
export function clockPicture(elapsed: number): Picture {
  const words = clockWords(elapsed)
  // A colon takes the gap after the digit before it, so it adds only the rest of its room.
  const width = [...words].reduce((n, ch) => n + (ch === ':' ? COLON_W - DIGIT_GAP : DIGIT_W + DIGIT_GAP), 0) - DIGIT_GAP + 16
  const columns = Math.ceil(width / CELL_W)
  const file = newest('clock', `${columns}|${words}`, () => {
    const cv = new Canvas(columns, CLOCK_ROWS)
    const ink = rgb(CLOCK_INK)
    const top = (cv.h - DIGIT_H) / 2
    const r = THICK / 2
    const gap = 1.5
    let x = 8
    for (const ch of words) {
      if (ch === ':') {
        // A colon stands in the room between two pairs: the gap before it is the last digit's own.
        const cx = x - DIGIT_GAP + COLON_W / 2
        for (const cy of [top + DIGIT_H * 0.32, top + DIGIT_H * 0.68]) cv.rect(cx - 4.5, cy - 4.5, cx + 4.5, cy + 4.5, ink)
        x += COLON_W - DIGIT_GAP
        continue
      }
      const lit = SEGMENTS[Number(ch)] ?? ''
      const left = x + r
      const right = x + DIGIT_W - r
      const mid = top + DIGIT_H / 2
      const bottom = top + DIGIT_H - r
      const parts: Record<string, [Pt, Pt]> = {
        a: [[left + gap, top + r], [right - gap, top + r]],
        b: [[right, top + r + gap], [right, mid - gap]],
        c: [[right, mid + gap], [right, bottom - gap]],
        d: [[left + gap, bottom], [right - gap, bottom]],
        e: [[left, mid + gap], [left, bottom - gap]],
        f: [[left, top + r + gap], [left, mid - gap]],
        g: [[left + gap, mid], [right - gap, mid]],
      }
      for (const [name, [from, to]] of Object.entries(parts)) segment(cv, from, to, ink, lit.includes(name) ? 1 : GHOST)
      x += DIGIT_W + DIGIT_GAP
    }

    return base64(png(cv))
  })

  return { columns, rows: CLOCK_ROWS, alt: words, png: file }
}

// The token board: the whole run's token counts as an airport departures
// board of split flaps. Each character stands on its own dark tile, with the
// flap's split through its middle; the letters are drawn as lines, not dots.

type Path = readonly Pt[]

/** Points along a circle's arc, angles in degrees: 0 is right, 90 is down. */
const arc = (cx: number, cy: number, r: number, from: number, to: number): Pt[] => {
  const n = Math.max(2, Math.ceil(Math.abs(to - from) / 12))

  return Array.from({ length: n + 1 }, (_, i): Pt => {
    const a = ((from + ((to - from) * i) / n) * Math.PI) / 180

    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
}

/** A shape turned half a round in its box: `6` gives `9`. */
const turned = (path: Path): Path => path.map(([x, y]): Pt => [6 - x, 10 - y])

const ROUND: Path = [...arc(3, 3, 3, 180, 360), ...arc(3, 7, 3, 0, 180), [0, 3]]
const SIX: Path = [...arc(3.2, 3.2, 3.2, 300, 180), [0, 7], ...arc(3, 7, 3, 180, 540)]

/** Each character the board shows, as lines in a box 6 wide and 10 high, one even stroke: a plain airport face. */
const GLYPHS: Record<string, readonly Path[]> = {
  '0': [ROUND],
  '1': [[[1.4, 2.2], [3.4, 0], [3.4, 10]]],
  '2': [[...arc(3, 3, 3, 180, 400), [0, 10], [6, 10]]],
  '3': [[...arc(3, 2.45, 2.45, 205, 450), ...arc(3, 7.45, 2.55, 270, 515)]],
  '4': [[[4.7, 10], [4.7, 0], [0, 7], [6, 7]]],
  '5': [[[5.5, 0], [0.8, 0], [0.45, 5], ...arc(2.9, 6.9, 3.1, 215, 510)]],
  '6': [SIX],
  '7': [[[0, 0], [6, 0], [2.3, 10]]],
  '8': [arc(3, 2.4, 2.4, 0, 360), arc(3, 7.3, 2.7, 0, 360)],
  '9': [turned(SIX)],
  ',': [[[3.3, 8.4], [2.5, 10.8]]],
  A: [[[0, 10], [3, 0], [6, 10]], [[1.15, 6.5], [4.85, 6.5]]],
  C: [[...arc(3, 3, 3, 330, 180), ...arc(3, 7, 3, 180, 30)]],
  D: [[[0, 0], [2.5, 0], ...arc(2.5, 3.5, 3.5, 270, 360), ...arc(2.5, 6.5, 3.5, 0, 90), [0, 10], [0, 0]]],
  E: [[[6, 0], [0, 0], [0, 10], [6, 10]], [[0, 4.9], [5, 4.9]]],
  H: [[[0, 0], [0, 10]], [[6, 0], [6, 10]], [[0, 4.9], [6, 4.9]]],
  I: [[[3, 0], [3, 10]]],
  K: [[[0, 0], [0, 10]], [[6, 0], [0, 6.3]], [[2.3, 4.4], [6, 10]]],
  N: [[[0, 10], [0, 0], [6, 10], [6, 0]]],
  O: [ROUND],
  R: [[[0, 10], [0, 0], [3.3, 0], ...arc(3.3, 2.6, 2.6, 270, 450), [0, 5.2]], [[3.1, 5.2], [6, 10]]],
  S: [[...arc(3, 2.5, 2.5, 330, 90), ...arc(3, 7.5, 2.5, 270, 510)]],
  T: [[[0, 0], [6, 0]], [[3, 0], [3, 10]]],
  U: [[[0, 0], [0, 7], ...arc(3, 7, 3, 180, 0), [6, 0]]],
  W: [[[0, 0], [1.5, 10], [3, 3.2], [4.5, 10], [6, 0]]],
}

/** Words in the board's face, from `x`, `height` pixels high on the line whose top is `y`; `weight` is the stroke's share of the height. */
function write(cv: Canvas, words: string, x: number, y: number, height: number, weight: number, ink: readonly [number, number, number]): void {
  const s = height / 10
  for (const [i, ch] of [...words].entries()) {
    for (const path of GLYPHS[ch] ?? []) cv.stroke(path.map(([gx, gy]): Pt => [x + i * s * 8.6 + gx * s, y + gy * s]), height * weight, ink)
  }
}

/** The width of `words` as `write` draws them. */
const written = (words: string, height: number) => (height / 10) * (words.length * 8.6 - 2.6)

/** The tiles of a line: its label from the left, then its count to the right. */
const BOARD_LABEL = 11
const BOARD_COUNT = 13
/** The pixels from one tile to the next: at most 30, so a figure is smaller than the clock's, and 16 at the least. */
const TILE_MAX = 30
const TILE_MIN = 16
const BOARD = { panel: rgb('#050505'), top: rgb('#4a4a4a'), bottom: rgb('#3a3a3a'), split: rgb('#0a0a0a'), ink: rgb('#f4f4f4') }
const BOARD_TITLE = 'TOKENS'
const BOARD_HEADS = ['KIND', 'COUNT'] as const

/** A count with a comma each three digits, or its digits alone when the commas do not fit. */
const boardCount = (n: number) => {
  const digits = String(Math.max(0, Math.round(n)))
  const commas = digits.replace(/\B(?=(\d{3})+$)/g, ',')

  return (commas.length <= BOARD_COUNT ? commas : digits).slice(-BOARD_COUNT)
}

/**
 * Counts as an airport departures board: a black panel with its title, then a
 * line for each count, its label and its figures on split-flap tiles.
 * `columns` is the room it has; it takes less when its tiles are at their largest.
 */
export function boardPicture(columns: number, lines: readonly (readonly [label: string, count: number])[]): Picture {
  const texts = lines.map(([label, count]) => [label.slice(0, BOARD_LABEL).padEnd(BOARD_LABEL), boardCount(count).padStart(BOARD_COUNT)] as const)
  // A tile of room between the two groups, and half a tile at each side.
  const across = BOARD_LABEL + BOARD_COUNT + 2
  const pitch = Math.max(TILE_MIN, Math.min(TILE_MAX, Math.floor((columns * CELL_W) / across)))
  const tile = { w: pitch - 3, h: Math.round(pitch * 1.3) }
  const row = tile.h + 4
  const side = Math.round(pitch / 2)
  const title = Math.round(pitch * 1.5)
  const heads = Math.round(pitch * 0.8)
  const body = title + 6
  const width = across * pitch
  const size = { columns: Math.ceil(width / CELL_W), rows: Math.ceil((body + heads + lines.length * row + side) / CELL_H) }

  return {
    ...size,
    alt: lines.map(([label, count]) => `${label} ${boardCount(count)}`).join(' · '),
    png: newest('board', `${pitch}|${texts.map(t => t.join(' ')).join('|')}`, () => {
      const cv = new Canvas(size.columns, size.rows)
      // The title's own block, a gap of the pane, then the block of the lines, as the airport's board has them.
      cv.rect(0, 0, width, title, BOARD.panel)
      cv.rect(0, body, width, cv.h, BOARD.panel)
      const high = title * 0.5
      write(cv, BOARD_TITLE, (width - written(BOARD_TITLE, high)) / 2, (title - high) / 2, high, 0.2, BOARD.ink)
      const groups = [side, side + (BOARD_LABEL + 1) * pitch]
      for (const [g, words] of BOARD_HEADS.entries()) write(cv, words, (groups[g] ?? 0) + 1, body + heads * 0.3, heads * 0.42, 0.17, BOARD.ink)
      const glyph = tile.h * 0.6
      for (const [i, parts] of texts.entries()) {
        const y = body + heads + i * row
        const mid = y + tile.h / 2
        for (const [g, words] of parts.entries()) {
          for (const [k, ch] of [...words].entries()) {
            const x = (groups[g] ?? 0) + k * pitch
            cv.rect(x, y, x + tile.w, mid, BOARD.top)
            cv.rect(x, mid, x + tile.w, y + tile.h, BOARD.bottom)
            write(cv, ch, x + (tile.w - glyph * 0.6) / 2, y + (tile.h - glyph) / 2, glyph, 0.12, BOARD.ink)
            // The flap's split crosses the character, and a hinge shows at each end of it.
            cv.rect(x, mid - 0.75, x + tile.w, mid + 0.75, BOARD.split)
            cv.rect(x, mid - 2.5, x + 1.5, mid + 2.5, BOARD.split)
            cv.rect(x + tile.w - 1.5, mid - 2.5, x + tile.w, mid + 2.5, BOARD.split)
          }
        }
      }

      return base64(png(cv, { x: pitch, y: row }))
    }),
  }
}
