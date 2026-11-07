# Batch

`goldfinger batch` reads at most 10 steps, a JSON array on stdin, and runs them in order,
stopping at the first that fails. A step is `{"verb", "args"}`: `click`, `type`, `keys`, `scroll`,
`set-value` or `perform`, with its arguments as snake_case JSON (`target`, `text`, `combos`,
`direction`, `lines`, `value`, `right`, `double`, `observe`, `action`, `custom`, `observe_ocr`
and `max_nodes`). A step's `max_nodes`, with `observe`, cuts that step's observe, and a later
`step<k>:<index>` names an element of the cut snapshot; `goldfinger batch` prints no cut line, so
read each entry's `observe` for its `truncated`. A step runs in the background, so one whose args
carry `foreground` is `usage`, and a `perform` step's `show-menu` goes as it does alone without
`--foreground`. Each step falls back as its verb does alone (see the focus fallback in
[focus.md](focus.md)), and `goldfinger batch --background --json` (socket arg `background`) keeps
every step in the background. A step with `"observe": true` lets a later one target
`step<k>:<index>`, an element of step `k`'s observe, `k` counted from 0; its index is the one that
element has in the UI step `k` leaves, known from an earlier observe of that state:

```
printf '%s' '[{"verb": "click", "args": {"target": "k7.12:4", "observe": true}},
  {"verb": "click", "args": {"target": "step0:2"}}]' | goldfinger batch --json
```

It returns an entry per step that ran, `{"step": 0, "ok": true, "result": {…}}`, and a failed
step's `{"step": 1, "ok": false, "error": {…}}` is always the last. A bad array (empty, over 10
steps, another verb, `session` in a step's args, a reference to a step not earlier or without
`observe`) is refused whole as `usage`, with nothing sent. The app policy (see
[policy.md](policy.md)) checks every step before step 0 runs: one step whose app's tier does not
allow its verb refuses the whole batch as `denied`, naming the step's position and verb, with no
step run (exit `1`). Each step is checked again as it runs, so a step on a snapshot an earlier
step made can still fail `denied` as its own last entry, after the steps before it ran. The batch
has one 20 s limit; a session cursor's glide adds up to 0.75 s a step: turn it off for a long
batch (`session-cursor --session <id> off`, or MCP's `session-cursor` with `cursor: false`).

**Text references.** `step<k>:text=<text>` names an entry of the text step `k`'s
`--observe-ocr` read by its text, since no caller knows an entry's number before the batch runs.
Step `k` needs both `"observe": true` and `"observe_ocr": true`, else the batch is `usage`, as is
a `<text>` empty once trimmed. `<text>` is all that follows `text=`, colons included, in a JSON
string, never a shell word:

```
printf '%s' '[{"verb": "click", "args": {"target": "k7.12:9", "observe": true, "observe_ocr": true}},
  {"verb": "click", "args": {"target": "step0:text=Counter"}}]' | goldfinger batch --json
```

- The step finds the entries whose text holds `<text>`, both lowercased with each run of
  whitespace made one space, as `find-text` matches. Exactly one resolves to its text target,
  checked against the window's pixels as any text target is. None, or two or more, is
  `not_found` (the second "ambiguous"), nothing sent. So "Save" beside "Save As" has no text
  reference of its own: end the batch at step `k`, and act on that entry's own `target`.
- Step `k`'s `observe_failed` fails the step `stale_snapshot`. Until Vision's model has
  compiled, every step's read gives `observe_failed`, so run `observe --ocr` until it answers
  `ok` before a batch that reads text.
- A step with `observe_ocr` adds a recognition, under 2 s warm, and a text reference its check:
  mind the 20 s limit.
