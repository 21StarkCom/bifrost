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
run.

- The tag is the text up to the `)` that closes `Needs you (`, so a tag can
  hold its own parentheses: `GO: terraform apply (prod)`.
- The pick is the text after `I recommend` in the same line, less one end
  stop: `I recommend only Vertex.` gives `only Vertex`.
- A turn that ends with no such lines clears the band. An interrupt, a
  refusal, an error, and a subagent's turn leave the band as it is.

## The band

```
Needs you 2 of 3 answered
1: ✓ only Vertex   Yours: clouds · should v0 use only Vertex, or Bedrock too? I recommend only Vertex.
2: ✗ no go         GO: terraform apply (prod) · may I apply the plan?
3: ○               Design approval · approve the v0 design in section 10.
[ Take all picks ] [ Send answers ]
1-3 in an empty prompt answers a row. a and s work after ctrl+x tab. Words you type and send go after your answers.
```

- **A row** shows its answer, its tag, and the question, cut to the band's
  width. `○` is no answer, `✓` the yes side, `✗` the no side.
- **A digit** `1`–`9` typed in an empty prompt, or a click on the row, moves
  that row to its next answer: no answer, yes, no, then no answer again.
- **`a` (Take all picks)** sets the yes side on each row but a `Your hands`
  row: that one says the operator did a step, so only the operator sets it.
- **`s` (Send answers)** sends the answers as the operator's own message
  (`$.prompt.submit` with `asUser: true`) and clears the band. With no answer
  yet, it sends nothing and says so in a toast.
- `a` and `s` work while the band holds the keys: click it, or press
  `ctrl+x tab`.

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

1. Yours: clouds — your pick: only Vertex.
2. GO: terraform apply (prod) — no go.
3. Design approval — no answer.

<the words the operator typed, if any>
```

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
