# needs-you

A Claude Code mod for the `Needs you (<tag>): …` lines that the root rules
put at the end of a turn. When a turn ends on those lines, a band above the
prompt shows one row for each line, whole. The operator answers each row with
one key, writes their own words in its field, or takes all of Claude's picks
with one key, and sends the answers as one message. A row with no answer
stays open, so the operator can answer it later, while Claude works on.

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
- New lines join the band after the open rows. A line asked again, with the
  same tag and question, keeps its one row and what the operator gave it.
- A turn that ends with no such lines leaves the band as it is: a task
  notification's turn or a command's turn does not answer the lines. So do an
  interrupt, a refusal, an error, and a subagent's turn.

## The band

```
Needs you 2 of 3 answered
1: ✓ your pick  Yours: clouds · should v0 use only Vertex, or Bedrock too? I recommend
                only Vertex.
                your own words (optional)
2: ✎ words      GO: terraform apply (prod) · may I apply the plan?
                not before the plan review
3: ○            Design approval · approve the v0 design in section 10.
                your own words (optional)
[ Take all picks ] [ Send answers ] [ Clear ]
1-3 in an empty prompt answers a row. ctrl+x tab gives the band the keys: …
```

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
- **`s` (Send answers)** sends the answers as the operator's own message
  (`$.prompt.submit` with `asUser: true`). The answered rows leave the band,
  and the open rows stay. With no answer yet, it sends nothing and says so in
  a toast. While Claude works, the message waits until the turn ends.
- **`c` (Clear)** removes every row and sends nothing.
- `a`, `s` and `c` work while the band holds the keys and no field has the
  focus: click the band, or press `ctrl+x tab`.
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

Send writes this message. A typed prompt that the operator sends with Enter
(origin `composer`, or `bridge` from a phone) gets the same lines above its
own words, when at least one row has an answer. Either way, the answered
rows leave the band and the open rows stay.

```
My answers to your Needs you lines (2 of 3 answered):

1. Yours: clouds ("should v0 use only Vertex, or Bedrock too?") — your pick: only Vertex.
2. GO: terraform apply (prod) ("may I apply the plan?") — my words: not before the plan review
3. Design approval ("approve the v0 design in section 10.") — no answer yet.

<the words the operator typed, if any>
```

Each line quotes its whole question, less the `I recommend` part, so an
answer that Claude reads after a newer turn still names its own question. A
side and words read `no go; my words: …`. A later line of the words stays
indented under its item.

A typed prompt with no answer goes as typed, and every row stays open. A
slash command, a task notification and any other origin leave the band and
its answers alone.

## The state it keeps

One session value, `asks`: the open rows, oldest first. Each row holds its
line, its side (`yes`, `no` or `null`), its words, and its field's drawn
value and key count. It carries the shape tag `asks-2`; change the tag when
the shape of the value changes. The mod writes nothing to disk.

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
  set on the computer.

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
