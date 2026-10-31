import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Answer, Ask, Asks, Kind } from '../types'

// Change the tag when the shape of the value changes: it declines what an
// earlier version stored, which outlives a reload.
const asksAtom = atom({ plugin: 'needs-you', key: 'asks' } as const, null, { shape: 'asks-1' })

// The root rules' tags, in the order `tools/ask_guard_metric.ts` reads them.
const KINDS: readonly Kind[] = ['GO', 'Yours', 'Your hands', 'Design approval']
const LEAD = 'Needs you ('
const RECOMMEND = /\bI recommend\s+(.+)$/i
const PICK_CHIP_MAX = 24

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
  const pick = found?.[1]?.replace(/[.!]$/, '').trim()

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

const cut = (s: string, n: number) => (n <= 0 ? '' : s.length <= n ? s : `${s.slice(0, Math.max(n - 1, 0))}…`)

function chip(ask: Ask, answer: Answer | null): string {
  if (answer === null) return '○'
  if (answer === 'no') return `✗ ${labels(ask).no}`
  // A pick is the yes side of a Yours row: the chip shows the pick alone.
  return `✓ ${ask.kind === 'Yours' && ask.pick !== undefined ? cut(ask.pick, PICK_CHIP_MAX) : labels(ask).yes}`
}

const nextAnswer = (a: Answer | null): Answer | null => (a === null ? 'yes' : a === 'yes' ? 'no' : null)
const answeredCount = (asks: Asks) => asks.answers.filter(a => a !== null).length

export function messageFor(asks: Asks): string {
  return [
    `My answers to your Needs you lines (${answeredCount(asks)} of ${asks.items.length} answered):`,
    '',
    ...asks.items.map((ask, i) => {
      const answer = asks.answers[i] ?? null
      const said = answer === null ? 'no answer' : labels(ask)[answer]

      return `${i + 1}. ${ask.tag} — ${said}.`
    }),
  ].join('\n')
}

async function send($: EngineInterface): Promise<void> {
  const asks = await read($, asksAtom)
  if (asks === null) return
  if (answeredCount(asks) === 0) {
    $.ui.toast('Answer a row first: press its number.')
    return
  }
  await update($, asksAtom, () => null)
  // The submit resolves only when its turn starts: awaiting it here would run
  // the press past its time budget.
  void $.prompt.submit({ text: messageFor(asks), asUser: true }).then(async submitted => {
    if (submitted.drop === undefined) return
    await update($, asksAtom, now => now ?? asks)
    $.ui.toast(`Not sent: ${submitted.drop}`)
  })
}

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    // Only an answer replaces the rows: an interrupt, a refusal or an error keeps them.
    if (e.agentId === undefined && e.reason === 'answer') {
      const items = parseAsks(e.answer)
      await update($, asksAtom, () =>
        items.length === 0 ? null : { turnId: e.turnId, items, answers: items.map(() => null) },
      )
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // The person's own prompt carries the answers above their words, then clears the rows.
  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!isPerson || e.command !== undefined || e.isMeta) return next(e)
    const asks = await read($, asksAtom)
    if (asks === null) return next(e)
    await update($, asksAtom, () => null)
    if (answeredCount(asks) === 0) return next(e)
    const entered = await next({ ...e, text: `${messageFor(asks)}\n\n${e.text}` })
    if (entered.drop !== undefined) await update($, asksAtom, now => now ?? asks)

    return entered
    // A failure here never holds the person's prompt: it goes as typed.
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) return next(e)
    const asks = await read($, asksAtom)
    if (asks === null || asks.items.length === 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const { turnId, items, answers } = asks
    const columns = e.props.bodyColumns
    const count = items.length
    // One chip width for every row and answer, so a press never moves the text.
    const chipWidth = Math.max(...items.flatMap(ask => [chip(ask, 'yes'), chip(ask, 'no')].map(c => c.length)))
    const cycle = (i: number) =>
      update($, asksAtom, now =>
        now === null || now.turnId !== turnId
          ? now
          : { ...now, answers: now.answers.map((a, j) => (j === i ? nextAnswer(a) : a)) },
      )
    const takeAll = () =>
      update($, asksAtom, now =>
        now === null || now.turnId !== turnId
          ? now
          : { ...now, answers: now.items.map((ask, j) => (ask.kind === 'Your hands' ? (now.answers[j] ?? null) : 'yes')) },
      )
    const digits = count > 1 ? `1-${Math.min(count, 9)}` : '1'

    return (
      <Box flexDirection="column">
        <Box columnGap={1}>
          <Text bold color="claude">
            Needs you
          </Text>
          <Text dimColor>
            {answeredCount(asks)} of {count} answered
          </Text>
        </Box>
        {items.map((ask, i) => {
          const answer = answers[i] ?? null
          const hotkey = i < 9 ? { hotkey: String(i + 1) } : {}
          // `1: ` before the chip, two spaces after it.
          const room = columns - 3 - chipWidth - 2
          const tag = cut(ask.tag, room)
          const question = cut(ask.question, room - tag.length - 3)

          return (
            <Button key={`row-${i}`} plain {...hotkey} onPress={() => cycle(i)}>
              <Text color={answer === null ? 'inactive' : answer === 'yes' ? 'success' : 'warning'}>
                {chip(ask, answer).padEnd(chipWidth)}
              </Text>
              {`  ${tag}`}
              <Text dimColor>{question === '' ? '' : ` · ${question}`}</Text>
            </Button>
          )
        })}
        <Box columnGap={1}>
          <Button key="all" hotkey="a" label="Take all picks" onPress={() => takeAll()} />
          <Button key="send" hotkey="s" variant="primary" label="Send answers" onPress={() => send($)} />
        </Box>
        <Text dimColor>
          {`${digits} in an empty prompt answers a row. a and s work after ctrl+x tab. Words you type and send go after your answers.`}
        </Text>
      </Box>
    )
  })
}
