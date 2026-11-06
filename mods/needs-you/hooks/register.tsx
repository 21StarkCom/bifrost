import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Answer, Ask, Kind, Row } from '../types'

// Change the tag when the shape of the value changes: it declines what an
// earlier version stored, which outlives a reload.
const rowsAtom = atom({ plugin: 'needs-you', key: 'asks' } as const, [], { shape: 'asks-2' })

// The root rules' tags, in the order `tools/ask_guard_metric.ts` reads them.
// `tools/ask_guard_metric.test.ts` holds KINDS and LEAD to QUESTION_KINDS and TAG there.
const KINDS: readonly Kind[] = ['GO', 'Yours', 'Your hands', 'Design approval']
const LEAD = 'Needs you ('
const RECOMMEND = /\bI recommend\s+(.+)$/i
// A field grows with its words up to this many rows, then scrolls.
const FIELD_ROWS_MAX = 5
// The cells the engine draws beside a field that has the focus: ` ⏎ next`.
const FIELD_LABEL = 8

// One `Needs you (<tag>): <question>` line, or null when the line is not one.
export function parseLine(line: string): Ask | null {
  if (!line.startsWith(LEAD)) return null
  const kind = KINDS.find(k => line.startsWith(k, LEAD.length))
  if (kind === undefined) return null
  // The tag ends at the parenthesis that closes `Needs you (`, so a tag may hold its own.
  let depth = 1
  let end = -1
  for (let i = LEAD.length; i < line.length && end === -1; i++) {
    if (line[i] === '(') depth += 1
    if (line[i] === ')') {
      depth -= 1
      if (depth === 0) end = i
    }
  }
  const tag = end === -1 ? kind : line.slice(LEAD.length, end).trim()
  const question = (end === -1 ? line.slice(LEAD.length + kind.length) : line.slice(end + 1)).replace(/^:\s*/, '').trim()
  const found = RECOMMEND.exec(question)
  // The pick ends at its first sentence stop: a reason after it is not the pick.
  const pick = found?.[1]?.split(/[.!](?:\s|$)/)[0]?.trim()

  return { kind, tag, question, ...(pick ? { pick } : {}) }
}

// The closing run of tagged lines, as `classifyEnding` in tools/ask_guard_metric.ts
// reads it: trimmed non-empty lines, from the end, while each is a tagged line.
export function parseAsks(text: string): Ask[] {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
  const out: Ask[] = []
  for (const line of [...lines].reverse()) {
    const ask = parseLine(line)
    if (ask === null) break
    out.unshift(ask)
  }

  return out
}

// The words for each side of an answer, by tag.
function labels(ask: Ask): { yes: string; no: string } {
  switch (ask.kind) {
    case 'GO':
      return { yes: 'go', no: 'no go' }
    case 'Your hands':
      return { yes: 'done', no: 'not yet' }
    case 'Design approval':
      return { yes: 'approve', no: 'changes' }
    default:
      return ask.pick === undefined ? { yes: 'yes', no: 'no' } : { yes: `your pick: ${ask.pick}`, no: 'no' }
  }
}

// Take all picks answers only a Yours row that carries a pick. A GO row, a
// Design approval row, a Your hands row and a Yours row with no pick each
// need the operator's own key.
const hasPick = (ask: Ask) => ask.kind === 'Yours' && ask.pick !== undefined
const hasWords = (row: Row) => row.words.trim() !== ''
const isAnswered = (row: Row) => row.answer !== null || hasWords(row)
const sameAsk = (a: Ask, b: Ask) => a.tag === b.tag && a.question === b.question
// Code points a terminal draws two cells wide: East Asian wide letters and the emoji blocks.
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
]
// The cells a text takes on a terminal, by code point, so an emoji is never split.
const width = (s: string) =>
  Array.from(s).reduce((sum, ch) => {
    const point = ch.codePointAt(0) ?? 0

    return sum + (WIDE.some(([from, to]) => point >= from && point <= to) ? 2 : 1)
  }, 0)

// The chip names the side the row is on. A pick shows in the question, whole,
// so the chip says only "your pick" and never cuts it.
function chip(ask: Ask, answer: Answer | null, words: boolean): string {
  if (answer === 'yes') return `✓ ${hasPick(ask) ? 'your pick' : labels(ask).yes}`
  if (answer === 'no') return `✗ ${labels(ask).no}`

  return words ? '✎ words' : '○'
}

// A new key draws the field again with its `value`: see `Row.field`.
const fieldKey = (row: Row) => `words-${row.id}-${row.field.rev}`
// The field drawn again with the words as they are now.
const redrawn = (row: Row, words: string): Row => ({ ...row, words, field: { value: words, rev: row.field.rev + 1 } })

const nextAnswer = (a: Answer | null): Answer | null => (a === null ? 'yes' : a === 'yes' ? 'no' : null)

// Answered rows whose message waits for the running turn to end. A turn that
// ends in that time has not read the answers, so a line it asks again is not
// open: it does not join the band. Module state: a reload starts it empty.
let waiting: readonly Row[] = []

// An id no row in `taken` holds, so two rows never share a key.
function freshId(taken: readonly Row[], turnId: string): string {
  let n = 0
  while (taken.some(row => row.id === `${turnId}:${n}`)) n += 1

  return `${turnId}:${n}`
}

// New lines join the band after the open rows; a line asked again keeps its one row.
export function merge(now: readonly Row[], items: readonly Ask[], turnId: string, sent: readonly Row[] = []): Row[] {
  const out = [...now]
  for (const ask of items) {
    if ([...out, ...sent].some(row => sameAsk(row.ask, ask))) continue
    const id = freshId([...out, ...sent], turnId)
    out.push({ id, ask, answer: null, words: '', field: { value: '', rev: 0 } })
  }

  return out
}

// Holds `sent` in `waiting` until `delivered` settles, whichever way it goes.
async function whileWaiting<T>(sent: readonly Row[], delivered: Promise<T>): Promise<T> {
  waiting = [...waiting, ...sent]
  try {
    return await delivered
  } finally {
    waiting = waiting.filter(row => !sent.includes(row))
  }
}

const without = (now: readonly Row[], gone: readonly Row[]) => now.filter(row => !gone.some(g => g.id === row.id))

// A message that did not go puts its rows back in front, with what they held.
// A line a later turn asked again while the message waited keeps one row: the sent one.
const putBack = (now: readonly Row[], sent: readonly Row[]) => [
  ...sent.map(row => redrawn(row, row.words)),
  ...without(now, sent).filter(row => !sent.some(s => sameAsk(s.ask, row.ask))),
]

function said(row: Row): string {
  const side = row.answer === null ? undefined : labels(row.ask)[row.answer]
  if (!hasWords(row)) return `${side ?? 'no answer yet'}.`
  // The words go as typed; a later line of them stays under its own item.
  const words = `my words: ${row.words.trim().replace(/\n/g, '\n   ')}`

  return side === undefined ? words : `${side}; ${words}`
}

export function messageFor(rows: readonly Row[]): string {
  return [
    `My answers to your Needs you lines (${rows.filter(isAnswered).length} of ${rows.length} answered):`,
    '',
    // The question names the line, so an answer read after a newer turn
    // still matches its own question. The recommendation is left out.
    ...rows.map(
      (row, i) => `${i + 1}. ${row.ask.tag} ("${row.ask.question.replace(/\s*\bI recommend\b.*$/i, '')}") — ${said(row)}`,
    ),
  ].join('\n')
}

// Rows a field of `columns` cells needs to show its words whole, the cursor's
// cell and the label beside a focused field included.
function fieldRows(words: string, columns: number): number {
  const cells = Math.max(columns - FIELD_LABEL, 10)
  const needed = words.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil((width(line) + 1) / cells)), 0)

  return Math.min(Math.max(needed, 1), FIELD_ROWS_MAX)
}

// Sends the answered rows and keeps the open ones, so the operator answers them later.
async function send($: EngineInterface): Promise<void> {
  const rows = await read($, rowsAtom)
  const sent = rows.filter(isAnswered)
  if (sent.length === 0) {
    $.ui.toast('Answer a row first: press its number, or write in its field.')
    return
  }
  await update($, rowsAtom, now => without(now, sent))
  // A plugin's prompt runs once the session is idle, and the submit resolves
  // only when its turn starts: awaiting it here would run the press past its
  // time budget.
  void whileWaiting(sent, $.prompt.submit({ text: messageFor(rows), asUser: true })).then(async submitted => {
    if (submitted.drop === undefined) return
    await update($, rowsAtom, now => putBack(now, sent))
    $.ui.toast(`Not sent: ${submitted.drop}`)
  })
}

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    // New lines join the band. An end with no lines keeps it: a task
    // notification's or a command's turn does not answer the lines.
    if (e.agentId === undefined && e.reason === 'answer') {
      const items = parseAsks(e.answer)
      if (items.length > 0) await update($, rowsAtom, now => merge(now, items, e.turnId, waiting))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // The person's own prompt carries the answered rows above their words. A
  // prompt with no answer goes as typed, and every row stays open.
  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!isPerson || e.command !== undefined || e.isMeta) return next(e)
    const rows = await read($, rowsAtom)
    const sent = rows.filter(isAnswered)
    if (sent.length === 0) return next(e)
    await update($, rowsAtom, now => without(now, sent))
    const entered = await whileWaiting(sent, next({ ...e, text: `${messageFor(rows)}\n\n${e.text}` }))
    if (entered.drop !== undefined) await update($, rowsAtom, now => putBack(now, sent))

    return entered
    // A failure here never holds the person's prompt: it goes as typed.
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) return next(e)
    const rows = await read($, rowsAtom)
    if (rows.length === 0) return next(e)

    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const band = e.requestId
    const count = rows.length
    // One chip width for every row and answer, so a press never moves the text.
    const chipWidth = Math.max(
      ...rows.flatMap(row => [chip(row.ask, 'yes', false), chip(row.ask, 'no', false), chip(row.ask, null, true)].map(width)),
    )
    // `1: ` before the chip, two cells after it: the rest holds the question and the field.
    const textColumns = e.props.bodyColumns - 3 - chipWidth - 2
    // A handler finds its row by its id, not its place: a row that left moves the rest up.
    const change = (id: string, fn: (row: Row) => Row) =>
      update($, rowsAtom, now => now.map(row => (row.id === id ? fn(row) : row)))
    // Fills only a pick row the person left alone: an answer or words they gave stay.
    const takeAll = () =>
      update($, rowsAtom, now =>
        now.map(row => (hasPick(row.ask) && !isAnswered(row) ? { ...row, answer: 'yes' as const } : row)),
      )
    const digits = count > 1 ? `1-${Math.min(count, 9)}` : '1'
    const anyPick = rows.some(row => hasPick(row.ask))
    const keys = anyPick ? 'a, s or c' : 's or c'

    return (
      <Box flexDirection="column">
        <Box columnGap={1}>
          <Text bold color="claude">
            Needs you
          </Text>
          <Text dimColor>
            {rows.filter(isAnswered).length} of {count} answered
          </Text>
        </Box>
        {rows.map((row, i) => {
          const shown = chip(row.ask, row.answer, hasWords(row))
          // A row past 9 has no hotkey, so it takes the cells `1: ` holds on the others.
          const lead = i < 9 ? '' : '   '

          return (
            <Box key={`line-${row.id}`} flexDirection="row" columnGap={2}>
              <Box flexShrink={0}>
                <Button
                  // By id, as the field: the focus ring finds a Button again by its key,
                  // so a key by place would move the ring to another row when one leaves.
                  key={`row-${row.id}`}
                  plain
                  {...(i < 9 ? { hotkey: String(i + 1) } : {})}
                  onPress={() => change(row.id, r => ({ ...r, answer: nextAnswer(r.answer) }))}
                >
                  <Text color={row.answer === null ? 'inactive' : row.answer === 'yes' ? 'success' : 'warning'}>
                    {lead + shown + ' '.repeat(Math.max(chipWidth - width(shown), 0))}
                  </Text>
                </Button>
              </Box>
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Text wrap="wrap">
                  {row.ask.tag}
                  <Text dimColor>{` · ${row.ask.question}`}</Text>
                </Text>
                <Input
                  key={fieldKey(row)}
                  placeholder="your own words (optional)"
                  submitLabel="next"
                  value={row.field.value}
                  rows={fieldRows(row.words, textColumns)}
                  onInput={value => change(row.id, r => ({ ...r, words: value }))}
                  // Enter keeps the words and moves to the next field, then to Send.
                  // A move the engine refuses leaves the focus where it is.
                  onSubmit={value =>
                    change(row.id, r => redrawn(r, value))
                      .then(async () => {
                        // The row after this one as the band holds it now, not as it was drawn.
                        const now = await read($, rowsAtom)
                        const at = now.findIndex(r => r.id === row.id)
                        const after = at === -1 ? undefined : now[at + 1]
                        await $.ui.focus({ requestId: band, key: after === undefined ? 'send' : fieldKey(after) })
                      })
                      .catch(() => undefined)
                  }
                />
              </Box>
            </Box>
          )
        })}
        <Box columnGap={1}>
          {anyPick && <Button key="all" hotkey="a" label="Take all picks" onPress={() => takeAll()} />}
          <Button key="send" hotkey="s" variant="primary" label="Send answers" onPress={() => send($)} />
          <Button key="clear" hotkey="c" dimColor label="Clear" onPress={() => update($, rowsAtom, () => [])} />
        </Box>
        <Text dimColor wrap="wrap">
          {`${digits} in an empty prompt answers a row. ctrl+x tab gives the band the keys: Tab to a field and write, ` +
            `Enter for the next field and then Send, ${keys} outside a field, Esc for the prompt. ` +
            `Open rows stay until you answer them. Words you type in the prompt go after your answers.` +
            (e.props.isWorking ? ' Send waits until Claude stops.' : '')}
        </Text>
      </Box>
    )
  })
}
