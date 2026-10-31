import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'needs-you',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 30,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const ANSWER = [
  'Here is the plan.',
  '',
  'Needs you (Yours: clouds): should v0 use only Vertex, or Bedrock too? I recommend only Vertex.',
  'Needs you (GO: terraform apply (prod)): may I apply the plan?',
  '',
  'Needs you (Your hands: Touch ID): approve the keychain prompt.',
  'Needs you (Design approval): approve the v0 design in section 10.',
].join('\n')

const end = (answer: string, extra: { agentId?: string; reason?: 'answer' | 'aborted' } = {}) => ({
  answer,
  durationMs: 1,
  isAborted: extra.reason === 'aborted',
  turnId: `t-${answer.length}`,
  reason: extra.reason ?? 'answer',
  ...(extra.agentId === undefined ? {} : { agentId: extra.agentId }),
})

const composer = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })

// Nothing sits beneath the plugin: these hooks stand for the engine. `sent`
// collects each prompt that reaches the bottom, `toasts` each toast.
function engine(on: On): { sent: string[]; toasts: string[] } {
  const sent: string[] = []
  const toasts: string[] = []
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: unknown }).text))

    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  return { sent, toasts }
}

// The band's rows: the Buttons keyed `row-<n>`.
const rows = async (ui: { findAll: (q: { type: string }) => Promise<{ key: string | undefined }[]> }) =>
  (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('row-') === true)

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a turn's Needs you lines become rows, on ${surface}`, async ($, on) => {
    engine(on)
    await $.turn.complete(end(ANSWER))
    const ui = await $.ui.mount({ ...BAND, surface })

    expect(await rows(ui)).toHaveLength(4)
    expect((await ui.find({ key: 'row-0' }))?.text).toMatch(/○ +Yours: clouds · should v0 use only Vertex/)
    expect((await ui.find({ key: 'row-1' }))?.text).toMatch(/GO: terraform apply \(prod\) · may I apply the plan\?/)
    expect(await ui.find({ type: 'Text', text: /0 of 4 answered/ })).toBeDefined()
    await ui.unmount()
  })
}

test('a press moves a row to yes, then no, then no answer', async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: 'row-0' })
  expect((await ui.find({ key: 'row-0' }))?.text).toMatch(/✓ only Vertex/)
  await ui.press({ key: 'row-0' })
  expect((await ui.find({ key: 'row-0' }))?.text).toMatch(/✗ no /)
  await ui.press({ key: 'row-0' })
  expect((await ui.find({ key: 'row-0' }))?.text).toMatch(/^○ /)

  await ui.press({ key: 'row-1' })
  await ui.press({ key: 'row-1' })
  expect((await ui.find({ key: 'row-1' }))?.text).toMatch(/✗ no go/)
  await ui.unmount()
})

test('Take all picks answers only a Yours row with a pick, and Send writes one line per row', async ($, on) => {
  const { sent } = engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: 'all' })
  expect((await ui.find({ key: 'row-0' }))?.text).toMatch(/✓ only Vertex/)
  expect((await ui.find({ key: 'row-1' }))?.text).toMatch(/^○ +GO: terraform apply/)
  expect((await ui.find({ key: 'row-2' }))?.text).toMatch(/^○ +Your hands: Touch ID/)
  expect((await ui.find({ key: 'row-3' }))?.text).toMatch(/^○ +Design approval/)
  await ui.press({ key: 'row-1' })
  expect(await ui.find({ type: 'Text', text: /2 of 4 answered/ })).toBeDefined()
  await ui.press({ key: 'send' })

  expect(sent).toEqual([
    [
      'My answers to your Needs you lines (2 of 4 answered):',
      '',
      '1. Yours: clouds ("should v0 use only Vertex, or Bedrock too?") — your pick: only Vertex.',
      '2. GO: terraform apply (prod) ("may I apply the plan?") — go.',
      '3. Your hands: Touch ID ("approve the keychain prompt.") — no answer.',
      '4. Design approval ("approve the v0 design in section 10.") — no answer.',
    ].join('\n'),
  ])
  expect(await rows(ui)).toHaveLength(0)
  await ui.unmount()
})

test('Take all picks keeps an answer the person set', async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: 'row-0' })
  await ui.press({ key: 'row-0' })
  await ui.press({ key: 'all' })
  expect((await ui.find({ key: 'row-0' }))?.text).toMatch(/✗ no /)
  await ui.unmount()
})

test('with no pick row, the band shows no Take all picks', async ($, on) => {
  engine(on)
  await $.turn.complete(end('Needs you (GO: merge): merge the PR?\nNeeds you (Yours: name): odin or thor?'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'all' })).toBeUndefined()
  expect(await ui.find({ key: 'send' })).toBeDefined()
  await ui.unmount()
})

test('a pick ends at its first sentence stop', async ($, on) => {
  engine(on)
  await $.turn.complete(end('Needs you (Yours: name): odin or thor? I recommend odin. Thor is slower.'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'row-0' })
  expect((await ui.find({ key: 'row-0' }))?.text).toMatch(/^✓ odin +Yours: name/)
  await ui.unmount()
})

test('Send with no answer sends nothing', async ($, on) => {
  const { sent, toasts } = engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'send' })

  expect(sent).toHaveLength(0)
  expect(toasts).toEqual(['Answer a row first: press its number.'])
  expect(await rows(ui)).toHaveLength(4)
  await ui.unmount()
})

test("the person's prompt carries the answers above their words, then the rows clear", async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'row-3' })
  await ui.press({ key: 'row-3' })

  const entered = await $.prompt.submit(composer('Use two regions, not one.'))
  expect(entered.text).toBe(
    [
      'My answers to your Needs you lines (1 of 4 answered):',
      '',
      '1. Yours: clouds ("should v0 use only Vertex, or Bedrock too?") — no answer.',
      '2. GO: terraform apply (prod) ("may I apply the plan?") — no answer.',
      '3. Your hands: Touch ID ("approve the keychain prompt.") — no answer.',
      '4. Design approval ("approve the v0 design in section 10.") — changes.',
      '',
      'Use two regions, not one.',
    ].join('\n'),
  )
  expect(await rows(ui)).toHaveLength(0)
  await ui.unmount()
})

test('a prompt with no answer goes as typed and clears the rows', async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER))

  const entered = await $.prompt.submit(composer('What is ROE?'))
  expect(entered.text).toBe('What is ROE?')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await rows(ui)).toHaveLength(0)
  await ui.unmount()
})

test('a slash command and a task notification leave the answers alone', async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'row-0' })

  const command = await $.prompt.submit({ ...composer('/compact'), command: { name: 'compact', args: '' } })
  expect(command.text).toBe('/compact')
  const note = await $.prompt.submit({ text: 'task done', wait: false, origin: { kind: 'task-notification' } })
  expect(note.text).toBe('task done')
  expect((await ui.find({ key: 'row-0' }))?.text).toMatch(/✓ only Vertex/)
  await ui.unmount()
})

test('a turn end with no Needs you lines keeps the band and its answers', async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'row-0' })

  await $.turn.complete(end('Partial work.', { reason: 'aborted' }))
  await $.turn.complete(end('Noted: the task finished.'))
  expect(await rows(ui)).toHaveLength(4)
  expect((await ui.find({ key: 'row-0' }))?.text).toMatch(/✓ only Vertex/)
  await ui.unmount()
})

test('new Needs you lines replace the rows and keep the answer of a line asked again', async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'row-1' })
  await ui.press({ key: 'row-1' })

  await $.turn.complete(
    end('Needs you (GO: terraform apply (prod)): may I apply the plan?\nNeeds you (GO: merge): merge the PR?'),
  )
  expect(await rows(ui)).toHaveLength(2)
  expect((await ui.find({ key: 'row-0' }))?.text).toMatch(/✗ no go +GO: terraform apply/)
  expect((await ui.find({ key: 'row-1' }))?.text).toMatch(/^○ +GO: merge/)
  await ui.unmount()
})

test("a subagent's answer does not touch the band", async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER, { agentId: 'a1' }))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await rows(ui)).toHaveLength(0)
  await ui.unmount()
})

test('only the closing run counts, and an unknown tag ends it', async ($, on) => {
  engine(on)
  await $.turn.complete(
    end(
      [
        'Needs you (GO: merge): merge the PR?',
        'One more thing.',
        'Needs you (Maybe): ship it?',
        'Needs you (Yours: name): odin or thor? I recommend odin!',
      ].join('\n'),
    ),
  )
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await rows(ui)).toHaveLength(1)
  await ui.press({ key: 'row-0' })
  expect((await ui.find({ key: 'row-0' }))?.text).toMatch(/✓ odin +Yours: name/)
  await ui.unmount()
})

test('a cut never splits an emoji', async ($, on) => {
  engine(on)
  await $.turn.complete(end(`Needs you (Yours: name): ${'🚀'.repeat(60)}`))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 40 } })
  const row = (await ui.find({ key: 'row-0' }))?.text ?? ''
  expect(row).toMatch(/🚀…$/)
  expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(row)).toBe(false)
  await ui.unmount()
})

test('a narrow band cuts the question, not the tag', async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 50 } })
  const row = (await ui.find({ key: 'row-0' }))?.text ?? ''
  expect(row).toMatch(/Yours: clouds · .*…$/)
  expect(row.length).toBeLessThanOrEqual(50)
  await ui.unmount()
})
