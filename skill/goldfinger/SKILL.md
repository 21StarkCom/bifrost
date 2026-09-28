---
name: goldfinger
description: "Operate desktop apps in the background with the goldfinger CLI: list apps and windows, observe a window's accessibility tree, then click, type, press keys, scroll or set a value, move or resize a window, and read or write the clipboard's text, without taking the user's focus or moving their cursor; or press a menu-bar command or drag, which bring the app to the front for that action alone. Use when a task needs a native app that has no API, CLI or browser route, a menu-bar command or a drag in one, a window moved or resized, or the clipboard read or written."
argument-hint: "[help]"
---

## Help

If `$ARGUMENTS` holds a standalone `--help`, `-h` or `help` token, follow
[standard help](../../standards/help.md), then stop.

# goldfinger

`goldfinger` gives an agent in any terminal background computer use. One daemon, shared by every
agent on the machine, holds the OS grants and does the work; every other `goldfinger` command is
a client that starts it on demand (`stop` never does). No verb moves the hardware cursor. None
activates an app or raises a window except `setup`, which is interactive, `quit` of the frontmost
app, and `menu` and `drag`, which run only with `--foreground`: they activate the target's app for
their action alone, which may raise its window, then make the app that was in front frontmost
again. So the user keeps working while every other verb acts, with one catch: when any app
activates during an action's 1 s guard, goldfinger puts back the app that was in front, and that
includes the user's own app switch.

## Arguments

No arguments. The skill teaches the CLI; the work happens through `goldfinger` itself.

## Install, once

- **macOS:** `brew install --cask 21StarkCom/tap/goldfinger`. The tap is private, so it needs
  `HOMEBREW_GITHUB_API_TOKEN` set to a GitHub token that can read 21StarkCom. It installs the
  helper app and puts `goldfinger` on `PATH`. Linux is not built yet.
- **Grants:** the operator runs `goldfinger setup` once, in a terminal they are watching. It asks
  for the Accessibility and Screen Recording grants, opens each settings pane in turn, and waits
  until both are allowed, for up to 5 minutes, then fails `permission_missing`. It is
  interactive: ask the operator to run it; never click a grant yourself.
- **Check:** `goldfinger status --json` shows `"permissions": {"accessibility": true,
  "screen_recording": true}`. `status` never raises a prompt.

## MCP

`goldfinger mcp` serves the same client as an MCP server on stdio, for an agent that would rather
call tools than run commands. It needs goldfinger 0.2.0 or later (`goldfinger --version`); an
older install fails it with `unknown subcommand "mcp"`. Register it once. Its tools appear in
an agent session started after that; in one already running, use the CLI:

- **Claude Code:** `claude mcp add --scope user goldfinger -- goldfinger mcp`.
- **Codex:** `codex mcp add goldfinger -- goldfinger mcp`, or add this block to
  `~/.codex/config.toml`:

  ```toml
  [mcp_servers.goldfinger]
  command = "goldfinger"
  args = ["mcp"]
  ```

The tools are thirteen of the verbs this skill teaches, `status` through `stop`, under the same
names; `window-frame`, `clipboard read`, `clipboard write` and the CLI's other verbs have no tool,
so run those with the CLI. Their parameters are the socket args, which are
snake_case (`window_id`, `max_nodes`, `new_instance`), and a tool's result is what
`goldfinger <verb> … --json` prints for the same call, errors included (marked `isError`): an
object, or for `apps` and `windows` an array, which comes as text only. `observe` with
`screenshot` also returns the PNG as an image. A client caps a result's size (Claude Code cuts
one off past `MAX_MCP_OUTPUT_TOKENS`, 25,000 by default), so pass `max_nodes` on a large window.
The rest of this skill applies, but not the CLI's own syntax: a tool takes no `--json` or `--`
and has no exit code, and a flag such as `--observe` is a boolean parameter.

Each MCP connection gets a session of its own: the server starts one when a call first needs
it, starts another when that one has ended (an idle end, any agent's `stop`), and ends it when
the connection closes. There are no session tools. A call that fails `session_limit` found
every session colour held and ran nothing: retry later. `setup` is a tool too, and it stays the
operator's to run, as "Install, once" says. After a `brew upgrade`, the agent needs a restart:
until then its `goldfinger mcp` is the old client, and the new daemon answers it
`version_mismatch`. So on a tool's `version_mismatch`, ask the operator to restart the agent.
Do not call `stop`: the next call starts the upgraded daemon again and still mismatches, and
every other agent has lost its daemon for nothing.

## Output

Pass `--json` on every call. Success prints the verb's result itself (an object or an array);
an error prints `{"ok": false, "error": {"code", "message", "retryable"}}`. Exit `0` is ok, `1`
an error, `2` a usage error. `--` ends the flags: every argument after it is an operand, `--json`
and `--observe` included. So text that starts with `-` goes after it, and the flags go before it:
`goldfinger type k7.12:3 --json -- -x`. A flag after `--` is a usage error, and one that was
`--json` leaves that error plain text on stderr.

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
   - `goldfinger keys <target> <combo>... --json`: combos such as `return`, `escape`,
     `shift+tab` or `ctrl+a`, modifiers first and one key last. Modifiers are `shift`, `option`
     or `alt`, `ctrl` or `control`, and `fn`; keys are `return`, `tab`, `space`, `delete`,
     `escape`, `up`, `down`, `left`, `right`, `home`, `end`, `pageup`, `pagedown`, `f1`–`f12`,
     `a`–`z` and `0`–`9`, nothing else (no `enter`, no `esc`). A `cmd` combo is refused with
     `background_unavailable`: click the control it would reach instead.
   - `goldfinger scroll <target> up|down|left|right [lines] --json` (3 lines by default)
   - `goldfinger set-value <target> <value> --json`: element targets only; the value is read
     back and compared
4. **Observe again** before the next action once the UI may have changed. Add `--observe` to
   `click`, `type`, `keys`, `scroll` or `set-value` (not `launch` or `quit`) to get the window's
   new observe result, with its new `snapshot` and `tree`, back as `observe` in the same call.

Every action and every `launch` takes at least 1 s: goldfinger holds a guard that long to undo
an app that activates itself. `goldfinger quit <pid> [--force] --json` quits an app and returns
`exited`: `false` means it was still running after 15 s, which is not an error. `goldfinger stop`
stops the daemon every agent shares and makes every agent's snapshots stale, so run it only when
an error below calls for it.

## Window frames and the clipboard

These three verbs take no target and no `--observe`. They need goldfinger 0.2.0 or later
(`goldfinger --version`); an older install refuses them as an unknown subcommand, `usage`.

- `goldfinger window-frame <window_id> <x>,<y>,<w>,<h> --json` moves and resizes a window in the
  background: its app is not activated, the window is not raised and the cursor does not move.
  The frame is four whole numbers of points from the top left of the primary display, as
  `windows` reports frames: `x` and `y` at least 0, `w` and `h` at least 1; anything else is
  `usage`. So a window on a display left of or above the primary one, where `windows` reports a
  negative `x` or `y`, cannot be framed there. The result is
  `{"frame": {"x", "y", "width", "height"}, "warnings": []}`, and `frame` is the window server's
  read-back once it matches the request, never the request itself; a `windows` right after
  reports the same. It is `action_failed` when the window cannot be moved or resized (nothing is
  written), when the app rejects a write (part of the frame may have landed), or when the
  read-back does not match the request to within 2 points because the app or the platform
  clamped it (to a minimum size, or to keep a title bar below the menu bar); the message names
  both frames. Like every action it takes at least 1 s.
- `goldfinger clipboard read --json` returns the clipboard's plain text as `{"text": "…"}`. `text`
  is omitted (`{}`) when the clipboard holds no plain text, or an empty string. It needs no grant,
  sends nothing to any app and holds no 1 s guard, but it can put the platform's paste alert in
  front of the user for them to answer, which is not background: read the clipboard only when
  the task needs it. When the user has denied goldfinger clipboard
  access in the platform's settings, or refused the read at the platform's paste alert, it is
  `action_failed`, naming that setting: a denied read is an error, never an empty clipboard.
- `goldfinger clipboard write --json [--] <text>` replaces everything on the clipboard with that
  one plain-text string and returns `{"warnings": []}`. The clipboard is the user's: what they had
  copied is gone, and `clipboard read` can save and restore only its plain text, so write it only
  when the task calls for it. Put `--json` before the `--`, as Output
  says: after it, `--json` is an operand and the call is `usage`. Empty text is `usage`. It needs
  no grant and sends nothing to any app, but it is an action, so it takes at least 1 s. Denied
  clipboard access is `action_failed`, and nothing is written; a write the platform refuses after
  the clipboard was cleared is `action_failed` too and leaves the clipboard empty, which the
  message says.

## Menus and drag: the foreground verbs

`menu` and `drag` need goldfinger 0.2.0 or later (`goldfinger --version`); an older install
refuses them as `usage`, naming `--foreground` an unknown flag or the verb an unknown subcommand.
They run only with `--foreground`. Without it both fail `background_unavailable` and nothing is
activated or sent. With it, goldfinger activates the target's app for the action alone, which may
raise its window, acts, and then makes the app that was frontmost before frontmost again, even
when the action failed. The user sees a brief switch and loses their focus for that long, then
gets it back, so use these verbs only for what no background verb reaches. The hardware cursor
still never moves. Like every action, each takes at least 1 s. Neither takes `--observe`: observe
afterwards. Neither has an MCP tool, so run both with the CLI.

- `goldfinger menu <pid> "<path>" --foreground --json` presses an item in the menu bar of app
  `pid` (from `apps`). It is also the route for a `cmd` combo, which `keys` refuses: press the
  combo's menu-bar command. The path is titles from the menu bar down, joined by `>`:
  `"File>Export…"`, `"Edit>Find>Find…"`. Quote it: unquoted, the shell takes `>` as a redirect.
  Each segment matches one title exactly, case and spaces included (the `…` many titles end in is
  usually one character, not three dots), and the first item with that title is taken; an empty
  path or segment is `usage`. Only the last item is pressed, and the menus above it are not
  opened. A path that ends at an item that opens a menu (a menu bar title, or an item with a
  submenu) is `action_failed`, and so is a disabled item; nothing is pressed. A segment that
  matches nothing is `not_found`, and the message names the segment, where it was looked for and
  the titles there: copy the title from it. A `timeout` is not retryable; its message says whether
  it came while the menus were walked (nothing was pressed) or at the press. `menu` names no
  window, so after one at the press, find the app's windows with `windows --pid` and observe the
  command's effect before you repeat it.
- `goldfinger drag <from> <to> --foreground --json` is one left-button press at `from`, drags
  along the straight line to `to`, and one release there. The events go to the app as `click`'s
  mouse events do, never through the cursor, so the cursor never moves. `from` and `to` are
  targets under the rules below, each aimed as `click` aims: an element at its visible centre, a
  pixel at its point. Both must be in one window: a `to` in another window than `from` is
  `invalid_target`. A control that tracks a press in a loop of its own may take the press alone
  and ignore the drags while the verb still succeeds, so read the effect back with `observe`, and
  set a slider with `set-value`.
- **Result**, for both: `{"warnings": [], "activated": {…}, "restored": {…}}`. `activated` is the
  app goldfinger brought to the front and `restored` the one it put back, each as its `pid`,
  `bundle_id` and `name`. Both are omitted when the target's app was already frontmost, which is
  neither activated nor restored. `restored` alone is omitted when no app was frontmost before,
  and with the `restore_failed` warning. An error keeps its usual shape; once goldfinger has asked
  to activate the target's app, its message ends by saying which app was activated and whether the
  app frontmost before was restored.

## Targets and staleness

- `k7.12:4` is the node whose `index` is 4 in snapshot `k7.12`, not `tree[4]`: nodes without
  an `index` (the window itself, labels) sit in `tree` too. Prefer element targets: an element
  target stays valid while its element exists, even if the window moves.
- `k7.12@640,210` is a pixel of that snapshot's screenshot PNG, so the observe needed
  `--screenshot`. It is a PNG pixel, never the screen points of a node's `frame`. A pixel target
  goes stale the moment its window moves or resizes.
- In Chromium and Electron apps, a pixel click into web content may not land and a scroll may be
  dropped, with no error. Target web content by element, and observe to confirm.
- A target is never guessed. It is `stale_snapshot` when its snapshot was evicted (the daemon
  keeps 8 per window and 64 in all) or came from an earlier daemon, when its window has closed,
  or when its element is gone. Observe again and use the new snapshot's indexes.

## Warnings

Actions return `"warnings": [...]`, usually empty:

- `app_self_activated`: an app activated itself during the action, and the app that was in front
  was put back. The action still happened; do not repeat it.
- `observe_failed`: the action landed, but its `--observe` did not. Run `observe` yourself.
- `restore_failed`: a `--foreground` `menu` or `drag` acted, but the app that was frontmost before
  it had quit or did not come back to the front within 1 s, so the result has no `restored`. The
  action still happened; do not repeat it. The target's app may still be in front, and no verb
  brings the user's app back, so tell the user.

## Errors: what to do

| Code | Do this |
|---|---|
| `permission_missing` | The daemon lacks a grant; the message names which. Ask the operator to run `goldfinger setup`. Do not retry. |
| `not_found` | The pid or window is gone, no installed app has the bundle id (`launch`), or the window has no accessibility tree (another desktop; for `window-frame`, no accessibility counterpart). A window that closes while `window-frame` moves it is `not_found` too. List apps or windows again. For `menu`, the app has no menu bar, an item went away while the menus were walked, or a path segment matches no item: the message names the segment and the titles where it was looked for, so fix the path from those. |
| `stale_snapshot` | Observe again, then act on the new snapshot. |
| `invalid_target` | Fix the target: a malformed id, an index past the snapshot, a pixel target without a screenshot or outside it, a pixel target for `set-value`, or a `drag` whose `to` is in another window than its `from`. |
| `background_unavailable` | This action cannot keep the background guarantee: a `cmd` combo (a menu shortcut reaches only the active app), `menu` or `drag` without `--foreground`, or a mouse event this platform cannot aim into a background window. Nothing was activated or sent. For a `cmd` combo, click the control in the window's tree, or press its menu-bar command with `menu … --foreground`; `menu` and `drag` need `--foreground`, which switches the user's front app for the action. A `drag` refused even with `--foreground` met the mouse-event limit, which no flag or target lifts: use another route or ask the user. Otherwise use an element target, another route, or ask the user. |
| `action_failed` | The app rejected the action or value. Observe to see the state before trying another way. An element that needed mouse events has no visible part in its window (nothing was sent): scroll it into view, then observe again and act on the new snapshot. For `window-frame`, the window cannot be moved or resized (nothing was written), the app rejected a write (part of the frame may have landed), or its read-back did not match the request, clamped by the app or the platform: run `windows` to see where it went. For `clipboard read` and `clipboard write`, the user denied goldfinger clipboard access, or refused a `clipboard read` at the paste alert, and the message names the setting: ask the operator to allow it. A write the platform refused after clearing the clipboard left it empty, and the message says so. For `menu` and `drag`, the target's app did not come frontmost within 1 s: nothing was sent, and the app frontmost before was put back if the focus moved. For `menu`, nothing was pressed when the path ends at an item that opens a menu, such as a menu bar title: end the path at a command inside it; or at a disabled item: the command needs a state the app is not in (nothing selected, say), so observe, change that state, then press it again. |
| `usage` | Malformed arguments (exit 2). Fix the call; `goldfinger --help` lists the verbs. |
| `timeout` | A read (`status`, `apps`, `windows`, `observe`, `clipboard read`) may be retried. An action may already have landed, so observe before you repeat it; a `launch` may still open, so list apps first. No observe shows a `clipboard write`: check a lost `clipboard write` with `clipboard read`, and a lost `window-frame` with `windows`, before you repeat it. |
| `daemon_unavailable` | Retry when `retryable` is true. When the message says the action may have landed, observe first, or for a `window-frame` run `windows` and for a `clipboard write` run `clipboard read`. |
| `version_mismatch` | Two goldfinger versions met. Use the newer `goldfinger`. `goldfinger stop` and a retry also clears it, but stops the daemon other agents share. |

Trust `retryable`: it says whether repeating the same request is safe, never whether it worked.
