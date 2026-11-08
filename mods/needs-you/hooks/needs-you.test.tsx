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

const LONG_QUESTION =
  'should the band keep each open line until the operator answers it, even after a typed prompt, a send, ' +
  'a later turn that ends on new lines, and a task notification that ends a turn with no lines at all?'

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

type Found = { key: string | undefined; text?: string; props: Record<string, unknown> }
type Drawing = {
  findAll: (q: { type: string }) => Promise<Found[]>
  find: (q: { type?: string; key?: string; text?: RegExp | string }) => Promise<Found | undefined>
}

// The band's rows: the Buttons keyed `row-<row id>`, in the band's order.
const rows = async (ui: Drawing) => (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('row-') === true)
// The key of row `i`'s chip Button.
const rowKey = async (ui: Drawing, i: number) => (await rows(ui))[i]?.key ?? `no row ${i}`
// A row's chip, the text of its Button.
const chipOf = async (ui: Drawing, i: number) => (await rows(ui))[i]?.text ?? ''
// The key of the field under row `i`.
const field = async (ui: Drawing, i: number) => (await ui.findAll({ type: 'Input' }))[i]?.key ?? `no field ${i}`
// The whole text of the band, its rows' questions included.
const bandText = async (ui: Drawing) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '').join('\n')

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a turn's Needs you lines become rows, each with a field, on ${surface}`, async ($, on) => {
    engine(on)
    await $.turn.complete(end(ANSWER))
    const ui = await $.ui.mount({ ...BAND, surface })

    expect(await rows(ui)).toHaveLength(4)
    expect(await chipOf(ui, 0)).toMatch(/^○ *$/)
    expect(await ui.find({ type: 'Text', text: /^Yours: clouds · should v0 use only Vertex, or Bedrock too\? I recommend only Vertex\.$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^GO: terraform apply \(prod\) · may I apply the plan\?$/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Input' })).map(f => [f.key, f.props.value])).toEqual([
      [`words-t-${ANSWER.length}:0-0`, ''],
      [`words-t-${ANSWER.length}:1-0`, ''],
      [`words-t-${ANSWER.length}:2-0`, ''],
      [`words-t-${ANSWER.length}:3-0`, ''],
    ])
    expect(await ui.find({ type: 'Text', text: /0 of 4 answered/ })).toBeDefined()
    await ui.unmount()
  })
}

test('a long question shows whole in a narrow band, with no cut', async ($, on) => {
  engine(on)
  await $.turn.complete(end(`Needs you (Yours: async): ${LONG_QUESTION} I recommend yes. ${'🚀'.repeat(30)}`))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 50 } })
  const question = await ui.find({ type: 'Text', text: /^Yours: async · / })

  expect(question?.text).toContain(LONG_QUESTION)
  expect(question?.text).toMatch(/🚀$/)
  expect(await bandText(ui)).not.toContain('…')
  await ui.unmount()
})

test('a press moves a row to yes, then no, then no answer', async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: await rowKey(ui, 0) })
  expect(await chipOf(ui, 0)).toMatch(/^✓ your pick/)
  await ui.press({ key: await rowKey(ui, 0) })
  expect(await chipOf(ui, 0)).toMatch(/^✗ no /)
  await ui.press({ key: await rowKey(ui, 0) })
  expect(await chipOf(ui, 0)).toMatch(/^○ /)

  await ui.press({ key: await rowKey(ui, 1) })
  await ui.press({ key: await rowKey(ui, 1) })
  expect(await chipOf(ui, 1)).toMatch(/^✗ no go/)
  await ui.unmount()
})

test('Take all picks answers only a Yours row with a pick, and Send sends only the answered rows', async ($, on) => {
  const { sent } = engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: 'all' })
  expect(await chipOf(ui, 0)).toMatch(/^✓ your pick/)
  expect(await chipOf(ui, 1)).toMatch(/^○ /)
  expect(await chipOf(ui, 2)).toMatch(/^○ /)
  expect(await chipOf(ui, 3)).toMatch(/^○ /)
  await ui.press({ key: await rowKey(ui, 1) })
  expect(await ui.find({ type: 'Text', text: /2 of 4 answered/ })).toBeDefined()
  await ui.press({ key: 'send' })

  expect(sent).toEqual([
    [
      'My answers to your Needs you lines:',
      '',
      '1. Yours: clouds ("should v0 use only Vertex, or Bedrock too?") — your pick: only Vertex.',
      '2. GO: terraform apply (prod) ("may I apply the plan?") — go.',
    ].join('\n'),
  ])
  // Send closes the band: the two rows with no answer are passed, not kept.
  expect(await rows(ui)).toHaveLength(0)
  await ui.unmount()
})

test("words in a row's field answer it and reach Claude with the row's side", async ($, on) => {
  const { sent } = engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: await rowKey(ui, 1) })
  await ui.press({ key: await rowKey(ui, 1) })
  await ui.input({ key: await field(ui, 1), text: 'wait for the plan review first', kind: 'change' })
  await ui.input({ key: await field(ui, 2), text: 'I am away until 18:00.\nAsk me again then.' })
  expect(await chipOf(ui, 2)).toMatch(/^✎ words/)
  expect(await ui.find({ type: 'Text', text: /2 of 4 answered/ })).toBeDefined()
  await ui.press({ key: 'send' })

  expect(sent[0]).toBe(
    [
      'My answers to your Needs you lines:',
      '',
      '1. GO: terraform apply (prod) ("may I apply the plan?") — no go; my words: wait for the plan review first',
      '2. Your hands: Touch ID ("approve the keychain prompt.") — my words: I am away until 18:00.',
      '   Ask me again then.',
    ].join('\n'),
  )
  expect(await rows(ui)).toHaveLength(0)
  await ui.unmount()
})

// A mod's own $.ui.focus call does not reach a test's hook in this kit, so the
// move to the next field is checked live, not here.
test('Enter in a field keeps its words and sends nothing', async ($, on) => {
  const { sent } = engine(on)
  await $.turn.complete(end('Needs you (GO: merge): merge the PR?\nNeeds you (Yours: name): odin or thor?'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  const before = (await ui.findAll({ type: 'Input' })).map(f => f.key ?? '')
  await ui.input({ key: await field(ui, 0), text: 'yes, after CI' })
  await ui.input({ key: await field(ui, 1), text: 'loki' })
  expect(sent).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: /2 of 2 answered/ })).toBeDefined()
  // Enter empties a field, so the field comes back under a new key with the words.
  const fields = await ui.findAll({ type: 'Input' })
  expect(fields.map(f => [f.key, f.props.value])).toEqual([
    [before[0]?.replace(/-0$/, '-1'), 'yes, after CI'],
    [before[1]?.replace(/-0$/, '-1'), 'loki'],
  ])
  expect(fields.map(f => f.props.submitLabel)).toEqual(['next', 'next'])
  await ui.unmount()
})

// A redraw while the person types must not hand the field an older text: the
// field keeps its key and its value, and the person's own text stays.
test('typing changes neither the key nor the value of a field, and blank words are no answer', async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const key = await field(ui, 0)

  await ui.input({ key, text: 'only Vertex for now', kind: 'change' })
  await ui.press({ key: await rowKey(ui, 3) })
  expect((await ui.findAll({ type: 'Input' }))[0]).toMatchObject({ key, props: { value: '' } })
  expect(await ui.find({ type: 'Text', text: /2 of 4 answered/ })).toBeDefined()
  await ui.input({ key: await field(ui, 0), text: '   ', kind: 'change' })
  expect(await chipOf(ui, 0)).toMatch(/^○ /)
  expect(await ui.find({ type: 'Text', text: /1 of 4 answered/ })).toBeDefined()
  await ui.unmount()
})

// The tag names the question: a reworded line is the same question, asked again.
test('a line asked again in new words keeps its one row, and its answer clears', async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'all' })
  await ui.input({ key: await field(ui, 0), text: 'and no Bedrock key', kind: 'change' })
  const chipKey = await rowKey(ui, 0)

  await $.turn.complete({
    ...end(
      'Needs you (Yours: clouds): should v0 run on Vertex alone? I recommend only Vertex.\n' +
        'Needs you (GO: merge): merge the PR?',
    ),
    turnId: 'later',
  })
  expect(await rows(ui)).toHaveLength(5)
  expect(await rowKey(ui, 0)).toBe(chipKey)
  // The words of the question changed, so the pick and the words do not move to them.
  expect(await chipOf(ui, 0)).toMatch(/^○/)
  expect((await ui.findAll({ type: 'Input' }))[0]?.props.value).toBe('')
  expect(await ui.find({ type: 'Text', text: /^Yours: clouds · should v0 run on Vertex alone\?/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Yours: clouds · should v0 use only Vertex/ })).toBeUndefined()
  await ui.unmount()
})

test('a go does not move to a GO line asked again in other words', async ($, on) => {
  const { sent } = engine(on)
  await $.turn.complete(end('Needs you (GO: merge): may I merge the PR?'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: await rowKey(ui, 0) })
  expect(await chipOf(ui, 0)).toMatch(/^✓ go/)

  await $.turn.complete({ ...end('Needs you (GO: merge): may I merge PR #13 and delete the branch?'), turnId: 'later' })
  expect(await rows(ui)).toHaveLength(1)
  expect(await chipOf(ui, 0)).toMatch(/^○/)
  await ui.press({ key: 'send' })
  expect(sent).toHaveLength(0)
  await ui.unmount()
})

test("after the person's prompt, the next turn's lines show alone", async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER))
  await $.prompt.submit(composer('Look at the logs first.'))
  await $.turn.complete({
    ...end('Needs you (GO: merge): merge the PR?\nNeeds you (Yours: name): odin or thor?'),
    turnId: 'next',
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await rows(ui)).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /^GO: merge · merge the PR\?$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Yours: clouds · / })).toBeUndefined()
  await ui.unmount()
})

test('the keys share the top row when they fit, and go under the rows when they do not', async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER))
  const order = async (columns: number) => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: columns } })
    const keys = (await ui.findAll({ type: 'Button' })).map(b => (b.key?.startsWith('row-') === true ? 'row' : b.key))
    await ui.unmount()

    return keys
  }

  expect(await order(115)).toEqual(['all', 'send', 'clear', 'row', 'row', 'row', 'row'])
  expect(await order(60)).toEqual(['row', 'row', 'row', 'row', 'all', 'send', 'clear'])
})

for (const isWorking of [false, true]) {
  test(`the help text fits one row of a 120-column terminal, and names ctrl+x tab for the letter keys (working: ${isWorking})`, async ($, on) => {
    engine(on)
    await $.turn.complete(end(ANSWER))
    // A 120-column terminal gives the band 115 columns: the engine keeps five for its `[-]`.
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 115, isWorking } })
    const help = await ui.find({ type: 'Text', text: /closes the band$/ })

    expect(help?.text).toContain('ctrl+x tab for a, s, c and your words')
    expect(help?.text?.length ?? 999).toBeLessThanOrEqual(115)
    await ui.unmount()
  })
}

test('Send while Claude works says that the answers go when Claude stops', async ($, on) => {
  const { toasts } = engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, isWorking: true } })
  await ui.press({ key: 'all' })
  await ui.press({ key: 'send' })

  expect(toasts).toEqual(['Your answers go when Claude stops.'])
  expect(await rows(ui)).toHaveLength(0)
  await ui.unmount()
})

// A prompt typed over a running turn is queued: its `next` resolves at once,
// and the prompt may start the next turn. Until the running turn ends, a line
// it asks again has not read the prompt.
test('a prompt typed over a running turn keeps its closed lines out until that turn ends', async ($, on) => {
  engine(on)
  await $.turn.complete(end('Needs you (GO: tag): may I tag the release?'))
  await $.prompt.submit({ ...composer('Look at the logs first.'), turnId: 'running' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await $.turn.complete({ ...end('Needs you (GO: tag): may I tag the release?'), turnId: 'running' })
  expect(await rows(ui)).toHaveLength(0)
  // The turn after it read the prompt: a line it asks again is a new ask.
  await $.turn.complete({ ...end('Needs you (GO: tag): may I tag the release?'), turnId: 'after' })
  expect(await rows(ui)).toHaveLength(1)
  await ui.unmount()
})

// A turn that ends while the message waits has not read it: a line it asks
// again stays closed, so it does not come back to the band.
test('every line of a band that a waiting message closed stays out, and a dropped message brings its rows back', async ($, on) => {
  // The engine holds the message until a later turn has ended, then drops it.
  let release: (drop: string) => void = () => undefined
  let toasted: () => void = () => undefined
  const toast = new Promise<void>(resolve => (toasted = resolve))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', () => new Promise(resolve => (release = drop => resolve({ drop }))))
  // The mod puts the rows back, then says so in a toast.
  on('ui.toast', () => {
    toasted()

    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  const lines = 'Needs you (GO: merge): merge the PR?\nNeeds you (GO: tag): tag the release?'
  await $.turn.complete(end(lines))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: await rowKey(ui, 0) })
  await ui.press({ key: 'send' })
  // The open row closed too, and a line asked in new words is still its line.
  await $.turn.complete({ ...end(lines.replace('tag the release?', 'tag v0.3.0?')), turnId: 'later' })
  expect(await rows(ui)).toHaveLength(0)
  release('test drop')
  await toast

  expect(await rows(ui)).toHaveLength(2)
  // A line asked again in the same words keeps its answer.
  expect(await chipOf(ui, 0)).toMatch(/^✓ go/)
  // A row comes back in the newest words that the later turn asked it in.
  expect(await chipOf(ui, 1)).toMatch(/^○/)
  expect(await ui.find({ type: 'Text', text: /^GO: tag · tag v0\.3\.0\?$/ })).toBeDefined()
  await ui.unmount()
})

test('a dropped message does not bring back a go for a question asked again in other words', async ($, on) => {
  let release: (drop: string) => void = () => undefined
  let toasted: () => void = () => undefined
  const toast = new Promise<void>(resolve => (toasted = resolve))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', () => new Promise(resolve => (release = drop => resolve({ drop }))))
  on('ui.toast', () => {
    toasted()

    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  await $.turn.complete(end('Needs you (GO: merge): merge the PR?'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: await rowKey(ui, 0) })
  await ui.press({ key: 'send' })
  await $.turn.complete({ ...end('Needs you (GO: merge): merge PR #12 and delete the branch?'), turnId: 'later' })
  release('test drop')
  await toast

  expect(await rows(ui)).toHaveLength(1)
  expect(await chipOf(ui, 0)).toMatch(/^○/)
  expect(await ui.find({ type: 'Text', text: /^GO: merge · merge PR #12 and delete the branch\?$/ })).toBeDefined()
  await ui.unmount()
})

test('once the answers went, a line asked again joins the band as open', async ($, on) => {
  let deliver: () => void = () => undefined
  let entered: () => void = () => undefined
  const turnStarted = new Promise<void>(resolve => (entered = resolve))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) =>
    new Promise(resolve => {
      deliver = () => {
        resolve({ text: e.text })
        entered()
      }
    }),
  )
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  const line = 'Needs you (GO: merge): merge the PR?'
  await $.turn.complete(end(line))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: await rowKey(ui, 0) })
  await ui.press({ key: 'send' })
  deliver()
  await turnStarted
  // The mod hears of the delivery a few hops after the engine: let it settle.
  for (let i = 0; i < 5; i++) await rows(ui)
  await $.turn.complete({ ...end(line), turnId: 'after' })

  expect(await rows(ui)).toHaveLength(1)
  expect(await chipOf(ui, 0)).toMatch(/^○/)
  await ui.unmount()
})

test('a row id is never held twice, even when one turn ends twice', async ($, on) => {
  engine(on)
  const once = (answer: string) => $.turn.complete({ ...end(answer), turnId: 'same' })
  await once('Needs you (GO: a): run a?\nNeeds you (GO: b): run b?')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: await rowKey(ui, 0) })
  await once('Needs you (GO: c): run c?')

  const keys = (await ui.findAll({ type: 'Input' })).map(f => f.key)
  expect(keys).toHaveLength(3)
  expect(new Set(keys).size).toBe(3)
  await ui.press({ key: await rowKey(ui, 2) })
  expect(await chipOf(ui, 0)).toMatch(/^✓ go/)
  expect(await chipOf(ui, 1)).toMatch(/^○/)
  expect(await chipOf(ui, 2)).toMatch(/^✓ go/)
  await ui.unmount()
})

test('a field counts a wide character as two cells', async ($, on) => {
  engine(on)
  await $.turn.complete(end('Needs you (Yours: name): which name?'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // 60 wide characters take 120 cells: two rows in a field under 120 cells.
  await ui.input({ key: await field(ui, 0), text: '名'.repeat(60) })
  expect((await ui.findAll({ type: 'Input' }))[0]?.props.rows).toBe(2)
  await ui.unmount()
})

test('Take all picks keeps an answer or words the person gave', async ($, on) => {
  engine(on)
  await $.turn.complete(
    end(
      [
        'Needs you (Yours: clouds): only Vertex? I recommend only Vertex.',
        'Needs you (Yours: name): odin or thor? I recommend odin.',
        'Needs you (Yours: region): which region? I recommend me-west1.',
      ].join('\n'),
    ),
  )
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: await rowKey(ui, 0) })
  await ui.press({ key: await rowKey(ui, 0) })
  await ui.input({ key: await field(ui, 1), text: 'loki', kind: 'change' })
  await ui.press({ key: 'all' })
  expect(await chipOf(ui, 0)).toMatch(/^✗ no /)
  expect(await chipOf(ui, 1)).toMatch(/^✎ words/)
  expect(await chipOf(ui, 2)).toMatch(/^✓ your pick/)
  await ui.unmount()
})

test('with no pick row, the band shows no Take all picks', async ($, on) => {
  engine(on)
  await $.turn.complete(end('Needs you (GO: merge): merge the PR?\nNeeds you (Yours: name): odin or thor?'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'all' })).toBeUndefined()
  expect(await ui.find({ key: 'send' })).toBeDefined()
  expect(await ui.find({ key: 'clear' })).toBeDefined()
  await ui.unmount()
})

test('a pick ends at its first sentence stop', async ($, on) => {
  const { sent } = engine(on)
  await $.turn.complete(end('Needs you (Yours: name): odin or thor? I recommend odin. Thor is slower.'))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: await rowKey(ui, 0) })
  await ui.press({ key: 'send' })
  expect(sent[0]).toMatch(/— your pick: odin\.$/)
  await ui.unmount()
})

test('Send with no answer sends nothing', async ($, on) => {
  const { sent, toasts } = engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'send' })

  expect(sent).toHaveLength(0)
  expect(toasts).toEqual(['Answer a row first: press its number, or write in its field.'])
  expect(await rows(ui)).toHaveLength(4)
  await ui.unmount()
})

test('Clear removes every row', async ($, on) => {
  const { sent } = engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: await rowKey(ui, 0) })
  await ui.press({ key: 'clear' })

  expect(await rows(ui)).toHaveLength(0)
  expect(sent).toHaveLength(0)
  await ui.unmount()
})

test("the person's prompt carries the answered rows above their words, and closes the band", async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: await rowKey(ui, 3) })
  await ui.press({ key: await rowKey(ui, 3) })

  const entered = await $.prompt.submit(composer('Use two regions, not one.'))
  expect(entered.text).toBe(
    [
      'My answers to your Needs you lines:',
      '',
      '1. Design approval ("approve the v0 design in section 10.") — changes.',
      '',
      'Use two regions, not one.',
    ].join('\n'),
  )
  expect(await rows(ui)).toHaveLength(0)
  await ui.unmount()
})

test('a prompt with no answer goes as typed and closes the band', async ($, on) => {
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
  await ui.press({ key: await rowKey(ui, 0) })

  const command = await $.prompt.submit({ ...composer('/compact'), command: { name: 'compact', args: '' } })
  expect(command.text).toBe('/compact')
  const note = await $.prompt.submit({ text: 'task done', wait: false, origin: { kind: 'task-notification' } })
  expect(note.text).toBe('task done')
  expect(await chipOf(ui, 0)).toMatch(/^✓ your pick/)
  await ui.unmount()
})

test('a turn end with no Needs you lines keeps the band and its answers', async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: await rowKey(ui, 0) })

  await $.turn.complete(end('Partial work.', { reason: 'aborted' }))
  await $.turn.complete(end('Noted: the task finished.'))
  expect(await rows(ui)).toHaveLength(4)
  expect(await chipOf(ui, 0)).toMatch(/^✓ your pick/)
  await ui.unmount()
})

test("a later turn's new lines join the open rows, and a line asked again keeps its one row", async ($, on) => {
  engine(on)
  await $.turn.complete(end(ANSWER))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: await rowKey(ui, 1) })
  await ui.press({ key: await rowKey(ui, 1) })
  await ui.input({ key: await field(ui, 2), text: 'after lunch', kind: 'change' })

  await $.turn.complete(
    end('Needs you (GO: terraform apply (prod)): may I apply the plan?\nNeeds you (GO: merge): merge the PR?'),
  )
  expect(await rows(ui)).toHaveLength(5)
  expect(await chipOf(ui, 1)).toMatch(/^✗ no go/)
  expect(await chipOf(ui, 2)).toMatch(/^✎ words/)
  expect(await chipOf(ui, 4)).toMatch(/^○ /)
  expect(await ui.find({ type: 'Text', text: /^GO: merge · merge the PR\?$/ })).toBeDefined()
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
  await ui.press({ key: await rowKey(ui, 0) })
  expect(await chipOf(ui, 0)).toMatch(/^✓ your pick/)
  await ui.unmount()
})

test('a band past nine rows keeps the chips in one column', async ($, on) => {
  engine(on)
  await $.turn.complete(end(Array.from({ length: 10 }, (_, i) => `Needs you (GO: step ${i}): run step ${i}?`).join('\n')))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await rows(ui)).toHaveLength(10)
  // Row 10 has no hotkey, so its chip takes the three cells `9: ` holds on row 9.
  expect(await chipOf(ui, 9)).toMatch(/^ {3}○/)
  expect(await chipOf(ui, 8)).toMatch(/^○/)
  await ui.unmount()
})
