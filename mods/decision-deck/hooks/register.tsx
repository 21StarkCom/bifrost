import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Answer, Deck, DeckItem, DeckOption } from '../types'

const PANE = 'decision-deck'
const TITLE = 'Decisions'

// Change a tag when the shape of its value changes: it declines what an
// earlier version stored, which outlives a reload.
const deckAtom = atom({ plugin: 'decision-deck', key: 'deck' } as const, null, { shape: 'deck-1' })
const cursorAtom = atom({ plugin: 'decision-deck', key: 'cursor' } as const, 0)
const answersAtom = atom({ plugin: 'decision-deck', key: 'answers' } as const, {}, { shape: 'answers-1' })
const sentAtom = atom({ plugin: 'decision-deck', key: 'sent' } as const, {}, { shape: 'sent-1' })

const EMPTY: Answer = { picks: [], note: '' }

const keyOf = (deck: Deck, item: DeckItem) => `${deck.id}-${item.id}`
const isAnswered = (a: Answer | undefined) =>
  a !== undefined && (a.picks.length > 0 || a.note.trim() !== '')
const without = (all: Record<string, string>, key: string) =>
  Object.fromEntries(Object.entries(all).filter(([k]) => k !== key))

// null until Claude presents a deck with the present tool.
async function currentDeck($: EngineInterface): Promise<Deck | null> {
  return read($, deckAtom)
}

function answerText(item: DeckItem, a: Answer | undefined): string {
  const picks = (a?.picks ?? []).flatMap(id => item.options.filter(o => o.id === id).map(o => o.label))
  const note = a?.note.trim() ?? ''
  if (picks.length === 0 && note === '') return 'no answer'
  return [picks.join(' + '), note === '' ? '' : `my words: "${note}"`].filter(Boolean).join('; ')
}

function messageFor(deck: Deck, answers: Record<string, Answer>): string {
  const done = deck.items.filter(i => isAnswered(answers[keyOf(deck, i)])).length
  const lines = [
    `My answers to "${deck.title}" (${done} of ${deck.items.length} answered):`,
    '',
    ...deck.items.map(i => `- ${i.id} ${i.title}: ${answerText(i, answers[keyOf(deck, i)])}.`),
  ]
  if (deck.outro) lines.push('', deck.outro)
  return lines.join('\n')
}

async function send($: EngineInterface): Promise<void> {
  const deck = await currentDeck($)
  if (deck === null) return
  const answers = await read($, answersAtom)
  const done = deck.items.filter(i => isAnswered(answers[keyOf(deck, i)])).length
  if (done === 0) {
    $.ui.toast('Pick an option or write your words first.')
    return
  }
  const at = new Date(await $.clock.now()).toISOString().slice(11, 16) + ' UTC'
  await update($, sentAtom, all => ({ ...all, [deck.id]: at }))
  // The submit resolves only when its turn starts, which waits while Claude
  // is busy: awaiting it here would run the press past its time budget.
  void $.prompt.submit({ text: messageFor(deck, answers), asUser: true }).then(async submitted => {
    if (submitted.drop === undefined) return
    await update($, sentAtom, all => without(all, deck.id))
    $.ui.toast(`Not sent: ${submitted.drop}`)
  })
  $.ui.toast(`Sent ${done} answers. Claude reads them when its current turn ends.`)
}

// The tool's input as the model sends it, checked by hand: the engine passes
// it through as plain data.
function parseDeck(input: Record<string, unknown>): Deck | string {
  const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
  if (!text(input.id) || !text(input.title)) return 'id and title must be non-empty strings'
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 40) {
    return 'items must hold 1 to 40 decisions'
  }
  const items: DeckItem[] = []
  for (const raw of input.items as Record<string, unknown>[]) {
    if (!text(raw.id) || !text(raw.title) || !text(raw.explain)) return 'each item needs id, title and explain'
    if (items.some(i => i.id === raw.id)) return `item id ${raw.id} appears twice`
    if (!Array.isArray(raw.options) || raw.options.length === 0 || raw.options.length > 9) {
      return `item ${raw.id} needs 1 to 9 options`
    }
    const options: DeckOption[] = []
    for (const o of raw.options as Record<string, unknown>[]) {
      if (!text(o.id) || !text(o.label)) return `each option of ${raw.id} needs id and label`
      if (options.some(p => p.id === o.id)) return `option id ${o.id} appears twice in ${raw.id}`
      options.push({ id: o.id, label: o.label, ...(text(o.detail) ? { detail: o.detail } : {}) })
    }
    const facts = Array.isArray(raw.facts) ? raw.facts.filter(text) : []
    items.push({
      id: raw.id,
      title: raw.title,
      explain: raw.explain,
      options,
      ...(facts.length > 0 ? { facts } : {}),
      ...(text(raw.recommended) ? { recommended: raw.recommended } : {}),
    })
  }
  return {
    id: input.id,
    title: input.title,
    items,
    ...(text(input.intro) ? { intro: input.intro } : {}),
    ...(text(input.outro) ? { outro: input.outro } : {}),
  }
}

const OPTION_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    label: { type: 'string', description: 'A few words; the person reads it as a choice.' },
    detail: { type: 'string', description: 'One short line under the label.' },
  },
  required: ['id', 'label'],
}

const DECK_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'A stable id; the answers are kept per deck id.' },
    title: { type: 'string' },
    intro: { type: 'string', description: 'One or two sentences on the first decision.' },
    outro: { type: 'string', description: 'What the person asks you to do with the answers; it ends the message they send.' },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 40,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'A short id the person sees, such as C01.' },
          title: { type: 'string' },
          explain: { type: 'string', description: 'Markdown: what it is, why it matters, the catch. Keep it short.' },
          facts: { type: 'array', items: { type: 'string' }, description: 'Short facts drawn dim under the text.' },
          options: { type: 'array', minItems: 1, maxItems: 9, items: OPTION_SCHEMA },
          recommended: { type: 'string', description: 'The option id you recommend, marked "my pick".' },
        },
        required: ['id', 'title', 'explain', 'options'],
      },
    },
  },
  required: ['id', 'title', 'items'],
}

const TOOL_DESCRIPTION =
  'Shows the person a deck of decisions in the Decisions pane, one decision at a time: your short ' +
  'explanation, 1 to 9 options, and a field for their own words. They pick one or more options or ' +
  'write their own, then press Send, and their answers arrive as their next message. Use it to walk ' +
  'the person through proposed changes or open questions. It returns at once: do not wait for the ' +
  'answers in the same turn.'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'decide',
      description: 'Open the decision deck: go through the decisions Claude prepared, one at a time',
    })
    await $.tool.register({ name: 'present', description: TOOL_DESCRIPTION, inputSchema: DECK_SCHEMA })
    const deck = await currentDeck($)
    if (deck !== null && (await read($, sentAtom))[deck.id] === undefined) {
      void $.ui.open({ id: PANE, title: TITLE })
    }

    return next(e)
  })

  on('command.run', { command: 'decide' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })

    return { text: opened.isPlaced ? 'The decision deck is open.' : `The decision deck waits: ${opened.reason}.` }
  })

  on('tool.call', { tool: 'mcp__decision-deck__present' }, async ($, e) => {
    const deck = parseDeck(e as unknown as Record<string, unknown>)
    if (typeof deck === 'string') return { deny: `The deck was not loaded: ${deck}.` }
    await update($, deckAtom, () => deck)
    await update($, cursorAtom, () => 0)
    await update($, sentAtom, all => without(all, deck.id))
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })

    return {
      result: opened.isPlaced
        ? `The deck "${deck.title}" (${deck.items.length} decisions) is open in the Decisions pane. ` +
          "The person's answers arrive as their next message when they press Send."
        : `The deck "${deck.title}" is loaded, but the pane waits (${opened.reason}). ` +
          'Tell the person to type /decide.',
    }
  }).catch(() => ({ deny: 'decision-deck: the deck could not be loaded.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const deck = await currentDeck($)
    if (deck === null) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>No decisions yet</Text>
          <Text dimColor>Claude opens a deck here with its present tool, to walk you through a set of choices.</Text>
        </Box>
      )
    }
    const answers = await read($, answersAtom)
    const sentAt = (await read($, sentAtom))[deck.id]
    const count = deck.items.length
    const at = Math.min(Math.max(await read($, cursorAtom), 0), count)
    const done = deck.items.filter(i => isAnswered(answers[keyOf(deck, i)])).length
    const go = (to: number) => update($, cursorAtom, () => to)
    const step = (by: number) => update($, cursorAtom, c => Math.min(Math.max(c + by, 0), count))
    const item = deck.items[at]
    const keysHint = 'Click the pane, or press ctrl+x tab, to use the keys.'

    // One dot per decision: the current one in the accent, answered ones green.
    const header = (
      <Box flexDirection="column">
        <Text bold>{deck.title}</Text>
        <Box flexWrap="wrap" columnGap={1}>
          {deck.items.map((one, i) => {
            const isDone = isAnswered(answers[keyOf(deck, one)])

            return (
              <Button key={`jump-${i}`} plain onPress={() => go(i)}>
                <Text color={i === at ? 'claude' : isDone ? 'success' : 'inactive'}>
                  {i === at ? '◉' : isDone ? '●' : '○'}
                </Text>
              </Button>
            )
          })}
          <Button key="jump-all" plain onPress={() => go(count)}>
            <Text color={at === count ? 'claude' : 'inactive'}>≡</Text>
          </Button>
          <Text dimColor>
            {done} of {count} answered
          </Text>
        </Box>
      </Box>
    )

    if (item === undefined) {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
            <Text bold color="claude">
              All answers
            </Text>
            {deck.items.map((one, i) => {
              const answer = answers[keyOf(deck, one)]
              const isDone = isAnswered(answer)

              return (
                <Button key={`row-${one.id}`} plain dimColor={!isDone} onPress={() => go(i)}>
                  <Text color={isDone ? 'success' : 'inactive'}>{isDone ? '●' : '○'}</Text>
                  {` ${one.id}  `}
                  <Text dimColor={!isDone}>{answerText(one, answer)}</Text>
                </Button>
              )
            })}
            <Text dimColor>Press a row to change it.</Text>
          </Box>
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
            <Text bold dimColor>
              Claude reads this message when you send it
            </Text>
            <Text dimColor>{messageFor(deck, answers)}</Text>
          </Box>
          {sentAt !== undefined && (
            <Text bold color="success">
              ✓ Sent to Claude at {sentAt}. Claude answers in the chat.
            </Text>
          )}
          <Box flexWrap="wrap" columnGap={1}>
            <Button
              key="send"
              hotkey="s"
              variant="primary"
              label={sentAt === undefined ? 'Send to Claude' : 'Send again'}
              onPress={() => send($)}
            />
            <Button key="back" hotkey="b" label="◀ Back" onPress={() => step(-1)} />
            <Button key="close" role="dismiss" label="Close" onPress={() => $.ui.close({ id: PANE })} />
          </Box>
          <Text dimColor>{e.props.isFocused ? 's send · b back · Tab moves · Esc closes' : keysHint}</Text>
        </Box>
      )
    }

    const answer = answers[keyOf(deck, item)] ?? EMPTY
    const toggle = (id: string) =>
      update($, answersAtom, all => {
        const now = all[keyOf(deck, item)] ?? EMPTY
        const picks = now.picks.includes(id) ? now.picks.filter(p => p !== id) : [...now.picks, id]

        return { ...all, [keyOf(deck, item)]: { ...now, picks } }
      })
    const setNote = (note: string) =>
      update($, answersAtom, all => ({ ...all, [keyOf(deck, item)]: { ...(all[keyOf(deck, item)] ?? EMPTY), note } }))
    const hint = e.props.isFocused
      ? `1-${item.options.length} pick · Tab: your words · n next · b back · l all answers · Esc closes`
      : keysHint

    let field = null
    if (e.surface !== 'mobile') {
      const { Input } = $.ui.resolve(e)
      field = (
        <Input
          key={`note-${keyOf(deck, item)}`}
          label="Your words"
          placeholder="optional: a condition, a change, or your own answer"
          value={answer.note}
          rows={2}
          submitLabel="next"
          onInput={value => void setNote(value)}
          onSubmit={async value => {
            await setNote(value)
            await step(1)
          }}
        />
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        {at === 0 && deck.intro !== undefined && (
          <Text dimColor italic>
            {deck.intro}
          </Text>
        )}
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
          <Box columnGap={1}>
            <Text bold color="inverseText" backgroundColor="claude">
              {` ${item.id} `}
            </Text>
            <Text dimColor>
              {at + 1} of {count}
            </Text>
          </Box>
          <Text bold>{item.title}</Text>
          <Markdown text={item.explain} />
          {item.facts !== undefined && <Text dimColor>{item.facts.join('  ·  ')}</Text>}
        </Box>
        <Box flexDirection="column">
          <Box columnGap={1}>
            <Text bold color="claude">
              Your options
            </Text>
            <Text dimColor>· pick one or more</Text>
          </Box>
          {item.options.map((option, i) => {
            const isPicked = answer.picks.includes(option.id)

            return (
              <Box flexDirection="column">
                <Button
                  key={`opt-${item.id}-${option.id}`}
                  plain
                  hotkey={String(i + 1)}
                  onPress={() => toggle(option.id)}
                >
                  <Text color={isPicked ? 'success' : 'inactive'}>{isPicked ? '◉' : '○'}</Text>
                  {` ${option.label}`}
                  {option.id === item.recommended ? <Text color="warning">  ★ my pick</Text> : ''}
                </Button>
                {option.detail !== undefined && (
                  <Box paddingLeft={5}>
                    <Text dimColor>{option.detail}</Text>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
        {field}
        <Box flexWrap="wrap" columnGap={1}>
          <Button key="back" hotkey="b" label="◀ Back" onPress={() => step(-1)} />
          <Button
            key="next"
            hotkey="n"
            variant="primary"
            label={at === count - 1 ? 'All answers ▶' : 'Next ▶'}
            onPress={() => step(1)}
          />
          <Button key="all" hotkey="l" label="All answers" onPress={() => go(count)} />
        </Box>
        <Text dimColor>{hint}</Text>
      </Box>
    )
  })
}
