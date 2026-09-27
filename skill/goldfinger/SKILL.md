---
name: goldfinger
description: "Operate desktop apps in the background with the goldfinger CLI: list apps and windows, observe a window's accessibility tree, then click, type, press keys, scroll or set a value without taking the user's focus or moving their cursor. Use when a task needs a native app that has no API, CLI or browser route."
argument-hint: "[help]"
---

## Help

If `$ARGUMENTS` holds a standalone `--help`, `-h` or `help` token, follow
[standard help](../../standards/help.md), then stop.

# goldfinger

`goldfinger` gives an agent in any terminal background computer use. A daemon holds the OS
grants and does the work; every other `goldfinger` command is a client that starts it on demand.
Nothing it does activates an app, raises a window or moves the hardware cursor, so the user keeps
working while you act.

## Arguments

No arguments. The skill teaches the CLI; the work happens through `goldfinger` itself.

## Install, once

- **macOS:** `brew install --cask 21StarkCom/tap/goldfinger`. It installs the helper app and puts
  `goldfinger` on `PATH`. Linux is not built yet.
- **Grants:** the operator runs `goldfinger setup` once, in a terminal they are watching. It asks
  for the Accessibility and Screen Recording grants, opens each settings pane in turn, and waits
  until both are allowed. It is interactive: ask the operator to run it; never click a grant
  yourself.
- **Check:** `goldfinger status --json` shows `"permissions": {"accessibility": true,
  "screen_recording": true}`. `status` never raises a prompt.

## Output

Pass `--json` on every call. Success prints the verb's result itself (an object or an array);
an error prints `{"ok": false, "error": {"code", "message", "retryable"}}`. Exit `0` is ok, `1`
an error, `2` a usage error. `--` ends the flags, so text that starts with `-` goes after it:
`goldfinger type k7.12:3 -- -x`.

## The loop: observe, act, observe

1. **Find the window.** `goldfinger apps --json` lists running apps (`pid`, `bundle_id`, `name`,
   `active`). `goldfinger windows [--pid <pid>] --json` lists windows front to back
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
     `shift+tab` or `ctrl+a`, modifiers first and one key last
   - `goldfinger scroll <target> up|down|left|right [lines] --json` (3 lines by default)
   - `goldfinger set-value <target> <value> --json`: element targets only; the value is read
     back and compared
4. **Observe again** before the next action once the UI may have changed. Add `--observe` to any
   action to get the window's new tree back as `observe`, in the same call.

Every action and every `launch` takes at least 1 s: goldfinger holds a guard that long to undo
an app that activates itself. `goldfinger quit <pid> [--force] --json` quits an app;
`goldfinger stop` stops the daemon.

## Targets and staleness

- `k7.12:4` is element 4 of snapshot `k7.12`. Prefer element targets: an element target stays
  valid while its element exists, even if the window moves.
- `k7.12@640,210` is a pixel in that snapshot's screenshot, so the observe needed `--screenshot`.
  A pixel target goes stale the moment its window moves or resizes.
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
| `not_found` | The pid, window or bundle id is gone, or the window has no accessibility tree (another desktop). List windows again. |
| `stale_snapshot` | Observe again, then act on the new snapshot. |
| `invalid_target` | Fix the target: a malformed id, an index past the snapshot, a pixel target without a screenshot or outside it, or a pixel target for `set-value`. |
| `background_unavailable` | This action cannot happen in the background (a `cmd` combo, menu-bar use, drag). Nothing was sent. Use an element target, another route, or ask the user. |
| `action_failed` | The app rejected the action or value. Observe to see the state before trying another way. |
| `usage` | Malformed arguments (exit 2). Fix the call; `goldfinger --help` lists the verbs. |
| `timeout` | A read (`status`, `apps`, `windows`, `observe`) may be retried. An action may already have landed, so observe before you repeat it. |
| `daemon_unavailable` | Retry when `retryable` is true. When the message says the action may have landed, observe first. |
| `version_mismatch` | Two goldfinger versions met. Use the newer `goldfinger`, or run `goldfinger stop` and retry. |

Trust `retryable`: it says whether repeating the same request is safe, never whether it worked.
