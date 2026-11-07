# VoiceOver: the real screen reader

goldfinger drives the real VoiceOver, for an agent that must hear a page as a blind user does.
VoiceOver reads only the frontmost app, so these verbs take the user's front: use them only when
the task asks for VoiceOver, and stop VoiceOver when done.

- `goldfinger voiceover start <pid> --json` makes the app frontmost, starts VoiceOver unless it
  runs, and waits up to 15 s for it to answer: `{voiceover_pid, started, activated?, warnings}`.
  With VoiceOver off, VoiceOver answers about 10 s after the start, which then waits for 1.5 s
  of quiet, within its 15 s.
- `goldfinger voiceover do <command> --json` sends one command: `top`, `next`, `previous`, `act`,
  `interact`, `stop-interacting`, `heading-next`, `heading-previous`, `link-next`,
  `link-previous`, `landmark-next`, `landmark-previous`, `form-control-next` or
  `form-control-previous`. It returns `{phrases, text_under_cursor, cursor_bounds}`: each phrase
  VoiceOver spoke after it, read every 0.1 s until none is new for 2.5 s (at most 10 s), and the
  cursor's text and bounds. `phrases: []` is a repeat when the bounds moved, and silence when
  they did not. On a page VoiceOver has not been taken into, `top` stays on the page as one item,
  and `heading-next` from there goes into it.
- `goldfinger voiceover type <text> --json` and `goldfinger voiceover press <combo> --json` type
  the text, or press one combo (`cmd` and VoiceOver's `ctrl+option` combos too), into the
  frontmost app as a person does, and return the same object. Move the cursor onto a field first
  (`form-control-next`): in web content outside a field, VoiceOver can take letters as its own
  quick keys.
- `goldfinger voiceover speech --json` reads the last phrase now, with nothing sent.
- `goldfinger voiceover stop --json` turns VoiceOver off, so it stays off at the next login, and
  makes the app frontmost before `start` frontmost again.
- Every verb but `start` fails `not_running` when VoiceOver does not run. The CLI also takes each
  as one word, `goldfinger voiceover-start`.
- `type` and `press` also need the Accessibility grant, which posts their keys. A `voiceover`
  verb's `permission_missing` names `goldfinger setup --voiceover` or the Automation pane: the
  operator gives that grant (see [diagnose.md](diagnose.md)).
- The `voiceover` verbs are not recorded, keep no snapshot, and run in no `batch`.
- A `timeout` from `start`, `stop` or `speech` may be retried. One from `do`, `type` or `press`
  may have landed, unless `retryable` is true: run `voiceover speech` before you send it again.
