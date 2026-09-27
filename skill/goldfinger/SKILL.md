---
name: goldfinger
description: "Operate desktop apps in the background with the goldfinger CLI: list apps and windows, observe a window's accessibility tree, then click, type, press keys, scroll or set a value without taking the user's focus or moving their cursor. Use when a task needs a native app that has no API, CLI or browser route."
argument-hint: "[help]"
---

## Help

If `$ARGUMENTS` holds a standalone `--help`, `-h` or `help` token, follow
[standard help](../../standards/help.md), then stop.

# goldfinger

`goldfinger` gives an agent in any terminal background computer use. One daemon, shared by every
agent on the machine, holds the OS grants and does the work; every other `goldfinger` command is
a client that starts it on demand (`stop` never does). No verb moves the hardware cursor or raises
a window, and none activates an app except `setup`, which is interactive, and `quit` of the
frontmost app. So the user keeps working while you act, with one catch: when any app activates
during an action's 1 s guard, goldfinger puts back the app that was in front, and that includes
the user's own app switch.

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

## Errors: what to do

| Code | Do this |
|---|---|
| `permission_missing` | The daemon lacks a grant; the message names which. Ask the operator to run `goldfinger setup`. Do not retry. |
| `not_found` | The pid or window is gone, no installed app has the bundle id (`launch`), or the window has no accessibility tree (another desktop). List apps or windows again. |
| `stale_snapshot` | Observe again, then act on the new snapshot. |
| `invalid_target` | Fix the target: a malformed id, an index past the snapshot, a pixel target without a screenshot or outside it, or a pixel target for `set-value`. |
| `background_unavailable` | This action cannot keep the background guarantee: a `cmd` combo (a menu shortcut reaches only the active app), or a mouse event this platform cannot aim into a background window. Nothing was sent. For a `cmd` combo, click the control in the window's tree; otherwise use an element target, another route, or ask the user. Menu-bar commands and drag have no verb in this version. |
| `action_failed` | The app rejected the action or value. Observe to see the state before trying another way. |
| `usage` | Malformed arguments (exit 2). Fix the call; `goldfinger --help` lists the verbs. |
| `timeout` | A read (`status`, `apps`, `windows`, `observe`) may be retried. An action may already have landed, so observe before you repeat it; a `launch` may still open, so list apps first. |
| `daemon_unavailable` | Retry when `retryable` is true. When the message says the action may have landed, observe first. |
| `version_mismatch` | Two goldfinger versions met. Use the newer `goldfinger`. `goldfinger stop` and a retry also clears it, but stops the daemon other agents share. |

Trust `retryable`: it says whether repeating the same request is safe, never whether it worked.
