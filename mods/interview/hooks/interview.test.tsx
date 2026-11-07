import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'interview',
  component: 'Pane',
  requestId: 'interview',
  props: {
    title: 'Interview',
    isFocused: true,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const TOOL = 'mcp__interview__ask' as const

const ASK = {
  tool: TOOL,
  questions: [
    {
      id: 'Q1',
      question: 'Which database?',
      detail: 'The store for **sessions**.',
      options: [{ label: 'Postgres', detail: 'the managed one' }, { label: 'SQLite' }],
      recommended: 'Postgres',
    },
    { id: 'Q2', question: 'Which regions?', options: [{ label: 'us' }, { label: 'eu' }, { label: 'asia' }], multiSelect: true },
    { id: 'Q3', question: 'What do we call it?' },
  ],
}

const SURFACES = ['terminal', 'desktop'] as const

// Nothing sits beneath the plugin: these hooks stand for the engine. `sent`
// collects each prompt that reaches the bottom, `status` each status line.
function engine(on: On): { sent: string[]; toasts: string[]; status: (string | undefined)[] } {
  const sent: string[] = []
  const toasts: string[] = []
  const status: (string | undefined)[] = []
  mock.clock(on, { now: Date.UTC(2026, 10, 7, 9, 30) })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    status.push(e.text)

    return { value: undefined }
  })

  return { sent, toasts, status }
}

// One tool-result row of the main loop, or of a subagent's when `agentId` is given.
const toolResult = (uuid: string, agentId?: string) => ({
  message: {
    type: 'user' as const,
    role: 'user' as const,
    content: [{ type: 'tool_result' as const, tool_use_id: `tu-${uuid}`, content: 'ok' }],
  },
  door: 'tool-result' as const,
  origin: { kind: 'tool' as const, tool: 'Bash' },
  uuid,
  ...(agentId === undefined ? {} : { agentId }),
})

const end = (reason: 'answer' | 'aborted' = 'answer') => ({
  answer: 'done',
  durationMs: 1,
  isAborted: reason === 'aborted',
  turnId: 't1',
  reason,
})

// The text blocks of a stored row.
function texts(stored: unknown): string[] {
  const content = (stored as { message?: { content?: unknown[] } }).message?.content ?? []

  return content.flatMap(b => ((b as { type?: string }).type === 'text' ? [String((b as { text?: unknown }).text)] : []))
}

const resultText = (ran: unknown) =>
  String((ran as { result?: unknown }).result ?? (ran as { text?: unknown }).text ?? (ran as { deny?: unknown }).deny)

for (const surface of SURFACES) {
  test(`an answer sent while Claude is idle starts a turn, on ${surface}`, async ($, on) => {
    const { sent } = engine(on)
    await $.tool.call(ASK)

    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Which database\?/ })).toBeDefined()
    expect((await ui.find({ key: 'opt-Q1-0' }))?.text).toMatch(/○ Postgres\s+★ my pick/)

    await ui.press({ key: 'opt-Q1-0' })
    expect((await ui.find({ key: 'opt-Q1-0' }))?.text).toMatch(/◉ Postgres/)
    await ui.input({ key: 'words-Q1', text: 'the managed one', kind: 'change' })
    await ui.press({ key: 'send' })

    expect(sent.length).toBe(1)
    expect(sent[0]).toContain('- Q1 Which database?: Postgres; my words: "the managed one".')
    expect(sent[0]).toContain('still open: Q2, Q3')
    expect(await ui.find({ type: 'Text', text: /Which regions\?/ })).toBeDefined()
    await ui.unmount()
  })

  test(`an answer sent during a turn rides the next main tool result once, on ${surface}`, async ($, on) => {
    const { sent } = engine(on)
    await $.tool.call(ASK)
    await $.turn.start({ text: 'go', turnId: 't1' })

    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'next' })
    await ui.press({ key: 'opt-Q2-0' })
    await ui.press({ key: 'opt-Q2-2' })
    await ui.press({ key: 'send' })
    expect(sent.length).toBe(0)

    expect(texts(await $.session.append(toolResult('a', 'agent-1')))).toEqual([])
    const first = texts(await $.session.append(toolResult('b')))
    expect(first.length).toBe(1)
    expect(first[0]).toContain('- Q2 Which regions?: us + asia.')
    expect(first[0]).toContain('<interview-answers>')
    expect(texts(await $.session.append(toolResult('c')))).toEqual([])

    await $.turn.complete(end())
    expect(sent.length).toBe(0)

    await ui.press({ key: 'all' })
    expect((await ui.find({ type: 'Text', text: /us \+ asia · Claude has it \(09:30 UTC\)/ }))).toBeDefined()
    await ui.unmount()
  })

  test(`an answer that missed the turn's tool results goes when the turn ends, on ${surface}`, async ($, on) => {
    const { sent } = engine(on)
    await $.tool.call(ASK)
    await $.turn.start({ text: 'go', turnId: 't1' })

    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'opt-Q1-1' })
    await ui.press({ key: 'send' })
    expect(sent.length).toBe(0)

    await $.turn.complete(end())
    expect(sent.length).toBe(1)
    expect(sent[0]).toContain('- Q1 Which database?: SQLite.')
    await ui.unmount()
  })

  test(`after an interrupt the answer waits for the next typed prompt, on ${surface}`, async ($, on) => {
    const { sent } = engine(on)
    await $.tool.call(ASK)
    await $.turn.start({ text: 'go', turnId: 't1' })

    const ui = await $.ui.mount({ ...PANE, surface })
    // Back from the first open question goes round to the last one, Q3.
    await ui.press({ key: 'back' })
    // Enter in the field sends the words.
    await ui.input({ key: 'words-Q3', text: 'scout' })
    await $.turn.complete(end('aborted'))
    expect(sent.length).toBe(0)

    await $.prompt.submit({ text: 'carry on', wait: false, origin: { kind: 'composer' } })
    expect(sent.length).toBe(1)
    expect(sent[0]).toContain('- Q3 What do we call it?: my words: "scout".')
    expect(sent[0]).toMatch(/carry on$/)

    // The answer went with the prompt: a later tool result does not carry it again.
    await $.turn.start({ text: 'carry on', turnId: 't2' })
    expect(texts(await $.session.append(toolResult('d')))).toEqual([])
    await ui.unmount()
  })

  test(`withdraw takes a question out of the open ones, on ${surface}`, async ($, on) => {
    const { status } = engine(on)
    await $.tool.call(ASK)
    expect(status.at(-1)).toBe('Interview: 3 open · /interview')

    const ran = await $.tool.call({ tool: TOOL, withdraw: ['Q2', 'Q9'] })
    expect(resultText(ran)).toMatch(/Withdrew Q2\./)
    expect(resultText(ran)).toMatch(/Not withdrawn \(answered already or unknown\): Q9\./)
    expect(status.at(-1)).toBe('Interview: 2 open · /interview')

    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'all' })
    expect(await ui.find({ type: 'Text', text: /withdrawn by Claude/ })).toBeDefined()

    await $.tool.call({ tool: TOOL, withdraw: ['Q1', 'Q3'] })
    expect(status.at(-1)).toBeUndefined()
    await ui.unmount()
  })
}

test('a second ask adds questions after the open ones', async ($, on) => {
  engine(on)
  await $.tool.call(ASK)
  const ran = await $.tool.call({
    tool: TOOL,
    questions: [
      { id: 'Q4', question: 'Ship today?', options: [{ label: 'yes' }, { label: 'no' }] },
      { id: 'Q1', question: 'Which database, again?', options: [{ label: 'Postgres' }] },
    ],
  })
  expect(resultText(ran)).toMatch(/Asked Q4, Q1 in the Interview pane\. 4 questions are open\./)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'all' })
  const rows = ['go-Q1', 'go-Q2', 'go-Q3', 'go-Q4']
  for (const key of rows) expect(await ui.find({ key })).toBeDefined()
  expect((await ui.find({ key: 'go-Q1' }))?.text).toMatch(/Which database, again\?/)
  await ui.unmount()
})

test('send refuses an empty answer, and a single pick replaces the last one', async ($, on) => {
  const { sent, toasts } = engine(on)
  await $.tool.call(ASK)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'send' })
  expect(sent.length).toBe(0)
  expect(toasts.at(-1)).toBe('Pick an option or write your words first.')

  await ui.press({ key: 'opt-Q1-0' })
  await ui.press({ key: 'opt-Q1-1' })
  expect((await ui.find({ key: 'opt-Q1-0' }))?.text).toMatch(/○ Postgres/)
  expect((await ui.find({ key: 'opt-Q1-1' }))?.text).toMatch(/◉ SQLite/)
  await ui.unmount()
})

test('ask refuses an id that was answered, and a recommendation that is no option', async ($, on) => {
  engine(on)
  await $.tool.call(ASK)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'opt-Q1-0' })
  await ui.press({ key: 'send' })
  await ui.unmount()

  const reused = await $.tool.call({ tool: TOOL, questions: [{ id: 'Q1', question: 'Again?' }] })
  expect(resultText(reused)).toMatch(/the id Q1 was used for a question that is answered; use a new id/)

  const bad = await $.tool.call({
    tool: TOOL,
    questions: [{ id: 'Q5', question: 'Which?', options: [{ label: 'a' }], recommended: 'b' }],
  })
  expect(resultText(bad)).toMatch(/the recommended option of Q5 must be the label of one of its options/)

  const empty = await $.tool.call({ tool: TOOL })
  expect(resultText(empty)).toMatch(/give at least one question or one id to withdraw/)
})

test('with no questions, the pane says so', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /No questions yet/ })).toBeDefined()
  await ui.unmount()
})
