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
