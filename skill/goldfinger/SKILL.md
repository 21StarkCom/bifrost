---
name: goldfinger
description: "Operate desktop apps in the background with the goldfinger CLI: list apps and windows, observe a window's accessibility tree, then click, type, press keys, scroll or set a value, move or resize a window, and read or write the clipboard's text, without taking the user's focus; hover a target with the mouse pointer, held there and then put back, so hover-only UI shows; press a menu-bar command or drag, which briefly bring the app to the front; batch actions, and record a session to replay it. Use when a task needs a native app that has no API, CLI or browser route, a menu-bar command, a drag or a hover in one, a window moved or resized, or the clipboard read or written."
argument-hint: "[help]"
---

## Help

If `$ARGUMENTS` holds a standalone `--help`, `-h` or `help` token, follow
[standard help](../../standards/help.md), then stop.

# goldfinger

`goldfinger` gives an agent in any terminal background computer use. One daemon, shared by every
agent on the machine, holds the OS grants and does the work; every other command is a client that
starts it on demand (`stop` never does). No verb activates an app or raises a window but `setup`
(interactive), `quit` of the frontmost app, and `menu` and `drag` under `--foreground`, and only
`hover` moves the mouse pointer, for its hold alone. So the user keeps working, but when any app
activates during an action's 1 s guard, goldfinger puts back the app that was in front, even over
the user's switch.

This skill teaches 0.4.0 (`goldfinger --version`) and marks what 0.5.0 adds: `hover`, `glide`, a
session cursor that tracks a drag, and a single click refused in background WebKit content. Before
0.5.0, `hover` and `glide` fail `usage` (unknown verb) and are no MCP tools. 0.3.0 has no MCP
`session-cursor` and replays only the loop's five verbs. Before 0.2.0 only Install's and The
loop's verbs exist: the rest fail `usage` (unknown verb or flag), `mcp` as
`unknown subcommand "mcp"`. 0.2.0 lacks MCP's tools after `stop` and records only the loop's five
verbs, never a `batch` step.

## Arguments

No arguments: the work happens through `goldfinger` itself.

## Install, once

- **macOS:** `brew install --cask 21StarkCom/tap/goldfinger`, with `HOMEBREW_GITHUB_API_TOKEN`
  set to a GitHub token that can read 21StarkCom (the tap is private). It installs the helper
  app and puts `goldfinger` on `PATH`. Linux is not built yet.
- **Grants:** the operator runs `goldfinger setup` once, in a terminal they watch: it asks for the
  Accessibility and Screen Recording grants, opens each settings pane in turn, and waits up to
  5 minutes for both, else fails `permission_missing`. Ask the operator; never click a grant.
- **Check:** `goldfinger status --json` shows `"permissions": {"accessibility": true,
  "screen_recording": true}`, and never raises a prompt.

## Output

Pass `--json` on every call. Success prints the result itself, object or array; an error prints
`{"ok": false, "error": {"code", "message", "retryable"}}`. Exit `0` is ok, `1` an error, `2` a
usage error; a `batch` whose step failed exits `1` with its entries array, not an error object.
`--` ends the flags, so flags go before it and text that starts with `-` after it:
`goldfinger type k7.12:3 --json -- -x`. After it, `--json` and `--observe` are operands too: the
text or value itself, else a usage error, printed as plain text on stderr when it was `--json`.

## The loop: observe, act, observe

1. **Find the window.** `goldfinger apps --json` lists running apps (`pid`, `bundle_id`, `name`,
   `active`, `hidden`). `goldfinger windows [--pid <pid>] --json` lists windows front to back
   (`window_id`, `pid`, `title`, `frame`, `on_screen`). `goldfinger launch <bundle_id>
   [--new-instance] --json` opens an app without activating it and returns its `pid`.
2. **Observe it.** `goldfinger observe <window_id> --json` returns a `snapshot` id and a `tree`.
   Each node has `role`, `frame` and `depth`, maybe `title` and `value`, and an `index` when it
   can be acted on. `--screenshot` adds a PNG at `screenshot.path` (longest edge at most
   1,568 px). `--max-nodes <n>` caps the walk (1–2,000).
3. **Act on a target from that snapshot:**
   - `goldfinger click <target> [--right] [--double] --json`
   - `goldfinger type <target> <text> --json`: the text arrives exactly once
   - `goldfinger keys <target> <combo>... --json`: combos such as `shift+tab` or `ctrl+a`,
     modifiers first and one key last. Modifiers are `shift`, `option`/`alt`, `ctrl`/`control`
     and `fn`; keys are `return`, `tab`, `space`, `delete`, `escape`, `up`, `down`, `left`,
     `right`, `home`, `end`, `pageup`, `pagedown`, `f1`–`f12`, `a`–`z` and `0`–`9`, nothing else
     (no `enter`, no `esc`). A `cmd` combo is refused with `background_unavailable`: click the
     control it would reach instead, or use `menu`.
   - `goldfinger scroll <target> up|down|left|right [lines] --json` (3 lines by default)
   - `goldfinger set-value <target> <value> --json`: element targets only, read back, compared
4. **Observe again** once the UI may have changed, or add `--observe` to one of these five (not
   `launch` or `quit`) to get the window's new observe result back as `observe` in the same call.

Every action (these five, `window-frame`, `clipboard write`, `menu`, `drag`, `hover`, each
`batch` step) and every `launch` takes at least 1 s, its guard.
`goldfinger quit <pid> [--force] --json` returns `exited`: `false`, still running after 15 s, is
not an error. `goldfinger stop` stops the daemon
every agent shares, staling all snapshots and ending all sessions; run it only as the errors say.

## Targets and staleness

- `k7.12:4` is the node whose `index` is 4 in snapshot `k7.12`, not `tree[4]`: nodes without
  an `index` (the window itself, labels) sit in `tree` too. Prefer element targets, which stay
  valid while their element exists, even if the window moves.
- `k7.12@640,210` is a pixel of that snapshot's PNG, so the observe needed `--screenshot`: a PNG
  pixel, never the screen points of a node's `frame`. It goes stale the moment its window moves
  or resizes. Inside a `batch`, `step0:4` targets an earlier step's observe (see Batch).
- In Chromium and Electron apps, a pixel click into web content may not land and a scroll may be
  dropped, with no error. Target web content by element, and observe to confirm.
- From 0.5.0, a single left click into web content of a background app outside the Chromium family
  (Safari, or any app built on WebKit) is refused `background_unavailable`, with nothing sent:
  a `click` without `--double` or `--right`, an element's mouse fallback, and the click that
  focuses a pixel target for `type` and `keys`. Such content takes a first click only in the
  active app. Target an element whose press lands; `--double` does land.
- A target is never guessed. It is `stale_snapshot` when its snapshot was evicted (8 are kept per
  window, 64 in all) or is an earlier daemon's, its window has closed, or its element is gone.

## Window frames and the clipboard

These take no target and no `--observe`; the clipboard verbs need no grant and reach no app.

- `goldfinger window-frame <window_id> <x>,<y>,<w>,<h> --json` moves and resizes a window, in
  whole points from the top left of the primary display, as `windows` reports frames: `x` and
  `y` at least 0, `w` and `h` at least 1, else `usage`. So a window left of or above the primary
  display (a negative `x` or `y` in `windows`) cannot be framed there. It returns
  `{"frame": {"x", "y", "width", "height"}, "warnings": []}`, `frame` being the window server's
  read-back once it matched the request within 2 points, never the request, as `windows` reports.
- `goldfinger clipboard read --json` returns the plain text as `{"text": "…"}`, or `{}` when the
  clipboard holds no plain text or an empty string. It holds no 1 s guard, but may put the
  platform's paste alert in front of the user, which is not background: read it only when the
  task needs it. A denied read is an error, never an empty clipboard.
- `goldfinger clipboard write --json [--] <text>` replaces everything on the clipboard with that
  plain text (empty is `usage`) and returns `{"warnings": []}`. What the user had copied is gone,
  and `clipboard read` can save and restore only plain text: write only when the task needs it.

## Menus and drag: the foreground verbs

`menu` and `drag` run only with `--foreground`, else they fail `background_unavailable`. With
it, goldfinger activates the target's app for the action alone, which may raise its window, then
restores the app frontmost before, even when the action failed. The user sees a brief switch and
loses focus that long: use these only where no background verb reaches. Neither takes `--observe`.

- `goldfinger menu <pid> "<path>" --foreground --json` presses an item in the menu bar of app
  `pid`. The path is titles from the menu bar down, joined by `>` and quoted, or the shell takes
  `>` as a redirect: `"File>Export…"`, `"Edit>Find>Find…"`. Each segment matches one title
  exactly, case and spaces included (a title's `…` is usually one character, not three dots),
  and the first match is taken; an empty path or segment is `usage`. Only the last item is
  pressed, without opening the menus above it. `menu` names no window: find the app's with
  `windows --pid`, and observe the effect.
- `goldfinger drag <from> <to> --foreground --json` presses the left button at `from`, drags in
  a straight line to `to` and releases there, its events sent to the app as `click`'s are, so the
  mouse pointer stays where it is. `from` and `to` are targets in one window, aimed as `click`
  aims: an element at its visible centre, a pixel at its point. A control that tracks a press in
  its own loop may ignore the drags while the verb succeeds: check with `observe`, and set a
  slider with `set-value`.
- **Result:** `{"warnings": [], "activated": {…}, "restored": {…}}`: the apps brought to the
  front and put back, as `pid`, `bundle_id` and `name`, both omitted when the target's app was
  already frontmost, and `restored` alone omitted when no app was frontmost before or with
  `restore_failed`. After activation was asked for, an error's message ends saying which app was
  activated and whether the one before was restored.

## Hover: the mouse pointer, held and put back

From 0.5.0, `goldfinger hover <target> [--hold <seconds>] [--click <index>] [--observe] --json`
puts the mouse pointer on the target, holds it there, then puts it back, so what a window shows
only under the pointer shows in a background app. It is the one verb that moves the pointer, and
otherwise a background action: no app activated, no window raised, no `--foreground` (`usage`).
It aims as `click` aims, an element at its visible centre and a pixel at its point, and returns
`{"warnings": [], "observe"?: {…}}`.

- **The hold** is `--hold` seconds, 0.1 to 5, default 1, then the 1 s guard. The hover ends when
  the pointer goes back, so whatever needs it runs inside the hold, in this order:
  - `--click <index>` observes the window, then presses that observe's element `<index>` as
    `click` presses an element. Learn the index from a first `hover <target> --observe`: an
    element the hover reveals has no index in an observe taken without it, and Chromium can drop
    it when the hover ends, so a target from the first hover's snapshot can be stale by the
    second. An index past that observe's last is `invalid_target`.
  - `--observe` observes the window while the pointer is still there, after `--click`'s press.
- **Refused before the pointer moves** (`action_failed`): an element with no visible part; a point
  another window would take the mouse at (the message names it), or no window at all, as with the
  target's window off screen: move one with `window-frame`; a mouse button held down.
- **The user's mouse.** A pointer moved off the point during the hold, or a button held at its
  end, is left where it is, with `hover_interrupted` in `warnings`: what ran inside the hold may
  have run without the hover. Otherwise the pointer ends within 1 pt of where it was. One resting
  anywhere but over another window goes there and back by way of the menu bar, 0.15 s each way,
  so the background app sees it arrive.
- **What responds**, on macOS: Chromium web content (`:hover`, `mouseover`) and AppKit areas that
  track the mouse whatever app is active. WebKit content, areas live only in the active app or
  key window, and tooltips get nothing. The verb cannot tell, and succeeds: read it in `--observe`.
- It is no `batch` step. MCP's `hover` takes `target`, `hold` (a number), `click` (an integer)
  and `observe`.

## Batch

`goldfinger batch` reads at most 10 steps, a JSON array on stdin, and runs them in order,
stopping at the first that fails. A step is `{"verb", "args"}`: `click`, `type`, `keys`, `scroll`
or `set-value`, with its arguments as snake_case JSON (`target`, `text`, `combos`, `direction`,
`lines`, `value`, `right`, `double`, `observe`). A step with `"observe": true` lets a later one
target `step<k>:<index>`, an element of step `k`'s observe, `k` counted from 0; its index is the
one that element has in the UI step `k` leaves, known from an earlier observe of that state:

```
printf '%s' '[{"verb": "click", "args": {"target": "k7.12:4", "observe": true}},
  {"verb": "click", "args": {"target": "step0:2"}}]' | goldfinger batch --json
```

It returns an entry per step that ran, `{"step": 0, "ok": true, "result": {…}}`, and a failed
step's `{"step": 1, "ok": false, "error": {…}}` is always the last. A bad array (empty, over 10
steps, another verb, `session` in a step's args, a reference to a step not earlier or without
`observe`) is refused whole as `usage`, with nothing sent. The batch has one 20 s limit; a session
cursor's glide adds up to 0.75 s a step: turn it off for a long batch (`session cursor <id> off`,
or MCP's `session-cursor` with `cursor: false`).

## Sessions

A session marks an agent's calls as its own, and its cursor shows the operator where it acts.

- `goldfinger session start [--idle-timeout <seconds>] --json` returns `{"session": "k7.s1",
  "color": "orange", "idle_timeout": 300, "cursor": true}`. Pass `--session <id>` on each call
  that belongs in it (one without runs in no session): every command takes it but the `session`
  verbs, `serve` and `mcp`, and `record` and `glide` require it.
- `goldfinger session end <id> --json` ends it, `goldfinger session list --json` lists the live
  ones, and `goldfinger session cursor <id> on|off --json` shows or hides its cursor, on from the
  start: for a session without one, run `off` right after `session start`.
- **The cursor**, an arrow in the session's colour drawn in front of the window acted in (main
  display only), glides to where each action aims before it runs; from 0.5.0 it then tracks a
  `drag` from `from` to `to`, and stays there. It is not the mouse pointer, and clicks pass
  through it.
- `goldfinger glide <target> --session <id> --json` (0.5.0) glides that cursor to where an action
  on the target would aim, and sends nothing to the app: for a demo or a recording, to show where
  the agent will act or what it reads. Without `--session` it is `usage`; with the cursor off it is
  `ok` and nothing moves. It returns `{"warnings": []}` once the cursor arrives, taking the glide's
  0.25–0.75 s and no 1 s guard; it takes no `--observe` and is no `batch` step. An element with no
  visible part or position is `action_failed`, the cursor unmoved; an ended session `not_found`.
  MCP's `glide` takes `target` alone, in the connection's session.
- **The end.** A session idles out when no call has carried its id for its idle timeout (default
  300 s, 1 to 86,400; `session list` does not count), and every daemon exit (`stop`, `setup`'s
  restart, a newer client) ends them all. An ended id is `not_found`, with nothing run. Six can
  be live, one per colour; a seventh `session start` is `session_limit`.

## Recording and replay

- `goldfinger record start --session <id> [--video] --json` records that session until
  `goldfinger record stop --session <id> --json`, the session's end or the daemon's. Both return
  the `trajectory`'s path, under `~/Library/Application Support/goldfinger/recordings/`
  (`<id>-<n>/trajectory.jsonl`), and with `--video` a `video` beside it, an MP4 of the main
  display (Screen Recording grant; one at a time); `record stop` adds `steps`, the lines written.
  Nothing is recorded unless `record start` ran, and nothing leaves the Mac.
- **Recorded:** every action (see The loop) that succeeded in that session, `batch` steps
  included, and from 0.5.0 `glide` and `hover`, with whichever it acted on of the app's bundle id,
  window title and element's role, title and tree path (or pixel point); a `hover --click` also
  keeps the pressed element's. Not reads, `launch`, `quit` or failures. Text and values are
  written verbatim, passwords included, to a file only the user can read.
- `goldfinger replay <file> [--session <id>] --json` does the steps again, in order, and returns
  `{"steps": 7, "warnings": []}`. Each finds its app by bundle id (launching it if none runs), its
  window by title, and its element by that role, title and path in a fresh observe, never a
  look-alike, as far as its step keeps them (a `menu` keeps no window, a `clipboard-write` no
  app); on an app replay launched, the observe and the re-find are retried for 10 s. A `menu` or
  `drag` activates its app again, as under `--foreground`. A `hover --click` re-finds its pressed
  element in the observe of the replayed hold, else `not_found` with nothing clicked, and a `glide`
  is skipped, uncounted, without `--session`. The first step that fails stops it, its error
  prefixed `step <k>: ` and not retryable, as a retry repeats the steps before. 0.3.0 replays only
  the loop's five actions, and 0.4.0 not `glide` or `hover`: a recording holding a step its
  version does not replay is refused whole (`usage`).

## MCP

`goldfinger mcp` serves the same client as an MCP server on stdio. Register it once, and its
tools appear in agent sessions started after that (in one already running, use the CLI):
`claude mcp add --scope user goldfinger -- goldfinger mcp` for Claude Code; for Codex,
`codex mcp add goldfinger -- goldfinger mcp` or a `[mcp_servers.goldfinger]` table in
`~/.codex/config.toml` with `command = "goldfinger"` and `args = ["mcp"]`.

Its tools are named as the socket verbs: `status`, `setup`, `apps`, `windows`, `observe`,
`launch`, `quit`, `click`, `type`, `keys`, `scroll`, `set-value`, `stop`, `window-frame`,
`clipboard-read`, `clipboard-write`, `menu`, `drag`, `batch` and `session-cursor`, 20 in 0.4.0,
then `glide` and `hover`, 22 from 0.5.0. Parameters are the snake_case socket args (`window_id`,
`max_nodes`, `new_instance`); `window-frame`'s `frame` is `{"x", "y", "width", "height"}`,
`batch`'s `steps` the array its stdin takes, `menu` and `drag` need `foreground: true`, and
`session-cursor` takes only `cursor`, a boolean. A result is what `goldfinger <verb> … --json`
prints for the same call, marked `isError` exactly where the CLI exits non-zero: an error, or a
`batch` whose last entry failed. Arrays (`apps`, `windows`, `batch`) come as text only; `observe`
with `screenshot` adds the PNG as an image. A client caps a result's size (Claude Code at
`MAX_MCP_OUTPUT_TOKENS`, 25,000 by default): pass `max_nodes` on a large window. The rest of
this skill applies, but not the CLI's syntax: no `--json`, no `--`, no exit code, and a flag like
`--observe` is a boolean parameter.

Each connection has its own session, started at the first call that needs one, started again once
it ends (an idle end, any agent's `stop`), and ended when the connection closes. `session-cursor`
shows or hides that session's cursor, and `cursor: false` carries into the sessions the
connection starts later. There are no other session tools, and no record or replay tools: use the
CLI, acting through it too while recording, as MCP calls stay in the connection's session. A call
that fails `session_limit` ran nothing: retry later. `setup` is a tool but stays the operator's.
After a `brew upgrade`, the agent's `goldfinger mcp` is the old client, and the new daemon answers
it `version_mismatch`: ask the operator to restart the agent. Do not call `stop`, which would cost
every other agent its daemon and still mismatch.

## Warnings

Actions return `"warnings": [...]`, usually empty. With each, the action happened: do not repeat it.

| Warning | Meaning |
|---|---|
| `app_self_activated` | An app activated itself during the action, and the app that was in front was put back. |
| `observe_failed` | Its `--observe` failed: run `observe` yourself. A later batch step that references it fails `stale_snapshot`. |
| `restore_failed` | A `--foreground` `menu` or `drag` acted, but the app frontmost before had quit or did not come back to the front within 1 s, so there is no `restored`. The target's app may still be in front and no verb brings the user's app back: tell the user. |
| `record_failed` | Its line could not be written, so replaying the recording skips that step. |
| `hover_interrupted` | Someone moved the mouse pointer off `hover`'s point during its hold, or held a button at its end, so it was left where it was: what ran inside the hold may have run without the hover, and its `observe` may not show what the hover reveals. Observe before another hover. |

## Errors: what to do

| Code | Do this |
|---|---|
| `permission_missing` | A grant is missing, which the message names: ask the operator to run `goldfinger setup`, and do not retry. |
| `not_found` | The pid, window or bundle id (`launch`) is gone, or the window has no accessibility tree (another desktop; for `window-frame`, no accessibility counterpart) or closed while `window-frame` moved it: list apps or windows again. An ended or idled-out session, its recording closed too: `session start`, and use the new id. `record stop` on a session not recording. `replay`: a missing file, or a step's app, window or element not found, a replayed `hover`'s pressed element included. `menu`: no menu bar, an item gone while the menus were walked, or a segment matching no item: fix the path from the titles the message lists. |
| `stale_snapshot` | Observe again, then act on the new snapshot. |
| `invalid_target` | Fix the target: a malformed id, an index past the snapshot, a pixel target without a screenshot or outside it, a pixel target for `set-value`, a `step<k>:` target outside a `batch`, a `drag` whose `to` is in another window than its `from`, or a `hover --click` index past the observe taken in its hold. |
| `background_unavailable` | Nothing was activated or sent. A `cmd` combo (a menu shortcut reaches only the active app): click the control, or press its menu-bar command with `menu … --foreground`. `menu` or `drag` without `--foreground`: add it, which switches the user's front app for the action. A mouse event this platform cannot aim into a background window: use an element target, another route, or ask the user; for a `drag` refused even with `--foreground`, no flag or target lifts it. From 0.5.0, a single click into background WebKit content (see Targets): target an element whose press lands. |
| `action_failed` | The app rejected the action or value: observe the state before another try. An element that needed mouse events has no visible part in its window (nothing sent): scroll it into view, observe again, act on the new snapshot. `window-frame`: the window is not movable or resizable (nothing written), a write was rejected (part may have landed), or the app or platform clamped it (a minimum size, a title bar kept below the menu bar), the message naming both frames: run `windows`. `clipboard read`, `clipboard write`: clipboard access is denied (nothing written), or the user refused the read at the paste alert: ask the operator to allow the setting the message names. A write refused after the clipboard was cleared left it empty, and says so. `menu`, `drag`: the app did not come frontmost within 1 s (nothing sent; the app before was put back if the focus moved). `menu`: nothing pressed, as the path ends at an item that opens a menu, like a menu bar title (end it at a command inside), or at a disabled one (it needs a state the app is not in, say a selection: observe, change it, press again). `record start`: its files or video would not start, or another session's recording has video. `hover`: the pointer did not move, as another window, or none, is at the point, a button is held, or the platform would not move it (see Hover); or its `--click` press failed as `click`'s does. `glide`: the element has no visible part or position, and the cursor did not move. |
| `usage` | Malformed arguments (exit 2): fix the call; `goldfinger --help` lists the verbs. Also a `record start` on a session already recording (that recording goes on), a refused `batch` (a step's own bad args fail only that step, after the ones before it ran), a `replay` file that is not a trajectory its version replays, a `glide` without `--session`, and before 0.5.0 `hover` and `glide` themselves. |
| `timeout` | Reads (`status`, `apps`, `windows`, `observe`, `clipboard read`, `session list`), `session cursor` and `glide` may be retried. Anything else may have landed and is not retryable: observe before repeating an action, list apps before a `launch` (it may still open), check a `window-frame` with `windows`, a `clipboard write` with `clipboard read` and a `session start` with `session list`. A `batch` timeout has no entries: observe before repeating any step. A `menu` timeout says whether it came while the menus were walked (nothing pressed) or at the press; after the press, observe the app's windows first. |
| `daemon_unavailable` | Retry when `retryable` is true. When the message says the action may have landed, check it as for `timeout` first: a `batch` may have run steps, a `record start` started a recording. |
| `version_mismatch` | Two goldfinger versions met. Use the newer `goldfinger`. `goldfinger stop` and a retry also clears it, but stops the daemon other agents share. |
| `session_limit` | All six session colours are held, so `session start` started nothing. End a session of yours, or wait for one to idle out, then retry. |

Trust `retryable`: it says whether repeating the same request is safe, never whether it worked.
