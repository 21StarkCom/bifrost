# decision-deck

A Claude Code mod that walks the operator through a deck of decisions in a
pane beside the chat. Claude presents the deck with the `present` tool. The
pane shows one decision at a time: Claude's short explanation, its options
and a field for the operator's own words. The operator picks one or more
options or writes words for each decision, and Send returns all the answers
to Claude as the operator's next message.

Install it on its own; the seven skill plugins do not need it:

```
/plugin install decision-deck@bifrost
```

## The `present` tool

The mod registers the tool `present`, which Claude calls as
`mcp__decision-deck__present`. The tool returns at once: Claude does not wait
for the answers in the same turn.

| Field | Type | Required | What it is |
|---|---|---|---|
| `id` | string | yes | A stable id. The answers are kept per deck id. |
| `title` | string | yes | The title of the deck. |
| `intro` | string | no | One or two sentences, shown above the first decision. |
| `outro` | string | no | What the operator asks Claude to do with the answers. It ends the message that Send writes. |
| `items` | array of 1 to 40 decisions | yes | The decisions, in order. |

Each decision in `items`:

| Field | Type | Required | What it is |
|---|---|---|---|
| `id` | string | yes | A short id the operator sees, such as `C01`. Unique in the deck. |
| `title` | string | yes | The decision, in a few words. |
| `explain` | string | yes | Markdown: what it is, why it matters, the catch. |
| `facts` | array of strings | no | Short facts, drawn dim under the text. |
| `options` | array of 1 to 9 options | yes | Each option has `id` and `label`, and an optional one-line `detail`. Option ids are unique in the decision. |
| `recommended` | string | no | The option id Claude recommends, marked `★ my pick`. It must be one of the decision's option ids. |

The mod checks the input itself. A deck that breaks a rule is refused with
`The deck was not loaded: <reason>.`, and the pane keeps the deck it had.

A good deck replaces the deck in the pane, puts the pane at the first
decision, clears the sent mark of that deck id, and opens the pane with the
focus. A deck presented again under the same id keeps the answers it already
has; a pick of an option that the new deck dropped no longer counts as an
answer. When the pane cannot open, the tool tells Claude to ask the operator to
type `/decide`.

## The `/decide` command

`/decide` opens the pane and gives it the focus. With no deck yet, the pane
says `No decisions yet`. Esc closes the pane.

At session start the mod also opens the pane when it holds a deck that the
operator did not send.

## The pane

- **Header:** the deck's title and one dot per decision: `◉` the decision on
  screen, `●` an answered one, `○` one with no answer. Press a dot to go to its
  decision, and `≡` for the page of all answers. `<n> of <m> answered` follows.
- **A decision:** its id, `<k> of <m>`, the title, the explanation and the
  facts. Then the options: `1`–`9` picks or takes back an option, and more than
  one can be picked. Then `Your words`, a free-text field, which the mobile
  surface does not show. A submit in the field goes to the next decision.
- **Keys on a decision:** `n` next, `b` back, `l` all answers, Tab to the
  field, Esc closes.
- **All answers:** one row per decision with its answer or `no answer`, and a
  row press goes back to that decision. Below it, the message Send will write.
  `s` sends (`Send again` after a send), `b` goes back, and Close closes.

A key works only while the pane has the focus: click the pane, or press
`ctrl+x tab`.

### What Send writes

Send refuses a deck with no answer at all. Otherwise it sends this message as
the operator, and Claude reads it when its current turn ends:

```
My answers to "<title>" (<answered> of <count> answered):

- <id> <title>: <label> + <label>; my words: "<words>".
- <id> <title>: no answer.

<outro>
```

The operator's words are put on one line in the message. The pane then shows
`✓ Sent to Claude at <HH:MM> UTC`. When Claude Code drops the message, or the
submit fails, the mod clears that mark and shows `Not sent: <reason>`.

## The state the pane keeps

The host keeps four values for the session. They survive a reload of the mod's
code, and the mod writes nothing to disk.

| Key | Value |
|---|---|
| `deck` | The deck on screen, or `null` until Claude presents one. |
| `cursor` | The index of the decision on screen, or the count of decisions for the page of all answers. |
| `answers` | `{ picks, note }` per decision, keyed by the JSON array `[<deck id>, <item id>]`: the picked option ids and the operator's words. |
| `sent` | Deck id to the time its answers were sent. |

`deck`, `answers` and `sent` carry a shape tag (`deck-1`, `answers-2`,
`sent-1`). Change a tag when the shape of its value changes: the new code then
reads the old value as absent, not as a value of the wrong shape.

## Not built (add when it hurts)

- Answers kept on disk, past the end of a session.
- A deck that Claude adds to, not one that it replaces.

## Develop

```
claude plugin validate mods/decision-deck
claude plugin test mods/decision-deck
claude --plugin-dir mods/decision-deck
```
