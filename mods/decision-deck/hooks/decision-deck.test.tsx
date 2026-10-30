import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'decision-deck',
  component: 'Pane',
  requestId: 'decision-deck',
  props: {
    title: 'Decisions',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const DECK = {
  id: 'review',
  title: 'Proposed changes',
  outro: 'Carry out what I approved.',
  items: [
    {
      id: 'C01',
      title: 'Daily reminder on Expedite and overdue work',
      explain: '**What:** a rule comments on late work.',
      options: [
        { id: 'approve', label: 'Approve as written' },
        { id: 'assignee', label: 'Approve, but mention the assignee too' },
        { id: 'reject', label: 'Reject' },
      ],
      recommended: 'approve',
    },
    {
      id: 'C02',
      title: 'PR rules also move Backlog items',
      explain: '**What:** the PR rules act on Backlog items.',
      options: [
        { id: 'approve', label: 'Approve as written' },
        { id: 'merged', label: 'Only merged PRs close Backlog items' },
        { id: 'defer', label: 'Defer' },
      ],
    },
    {
      id: 'C03',
      title: 'Blocker type and Flagged move together',
      explain: '**What:** two rules pair the fields.',
      options: [
        { id: 'approve', label: 'Approve as written' },
        { id: 'reject', label: 'Reject' },
      ],
    },
  ],
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a pick and the person's words reach Claude, on ${surface}`, async ($, on) => {
    mock.clock(on)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    let sent = ''
    on('prompt.submit', (_, e) => {
      sent = e.text

      return { text: e.text }
    })
    await $.tool.call({ tool: 'mcp__decision-deck__present', ...DECK })

    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Daily reminder on Expedite/ })).toBeDefined()

    await ui.press({ key: 'opt-C01-approve' })
    expect((await ui.find({ key: 'opt-C01-approve' }))?.text).toMatch(/◉ Approve as written/)
    await ui.input({ key: 'note-review-C01', text: 'start on Sunday', kind: 'change' })

    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: /PR rules also move Backlog items/ })).toBeDefined()
    await ui.press({ key: 'opt-C02-merged' })
    await ui.press({ key: 'opt-C02-defer' })

    await ui.press({ key: 'all' })
    expect((await ui.find({ key: 'row-C03' }))?.text).toMatch(/no answer/)
    await ui.press({ key: 'send' })

    expect(sent).toContain(
      '- C01 Daily reminder on Expedite and overdue work: Approve as written; my words: "start on Sunday".',
    )
    expect(sent).toContain('- C02 PR rules also move Backlog items: Only merged PRs close Backlog items + Defer.')
    expect(sent).toContain('(2 of 3 answered)')
    expect(sent).toContain('Carry out what I approved.')
    expect(await ui.find({ type: 'Text', text: /Sent to Claude at/ })).toBeDefined()
    await ui.unmount()
  })
}

test('a second press takes a pick back', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.tool.call({ tool: 'mcp__decision-deck__present', ...DECK })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'opt-C01-reject' })
  await ui.press({ key: 'opt-C01-reject' })
  expect((await ui.find({ key: 'opt-C01-reject' }))?.text).toMatch(/○ Reject/)
  await ui.unmount()
})

test('with no deck, the pane says so', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /No decisions yet/ })).toBeDefined()
  await ui.unmount()
})

test('present loads a new deck into the pane', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const ran = await $.tool.call({
    tool: 'mcp__decision-deck__present',
    id: 'lunch',
    title: 'Lunch',
    items: [
      {
        id: 'Q1',
        title: 'Where do we eat?',
        explain: 'Pick a place.',
        options: [
          { id: 'pizza', label: 'Pizza' },
          { id: 'sushi', label: 'Sushi' },
        ],
      },
    ],
  })
  expect(String((ran as { result?: unknown }).result)).toMatch(/open in the Decisions pane/)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Where do we eat\?/ })).toBeDefined()
  expect(await ui.find({ key: 'opt-Q1-sushi' })).toBeDefined()
  await ui.unmount()
})

test('present refuses a deck with no options', async $ => {
  const ran = await $.tool.call({
    tool: 'mcp__decision-deck__present',
    id: 'bad',
    title: 'Bad',
    items: [{ id: 'Q1', title: 'Empty', explain: 'No options.', options: [] }],
  })
  expect(String((ran as { text?: unknown }).text ?? (ran as { deny?: unknown }).deny)).toMatch(/1 to 9 options/)
})

const refusal = (ran: unknown) =>
  String((ran as { text?: unknown }).text ?? (ran as { deny?: unknown }).deny)

test('present names the reason for an item or option that is not an object', async $ => {
  const item = await $.tool.call({ tool: 'mcp__decision-deck__present', id: 'n', title: 'N', items: [null] } as never)
  expect(refusal(item)).toMatch(/each item must be an object/)
  const option = await $.tool.call({
    tool: 'mcp__decision-deck__present',
    id: 'n',
    title: 'N',
    items: [{ id: 'Q1', title: 'q', explain: 'e', options: [null] }],
  } as never)
  expect(refusal(option)).toMatch(/each option of Q1 needs id and label/)
})

test('present refuses a recommended id that is not an option', async $ => {
  const ran = await $.tool.call({
    tool: 'mcp__decision-deck__present',
    id: 'r',
    title: 'R',
    items: [{ id: 'Q1', title: 'q', explain: 'e', options: [{ id: 'yes', label: 'Yes' }], recommended: 'ys' }],
  })
  expect(refusal(ran)).toMatch(/recommended ys is not an option id of Q1/)
})

const oneItem = (deckId: string, itemId: string, optionIds: string[]) => ({
  tool: 'mcp__decision-deck__present' as const,
  id: deckId,
  title: 'T',
  items: [
    { id: itemId, title: 'Item', explain: 'x', options: optionIds.map(id => ({ id, label: `L-${id}` })) },
    { id: 'Z', title: 'Other', explain: 'y', options: [{ id: 'k', label: 'K' }] },
  ],
})

test('a pick of an option the deck dropped is no answer', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  await $.tool.call(oneItem('d', 'A', ['a', 'b']))
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'opt-A-a' })
  await ui.unmount()

  await $.tool.call(oneItem('d', 'A', ['c', 'e']))
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /0 of 2 answered/ })).toBeDefined()
  await ui.press({ key: 'all' })
  await ui.press({ key: 'send' })
  expect(toasts).toContain('Pick an option or write your words first.')
  await ui.unmount()
})

test("one deck's answers do not show in another whose ids join the same way", async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.tool.call(oneItem('a', 'b-c', ['x']))
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'opt-b-c-x' })
  await ui.unmount()

  await $.tool.call(oneItem('a-b', 'c', ['x']))
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'opt-c-x' }))?.text).toMatch(/○ L-x/)
  await ui.unmount()
})

test('a session start reopens an unsent deck that Esc still closes', async ($, on) => {
  const opens: { closeOnEscape?: true }[] = []
  on('ui.open', (_, e) => {
    opens.push(e)

    return { value: { isPlaced: true } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__decision-deck__${e.name}` } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.tool.call(oneItem('d', 'A', ['a']))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(opens).toHaveLength(2)
  expect(opens[1]?.closeOnEscape).toBe(true)
})

test("the person's words go on one line", async ($, on) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let sent = ''
  on('prompt.submit', (_, e) => {
    sent = e.text

    return { text: e.text }
  })
  await $.tool.call(oneItem('d', 'A', ['a']))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'note-d-A', text: 'line one\n- Z Other: K.', kind: 'change' })
  await ui.press({ key: 'all' })
  await ui.press({ key: 'send' })
  expect(sent).toContain('- A Item: my words: "line one - Z Other: K.".\n- Z Other: no answer.')
  await ui.unmount()
})

for (const [how, answer] of [
  ['dropped', () => ({ drop: 'a hook said no' })],
  [
    'failed',
    () => {
      throw new Error('boom')
    },
  ],
] as const) {
  test(`a ${how} send takes the sent mark back`, async ($, on) => {
    mock.clock(on)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const toasts: string[] = []
    on('ui.toast', (_, e) => {
      toasts.push(e.text)

      return { value: undefined }
    })
    on('prompt.submit', answer)
    await $.tool.call(oneItem('d', 'A', ['a']))
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'opt-A-a' })
    await ui.press({ key: 'all' })
    await ui.press({ key: 'send' })
    expect(toasts).toContain('Sent 1 answer. Claude reads them when its current turn ends.')
    expect(toasts.some(t => t.startsWith('Not sent: '))).toBe(true)
    expect(await ui.find({ type: 'Text', text: /Sent to Claude at/ })).toBeUndefined()
    await ui.unmount()
  })
}
