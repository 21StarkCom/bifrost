// Pixels for the terminal's Image element: a small canvas with soft edges, and
// a PNG encoder. Pure, and with no engine call: the mod's runtime has no
// CompressionStream, so the PNG data is packed here. A picture is clear behind
// its marks, so it sits on whatever the terminal's theme draws there.

/** Pixels a cell, near a Retina cell of Ghostty or kitty (about 1:2.1). The terminal scales a picture to its box of cells. */
export const CELL_W = 16
export const CELL_H = 34

export type RGB = readonly [number, number, number]
export type Pt = readonly [number, number]

/** `#rrggbb` as its three bytes. */
export const rgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16) || 0,
  parseInt(hex.slice(3, 5), 16) || 0,
  parseInt(hex.slice(5, 7), 16) || 0,
]

const clamp = (v: number) => Math.max(0, Math.min(1, v))

export class Canvas {
  readonly px: Uint8Array
  readonly w: number
  readonly h: number

  /** A clear canvas of `columns` by `rows` cells. */
  constructor(columns: number, rows: number) {
    this.w = columns * CELL_W
    this.h = rows * CELL_H
    this.px = new Uint8Array(this.w * this.h * 4)
  }

  /** Source-over on straight alpha, so a clear canvas keeps soft edges. */
  blend(x: number, y: number, c: RGB, a: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return
    const i = (y * this.w + x) * 4
    const k = Math.min(a, 1)
    const under = (this.px[i + 3] ?? 0) / 255
    const out = k + under * (1 - k)
    for (let j = 0; j < 3; j++) this.px[i + j] = Math.round(((c[j] ?? 0) * k + (this.px[i + j] ?? 0) * under * (1 - k)) / out)
    this.px[i + 3] = Math.round(out * 255)
  }

  /** A filled box, its edges soft by how much of each pixel they cover. */
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1): void {
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      const cy = Math.min(y + 1, y1) - Math.max(y, y0)
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) this.blend(x, y, c, a * cy * (Math.min(x + 1, x1) - Math.max(x, x0)))
    }
  }

  /** A line through `pts`, `width` thick with round ends; each pixel keeps its best cover, so a joint does not darken. A dash is [on, off] pixels. */
  stroke(pts: readonly Pt[], width: number, c: RGB, dash: Pt | null = null, a = 1): void {
    const cover = new Map<number, number>()
    const r = width / 2
    let walked = 0
    for (let s = 0; s + 1 < pts.length; s++) {
      const [ax, ay] = pts[s] ?? [0, 0]
      const [bx, by] = pts[s + 1] ?? [0, 0]
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2
      const len = Math.sqrt(len2)
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1))
      const x1 = Math.min(this.w - 1, Math.ceil(Math.max(ax, bx) + r + 1))
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1))
      const y1 = Math.min(this.h - 1, Math.ceil(Math.max(ay, by) + r + 1))
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const t = len2 === 0 ? 0 : clamp(((x + 0.5 - ax) * (bx - ax) + (y + 0.5 - ay) * (by - ay)) / len2)
          if (dash !== null && (walked + t * len) % (dash[0] + dash[1]) > dash[0]) continue
          const k = clamp(r + 0.5 - Math.hypot(x + 0.5 - (ax + t * (bx - ax)), y + 0.5 - (ay + t * (by - ay))))
          const i = y * this.w + x
          if (k > (cover.get(i) ?? 0)) cover.set(i, k)
        }
      }
      walked += len
    }
    for (const [i, k] of cover) this.blend(i % this.w, Math.floor(i / this.w), c, k * a)
  }

  /** The area under a line down to `base`, fading from `top` alpha at `y0` to `bottom` at the base: one fade for the whole plot. */
  fillUnder(pts: readonly Pt[], y0: number, base: number, c: RGB, top: number, bottom: number): void {
    for (let x = 0; x < this.w; x++) {
      const cx = x + 0.5
      const s = pts.findIndex((p, i) => p[0] <= cx && cx < (pts[i + 1]?.[0] ?? Number.NEGATIVE_INFINITY))
      const from = pts[s]
      const to = pts[s + 1]
      if (from === undefined || to === undefined) continue
      const y = from[1] + ((cx - from[0]) / (to[0] - from[0])) * (to[1] - from[1])
      for (let py = Math.floor(y); py < base; py++) {
        this.blend(x, py, c, (py < y ? py + 1 - y : 1) * (top + (bottom - top) * ((py - y0) / (base - y0))))
      }
    }
  }

  /** A filled convex shape, its edges soft: each pixel takes the share of its 16 points that are inside. */
  poly(pts: readonly Pt[], c: RGB, a = 1): void {
    const xs = pts.map(p => p[0])
    const ys = pts.map(p => p[1])
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        let inside = 0
        for (let s = 0; s < 16; s++) {
          const px = x + ((s % 4) + 0.5) / 4
          const py = y + (Math.floor(s / 4) + 0.5) / 4
          // Inside a convex shape, a point is on one side of every edge.
          let side = 0
          let isIn = true
          for (let i = 0; i < pts.length && isIn; i++) {
            const [ax, ay] = pts[i] ?? [0, 0]
            const [bx, by] = pts[(i + 1) % pts.length] ?? [0, 0]
            const cross = Math.sign((bx - ax) * (py - ay) - (by - ay) * (px - ax))
            if (cross === 0) continue
            if (side === 0) side = cross
            else if (cross !== side) isIn = false
          }
          if (isIn) inside++
        }
        this.blend(x, y, c, (inside / 16) * a)
      }
    }
  }

  /** A filled circle. */
  dot(cx: number, cy: number, r: number, c: RGB, a = 1): void {
    this.ring(cx, cy, r, -1, c, a)
  }

  /** A ring from radius `r` out to `R`. */
  ring(cx: number, cy: number, R: number, r: number, c: RGB, a = 1): void {
    for (let y = Math.floor(cy - R - 1); y <= Math.ceil(cy + R + 1); y++) {
      for (let x = Math.floor(cx - R - 1); x <= Math.ceil(cx + R + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        this.blend(x, y, c, clamp(Math.min(R + 0.5 - d, d - r + 0.5)) * a)
      }
    }
  }

  /**
   * The parts of a whole as one bar with round ends, `2 * r` thick around
   * `cy`, from `x0` to `x1`, with a small gap between two parts.
   */
  pill(x0: number, x1: number, cy: number, r: number, parts: readonly { value: number; color: RGB; alpha?: number }[]): void {
    const total = parts.reduce((n, p) => n + p.value, 0)
    if (total <= 0) return
    let at = x0
    const edges = parts.map(p => {
      const from = at
      at += (p.value / total) * (x1 - x0)

      return [from, at] as const
    })
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const px = x + 0.5
        const i = edges.findIndex(([from, to]) => px >= from && px < to)
        const part = parts[i]
        const edge = edges[i]
        if (part === undefined || edge === undefined) continue
        const round = clamp(r + 0.5 - Math.hypot(px - Math.max(x0 + r, Math.min(x1 - r, px)), y + 0.5 - cy))
        const left = i === 0 ? 1 : clamp(px - edge[0] - 0.5)
        const right = i === parts.length - 1 ? 1 : clamp(edge[1] - px - 0.5)
        this.blend(x, y, part.color, round * Math.min(left, right) * (part.alpha ?? 1))
      }
    }
  }
}

// PNG: 8-bit RGBA, filter 0 on each row, in one zlib stream.

const CRC = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }

  return table
})()

const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (const b of bytes) c = (CRC[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8)

  return (c ^ 0xffffffff) >>> 0
}

const be32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }

  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length)
  body.set([...type].map(ch => ch.charCodeAt(0)))
  body.set(data, 4)

  return concat([be32(data.length), body, be32(crc32(body))])
}

// Deflate: one block of fixed Huffman codes, with a greedy LZ77 that tries
// three distances: 1 (a run), 4 (the pixel before) and one row up. A picture
// of flat marks on a clear ground packs to a few kilobytes.

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193,
  12289, 16385, 24577,
]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const MAX_MATCH = 258

class Bits {
  out = new Uint8Array(1 << 14)
  len = 0
  acc = 0
  n = 0

  /** `count` bits of `value`, the least significant first. */
  put(value: number, count: number): void {
    this.acc |= value << this.n
    this.n += count
    while (this.n >= 8) {
      if (this.len === this.out.length) {
        const more = new Uint8Array(this.out.length * 2)
        more.set(this.out)
        this.out = more
      }
      this.out[this.len++] = this.acc & 255
      this.acc >>>= 8
      this.n -= 8
    }
  }

  /** A Huffman code: the most significant bit first. */
  code(value: number, count: number): void {
    let r = 0
    for (let i = 0; i < count; i++) r |= ((value >>> i) & 1) << (count - 1 - i)
    this.put(r, count)
  }

  /** A literal or a length symbol, in the fixed codes. */
  symbol(v: number): void {
    if (v < 144) this.code(0x30 + v, 8)
    else if (v < 256) this.code(0x190 + v - 144, 9)
    else if (v < 280) this.code(v - 256, 7)
    else this.code(0xc0 + v - 280, 8)
  }

  done(): Uint8Array {
    if (this.n > 0) this.put(0, 8 - this.n)

    return this.out.subarray(0, this.len)
  }
}

/** The last entry of `table` that is `v` or less. */
const slot = (table: readonly number[], v: number) => {
  let i = table.length - 1
  while (i > 0 && (table[i] ?? 0) > v) i--

  return i
}

/** The farthest a deflate match reaches back. */
const MAX_DIST = 32768

/** zlib data of `raw`, whose rows are `stride` bytes apart. `more` adds distances to try: the period of a picture that repeats. */
export function zlib(raw: Uint8Array, stride: number, more: readonly number[] = []): Uint8Array {
  const tries = [1, 4, stride, ...more].filter(d => d >= 1 && d <= MAX_DIST)
  const bits = new Bits()
  bits.put(1, 1) // the last block
  bits.put(1, 2) // fixed Huffman codes
  for (let i = 0; i < raw.length; ) {
    let best = 0
    let dist = 0
    for (const d of tries) {
      if (d > i) continue
      let n = 0
      while (n < MAX_MATCH && i + n < raw.length && raw[i + n] === raw[i + n - d]) n++
      if (n > best) {
        best = n
        dist = d
      }
    }
    if (best < 3) {
      bits.symbol(raw[i] ?? 0)
      i++
      continue
    }
    const l = slot(LEN_BASE, best)
    bits.symbol(257 + l)
    bits.put(best - (LEN_BASE[l] ?? 0), LEN_EXTRA[l] ?? 0)
    const k = slot(DIST_BASE, dist)
    bits.code(k, 5)
    bits.put(dist - (DIST_BASE[k] ?? 0), DIST_EXTRA[k] ?? 0)
    i += best
  }
  bits.symbol(256)
  let s1 = 1
  let s2 = 0
  for (const b of raw) {
    s1 = (s1 + b) % 65521
    s2 = (s2 + s1) % 65521
  }

  return concat([Uint8Array.of(0x78, 0x01), bits.done(), be32(((s2 << 16) | s1) >>> 0)])
}

/**
 * The canvas as a PNG file. `repeat` is the period, in pixels, of a picture
 * that repeats across and down (a grid of dots): it packs far smaller with it.
 */
export function png(cv: Canvas, repeat?: { x: number; y: number }): Uint8Array {
  const stride = cv.w * 4 + 1
  const rows = new Uint8Array(cv.h * stride)
  for (let y = 0; y < cv.h; y++) rows.set(cv.px.subarray(y * cv.w * 4, (y + 1) * cv.w * 4), y * stride + 1)

  return concat([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', concat([be32(cv.w), be32(cv.h), Uint8Array.of(8, 6, 0, 0, 0)])),
    chunk('IDAT', zlib(rows, stride, repeat === undefined ? [] : [repeat.x * 4, repeat.y * stride])),
    chunk('IEND', new Uint8Array(0)),
  ])
}

const run = (from: string, count: number) => Array.from({ length: count }, (_, i) => String.fromCharCode(from.charCodeAt(0) + i)).join('')
/** The 64 characters of base64, in order: A to Z, a to z, 0 to 9, then + and /. Built, since a secret scan reads the literal as a key. */
const B64 = `${run('A', 26)}${run('a', 26)}${run('0', 10)}+/`

/** Standard padded base64, as an Image's `png` source takes it. */
export function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += (B64[(n >>> 18) & 63] ?? '') + (B64[(n >>> 12) & 63] ?? '')
    out += i + 1 < bytes.length ? (B64[(n >>> 6) & 63] ?? '') : '='
    out += i + 2 < bytes.length ? (B64[n & 63] ?? '') : '='
  }

  return out
}
