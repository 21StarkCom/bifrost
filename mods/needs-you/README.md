# needs-you

A Claude Code mod for the `Needs you (<tag>): …` lines that the root rules
put at the end of a turn. When a turn ends on those lines, a band above the
prompt shows one row for each line, whole. The operator answers each row with
one key, writes their own words in its field, or takes all of Claude's picks
with one key. The operator's next message closes the band: it carries the
answered rows, and a row with no answer is passed.

Install it on its own; the seven skill plugins do not need it:

```
/plugin install needs-you@bifrost
```

## Which lines it reads

At the end of each main-loop turn whose reason is `answer`, the mod reads the
turn's last text the way `classifyEnding` in `tools/ask_guard_metric.ts`
does: it trims each line, drops empty lines, and reads from the end while
each line starts with `Needs you (` and one of the four tags `GO`, `Yours`,
`Your hands` or `Design approval`. Another line, or an unknown tag, ends the
run. `tools/ask_guard_metric.test.ts` holds the mod's tag list and its
`Needs you (` lead to the metric's own.

- The tag is the text up to the `)` that closes `Needs you (`, so a tag can
  hold its own parentheses: `GO: terraform apply (prod)`.
- The pick is the text after `I recommend` in the same line, up to its first
  sentence stop: `I recommend only Vertex. Bedrock adds cost.` gives
  `only Vertex`.

## Which rows the band holds

The band holds the lines asked since the operator's last message, and no
older line. This follows the root rules: a question stays asked until the
operator's next message, and a question that message does not answer is
passed, never asked again.

- **A turn's lines join the band** after its rows. A turn that ends with no
  such lines leaves the band as it is: a task notification's turn or a
  command's turn does not answer the lines. So do an interrupt, a refusal,
  an error, and a subagent's turn.
- **A line asked again keeps its one row.** A line whose tag a row from an
  earlier turn holds is asked again, also in new words. The row shows the
  newest words of the question, and keeps the operator's words. It keeps its
  side while the pick stays the same.
- **The operator's next message closes the band:** `Send answers`, or a
  prompt typed in the composer or sent from a phone (origin `bridge`). Every
  row leaves the band. A slash command, a task notification and any other
  origin leave the band alone.
- **A line that a waiting message closed stays out.** While that message
  waits for the running turn to end, a line with the tag of one of its rows
  does not come back: that turn has not read the message. If the message
  does not go, its rows come back, one row for each tag.

## The band

```
Needs you 1 of 3 answered  a: Take all picks  s: Send answers  c: Clear
1: ✓ your pick  Yours: clouds · should v0 use only Vertex, or Bedrock too? I recommend
                only Vertex.
                your own words (optional)
2: ✎ words      GO: terraform apply (prod) · may I apply the plan?
                not before the plan review
3: ○            Design approval · approve the v0 design in section 10.
                your own words (optional)
1-3 in an empty prompt answers a row · ctrl+x tab, Tab: your words · your next message closes the band
```

- **The top row** holds the count and the three keys. When the keys do not
  fit beside the count in `bodyColumns`, they move to their own row under
  the rows.
- **A row** shows its answer, its tag and the whole question. A long question
  wraps under its own start; the band cuts no line. `○` is no answer, `✓` the
  yes side, `✗` the no side, `✎` words with no side.
- **A digit** `1`–`9` typed in an empty prompt, or a click on the row's
  chip, moves that row to its next side: no answer, yes, no, then no answer
  again. While the band shows, a digit in an empty prompt goes to the band.
  To start a prompt with a digit, type a space first.
- **The field** under a row takes the operator's own words: `ctrl+x tab`
  gives the band the keys, Tab walks to a field, and every key goes to the
  field. Enter keeps the words and moves to the next field, and from the
  last field to `Send answers`. Esc gives the keys back to the prompt. The
  words count as an answer, with a side or alone. Blank words are no answer.
- **`a` (Take all picks)** sets Claude's pick on each `Yours` row that has
  one and no answer or words yet. A `GO`, `Design approval` or `Your hands`
  row, and a `Yours` row with no pick, each take the operator's own key. With
  no pick row, the band shows no `Take all picks`.
- **`s` (Send answers)** sends the answered rows as the operator's own
  message (`$.prompt.submit` with `asUser: true`), and closes the band. With
  no answer yet, it sends nothing, keeps the band, and says so in a toast.
  While Claude works, the message waits until the turn ends.
- **`c` (Clear)** removes every row and sends nothing.
- `a`, `s` and `c` work while the band holds the keys and no field has the
  focus: click the band, or press `ctrl+x tab`. `ctrl+x ctrl+a` folds the
  band, as the engine does for any band.
- The band takes the slot above the prompt while it shows. Another mod's
  band there (the `stark-progress` row) comes back when the band clears.

The words for each side, by tag:

| Tag | Yes | No |
|---|---|---|
| `GO` | go | no go |
| `Yours` with `I recommend` | your pick: `<pick>` (the chip shows `your pick`) | no |
| `Yours` with no pick | yes | no |
| `Your hands` | done | not yet |
| `Design approval` | approve | changes |

## What Claude reads

Send writes this message. A typed prompt with at least one answered row gets
the same lines above the operator's own words.

```
My answers to your Needs you lines:

1. Yours: clouds ("should v0 use only Vertex, or Bedrock too?") — your pick: only Vertex.
2. GO: terraform apply (prod) ("may I apply the plan?") — my words: not before the plan review

<the words the operator typed, if any>
```

- The message lists only the answered rows. A row with no answer is not in
  it: the root rules read a question that the next message does not answer
  as passed.
- Each line quotes its whole question, less the `I recommend` part, so an
  answer that Claude reads after a newer turn still names its own question.
- A side and words read `no go; my words: …`. A later line of the words
  stays indented under its item.
- A typed prompt with no answered row goes as typed. It still closes the
  band.

## The state it keeps

One session value, `asks`: the rows asked since the operator's last message,
oldest first. Each row holds its line, its side (`yes`, `no` or `null`), its
words, and its field's drawn value and key count. It carries the shape tag
`asks-2`; change the tag when the shape of the value changes. The mod writes
nothing to disk.

The rows of a message that waits for the turn to end are held in a module
variable until the message goes or is dropped; a reload empties it. Each
row's id is one that no other row holds, so two rows never share a key.

A field keeps the operator's own text while its `value` prop stays the
same, so typing never changes the prop: a redraw between two fast keys would
otherwise put back an older text. Enter empties a field, so after Enter the
field is drawn again under a new key, with the words as its value.

## Limits

- While a field has the focus, the engine draws each line of its text on one
  row, cut at the field's width. The words show whole once the focus leaves
  the field.
- The engine draws the band on the terminal and desktop surfaces only, so the
  mobile app shows no rows. A prompt typed there still carries the answers
  set on the computer, and closes the band.
- Two lines with one tag in one turn keep two rows. In a later turn, a line
  with that tag is asked again on the first of them.

## Not built (add when it hurts)

- Answers kept past the end of a session.
- A pick for a tag other than `Yours`.
- A key to remove one row; `c` removes every row.

## Develop

```
claude plugin validate mods/needs-you
claude plugin test mods/needs-you
claude --plugin-dir mods/needs-you
```
