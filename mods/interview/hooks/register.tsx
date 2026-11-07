import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Draft, Option, Question, Route } from '../types'

const PANE = 'interview'
const TITLE = 'Interview'
const TOOL = 'mcp__interview__ask'
const MAX_OPTIONS = 9
const MAX_QUESTIONS = 20
// An id is echoed bare in the answer message, so it holds no space, quote or bracket.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,16}$/
// How much of a question or an option label the answer message echoes.
const ECHO_QUESTION = 120
const ECHO_LABEL = 60

// Change a tag when the shape of its value changes: it declines what an
// earlier version stored, which outlives a reload.
const questionsAtom = atom({ plugin: 'interview', key: 'questions' } as const, [], { shape: 'questions-1' })
const draftsAtom = atom({ plugin: 'interview', key: 'drafts' } as const, {}, { shape: 'drafts-1' })
const cursorAtom = atom({ plugin: 'interview', key: 'cursor' } as const, '')
const workingAtom = atom({ plugin: 'interview', key: 'working' } as const, false)

const EMPTY: Draft = { picks: [], words: '' }

const isOpen = (q: Question) => q.state === 'open'
// Answered, and not yet on its way to Claude.
const isWaiting = (q: Question) => q.state === 'answered' && q.read === undefined
const hasAnswer = (d: Draft) => d.picks.length > 0 || d.words.trim() !== ''

// The operator's local time, `HH:MM`, in the zone the mod's environment reads.
export function localTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}

async function clockText($: EngineInterface): Promise<string> {
  return localTime(await $.clock.now())
}

// Claude wrote the questions and the option labels, and the answer message goes
// as the operator's words. So a text echoed from Claude stays one quoted line:
// no line break, angle bracket or double quote of its own (a fake
// `</interview-answers>` and new lines after it cannot pass), cut to `max`.
export function quoted(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim().replace(/</g, '‹').replace(/>/g, '›').replace(/"/g, "'")
  const cut = Array.from(flat)

  return `"${cut.length > max ? `${cut.slice(0, max - 1).join('')}…` : flat}"`
}

export function answerText(q: Question): string {
  const picks = (q.answer?.picks ?? []).flatMap(i => (q.options[i] === undefined ? [] : [quoted(q.options[i].label, ECHO_LABEL)]))
  // The operator's own words go as they typed them.
  const words = q.answer?.words.trim() ?? ''
  const parts = [picks.join(' + '), words === '' ? '' : `my words: "${words}"`].filter(Boolean)

  return parts.length === 0 ? 'no answer' : parts.join('; ')
}

// The one text Claude reads, by every route: the answers in `sent`, and the
// ids still open in `all`.
export function messageFor(sent: readonly Question[], all: readonly Question[]): string {
  const open = all.filter(isOpen).map(q => q.id)
  const lines = [
    '<interview-answers>',
    `My answers to your interview questions (${sent.length} new; ${open.length === 0 ? 'none open' : `still open: ${open.join(', ')}`}):`,
    ...sent.map(q => `- ${q.id} (your question ${quoted(q.question, ECHO_QUESTION)}): ${answerText(q)}.`),
    '</interview-answers>',
  ]

  return lines.join('\n')
}

function refreshStatus($: EngineInterface, all: readonly Question[]): void {
  const open = all.filter(isOpen).length
  $.ui.status(open === 0 ? undefined : `Interview: ${open} open · /interview`)
}

// Marks every waiting answer as on its way by `route`, in one write, so two
// routes never carry the same answer. Returns the answers it marked.
async function claim($: EngineInterface, route: Route): Promise<{ sent: Question[]; all: Question[] }> {
  // Every main-loop tool result and every typed prompt asks: most find nothing.
  if (!(await read($, questionsAtom)).some(isWaiting)) return { sent: [], all: [] }
  const at = await clockText($)
  let sent: Question[] = []
  let all: Question[] = []
  await update($, questionsAtom, now => {
    sent = now.filter(isWaiting)
    all = now.map(q => (isWaiting(q) ? { ...q, read: { at, route } } : q))

    return sent.length === 0 ? now : all
  })

  return { sent, all }
}

// Puts answers back as waiting: their route dropped them.
async function unclaim($: EngineInterface, sent: readonly Question[]): Promise<void> {
  const ids = new Set(sent.map(q => q.id))
  await update($, questionsAtom, now =>
    now.map(q => {
      if (!ids.has(q.id)) return q
      const { read: _gone, ...rest } = q

      return rest
    }),
  )
}

// Sends the waiting answers as the operator's own message, which starts a turn
// once the session is idle.
async function flush($: EngineInterface): Promise<void> {
  const { sent, all } = await claim($, 'message')
  if (sent.length === 0) return
  // The submit resolves only when its turn starts: awaiting it here would run
  // a press past its time budget.
  const putBack = async (why: string) => {
    await unclaim($, sent)
    $.ui.toast(`Interview: the answers were not sent: ${why}`)
  }
  void $.prompt
    .submit({ text: messageFor(sent, all), asUser: true })
    .then(submitted => (submitted.drop === undefined ? undefined : putBack(submitted.drop)))
    .catch((error: unknown) => putBack(error instanceof Error ? error.message : String(error)))
    .catch(() => undefined)
}

// The open question after (by 1) or before (by -1) `id`, in asked order, or ''.
function stepOpen(all: readonly Question[], id: string, by: 1 | -1): string {
  const open = all.filter(isOpen)
  if (open.length === 0) return ''
  const at = open.findIndex(q => q.id === id)
  if (at === -1) return open[0]?.id ?? ''

  return open[(at + by + open.length) % open.length]?.id ?? ''
}

// The open question after `id` in asked order, or '' (the list of all
// questions) after the last one, so the list and its Send come at the end.
export function nextOpen(all: readonly Question[], id: string): string {
  const open = all.filter(isOpen)
  const at = open.findIndex(q => q.id === id)

  return open[at + 1]?.id ?? ''
}

// The open questions the operator has answered (a pick or words) and not sent.
const ready = (all: readonly Question[], drafts: Readonly<Record<string, Draft>>) =>
  all.filter(q => isOpen(q) && hasAnswer(drafts[q.id] ?? EMPTY))

// Sends every open question the operator has answered, in one write and one
// message; a question they skipped stays open for a later send.
async function sendAnswered($: EngineInterface): Promise<void> {
  const drafts = await read($, draftsAtom)
  const at = await clockText($)
  let all: Question[] = []
  let sent: string[] = []
  await update($, questionsAtom, now => {
    sent = ready(now, drafts).map(q => q.id)
    all = now.map(q =>
      sent.includes(q.id) ? { ...q, state: 'answered' as const, answer: { ...(drafts[q.id] ?? EMPTY), at } } : q,
    )

    return sent.length === 0 ? now : all
  })
  if (sent.length === 0) {
    $.ui.toast('Pick an option or write your words first.')
    return
  }
  await update($, draftsAtom, now => Object.fromEntries(Object.entries(now).filter(([k]) => !sent.includes(k))))
  // A sent question leaves the screen for the first open one, or the list.
  const cursor = await read($, cursorAtom)
  if (!all.some(q => q.id === cursor && isOpen(q))) await update($, cursorAtom, () => stepOpen(all, '', 1))
  refreshStatus($, all)
  const what = sent.length === 1 ? sent[0] : `${sent.length} answers (${sent.join(', ')})`
  if (await read($, workingAtom)) {
    $.ui.toast(`Sent ${what}. Claude reads them at its next tool call.`)
    return
  }
  await flush($)
  $.ui.toast(`Sent ${what}. Claude starts on them now.`)
}

type Parsed = { add: Question[]; withdraw: string[] }

// The tool's input as the model sends it, checked by hand: the engine passes
// it through as plain data.
export function parseAsk(input: Record<string, unknown>, known: readonly Question[]): Parsed | string {
  const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
  const rawQuestions = input.questions === undefined ? [] : input.questions
  const rawWithdraw = input.withdraw === undefined ? [] : input.withdraw
  if (!Array.isArray(rawQuestions) || rawQuestions.length > MAX_QUESTIONS) {
    return `questions must be a list of at most ${MAX_QUESTIONS}`
  }
  if (!Array.isArray(rawWithdraw) || !rawWithdraw.every(text)) return 'withdraw must be a list of question ids'
  if (rawQuestions.length === 0 && rawWithdraw.length === 0) return 'give at least one question or one id to withdraw'

  const add: Question[] = []
  for (const raw of rawQuestions as Record<string, unknown>[]) {
    if (raw === null || typeof raw !== 'object') return 'each question must be an object'
    if (!text(raw.id) || !text(raw.question)) return 'each question needs an id and a question'
    const id = raw.id.trim()
    if (!ID_PATTERN.test(id)) return `the id ${JSON.stringify(id.slice(0, 20))} must be 1 to 16 letters, digits, _ or -`
    if (add.some(q => q.id === id)) return `the id ${id} appears twice`
    const old = known.find(q => q.id === id)
    if (old !== undefined && !isOpen(old)) return `the id ${id} was used for a question that is ${old.state}; use a new id`
    const rawOptions = raw.options === undefined ? [] : raw.options
    if (!Array.isArray(rawOptions) || rawOptions.length > MAX_OPTIONS) {
      return `${id} may have at most ${MAX_OPTIONS} options`
    }
    const options: Option[] = []
    for (const o of rawOptions as Record<string, unknown>[]) {
      if (o === null || typeof o !== 'object' || !text(o.label)) return `each option of ${id} needs a label`
      if (options.some(p => p.label === o.label)) return `the option "${o.label}" appears twice in ${id}`
      options.push({ label: o.label, ...(text(o.detail) ? { detail: o.detail } : {}) })
    }
    if (text(raw.recommended) && !options.some(o => o.label === raw.recommended)) {
      return `the recommended option of ${id} must be the label of one of its options`
    }
    add.push({
      id,
      question: raw.question,
      options,
      multiSelect: raw.multiSelect === true,
      state: 'open',
      ...(text(raw.detail) ? { detail: raw.detail } : {}),
      ...(text(raw.recommended) ? { recommended: raw.recommended } : {}),
    })
  }

  return { add, withdraw: (rawWithdraw as string[]).map(w => w.trim()) }
}

// A question asked again under an open id takes that question's place; a new
// id joins at the end. One answered since the call was checked keeps its answer.
function merge(now: readonly Question[], add: readonly Question[], withdraw: readonly string[]): Question[] {
  const out = now.map(q => {
    const again = add.find(a => a.id === q.id)
    if (again !== undefined && isOpen(q)) return again
    if (withdraw.includes(q.id) && isOpen(q)) return { ...q, state: 'withdrawn' as const }

    return q
  })

  return [...out, ...add.filter(a => !now.some(q => q.id === a.id))]
}

// A draft of a question asked again keeps its words, and its picks by label:
// the new options may come in another order, or fewer.
function redraft(draft: Draft, was: Question, again: Question): Draft {
  const labels = draft.picks.flatMap(i => (was.options[i] === undefined ? [] : [was.options[i].label]))
  const picks = again.options.flatMap((o, i) => (labels.includes(o.label) ? [i] : []))

  return { ...draft, picks: again.multiSelect ? picks : picks.slice(0, 1) }
}

const OPTION_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'A few words; the person reads it as a choice.' },
    detail: { type: 'string', description: 'One short line under the label.' },
  },
  required: ['label'],
}

const ASK_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      maxItems: MAX_QUESTIONS,
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            pattern: ID_PATTERN.source,
            description: 'A short id the person sees, such as Q1: 1 to 16 letters, digits, _ or -. Unique in the session.',
          },
          question: { type: 'string', description: 'The question, in one sentence.' },
          detail: { type: 'string', description: 'Markdown: the context and why the answer matters. Keep it short.' },
          options: { type: 'array', maxItems: MAX_OPTIONS, items: OPTION_SCHEMA },
          multiSelect: { type: 'boolean', description: 'True lets the person pick more than one option.' },
          recommended: { type: 'string', description: 'The label of the option you recommend.' },
        },
        required: ['id', 'question'],
      },
    },
    withdraw: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ids of open questions you no longer need, for example because you found the answer.',
    },
  },
}

const TOOL_DESCRIPTION =
  'Asks the person questions without stopping your work. The questions go to the Interview pane beside ' +
  'the chat, and the call returns at once. Each question has 0 to 9 options (one pick, or several with ' +
  'multiSelect) and a field for the person\'s own words. Each answer reaches you as a message from the ' +
  'person in an <interview-answers> block: during your turn, right after one of your tool results, or once ' +
  'your turn has ended. Use it in place of a blocking question whenever you can keep working on what does not depend on ' +
  'the answer, and act on each answer when it arrives. A later call adds questions; it never replaces the ' +
  'open ones. Withdraw a question you no longer need with `withdraw`.'

// Adds and withdraws the questions of one checked call, opens the pane, and
// returns the lines the call's result reads.
async function applyAsk($: EngineInterface, parsed: Parsed): Promise<string[]> {
  let before: Question[] = []
  let all: Question[] = []
  await update($, questionsAtom, now => {
    before = now
    all = merge(now, parsed.add, parsed.withdraw)

    return all
  })
  const withdrew = parsed.withdraw.filter(
    id => before.some(q => q.id === id && isOpen(q)) && all.some(q => q.id === id && q.state === 'withdrawn'),
  )
  const askedAgain = parsed.add.filter(a => before.some(q => q.id === a.id && isOpen(q)))
  if (withdrew.length > 0 || askedAgain.length > 0) {
    await update($, draftsAtom, now =>
      Object.fromEntries(
        Object.entries(now).flatMap(([k, d]): [string, Draft][] => {
          if (withdrew.includes(k)) return []
          const again = askedAgain.find(a => a.id === k)
          const was = before.find(q => q.id === k)

          return [[k, again === undefined || was === undefined ? d : redraft(d, was, again)]]
        }),
      ),
    )
  }
  const cursor = await read($, cursorAtom)
  if (!all.some(q => q.id === cursor && isOpen(q))) {
    await update($, cursorAtom, () => parsed.add[0]?.id ?? stepOpen(all, '', 1))
  }
  refreshStatus($, all)
  const open = all.filter(isOpen).length
  const notOpen = parsed.withdraw.filter(id => !withdrew.includes(id))
  const lines = [
    parsed.add.length > 0 ? `Asked ${parsed.add.map(q => q.id).join(', ')} in the Interview pane.` : '',
    withdrew.length > 0 ? `Withdrew ${withdrew.join(', ')}.` : '',
    notOpen.length > 0 ? `Not withdrawn (not open, or asked again in this call): ${notOpen.join(', ')}.` : '',
    `${open} ${open === 1 ? 'question is' : 'questions are'} open.`,
  ]
  if (open > 0) {
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    lines.push(
      'Keep working on what does not depend on the answers. Each answer reaches you as a message from the person ' +
        'in an <interview-answers> block, during this turn or after it. Do not ask these questions again in your reply.',
    )
    if (!opened.isPlaced) lines.push(`The pane waits (${opened.reason}): tell the person to type /interview.`)
  }

  return lines.filter(Boolean)
}

// AskUserQuestion's questions as `ask` questions, each under the next free id
// `A<n>`, or null when the pane cannot show one of them (a `number` question).
export function fromAskUserQuestion(
  input: Record<string, unknown>,
  known: readonly Question[],
): Record<string, unknown>[] | null {
  if (!Array.isArray(input.questions) || input.questions.length === 0) return null
  const taken = new Set(known.map(q => q.id))
  let n = 1
  const out: Record<string, unknown>[] = []
  for (const raw of input.questions as Record<string, unknown>[]) {
    if (raw === null || typeof raw !== 'object' || typeof raw.question !== 'string' || raw.kind === 'number') return null
    while (taken.has(`A${n}`)) n += 1
    const id = `A${n}`
    taken.add(id)
    const options =
      raw.kind === 'text' || !Array.isArray(raw.options)
        ? []
        : (raw.options as Record<string, unknown>[]).map(o => ({ label: o?.label, detail: o?.description }))
    out.push({
      id,
      question: raw.question,
      options,
      multiSelect: raw.multiSelect === true,
      ...(typeof raw.description === 'string' ? { detail: raw.description } : {}),
    })
  }

  return out
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'interview',
      description: "Open the interview: answer the questions Claude asked while it keeps working",
    })
    await $.tool.register({ name: 'ask', description: TOOL_DESCRIPTION, inputSchema: ASK_SCHEMA, isDeferred: false })
    // `working` stays as it was: a reload runs this hook again in the middle of a turn.
    const all = await read($, questionsAtom)
    refreshStatus($, all)
    if (all.some(isOpen)) void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'interview' }, async $ => {
    const all = await read($, questionsAtom)
    const cursor = await read($, cursorAtom)
    if (!all.some(q => q.id === cursor && isOpen(q))) await update($, cursorAtom, () => stepOpen(all, '', 1))
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })

    return { text: opened.isPlaced ? 'The interview is open.' : `The interview waits: ${opened.reason}.` }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const parsed = parseAsk(e as unknown as Record<string, unknown>, await read($, questionsAtom))
    if (typeof parsed === 'string') return { deny: `The questions were not asked: ${parsed}.` }

    return { result: (await applyAsk($, parsed)).join(' ') }
  }).catch(() => ({ deny: 'interview: the questions could not be asked.' }))

  // With the `askUserQuestion` setting on, Claude's own AskUserQuestion goes to
  // the pane and returns at once with no answers, so Claude keeps working. A
  // call the pane cannot show (a `number` question) gets the engine's form.
  if (options.askUserQuestion === true) {
    on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
      const known = await read($, questionsAtom)
      const asked = fromAskUserQuestion(e as unknown as Record<string, unknown>, known)
      const parsed = asked === null ? 'not shown in the pane' : parseAsk({ questions: asked }, known)
      if (typeof parsed === 'string') return next(e)
      const lines = await applyAsk($, parsed)

      return {
        result: { questions: e.questions, answers: {} },
        context: [
          `The person has not answered yet: the interview mod sent these questions to its pane as ${parsed.add
            .map(q => q.id)
            .join(', ')}. ${lines.join(' ')}`,
        ],
      }
      // A failure here leaves the call to the engine's own form.
    }).catch(($, e, next) => next(e))
  }

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, workingAtom, () => true)

    return next(e)
  }).catch(($, e, next) => next(e))

  // A turn that ended on its own answer with answers not yet read sends them,
  // which starts the next turn. After an interrupt or an error they wait for
  // the operator's next prompt or next answer.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await update($, workingAtom, () => false)
    if (e.reason === 'answer') await flush($)

    return next(e)
  }).catch(($, e, next) => next(e))

  // While Claude works, the answers ride beside the next tool result of the
  // main loop, as a text block after the tool_result: the model reads them at
  // its next step, as text the person wrote, not as the tool's output.
  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const { sent, all } = await claim($, 'turn')
    if (sent.length === 0) return next(e)
    try {
      const stored = await next({
        ...e,
        message: { ...e.message, content: [...e.message.content, { type: 'text', text: messageFor(sent, all) }] },
      })
      $.ui.toast(`Claude has ${sent.map(q => q.id).join(', ')} for its next step.`)

      return stored
    } catch (error) {
      await unclaim($, sent)
      throw error
    }
  }).catch(($, e, next) => next(e))

  // The operator's own prompt carries the answers that wait, above its words.
  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!isPerson || e.command !== undefined || e.isMeta) return next(e)
    const { sent, all } = await claim($, 'prompt')
    if (sent.length === 0) return next(e)
    try {
      const entered = await next({ ...e, text: `${messageFor(sent, all)}\n\n${e.text}` })
      if (entered.drop !== undefined) await unclaim($, sent)

      return entered
    } catch (error) {
      await unclaim($, sent)
      throw error
    }
    // A failure here never holds the person's prompt: it goes as typed.
  }).catch(($, e, next) => next(e))

  // A /clear starts a conversation that never asked these questions: an answer
  // to one would reach a Claude that cannot place it.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, questionsAtom, () => [])
      await update($, draftsAtom, () => ({}))
      await update($, cursorAtom, () => '')
      await update($, workingAtom, () => false)
      refreshStatus($, [])
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const all = await read($, questionsAtom)
    const working = await read($, workingAtom)
    const keysHint = 'Click the pane, or press ctrl+x tab, to use the keys.'
    const openCount = all.filter(isOpen).length
    const answered = all.filter(q => q.state === 'answered').length
    const drafts = await read($, draftsAtom)
    const readyCount = ready(all, drafts).length
    const sendLabel = readyCount === 0 ? 'Send answers' : `Send ${readyCount} ${readyCount === 1 ? 'answer' : 'answers'}`

    const header = (
      <Box flexDirection="column">
        <Box columnGap={1} flexWrap="wrap">
          <Text bold color="claude">
            Interview
          </Text>
          <Text dimColor>
            {openCount} open · {answered} answered{readyCount > 0 ? ` · ${readyCount} ready to send` : ''}
          </Text>
        </Box>
        <Text dimColor wrap="wrap">
          {working
            ? 'Claude is working. An answer you send reaches it at its next tool call.'
            : 'Claude is idle. An answer you send starts its next turn.'}
        </Text>
      </Box>
    )

    if (all.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Text bold>No questions yet</Text>
          <Text dimColor wrap="wrap">
            Claude asks you questions here with its ask tool, and keeps working while you answer them.
          </Text>
        </Box>
      )
    }

    const cursor = await read($, cursorAtom)
    const q = all.find(one => one.id === cursor && isOpen(one))
    const go = (id: string) => update($, cursorAtom, () => id)

    if (q === undefined) {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
            <Text bold color="claude">
              All questions
            </Text>
            {all.map(one => {
              const draft = drafts[one.id] ?? EMPTY
              const isReady = isOpen(one) && hasAnswer(draft)
              const mark = isReady ? '◐' : one.state === 'open' ? '○' : one.state === 'withdrawn' ? '–' : one.read ? '✓' : '●'
              const color = isReady ? 'warning' : one.state === 'open' ? 'inactive' : one.state === 'withdrawn' ? 'subtle' : 'success'
              const note = isReady
                ? `${answerText({ ...one, answer: { ...draft, at: '' } })} · not sent yet`
                : one.state === 'open'
                  ? 'open'
                  : one.state === 'withdrawn'
                    ? 'withdrawn by Claude'
                    : `${answerText(one)} · ${one.read ? `Claude has it (${one.read.at})` : 'waits for Claude'}`

              return (
                <Box key={`row-${one.id}`} flexDirection="column">
                  <Button key={`go-${one.id}`} plain dimColor={!isOpen(one)} onPress={() => (isOpen(one) ? go(one.id) : undefined)}>
                    <Text color={color}>{mark}</Text>
                    {` ${one.id}  ${one.question}`}
                  </Button>
                  <Box paddingLeft={3}>
                    <Text dimColor wrap="wrap">
                      {note}
                    </Text>
                  </Box>
                </Box>
              )
            })}
            {openCount > 0 && <Text dimColor>Press an open question to answer it.</Text>}
          </Box>
          <Box flexWrap="wrap" columnGap={1}>
            {readyCount > 0 && <Button key="send" hotkey="s" variant="primary" label={sendLabel} onPress={() => sendAnswered($)} />}
            {openCount > 0 && (
              <Button
                key="answer"
                hotkey="a"
                {...(readyCount > 0 ? {} : { variant: 'primary' as const })}
                label="Answer the open ones"
                onPress={() => go(stepOpen(all, '', 1))}
              />
            )}
            <Button key="close" role="dismiss" label="Close" onPress={() => $.ui.close({ id: PANE })} />
          </Box>
          <Text dimColor>
            {e.props.isFocused
              ? [readyCount > 0 ? 's send the answered ones' : '', openCount > 0 ? 'a answer' : '', 'Esc closes'].filter(Boolean).join(' · ')
              : keysHint}
          </Text>
        </Box>
      )
    }

    const draft = drafts[q.id] ?? EMPTY
    const forward = hasAnswer(draft) ? 'next' : 'skip'
    const openList = all.filter(isOpen)
    const place = openList.findIndex(one => one.id === q.id) + 1
    const pick = (i: number) =>
      update($, draftsAtom, now => {
        const was = now[q.id] ?? EMPTY
        const picks = was.picks.includes(i)
          ? was.picks.filter(p => p !== i)
          : q.multiSelect
            ? [...was.picks, i].sort((a, b) => a - b)
            : [i]

        return { ...now, [q.id]: { ...was, picks } }
      })
    const setWords = (words: string) =>
      update($, draftsAtom, now => ({ ...now, [q.id]: { ...(now[q.id] ?? EMPTY), words } }))
    const digits = q.options.length === 0 ? '' : `1-${q.options.length} pick · `
    const hint = e.props.isFocused
      ? `${digits}Tab: your words · n ${forward} · b back · s send the answered ones · l all questions · Esc closes`
      : keysHint

    let field = null
    if (e.surface !== 'mobile') {
      const { Input } = $.ui.resolve(e)
      field = (
        <Input
          key={`words-${q.id}`}
          label="Your words"
          placeholder={q.options.length === 0 ? 'your answer' : 'optional: a condition, a change, or your own answer'}
          value={draft.words}
          rows={2}
          submitLabel="next"
          onInput={value => void setWords(value)}
          onSubmit={async value => {
            await setWords(value)
            await go(nextOpen(all, q.id))
          }}
        />
      )
    } else if (q.options.length === 0) {
      field = (
        <Text dimColor wrap="wrap">
          This question needs your own words: answer it in the terminal or the desktop app.
        </Text>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
          <Box columnGap={1}>
            <Text bold color="inverseText" backgroundColor="claude">
              {` ${q.id} `}
            </Text>
            <Text dimColor>
              {place} of {openList.length} open
            </Text>
          </Box>
          <Text bold wrap="wrap">
            {q.question}
          </Text>
          {q.detail !== undefined && <Markdown text={q.detail} />}
        </Box>
        {q.options.length > 0 && (
          <Box flexDirection="column">
            <Box columnGap={1}>
              <Text bold color="claude">
                Options
              </Text>
              <Text dimColor>· {q.multiSelect ? 'pick one or more' : 'pick one'}</Text>
            </Box>
            {q.options.map((option, i) => {
              const isPicked = draft.picks.includes(i)

              return (
                <Box key={`opt-row-${q.id}-${i}`} flexDirection="column">
                  <Button key={`opt-${q.id}-${i}`} plain hotkey={String(i + 1)} onPress={() => pick(i)}>
                    <Text color={isPicked ? 'success' : 'inactive'}>{isPicked ? '◉' : '○'}</Text>
                    {` ${option.label}`}
                    {option.label === q.recommended ? <Text color="warning">  ★ my pick</Text> : ''}
                  </Button>
                  {option.detail !== undefined && (
                    <Box paddingLeft={5}>
                      <Text dimColor wrap="wrap">
                        {option.detail}
                      </Text>
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        )}
        {field}
        <Box flexWrap="wrap" columnGap={1}>
          <Button
            key="next"
            hotkey="n"
            variant="primary"
            label={forward === 'next' ? 'Next ▶' : 'Skip ▶'}
            onPress={() => go(nextOpen(all, q.id))}
          />
          <Button key="back" hotkey="b" label="◀ Back" onPress={() => go(stepOpen(all, q.id, -1))} />
          <Button key="send" hotkey="s" label={sendLabel} onPress={() => sendAnswered($)} />
          <Button key="all" hotkey="l" label="All questions" onPress={() => go('')} />
        </Box>
        <Text dimColor>{hint}</Text>
      </Box>
    )
  })
}
