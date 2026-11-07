# interview

A Claude Code mod that lets Claude ask the operator questions and keep
working while the operator answers them. Claude asks with the `ask` tool,
which returns at once. The questions wait in a pane beside the chat. Each
question has 0 to 9 options and a field for the operator's own words. Each
answer reaches Claude in its running turn, or as a message once the turn has
ended.

Install it on its own; the seven skill plugins do not need it:

```
/plugin install interview@bifrost
```

## The `ask` tool

The mod registers the tool `ask`, which Claude calls as `mcp__interview__ask`.
Its schema is in the prompt's tool list, not behind ToolSearch, so Claude
sees it in every session. The tool returns at once.

| Field | Type | Required | What it is |
|---|---|---|---|
| `questions` | array of 0 to 20 questions | no | The questions to add. |
| `withdraw` | array of question ids | no | Open questions Claude no longer needs. |

A call gives at least one question or one id to withdraw. Each question:

| Field | Type | Required | What it is |
|---|---|---|---|
| `id` | string | yes | A short id the operator sees, such as `Q1`: 1 to 16 letters, digits, `_` or `-`. Unique in the session. |
| `question` | string | yes | The question, in one sentence. |
| `detail` | string | no | Markdown: the context and why the answer matters. |
| `options` | array of 0 to 9 options | no | Each option has a `label` and an optional one-line `detail`. Labels are unique in the question. |
| `multiSelect` | boolean | no | True lets the operator pick more than one option. |
| `recommended` | string | no | The label of the option Claude recommends, marked `★ my pick`. |

- A new id joins after the questions already asked. A call never replaces the open questions.
- An id of an open question replaces that question in its place. The operator's draft keeps its words, and its picks by option label.
- An id of an answered or withdrawn question refuses the call: `the id Q1 was used for a question that is answered; use a new id`.
- A withdrawn id that is not open (answered, withdrawn or unknown) stays as it is, and the result names it.

A call that breaks a rule is refused with `The questions were not asked: <reason>.`

## The pane

`/interview` opens the pane with the focus. The `ask` tool opens it without
the focus, so a prompt the operator types keeps its keys. Below 144 columns
an unasked pane waits, and the tool tells Claude to tell the operator to type
`/interview`. The status line shows `Interview: <n> open · /interview` while
a question is open.

- **Header:** the count of open and answered questions, and whether Claude is working or idle.
- **A question:** its id, `<k> of <m> open`, the question and its detail. Then the options and the field `Your words`, which the mobile surface does not show. On mobile, a question with no options tells the operator to answer it in the terminal or the desktop app.
- **Answer, skip, then send:** a pick or words answer the question on screen, and nothing goes to Claude yet. `n` moves to the next open question: its button reads **Skip ▶** while the question has no answer and **Next ▶** once it has one. After the last open question comes the list of all questions.
- **Send:** **Send N answers** (`s`) sends every open question with an answer, in one message. A skipped question stays open for a later send, and the pane moves to it.
- **Keys on a question:** `1`-`9` pick, `n` skip or next, `b` back, `s` send the answered ones, `l` all questions. Enter in the field keeps the words and moves on.
- **A pick:** a single-choice question keeps one pick. A `multiSelect` question toggles each option.
- **All questions:** one row per question: `○` open, `◐` answered and not sent, `●` sent and waiting, `✓` Claude has it, `–` withdrawn. Press an open row to answer it, `s` to send the answered ones, or `a` for the first open question. The header counts the answers ready to send.
- **Times:** each answer shows when Claude got it, as `HH:MM` in the operator's local time zone.

A key works only while the pane has the focus: click the pane, or press
`ctrl+x tab`.

## The `askUserQuestion` setting

Off by default. Turn it on in `/config` (the row `Send AskUserQuestion to the
Interview pane`), or in settings under `pluginConfigs.interview.options`.

With it on, Claude's own `AskUserQuestion` calls go to the pane and return at
once, so Claude keeps working:

- Each question gets the next free id `A1`, `A2`, …, and its options keep their labels and descriptions. Its `header`, the chip in the form, shows in bold before its description.
- The call returns an empty `answers` result. A note beside it tells Claude the questions went to the pane, under which ids.
- The answers then reach Claude by the routes below, as answers to `ask` do.
- A question the pane cannot show (a `number` question, in a build whose form takes `kind`, or an option with a `preview`) goes to Claude Code's own form, and so does the whole call.
- A subagent's call goes to Claude Code's own form: the pane's answers reach only the main loop.

## How an answer reaches Claude

An answer **waits** from the moment the operator sends it until a route
carries it. The mod gives each waiting answer to one route, in one write, so
two routes never carry the same answer.

1. **During a turn:** the next tool-result row of the main loop carries the waiting answers. The mod adds them as a text block beside the row's `tool_result` block, through a `session.append` hook on the door `tool-result`. Claude reads them at its next step, as words the operator wrote, not as the tool's output. A subagent's tool results carry nothing.
2. **When a turn ends with the reason `answer`:** the mod sends the waiting answers as the operator's own message (`$.prompt.submit` with `asUser`), which starts a turn.
3. **While Claude is idle:** the answers the operator sends go at once, as in route 2.
4. **When the operator types a prompt:** the waiting answers go above the prompt's words.

After an interrupt, a refusal or an error, the waiting answers stay. A route
that fails or is refused puts its answers back as waiting. The next
answer the operator sends, or the next prompt they type, carries them.

Every route carries the same text:

```
<interview-answers>
My answers to your interview questions (<n> new; still open: Q2, Q3):
- Q1 (your question "Which database?"): "Postgres"; my words: "the managed one".
</interview-answers>
```

Claude wrote each question and option label, and this text goes as the
operator's words. So the mod keeps each echoed question and label on one
quoted line: line breaks become spaces, `<` and `>` become `‹` and `›`, a
double quote becomes `'`, and the text is cut to 120 characters for a
question and 60 for a label. An injected `</interview-answers>` and the lines
after it cannot pass as the operator's words. The operator's own words go as
they typed them.

## The state the pane keeps

The host keeps four values for the session. They survive a reload of the
mod's code, and the mod writes nothing to disk. A `/clear` empties them, since
the new conversation never asked those questions.

| Key | Value |
|---|---|
| `questions` | Every question of the session, in the order Claude asked them, with its state (`open`, `answered`, `withdrawn`), its answer and the route that carried it. |
| `drafts` | The picks and words of each question the operator has started and not sent, keyed by question id. |
| `cursor` | The id of the question on screen, or `''` for the list of all questions. |
| `working` | True from a main-loop `turn.start` to its `turn.complete`. |

`questions` and `drafts` carry a shape tag (`questions-1`, `drafts-1`).
Change a tag when the shape of its value changes: the new code then reads the
old value as absent, not as a value of the wrong shape.

## Not built (add when it hurts)

- Questions and answers kept on disk, past the end of a session.
- A change to an answer after it was sent.
- A tool that waits for an answer.

## Develop

```
claude plugin validate mods/interview
claude plugin test mods/interview
claude --plugin-dir mods/interview
```
