# Sessions, recording and replay

## Sessions

A session marks an agent's calls as its own, and its cursor shows the operator where it acts.

- `goldfinger session-start [--idle-timeout <seconds>] --json` returns `{"session": "k7.s1",
  "color": "orange", "idle_timeout": 300, "cursor": true}`. Pass `--session <id>` on each call
  that belongs in it (one without runs in no session): every command takes it but
  `session-start`, `session-list`, `watch`, `doctor`, `serve`, `mcp` and `policy`, and `glide`,
  `record-start`, `record-stop`, `session-end` and `session-cursor` require it.
- `goldfinger session-end --session <id> --json` ends it, `goldfinger session-list --json` lists
  the live ones, and `goldfinger session-cursor --session <id> on|off --json` shows or hides its
  cursor, on from the start: for a session without one, run `off` right after `session-start`.
- **The cursor**, an arrow in the session's color drawn in front of the window acted in (main
  display only), glides to where each action aims before it runs; it then tracks a `drag` from
  `from` to `to`, through each `via`, and stays there. It is not the mouse pointer, and clicks pass through it.
- `goldfinger glide <target> --session <id> --json` glides that cursor to where an action on the
  target would aim, and sends nothing to the app: for a demo or a recording, to show where the
  agent will act or what it reads. Without `--session` it is `usage`; with the cursor off
  it is `ok` and nothing moves. It returns `{"warnings": []}` once the cursor arrives, taking the
  glide's 0.25–0.75 s and no 1 s guard; it takes no `--observe` and is no `batch` step. An element
  with no visible part or position is `action_failed`, the cursor unmoved; a session that is not
  live `session_not_live`. MCP's `glide` takes `target` alone, in the connection's session.
- **The end.** A session idles out when no call has carried its id for its idle timeout (default
  300 s, 1 to 86,400; `session-list` does not count), and every daemon exit ends them all:
  `stop`, `setup`'s restart, a newer client, and a person's Stop, Restart or Force quit in
  Goldfinger Control's panel (see [diagnose.md](diagnose.md)). An id that is not live (ended, idled out, never started
  or an earlier daemon's) fails `session_not_live`, with nothing run: `session-start`, and use
  the new id. Six can be live, one per color; a seventh `session-start` is `session_limit`.

## Recording and replay

- `goldfinger record-start --session <id> [--video] --json` records that session until
  `goldfinger record-stop --session <id> --json`, the session's end or the daemon's. Both return
  the `trajectory`'s path, under `~/Library/Application Support/goldfinger/recordings/`
  (`<id>-<n>/trajectory.jsonl`), and with `--video` a `video` beside it, an MP4 of the main
  display (Screen Recording grant; one at a time); `record-stop` adds `step_count`, the step
  lines written. Nothing is recorded unless `record-start` ran, and nothing leaves the Mac.
- **`--text-anchors`** (MCP `text_anchors`; the result and the trajectory's
  first line carry `"text_anchors": true`): each text target a recorded step acts on, a batch step's text
  reference included, keeps its entry's text as recognized beside its point, and its
  `ocr_language` when it is not `en-US`, so replay finds that text again before it acts. That
  writes screen text, secrets included, into the trajectory, in the recordings directory that
  Time Machine skips: start it only when the task needs a replay that survives a moved layout.
  Off, a recording writes no recognized text.
- **Recorded:** every action (see [actions.md](actions.md)) that succeeded in that session, `batch` steps
  included, and `glide`, with whichever it acted on of the app's bundle id, window title and
  element's role, title and tree path (or pixel point); a `hover --click` also keeps the pressed
  element's. `hide`, `unhide`, `open`, `window-state` and `perform` are recorded
  too: `hide`, `unhide` and `open` keep the app alone, `window-state` the app and window, and
  `perform` its element with the action's short name or the custom action's label, never the
  platform's name; a `perform` batch step too, but no `perform … show-menu`,
  which writes no line and adds no warning. A text target is kept as its box centre's point,
  and without `--text-anchors` never its text, so it replays there, unchecked. A
  batch step's text reference is kept as the text target it resolved to, and its `observe_ocr`
  is left out. Not reads, `launch`, `quit` or failures. Text and values are written verbatim,
  passwords included, to a file only the user can read. An action on a target of
  a menu snapshot (an `observe` of a `menu_window_id`, or a `capture` of a window at the pop-up
  menu level) writes no line and is `ok` with `record_failed`: the menu is gone by replay. An action on a pixel or
  text target on a window the PNG showed over its window (a sheet or a popover; see Windows over it in [observe.md](observe.md)) writes no line and is `ok` with `record_failed`: that window is gone by replay.
- `goldfinger replay <file> [--session <id>] --json` does the steps again, in order, and returns
  `{"step_count": 7, "warnings": []}`, the steps run. Each finds its app by bundle id (launching
  it if none runs), its window by title, and its element by that role, title and tree path in a
  fresh observe, never a look-alike, as far as its step keeps them (a `menu` keeps no window, a
  `clipboard-write` no app, but all its args, an image's bytes and the file paths included, so a
  file moved since pastes as a missing one); on an app replay launched, the observe and the
  re-find are retried for 10 s. A look-alike stops the step even at the recorded
  path: when more than one element with an index in the fresh observe has the step's role and
  title, whatever their tree paths, the descriptor is ambiguous, since a look-alike may have moved
  into that path. That is `not_found`, its message naming the count and ending `so the descriptor
  is ambiguous, and replay acts on none of them`, with nothing sent. An element with no index (a
  disabled one) is no look-alike, and untitled elements of one role are look-alikes too. So a
  recording that acts on one of several same-titled elements (a Delete per row), or on one of
  several untitled ones of a role (a window's close, minimize and zoom buttons, two unlabelled
  fields), replays up to that step and stops there: record a target whose role and title are
  unique, or act on that step by hand. A `drag`'s element ends stop the same way. A `reveal` or
  a `glide` step skips this check, as it presses nothing, and takes the element at the path,
  look-alikes or not. A fresh observe that the walk's time cut
  (`truncated_by: "time"`) re-finds no element, a `reveal`'s, a `glide`'s and a replayed
  `hover --click`'s pressed element included, since an element past the cut can match too:
  `not_found`, its message naming the cut. A recorded element can sit past the
  default walk's 2,000 nodes, from an observe whose `--max-nodes` passed them: when the node
  limit cut a step's fresh observe (`truncated: true`, no `truncated_by`) and a target's re-find
  is `not_found`, replay observes once more with `--max-nodes 20000` and re-finds every target of
  the step in that tree. A `menu`, `drag`, `window-state restore` or `window-state full-screen` activates its app again, as under `--foreground`.
  A text anchor is found again by its text, never at its point: replay runs
  `find-text` on a fresh observe's whole window, in the anchor's language, and takes the entry
  whose text equals the anchor's, else the one that holds it. Two such entries, or none, are
  `not_found`, naming the snapshot, the count and the text, and the step's verb is not sent; the
  verb's own check then reads the box again. A first recognition (about 35 s after an install,
  about 14 s for a language's first read) fails `timeout`: replay again in a minute. A replayed `open` runs the client's checks on its items again,
  and a file moved since or refused now is `usage`, stopping replay; a replayed `perform` matches
  its custom action's label again on that launch. A
  `hover --click` re-finds its pressed element in the observe of the replayed hold, else
  `not_found` with nothing clicked, and stops the same way on an ambiguous one,
  its message ending `so the descriptor is ambiguous; nothing was clicked`. A `glide` is
  skipped, uncounted, without `--session`. The first step that fails stops it, its error prefixed `step <k>: ` and not retryable, as a retry
  repeats the steps before. The app policy checks each step as a request of its
  own, so a step on an app whose tier does not allow its verb stops replay with `denied`, after
  the steps before it ran (see [policy.md](policy.md)). A file that is no trajectory to the goldfinger replaying it is refused
  whole (`usage`), with nothing sent. One in trajectory format 1, whose line 1 holds
  `"trajectory": 1` in place of `"format"`, is refused so too, its message saying so: record it
  again.
