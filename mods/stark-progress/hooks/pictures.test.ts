import { expect, test } from 'claude-code/testing'

import { clockOf, stepCounts } from './board'
import { paletteFor } from './pane'
import {
  boardPicture,
  burnUp,
  CLOCK_INK,
  clockPicture,
  clockWords,
  hasHour,
  hourPicture,
  hourScale,
  logPicture,
  stepsPicture,
  trackColumns,
  trackPicture,
} from './pictures'
import { base64, Canvas, CELL_H, CELL_W, png, rgb } from './pixels'

const P = paletteFor('terminal')
const T0 = Date.parse('2026-10-29T12:00:00Z')
const MIN = 60_000

const bytesOf = (b64: string) => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))
const be32 = (b: Uint8Array, at: number) => (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>> 0

// The check reads a PNG back with code of its own, never the mod's: a test file may import only the mod's
// files, so the standard inflate, Adler-32 and CRC-32 are written out here, each from its definition.
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193,
  12289, 16385, 24577,
]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

/** A zlib stream of fixed-Huffman blocks, inflated; its Adler-32 must be the one the stream ends on. */
function inflate(z: Uint8Array): Uint8Array {
  let pos = 16
  const bit = () => {
    const b = ((z[pos >> 3] ?? 0) >> (pos & 7)) & 1
    pos++

    return b
  }
  const bits = (n: number) => {
    let v = 0
    for (let i = 0; i < n; i++) v |= bit() << i

    return v
  }
  const code = (n: number, from = 0) => {
    let v = from
    for (let i = 0; i < n; i++) v = (v << 1) | bit()

    return v
  }
  const out: number[] = []
  for (let isLast = false; !isLast; ) {
    isLast = bit() === 1
    expect(bits(2)).toBe(1)
    for (;;) {
      // The fixed codes: 7 bits for 256 to 279, 8 for 0 to 143 and 280 to 287, 9 for 144 to 255.
      let c = code(7)
      let symbol = 256 + c
      if (c > 0b0010111) {
        c = code(1, c)
        if (c >= 0b00110000 && c <= 0b10111111) symbol = c - 0b00110000
        else if (c >= 0b11000000 && c <= 0b11000111) symbol = 280 + c - 0b11000000
        else symbol = 144 + code(1, c) - 0b110010000
      }
      if (symbol === 256) break
      if (symbol < 256) {
        out.push(symbol)
        continue
      }
      const length = (LEN_BASE[symbol - 257] ?? 0) + bits(LEN_EXTRA[symbol - 257] ?? 0)
      const d = code(5)
      const distance = (DIST_BASE[d] ?? 0) + bits(DIST_EXTRA[d] ?? 0)
      expect(distance).toBeLessThanOrEqual(out.length)
      for (let i = 0; i < length; i++) out.push(out[out.length - distance] ?? 0)
    }
  }
  let a = 1
  let b = 0
  for (const v of out) {
    a = (a + v) % 65521
    b = (b + a) % 65521
  }
  expect(be32(z, z.length - 4)).toBe(((b << 16) | a) >>> 0)

  return Uint8Array.from(out)
}

/** CRC-32, a bit at a time. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const v of bytes) {
    c ^= v
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }

  return (c ^ 0xffffffff) >>> 0
}

/** A PNG file read back: each chunk's CRC, its size, and its pixels, each row's filter 0. */
function decode(file: Uint8Array): { w: number; h: number; px: Uint8Array } {
  expect([...file.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  let at = 8
  let w = 0
  let h = 0
  const data: Uint8Array[] = []
  while (at < file.length) {
    const len = be32(file, at)
    const type = String.fromCharCode(...file.subarray(at + 4, at + 8))
    if (type === 'IHDR') {
      w = be32(file, at + 8)
      h = be32(file, at + 12)
      // 8 bits a channel, RGBA.
      expect([file[at + 16], file[at + 17]]).toEqual([8, 6])
    }
    if (type === 'IDAT') data.push(file.subarray(at + 8, at + 8 + len))
    expect(be32(file, at + 8 + len)).toBe(crc32(file.subarray(at + 4, at + 8 + len)))
    at += 12 + len
  }
  const packed = new Uint8Array(data.reduce((n, d) => n + d.length, 0))
  let to = 0
  for (const d of data) {
    packed.set(d, to)
    to += d.length
  }
  const raw = inflate(packed)
  const stride = w * 4 + 1
  expect(raw.length).toBe(h * stride)
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    expect(raw[y * stride]).toBe(0)
    px.set(raw.subarray(y * stride + 1, (y + 1) * stride), y * w * 4)
  }

  return { w, h, px }
}

test('a PNG holds the canvas: an inflate of its own reads back every pixel, with a repeat hint too', () => {
  const cv = new Canvas(3, 2)
  cv.rect(2, 3, 30, 20, rgb('#95d5b2'))
  cv.dot(20, 40, 6.5, rgb('#ff453a'), 0.5)
  cv.stroke([[1, 60], [46, 50]], 3, rgb('#8ecae6'), [4, 3])
  cv.poly([[30, 5], [44, 9], [36, 30]], rgb('#e9c46a'))
  cv.pill(2, 46, 62, 4, [{ value: 1, color: rgb('#a5b4fc') }, { value: 2, color: rgb('#f4a6cd'), alpha: 0.5 }])
  for (const file of [png(cv), png(cv, { x: 5, y: 5 })]) {
    const read = decode(file)
    expect([read.w, read.h]).toEqual([3 * CELL_W, 2 * CELL_H])
    expect([...read.px]).toEqual([...cv.px])
  }
  // A clear canvas stays clear, and a mark's edge is soft: some pixel is neither clear nor whole.
  expect(cv.px[3]).toBe(0)
  expect([...cv.px].some((v, i) => i % 4 === 3 && v > 0 && v < 255)).toBe(true)
})

test('base64 is the standard one, padded', () => {
  expect(base64(Uint8Array.of())).toBe('')
  expect(base64(Uint8Array.of(1))).toBe('AQ==')
  expect(base64(Uint8Array.of(1, 2))).toBe('AQI=')
  expect(base64(Uint8Array.of(1, 2, 3, 255))).toBe('AQID/w==')
})

test("a metro line's words are its text line, and a blocked ticket stops at a cross", () => {
  const moving = trackPicture(P, 6, { at: 2, state: 'review' }, P.blue)
  expect(moving).toMatchObject({ columns: trackColumns(6), rows: 1, alt: '●━━━━━━●━━━━━━◉┄┄┄┄┄┄○┄┄┄┄┄┄○' })
  expect(trackColumns(6)).toBe(31)
  expect(trackPicture(P, 2, { at: 1, state: 'blocked' }, P.blocked).alt).toBe('●━━✕┄┄○┄┄○┄┄○')
  expect(trackPicture(P, 6, { at: 5, state: 'done' }, P.green).alt).toBe('●━━━━━━●━━━━━━●━━━━━━●━━━━━━●')
  expect(trackPicture(P, 6, { at: -1, state: 'todo' }, P.track).alt).toBe('○┄┄┄┄┄┄○┄┄┄┄┄┄○┄┄┄┄┄┄○┄┄┄┄┄┄○')
  // The same line is drawn once; another color is another picture.
  expect(trackPicture(P, 6, { at: 2, state: 'review' }, P.blue).png).toBe(moving.png)
  expect(trackPicture(P, 6, { at: 2, state: 'review' }, P.amber).png).not.toBe(moving.png)
  expect(decode(bytesOf(moving.png))).toMatchObject({ w: 31 * CELL_W, h: CELL_H })
})

test('the steps bar says each count, and leaves a step with no ticket out of the bar', () => {
  const steps = stepCounts([
    { at: -1, tone: 'none', attention: null },
    { at: 5, tone: 'done', attention: null },
    { at: 5, tone: 'done', attention: null },
  ])
  const bar = stepsPicture(P, 40, steps)
  expect(bar).toMatchObject({ columns: 40, rows: 1, alt: 'not started 1 · ticket 0 · PR 0 · review 0 · merge 0 · done 2' })
  const { px, w } = decode(bytesOf(bar.png))
  // Mid-height: gray at the left third, the done green at the right.
  const at = (x: number) => [...px.subarray((17 * w + x) * 4, (17 * w + x) * 4 + 3)]
  expect(at(w - 20)).toEqual([...rgb(P.green)])
  expect(at(20)).toEqual([...rgb(P.gray)])
})

test('the burn-up needs a start and a minute of run, and counts the tickets done', () => {
  const row = (started: number | null, closed: number | null) => ({ started, closed }) as never
  expect(burnUp(P, 40, { rows: [row(null, null)], started: null, readAt: T0 })).toBeNull()
  expect(burnUp(P, 40, { rows: [], started: T0 - 60 * MIN, readAt: T0 })).toBeNull()
  expect(burnUp(P, 40, { rows: [row(null, null)], started: T0 - 20_000, readAt: T0 })).toBeNull()
  const burn = burnUp(P, 40, { rows: [row(T0 - 50 * MIN, T0 - 20 * MIN), row(T0 - 40 * MIN, null)], started: T0 - 60 * MIN, readAt: T0 + 30_000 })
  expect(burn).toMatchObject({ columns: 40, rows: 5, start: T0 - 60 * MIN, end: T0, alt: `1 of 2 tickets done since ${clockOf(T0 - 60 * MIN)}.` })
  // With no run start, the first ticket's start is the start; a ticket found closed started when it closed.
  expect(burnUp(P, 40, { rows: [row(null, T0 - 30 * MIN), row(T0 - 10 * MIN, null)], started: null, readAt: T0 })?.start).toBe(T0 - 30 * MIN)
})

test('an hour has something to show with a call, a milestone or a running call, on one scale for the run', () => {
  const quiet = { minutes: Array.from({ length: 60 }, () => ({ calls: 0, fails: 0 })), marks: [], runningFrom: null }
  const busy = { ...quiet, minutes: quiet.minutes.map((m, i) => (i === 7 ? { calls: 12, fails: 3 } : m)) }
  expect(hasHour(null)).toBe(false)
  expect(hasHour(quiet)).toBe(false)
  expect(hasHour(busy)).toBe(true)
  expect(hasHour({ ...quiet, marks: [4] })).toBe(true)
  expect(hasHour({ ...quiet, runningFrom: 30 })).toBe(true)
  // The busiest minute, up to the next 5; 10 at the least.
  expect(hourScale([{ hour: null }, { hour: quiet }])).toBe(10)
  expect(hourScale([{ hour: busy }, { hour: quiet }])).toBe(15)
  const strip = hourPicture(P, 60, 2, busy, 15, 'words')
  expect(strip).toMatchObject({ columns: 60, rows: 2, alt: 'words' })
  // The minute's bar is blue at its foot and red at its top: 3 of its 12 calls failed.
  const { px, w, h } = decode(bytesOf(strip.png))
  const at = (x: number, y: number) => [...px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)]
  expect(at(7 * 16 + 8, h - 6)).toEqual([...rgb(P.blue), 255])
  expect(at(7 * 16 + 8, h - 3 - 40)).toEqual([...rgb(P.blocked), 255])
  // A clear line stands between the cap and the bar, so the failed part shows by its shape too.
  expect(at(7 * 16 + 8, 34)[3]).toBe(0)
  expect(at(7 * 16 + 8, 37)).toEqual([...rgb(P.blue), 255])
  expect(at(20 * 16 + 8, h - 10)[3]).toBe(0)
})

test('the clock reads hours, minutes and seconds, and grows a digit past 99 hours', () => {
  expect(clockWords(0)).toBe('00:00:00')
  expect(clockWords(-5)).toBe('00:00:00')
  expect(clockWords((3600 + 2 * 60 + 5) * 1000 + 999)).toBe('01:02:05')
  expect(clockWords(100 * 3600 * 1000)).toBe('100:00:00')
  const clock = clockPicture(65_000)
  expect(clock).toMatchObject({ columns: 24, rows: 3, alt: '00:01:05' })
  expect(clockPicture(65_999).png).toBe(clock.png)
  expect(clockPicture(66_000).png).not.toBe(clock.png)
  expect(clockPicture(100 * 3600 * 1000).columns).toBeGreaterThan(24)
  // A lit segment is the clock's red; one that is not lit is there, but faint.
  const { px } = decode(bytesOf(clockPicture(0).png))
  const alphas = new Set<number>()
  const [red, green, blue] = rgb(CLOCK_INK)
  for (let i = 0; i < px.length; i += 4) if (px[i] === red && px[i + 1] === green && px[i + 2] === blue) alphas.add(px[i + 3] ?? 0)
  expect(alphas.has(255)).toBe(true)
  expect([...alphas].some(a => a > 0 && a < 40)).toBe(true)
  // The red reads on the pane's #262626: 4.5:1 or more (WCAG), as each text color of the pane.
  const light = (hex: string) =>
    rgb(hex)
      .map(v => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0)
  expect((light(CLOCK_INK) + 0.05) / (light('#262626') + 0.05)).toBeGreaterThanOrEqual(4.5)
})

test('the token board lines up its counts, and drops the commas that do not fit', () => {
  const lines = [
    ['IN', 87_400],
    ['OUT', 3_032_000],
    ['CACHE READ', 2_345_678_901],
    ['CACHE WRITE', 94_135_260],
  ] as const
  const board = boardPicture(60, lines)
  expect(board).toMatchObject({ columns: 49, rows: 8, alt: 'IN 87,400 · OUT 3,032,000 · CACHE READ 2,345,678,901 · CACHE WRITE 94,135,260' })
  expect(boardPicture(60, lines).png).toBe(board.png)
  // 13 tiles hold a count: one with more characters than that loses its commas.
  expect(boardPicture(60, [['IN', 12_345_678_901]]).alt).toBe('IN 12345678901')
  expect(boardPicture(60, [['IN', 1.6]]).alt).toBe('IN 2')
  // In less room the tiles are smaller, down to their least; the board never takes more than its room allows above that.
  const narrow = boardPicture(30, lines)
  expect(narrow.columns).toBeLessThanOrEqual(30)
  expect(narrow.rows).toBeLessThan(board.rows)
  expect(decode(bytesOf(narrow.png)).w).toBe(narrow.columns * CELL_W)
})

test("a log strip splits Gru's steps from the tickets' only when it has both", () => {
  const step = (minutesAgo: number, isRun: boolean) => ({ at: T0 - minutesAgo * MIN, isRun })
  expect(logPicture(P, 40, [step(5, false)], T0)).toBeNull()
  expect(logPicture(P, 40, [step(0, true), step(0, false)], T0 + 1000)).toBeNull()
  expect(logPicture(P, 40, [step(50, true), step(5, false)], T0)).toMatchObject({ columns: 40, rows: 1, isSplit: true, start: T0 - 50 * MIN })
  expect(logPicture(P, 40, [step(50, false), step(5, false)], T0)).toMatchObject({ isSplit: false, alt: `2 steps since ${clockOf(T0 - 50 * MIN)}.` })
})
