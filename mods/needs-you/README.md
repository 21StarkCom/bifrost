# needs-you

A Claude Code mod for the `Needs you (<tag>): …` lines that the root rules
put at the end of a turn. When a turn ends on those lines, a band above the
prompt shows one row for each line. The operator answers each row with one
key, or takes all of Claude's picks with one key, and sends all the answers
as one message.

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
- New lines replace the rows. A line asked again, with the same tag and
  question, keeps the answer the operator set on it.
- A turn that ends with no such lines leaves the band as it is: a task
  notification's turn or a command's turn does not answer the lines. So do an
  interrupt, a refusal, an error, and a subagent's turn. Only the operator's
  prompt or Send clears the band.

## The band

```
Needs you 2 of 3 answered
1: ✓ only Vertex   Yours: clouds · should v0 use only Vertex, or Bedrock too? I recommend only Vertex.
2: ✗ no go         GO: terraform apply (prod) · may I apply the plan?
3: ○               Design approval · approve the v0 design in section 10.
[ Take all picks ] [ Send answers ]
1-3 in an empty prompt answers a row; type a space first to start a prompt with a digit. a and s work after ctrl+x tab. …
```

- **A row** shows its answer, its tag, and the question, cut to the band's
  width by code point. `○` is no answer, `✓` the yes side, `✗` the no side.
- **A digit** `1`–`9` typed in an empty prompt, or a click on the row, moves
  that row to its next answer: no answer, yes, no, then no answer again.
  While the band shows, a digit in an empty prompt goes to the band. To start
  a prompt with a digit, type a space first: the prompt is then not empty.
- **`a` (Take all picks)** sets Claude's pick on each `Yours` row that has
  one and no answer yet. A `GO`, `Design approval` or `Your hands` row, and a
  `Yours` row with no pick, each take the operator's own key. A row the
  operator already answered keeps its answer. With no pick row, the band
  shows no `Take all picks`.
- **`s` (Send answers)** sends the answers as the operator's own message
  (`$.prompt.submit` with `asUser: true`) and clears the band. With no answer
  yet, it sends nothing and says so in a toast.
- `a` and `s` work while the band holds the keys: click it, or press
  `ctrl+x tab`.
- The band takes the slot above the prompt while it shows. Another mod's
  band there (the `stark-progress` row) comes back when the band clears.

The words for each side, by tag:

| Tag | Yes | No |
|---|---|---|
| `GO` | go | no go |
| `Yours` with `I recommend` | your pick: `<pick>` (the row shows the pick) | no |
| `Yours` with no pick | yes | no |
| `Your hands` | done | not yet |
| `Design approval` | approve | changes |

## What Claude reads

Send writes this message. A typed prompt that the operator sends with Enter
(origin `composer`, or `bridge` from a phone) gets the same lines above its
own words. Either way the band clears.

```
My answers to your Needs you lines (2 of 3 answered):

1. Yours: clouds ("should v0 use only Vertex, or Bedrock too?") — your pick: only Vertex.
2. GO: terraform apply (prod) ("may I apply the plan?") — no go.
3. Design approval ("approve the v0 design in section 10.") — no answer.

<the words the operator typed, if any>
```

Each line quotes its question, less the `I recommend` part, cut to 100
characters. So an answer that Claude reads after a newer turn still names
its own question.

A typed prompt with no answer goes as typed, and still clears the band. A
slash command, a task notification and any other origin leave the band and
its answers alone.

## The state it keeps

One session value, `asks`: the lines of the last turn, its `turnId`, and one
answer per line (`yes`, `no` or `null`). It carries the shape tag `asks-1`;
change the tag when the shape of the value changes. The mod writes nothing to
disk.

## Not built (add when it hurts)

- A text field per row: the operator types words in the prompt.
- Answers kept past the end of a session.
- A pick for a tag other than `Yours`.

## Develop

```
claude plugin validate mods/needs-you
claude plugin test mods/needs-you
claude --plugin-dir mods/needs-you
```
