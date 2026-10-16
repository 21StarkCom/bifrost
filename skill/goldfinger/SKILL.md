---
name: goldfinger
description: "Operate desktop apps in the background with the goldfinger CLI: list apps and windows, observe a window's accessibility tree, then click, type, press keys, scroll or set a value, move or resize a window, and read or write the clipboard's text, without taking the user's focus; hover a target with the mouse pointer, held there and then put back, so hover-only UI shows; press a menu-bar command or drag, which briefly bring the app to the front; batch actions, record a session to replay it, take a full-resolution screenshot, and diagnose goldfinger itself with `goldfinger doctor`. Use when a task needs a native app that has no API, CLI or browser route, a menu-bar command, a drag or a hover in one, a window moved or resized, or the clipboard read or written; and before acting in a Chrome window, since Chrome page work goes to Huginn."
argument-hint: "[help]"
---

## Help

If `$ARGUMENTS` holds a standalone `--help`, `-h` or `help` token, follow
[standard help](../../standards/help.md), then stop.

# goldfinger

`goldfinger` gives an agent in any terminal background computer use. One daemon, shared by every
agent on the machine, holds the OS grants and does the work; every other command is a client that
starts it on demand (`stop`, `watch` and `doctor` without `--fix` never do). No verb activates an
app or raises a window but `setup` (interactive), `quit` of the frontmost app, and `menu` and
`drag` under `--foreground`, and only `hover` moves the mouse pointer, for its hold alone.
`click --right` activates nothing, but the menu it shows sits over every app and can bring
the clicked window in front of the user's, where it stays (see The loop). So the user keeps
working, but when any app activates during an action's 1 s guard, goldfinger puts back the app
that was in front, even over the user's switch.

This skill teaches 0.9.0: run `goldfinger --version` once before the first call. An older
goldfinger can fail calls written as this skill writes them with `usage`, or answer them
otherwise, so below 0.9.0 act on nothing: tell the user the task needs goldfinger 0.9.0
(`brew upgrade --cask goldfinger`, then `goldfinger doctor --fix` once, both theirs to run, as the
upgrade quits the daemon every agent shares).

## Arguments

No arguments: the work happens through `goldfinger` itself.

## Install, once

- **macOS:** the operator's, in the order goldfinger's README gives:
  `brew tap 21StarkCom/tap git@github.com:21StarkCom/homebrew-tap.git` (the tap is private, read
  over SSH), `brew install --cask 21StarkCom/tap/goldfinger`, which installs `Goldfinger.app` and
  puts `goldfinger` on `PATH`, then `goldfinger doctor --fix`, which starts the daemon and
  Goldfinger Control and lists what is left. Linux is not built yet.
- **Grants:** the operator runs `goldfinger setup` once, in a terminal they watch: it asks for the
  Accessibility and Screen Recording grants, opens each settings pane in turn, and waits up to
  5 minutes for both, else fails `permission_missing`. It restarts the daemon, ending every live
  session. Ask the operator; never click a grant.
- **Check:** `goldfinger doctor --json` (see Diagnose), or `goldfinger status --json`, which shows
  `"permissions": {"accessibility": true, "screen_recording": true}`. Neither raises a prompt.

## Output

Pass `--json` on every call. Success prints the result itself, object or array; an error prints
`{"ok": false, "error": {"code", "message", "retryable"}}`. Exit `0` is ok, `1` an error, `2` a
usage error; a `batch` whose step failed exits `1` with its entries array, and a `doctor` whose
check failed exits `1` with its report, neither an error object.
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
   1,568 px). `--max-nodes <n>` caps the walk (1–2,000). A walk the node limit cut (2,000 nodes,
   or `--max-nodes`) returns `"truncated": true`, after the whole `tree` as `--json` sorts the
   keys, and prints `observe: tree cut at <n> nodes` on stderr; a walk it did not cut has
   neither. A cut tree is not the whole window, so a node missing from it may still be there.
   Nor is every uncut one: the walk takes nothing past level 25 (a group or scroll area counts as
   no level), and that limit never sets `truncated`.
   - **A node that gives no answer.** The first node below the window that answers nothing within
     5 s is left out, with every node it holds, and the walk goes on: the result says
     `"unanswered": true` (after any `truncated`) and prints `observe: a node gave no answer
     within 5 s and is left out, with what it holds` on stderr. A web view whose page shows a
     JavaScript `alert`, `confirm` or `prompt` answers nothing until the dialog closes, while the
     window and the dialog's sheet do: the sheet's buttons and field are indexed and the page's
     content is missing. Such a walk takes 5 s longer. A second node that gives no answer, or the
     window itself, fails the walk `timeout`.
   - **A suspended web page.** WebKit suspends a web view's page a few seconds after its window
     shows, if the window is fully covered and no accessibility client has read the page yet.
     Such a web view is an empty group to `observe`, with no web area, and `find` is `not_found`
     on its window. goldfinger's reads do not wake the page: its content shows again once the app
     next runs the page, as when the window comes into view or the app calls into the page. A
     page read before it was suspended stays readable while covered.
   When the tree is cut and the element you need is in web content (a browser page, an Electron
   app, a web view), use `find` instead of observing again: `goldfinger find <window_id>
   [--role <role>] [--text <text>] [--limit <n>] --json` (from 0.9.0 on) searches the window's
   web areas with the engine's own search, which reaches elements past observe's 2,000-node limit.
   It searches web content only: a native window (Finder, a SwiftUI app) holds no web area and is
   `not_found`, as AppKit offers no search, so there use `observe` with `--max-nodes`, or act
   through the app's own UI.
   - It needs `--role`, `--text` or both, else `usage`. A role is matched as `observe` names it
     (`button`, `link`, `statictext`). The text is matched against the element's own `title` or
     `value`, ignoring case; give a text that starts with `-` as `--text=-x`.
   - With `--text`, an element inside another match is left out, so a list item and its own text
     come back as one match: in Safari the list item (`group = "Item 2500"`), in Chrome Canary
     the text (`statictext = "Item 2500"`).
   - It returns `{snapshot, window_id, pid, frame, matches: [{index, role, title?, value?,
     frame}]}`, matches in page order. That is a new snapshot: every match has an index, whether
     or not `observe` would give it one, so act on it as `<snapshot>:<index>` (`click k7.13:0`).
   - `--limit` is 50 by default, from 1 to 2,000. More matches add `"truncated": true` after
     `matches` and print `find: matches cut at <n>` on stderr.
   - The snapshot has no screenshot, so it takes no pixel targets, and its matches keep no tree
     path: a recorded action on a find target writes no line and is `record_failed`.
   `--ocr` (from 0.9.0 on) also reads the window's text from its pixels, with Apple's Vision on
   the Mac, for text the tree does not hold (custom-drawn lists, canvases, images of text). It
   takes the screenshot, needing the Screen Recording grant too, and adds `ocr`:
   `[{text, box, target}]` in reading order, rows top to bottom and each row left to right. `box`
   is in the PNG's pixels, and `target` is the entry's text target, `<snapshot>:t<n>` (see Targets
   and staleness). It lists at most 500 entries, and adds `"ocr_truncated": true` when it cut the
   list. `--ocr-region <x>,<y>,<w>,<h>`, in points from the window's top-left, reads only that
   part; boxes and targets stay in the whole PNG's pixels. It reads `en-US` alone: other scripts
   come back as confident false Latin text, and a lone digit after a word can read as a letter
   (`row 0` as `row O`), and a `C` as the Cyrillic `С`. `⌘` can read as nothing or as one or two
   other characters (`Save ⌘S` as `Save 9S` or `Save 3tS`), and an emoji as nothing or as one or
   two (`Ship it 🚀` as `Ship it` or `Ship it P`); text turned to run vertically is not read; and
   at 7 pt and under, a letter or two of a word can misread (`Seven point` as `Seven poins`). It
   gives no confidence: check what matters against the tree or the PNG.
   The first `--ocr` after a goldfinger install, a macOS update or a purge of Vision's cache
   compiles Vision's model, about 35 s alone and minutes behind other compiles, past the verb's
   20 s limit: that call fails `timeout`, the compile runs on, and `--ocr` fails `timeout` at once
   until it ends. Observe with `--ocr` again a minute later. Anything else meanwhile, a plain
   `observe` included, runs as usual. It reads print too small to see in the PNG, secrets
   included, and your host may keep the text in its transcripts: read only windows the task
   needs. The daemon keeps it in memory with its snapshot alone, never on disk or in its log.
   `--detect` (from 0.9.0 on) also finds controls in the window's pixels, with a detection model
   the app ships, for a control the tree, the screenshot and `--ocr` all miss, as an icon-only
   button an app draws with no accessibility element: `goldfinger observe <window_id> --detect
   --json`. It takes the screenshot, needing the Screen Recording grant too, goes with `--ocr`,
   which runs first, and adds `detections`: `[{box, score, target}]` in reading order, rows as
   `--ocr` builds them. It lists at most 300 entries, and adds `"detections_truncated": true` when
   it cut the list. Text mode prints a `detect <target> <score>` line per entry after the tree and
   any `ocr` lines.
   - A detection is a `box` in the PNG's pixels, a `score` from 0 to 1 to 2 places, and a
     `target`, the pixel target of the box's centre (see Targets and staleness). It has no role,
     title or text: the model marks links, fields, rows and whole panels as well as controls, and
     a control can hold a box of its own inside a larger one. Tell which box is the control from
     the PNG, or from the tree and `--ocr` beside it.
   - Scores are low by design: every box over 0.05 is kept. Rank by score, but never read a score
     as a probability.
   - The model was trained on web pages. Of the tree's buttons, checkboxes, menu buttons and
     images at least 8 pt wide, a detection's centre fell in 0.87 of them in Chrome, 0.77 in
     System Settings, 0.67 in Slack and 0.65 in Finder. Never take a control for absent because
     no box covers it.
   - The model loads on the first `--detect`, not at the daemon's start: about 4 s after an
     install or an update, then about 0.1 s. A detection takes about 0.2 s, and 0.14 s warm. The
     daemon lets the model go 120 s after the last `--detect` (it holds 1.4 to 2.0 GB), so the
     next one loads again, fast. One detection runs at a time: one that passes its time fails
     `timeout` and runs on to finish, so call again; while it runs, another `--detect` fails
     `timeout` at once, and every other verb, a plain `observe` included, runs as usual.
   **Read an earlier snapshot again** (from 0.9.0 on): `goldfinger ocr <snapshot>
   [--region <x>,<y>,<w>,<h>] --json` reads the text of a snapshot `observe` took with
   `--screenshot` or `--ocr`, from the native-size capture the daemon keeps beside its PNG, and
   returns `{snapshot, ocr, ocr_truncated?}`, its entries as `--ocr` gives them. The pixels are the
   snapshot's, whatever the window shows now, moved, changed or closed.
   - `--region` is `--ocr-region`'s, in points from the window's top-left as it was observed.
   - The entries stay with the snapshot, numbered on from its last, so each `target` names one
     entry while the snapshot lives. A region the snapshot has already read (by `--ocr`, `ocr` or
     `find-text`; the whole window is one region) returns the same entries, numbers and all,
     without recognizing again.
   - It needs no grant, sends nothing, is not recorded, and its `timeout` is retryable. A
     snapshot the daemon no longer holds (8 per window, 64 in all) is `stale_snapshot`; one
     without a screenshot, `invalid_target`.
   **Find text** (from 0.9.0 on): `goldfinger find-text <snapshot> [--region <x>,<y>,<w>,<h>]
   --json [--] <text>` is `ocr`'s read, or the one the snapshot holds, kept to the entries whose
   text holds `<text>`, both lowercased with each run of whitespace made one space:
   `{snapshot, matches, ocr_truncated?}`, matches in reading order, `"matches": []` when none.
   An empty `<text>` is `usage`; the rest, errors included, is `ocr`'s. Act on a match's `target`:
   `observe <win> --screenshot`, `find-text <snapshot> --json -- Save`, then `click` the match's
   `target`. A `stale_snapshot` there means the window changed under you: observe again and
   repeat.
   For a picture alone,
   `goldfinger screenshot [<window_id>] --json` writes a PNG of the main display, or of that window,
   at its native pixels with no cap, and returns `{"path", "width", "height"}`: a read under the
   Screen Recording grant, whose pixels no target names, in a file that is yours to delete.
3. **Act on a target from that snapshot:**
   - `goldfinger click <target> [--right] [--double] --json`: an element gets its app's own press
     (`--right`: its show-menu action), and only if the app rejects that do mouse events go to
     its aim point, the centre of its visible part.
     - **The aim is hit-tested.** The app's own hit test checks that centre: when it names another
       element of the target's window, neither the target nor inside it, the aim moves to the
       nearest point on a 5 by 5 grid over the visible part where it names the target or one
       inside it. With none, the click is `action_failed` ("no visible part of the target element
       is the element by the app's own hit test"), and nothing is sent: scroll it into view
       (`reveal`, for web content) and observe again, or target its pixels or its text. A hit
       test that names nothing (an app that does not implement it) or a table column leaves the
       centre. An app hit-tests only its front window at a point, so under a window of its own
       app the centre goes unchecked, and a frame the app misreports there can still send the events to another
       view. `scroll`, `drag` and `hover` aim the same way.
     - **`--right` raises.** The app shows its menu in a window over every app, and can order the
       clicked window in front of the frontmost app's, where it stays once the menu closes; the
       open menu can take the key window. Nothing is activated. That is the background
       guarantee's exemption for the menu `--right` shows (the Gauntlet spec's Operator approval
       ruling 8). A `click` or `keys` that fires an item, or `keys <target> escape`, closes the
       menu, and a pixel target inside the open menu goes to the menu's window.
   - `goldfinger type <target> <text> --json`: the text arrives exactly once
     - **WebKit fields** (an element in a `webarea` of an app outside the Chromium family) take
       the text over accessibility, as VoiceOver inserts it, never as keys: key events reach no
       background WebKit web content. So the page sees the text arrive with no key event, and a
       combobox that searches on `keyup` does not search. An element WebKit gives no text is
       `action_failed`, nothing sent: a date or time field (its parts are separate steppers), an
       element that is not editable, and a field holding text whose character count did not move.
     - **Native secure fields** (AppKit's and SwiftUI's password fields, outside web content, in
       an app outside the Chromium family) in a background app take the text as their value, and only while empty and
       being edited, the caret at the start; the caret must then read at the text's end. One that
       holds text, is not being edited or reports no selection, or whose caret did not reach the
       end is `action_failed`, with no keys sent, so typing again cannot double it. An empty
       WebKit password field that drops the insert takes the text as its value too.
   - `goldfinger keys <target> <combo>... --json`: combos such as `shift+tab` or `ctrl+a`,
     modifiers first and one key last. Modifiers are `shift`, `option`/`alt`, `ctrl`/`control`
     and `fn`; keys are `return`, `tab`, `space`, `delete`, `escape`, `up`, `down`, `left`,
     `right`, `home`, `end`, `pageup`, `pagedown`, `f1`–`f12`, `a`–`z` and `0`–`9`, nothing else
     (no `enter`, no `esc`). A `cmd` combo is refused with `background_unavailable`: click the
     control it would reach instead, or use `menu`. A dead key composes with the next combo, as
     typing them would: `option+e e` gives `é` under a U.S. or ABC input source, and before a
     combo that types no text of its own (`return`, `ctrl+a`) the accent is typed alone first. A
     dead key that is the last combo is sent as its own press, which the app may compose with the
     next key it gets.
   - `goldfinger scroll <target> up|down|left|right [lines] --json` (3 lines by default)
   - `goldfinger set-value <target> <value> --json`: element targets only, read back, compared.
     For a text field the read-back is its text, not the value its app makes of it: an AppKit
     field with a formatter reads back the text as written, so the verb is `ok`, and then rejects
     it, leaving its value empty (a field that takes 0 to 100, given 250). No accessibility read
     tells the two apart, so there `ok` means written and read back, not accepted.
4. **Observe again** once the UI may have changed, or add `--observe` to one of these five or
   `reveal` (not `launch` or `quit`) to get the window's new observe result back as `observe` in
   the same call. A cut one holds its `truncated` there, and prints no line on stderr.

Every action (these five, `reveal`, `window-frame`, `clipboard-write`, `menu`, `drag`, `hover`,
each `batch` step) and every `launch` takes at least 1 s, its guard.
`goldfinger quit <pid> [--force] --json` returns `exited`: `false`, still running after 15 s, is
not an error. `goldfinger stop` stops the daemon every agent shares, staling all snapshots and
ending all sessions; run it only as the errors say.

## Targets and staleness

- `k7.12:4` is the node whose `index` is 4 in snapshot `k7.12`, not `tree[4]`: nodes without
  an `index` (the window itself, labels) sit in `tree` too. Prefer element targets, which stay
  valid while their element exists, even if the window moves.
- `k7.12@640,210` is a pixel of that snapshot's PNG, so the observe needed `--screenshot`: a PNG
  pixel, never the screen points of a node's `frame`. It goes stale the moment its window moves
  or resizes. Inside a `batch`, `step0:4` targets an earlier step's observe (see Batch).
- An `observe --detect` entry's `target` (from 0.9.0 on) is such a pixel target, at its box's
  centre: click it as any pixel target. Unlike a text target, it is never checked against the
  pixels: a scroll inside the window leaves it on its old point, over whatever is there now, and
  it goes stale only as a pixel target does. Observe again after anything that may move content.
- `k7.12:t4` (from 0.9.0 on) is a text target: entry 4 of the text read in that snapshot, the
  `target` that `observe --ocr`, `ocr` and `find-text` give each entry. It acts as a pixel target
  at its box's centre, so `click`, `type`, `keys`, `scroll`, `hover`, `drag` and `batch` steps take
  it, but first goldfinger captures the window and checks that the entry's text still shows at
  that point, all before anything is sent:
  - text that moved (a scroll inside the unmoved window) or changed is `stale_snapshot`, as is a
    window that moved or resized: observe again;
  - a check that cannot run is `timeout`, retryable on any verb: a recognition still running, the
    check past its 3 s, or too little of the verb's 20 s left (it keeps the last 2 s). A capture
    or recognition that fails is `action_failed`;
  - it needs the Screen Recording grant too, else `permission_missing`;
  - an entry past the snapshot's text is `invalid_target`, and so is a text target for
    `set-value` or `reveal`, as a pixel target is.
  The pixel target of the box's centre, `<snapshot>@<x + ⌊w/2⌋>,<y + ⌊h/2⌋>`, acts unchecked, when
  you mean whatever is there now. A plain pixel target is never checked: a scroll inside the window
  leaves it on its old point, over whatever is there now. Observe again after anything that may
  move content.
- In Chromium and Electron apps, a pixel click into web content may not land and a scroll may be
  dropped, with no error. Target web content by element, and observe to confirm. Only each
  window's active tab has a web tree: a background tab's page is not in its window's `observe`
  until that tab is the active one, and the next `observe` then holds it (measured on Chrome
  Canary: goldfinger's browser DOM spec, probe P4). A tree with no `webarea` node does not mean the
  page is empty. The first `observe` of such an app waits for the app to build its web tree, at
  most 4 s, and returns a partial tree when the build takes longer: observe again. Read a
  background Chrome tab through Huginn (below), but not while the operator types in that Chrome:
  wait, or ask them. In another Chromium browser, an element `click` on the tab makes it the
  active one, as probe P4 did, and changes the tab the operator sees.
- While the Mac is locked, apps show goldfinger no windows: a window has no accessibility
  counterpart, so `observe` answers `not_found`, its message ending `; the screen is locked, and
  apps show goldfinger no windows until it is unlocked`, as does a `replay` step's window or
  element lookup. `window-frame` answers the same `not_found` without the clause, its message
  saying the window may be on another Space. An element target taken before the lock is
  `stale_snapshot` (Chrome Canary, probe P4). Only the operator can unlock: tell them, and wait.
  The first `observe` after the unlock has the tree.
- A single left click into web content of a background app outside the Chromium family (Safari or
  any other app built on WebKit, and Firefox too, as the tree names no engine) is refused
  `background_unavailable`, with nothing sent: a `click` without `--double` or `--right`, an
  element's mouse fallback, and the click that focuses a pixel target for `type` and `keys`. Such
  content takes a first click only in the active app. Target an element whose press lands.
  `--double` lands too, but as a double click (two clicks and a `dblclick`), never a stand-in for
  a single one: it toggles a checkbox twice.
- **Out of view: `reveal`** (from 0.9.0 on). No action scrolls to its target on its own, so a
  `click` (or another action that needs mouse events) on an element with no visible part fails
  `action_failed`, nothing sent. `goldfinger reveal <target> [--observe] --json` then scrolls that
  element into view, in the background like every action, with the scroll-to-visible action its
  app offers, and returns `{"warnings": [], "frame": {…}}`: reveal it, then act on it.
  - Element targets only: a pixel or text target is `invalid_target`.
  - Web content offers the action, in Safari (WebKit) and in the Chromium family, though not on
    every web element. A native element offers none, so on one (a Finder row) `reveal` is
    `action_failed`, saying the element offers no scroll-to-visible action, and nothing scrolls:
    `scroll` a native scroll view instead.
  - `frame` is where the scroll left the element, read after the action's 1 s hold. It is left
    out when the element no longer reports one, which is no error: the scroll happened. `reveal`
    judges nothing: the app decides how far it scrolls, and an element larger than its viewport
    cannot show whole.
  - It is recorded and replayed like `click`, and is no `batch` step.
- A target is never guessed. It is `stale_snapshot` when its snapshot was evicted (8 are kept per
  window, 64 in all) or is an earlier daemon's, its window has closed, or its element is gone. A
  web element whose parent no longer lists it as a child counts as gone, though it may still
  answer, as WebKit's does once its page hides it (`display: none`).

## Chrome: page work goes to Huginn

Chrome and Chrome Canary page work (reading a page, finding an element in it, opening or
navigating a tab, filling a form, a page screenshot) goes to Huginn, sleipnir's browser companion,
for every agent: `slp huginn <action> <uuid> --tab <id>` (each action needs its own grant, and a
mutation adds `--yes`), or the sleipnir MCP server's `huginn` and `huginn_batch` tools
(`confirm: true`), taught in sleipnir's `docs/huginn.md`. It does not go through goldfinger's tree
too: when `slp huginn list --json` shows no Huginn online for that Chrome, or the action has no
grant, ask the operator. goldfinger's
part in a Chrome window is a background element action, `click`, `type`, `keys` or `set-value`
on an element target, and the `observe` that finds that target or reads a Chrome the operator is
typing in (below). The rules below come from goldfinger's browser DOM spec
(`docs/specs/2026-10-01-goldfinger-browser-dom-spec.md`, in the goldfinger repo), and what they
call unmeasured waits on its probe P6.

**What a Huginn action does to the operator's focus and Chrome's windows**, as sleipnir's
`docs/huginn.md` gives it:

- **These do not activate Chrome:** its reads (`tabs`, `observe`, `find`, `read`, `screenshot`
  and the rest), `set-value`, `upload`, an insert-mode `type` (the default), `scroll` with `to`,
  `open` (a background tab) and `navigate`.
- **These activate Chrome:** pointer and key input (`click`, `hover`, `scroll` without `to`,
  `drag`, `gesture`, `key`), a keys- or compose-mode `type`, input guarded by an `origin`, and
  `audit-dropdown` first bring their tab to the front. It becomes its window's active tab, the
  window comes up, a minimized one back on screen, and Chrome takes the front from whatever the
  operator is using. From Huginn 0.45.0, `"inBackground": true` on `click`, `hover`, `scroll`,
  `drag`, `gesture`, `key` or `type` brings nothing forward (Chrome's focus emulation instead). It
  is refused with an `origin`, on `audit-dropdown` and while an older worker is loaded; agent
  sessions do not offer it, and a journey replays without it.
- **`focus`** makes the tab its window's active tab and brings that window to the front, a
  minimized one restored: it activates Chrome by design. **`resize`** makes the tab its window's
  active tab and sets the window's outer size, restoring a maximized window first: a binding
  (below) is made again.
- **The debugger bar.** Every action attaches Chrome's debugger but `tabs`, `open`, `focus` and
  `record` itself, and, outside a recording, `navigate` without `expect`, `close` and `resize`. A
  recording that keeps a workflow trace (`record start` with `trace`) or a demonstration holds the
  debugger between its actions too, until it stops. With Huginn 0.46.0's Quiet reads on (the
  operator turns it on in Huginn's popup), a plain `read` that reads by script attaches nothing;
  a frozen or discarded tab, a page Chrome keeps scripts out of, and a background tab in a Chrome
  before 132 are still read by the debugger. While attached, Chrome shows its "started debugging
  this browser" bar in every window of that Chrome, until 5 s after the last attachment ends. The
  bar shrinks the page by 56 CSS px without moving the window, and, showing or leaving, can take
  the page's keyboard focus: sleipnir saw that in 2 of 3 headed runs, and with Chrome behind other
  apps it is unmeasured.

**Sharing a Chrome window:**

- **One tool per Chrome window.** A window driven with Huginn takes no goldfinger action, and one
  driven with goldfinger no Huginn action, until the agent binds them. From Huginn 0.44.0 each
  `tabs` row carries its window's bounds (`window`: `left`, `top`, `width`, `height`, `state`, in
  screen points from the primary display's top left) and `browserPid`. Bind a Huginn tab to a
  goldfinger window only on a unique match: exactly one window in
  `goldfinger windows --pid <browserPid>` whose `frame` is those bounds, and no other window in
  Huginn's `tabs` with the same bounds. None, or more than one, is no binding, and so is a row
  with no `browserPid` or no `window` (an older worker's, or a window that closed); and whether
  the two tools report one window's bounds alike is unmeasured.
- **Never carry coordinates or refs between the tools.** A Huginn `ref` or `point` means nothing
  to goldfinger, and a goldfinger target or `frame` nothing to Huginn: each finds its own element.
- **No goldfinger pixel target in any window of a Chrome that Huginn drives**, by any agent: act
  there by element. A pixel target is never checked against what it showed: short of a lost
  snapshot or a closed window, it goes stale only when its window moves or resizes. Content that
  moves inside an unmoved window, as the bar moves it, leaves the target on its old point. The bar
  slides in again with each action, and no agent sees another's Huginn calls, so no wait makes a
  pixel target safe there. An element target reads its element's frame when it acts.
- **Observe again after a Huginn call** before acting in that window: the call may have changed
  the page, its active tab or its window's frame.
- **Keys near the bar.** Before goldfinger `keys` or `type` into a Chrome, wait about 6 s after
  your own last Huginn call in that Chrome: the bar closes 5 s after the last action, plus 1 s of
  margin. These count as a call still running: a `huginn_batch` until its lease ends (up to 5 s
  after its last step), a JavaScript dialog Huginn holds until it is answered (up to 120 s), and a
  recording with a trace or a demonstration until it stops. The wait covers only your own calls:
  another agent's Huginn read can take the page's keyboard focus at any time. So in a Chrome that
  Huginn drives, prefer `set-value`, or `type` by element, and observe after `keys`, which reads
  nothing back. Whether another agent's read takes the focus from goldfinger `keys` is unmeasured.
- **While the operator types in a Chrome,** read it by goldfinger's `observe`, not Huginn, whose
  bar can take their keyboard focus.

**Consent, security and extension UI.** Press no browser consent, security or extension UI with
goldfinger, in Chrome or any other browser: a site's permission prompt, the debugger bar's
Cancel, an extension's install or site-access prompt (turning Quiet reads on raises one), a
certificate or Safe Browsing warning, a password or passkey prompt. The daemon cannot tell that UI
from the UI an agent aims at, so the rule is yours: leave it to the operator. Change no browser
setting with goldfinger either.

## Window frames and the clipboard

These take no target and no `--observe`; the clipboard verbs need no grant and reach no app.

- `goldfinger window-frame <window_id> <x>,<y>,<w>,<h> --json` moves and resizes a window, in
  whole points from the top left of the primary display, as `windows` reports frames: `x` and
  `y` at least 0, `w` and `h` at least 1, else `usage`. So a window left of or above the primary
  display (a negative `x` or `y` in `windows`) cannot be framed there. It returns
  `{"frame": {"x", "y", "width", "height"}, "warnings": []}`, `frame` being the window server's
  read-back, never the request, as `windows` reports. It is `ok` once that read-back matches the
  request within 2 points, or when an app holds the window at a size of its own (its size steps,
  a minimum or a maximum): with the position matched and the size held, `frame` has the app's
  size, and `warnings` holds `frame_adjusted`.
- `goldfinger clipboard-read --json` returns the plain text as `{"text": "…"}`, or `{}` when the
  clipboard holds no plain text or an empty string. It holds no 1 s guard, but may put the
  platform's paste alert in front of the user, which is not background: read it only when the
  task needs it. A denied read is an error, never an empty clipboard.
- `goldfinger clipboard-write --json [--] <text>` replaces everything on the clipboard with that
  plain text (empty is `usage`) and returns `{"warnings": []}`. What the user had copied is gone,
  and `clipboard-read` can save and restore only plain text: write only when the task needs it.

## Menus and drag: the foreground verbs

`menu` and `drag` run only with `--foreground`, else they fail `background_unavailable`. With
it, goldfinger activates the target's app for the action alone, which may raise its window, then
restores the app frontmost before, even when the action failed. The user sees a brief switch and
loses focus that long: use these only where no background verb reaches. Neither takes `--observe`.

- `goldfinger menu <pid> "<menu_path>" --foreground --json` presses an item in the menu bar of
  app `pid`. The menu path is titles from the menu bar down, joined by `>` and quoted, or the shell
  takes `>` as a redirect: `"File>Export…"`, `"Edit>Find>Find…"`. Each segment matches one title
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

`goldfinger hover <target> [--hold <seconds>] [--click <index>] [--observe] --json` puts the
mouse pointer on the target, holds it there, then puts it back, so what a window shows only under
the pointer shows in a background app. It is the one verb that moves the pointer, and
otherwise a background action: no app activated, no window raised, no `--foreground` (`usage`).
It aims as `click` aims, an element at its visible centre and a pixel at its point, and returns
`{"warnings": [], "observe"?: {…}}`. The user sees their pointer leave and come back, and loses it
that long: hover only where UI shows under the pointer alone.

- **The hold** is `--hold` seconds, 0.1 to 5, default 1, then the 1 s guard. The hover ends when
  the pointer goes back, so whatever needs it runs inside the hold, in this order:
  - `--click <index>` observes the window, then presses that observe's element `<index>` as
    `click` presses an element. Learn the index from a first `hover <target> --observe`: an
    element the hover reveals has no index in an observe taken without it, and Chromium can drop
    it when the hover ends, so a target from the first hover's snapshot can be stale by the
    second. An index past that observe's last is `invalid_target`.
  - `--observe` observes the window while the pointer is still there, after `--click`'s press.
- **Refused before the pointer moves** (`action_failed`): an element with no visible part; a point
  another window would take the mouse at (the message names it: move one of them with
  `window-frame`), or no window at all, as with the target's window off screen or a point on no
  display; a hit test unanswered within 2 s; a mouse button held down. A pointer the platform
  will not move is `action_failed` too, its message saying where it was left.
- **The user's mouse.** A pointer moved off the point during the hold, or a button held at its
  end, is left where it is, with `hover_interrupted` in `warnings`: what ran inside the hold may
  have run without the hover. Otherwise the pointer ends within 1 pt of where it was. One resting
  anywhere but over another window goes there and back by way of the menu bar, 0.15 s each way,
  so the background app sees it arrive. A target window that covers that menu-bar point, as a
  full-screen one does, is hovered straight, and may not see the hover.
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
cursor's glide adds up to 0.75 s a step: turn it off for a long batch
(`session-cursor --session <id> off`, or MCP's `session-cursor` with `cursor: false`).

## Sessions

A session marks an agent's calls as its own, and its cursor shows the operator where it acts.

- `goldfinger session-start [--idle-timeout <seconds>] --json` returns `{"session": "k7.s1",
  "color": "orange", "idle_timeout": 300, "cursor": true}`. Pass `--session <id>` on each call
  that belongs in it (one without runs in no session): every command takes it but
  `session-start`, `session-list`, `watch`, `doctor`, `serve` and `mcp`, and `glide`,
  `record-start`, `record-stop`, `session-end` and `session-cursor` require it.
- `goldfinger session-end --session <id> --json` ends it, `goldfinger session-list --json` lists
  the live ones, and `goldfinger session-cursor --session <id> on|off --json` shows or hides its
  cursor, on from the start: for a session without one, run `off` right after `session-start`.
- **The cursor**, an arrow in the session's color drawn in front of the window acted in (main
  display only), glides to where each action aims before it runs; it then tracks a `drag` from
  `from` to `to`, and stays there. It is not the mouse pointer, and clicks pass through it.
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
  Goldfinger Control's panel (see Diagnose). An id that is not live (ended, idled out, never started
  or an earlier daemon's) fails `session_not_live`, with nothing run: `session-start`, and use
  the new id. Six can be live, one per color; a seventh `session-start` is `session_limit`.

## Recording and replay

- `goldfinger record-start --session <id> [--video] --json` records that session until
  `goldfinger record-stop --session <id> --json`, the session's end or the daemon's. Both return
  the `trajectory`'s path, under `~/Library/Application Support/goldfinger/recordings/`
  (`<id>-<n>/trajectory.jsonl`), and with `--video` a `video` beside it, an MP4 of the main
  display (Screen Recording grant; one at a time); `record-stop` adds `step_count`, the step
  lines written. Nothing is recorded unless `record-start` ran, and nothing leaves the Mac.
- **Recorded:** every action (see The loop) that succeeded in that session, `batch` steps
  included, and `glide`, with whichever it acted on of the app's bundle id, window title and
  element's role, title and tree path (or pixel point); a `hover --click` also keeps the pressed
  element's. A text target is kept as its box centre's point, never its text, and replays there,
  unchecked. Not reads, `launch`, `quit` or failures. Text and values are written verbatim,
  passwords included, to a file only the user can read.
- `goldfinger replay <file> [--session <id>] --json` does the steps again, in order, and returns
  `{"step_count": 7, "warnings": []}`, the steps run. Each finds its app by bundle id (launching
  it if none runs), its window by title, and its element by that role, title and tree path in a
  fresh observe, never a look-alike, as far as its step keeps them (a `menu` keeps no window, a
  `clipboard-write` no app); on an app replay launched, the observe and the re-find are retried
  for 10 s. A `menu` or `drag` activates its app again, as under `--foreground`. A
  `hover --click` re-finds its pressed element in the observe of the replayed hold, else
  `not_found` with nothing clicked, and a `glide` is skipped, uncounted, without `--session`. The
  first step that fails stops it, its error prefixed `step <k>: ` and not retryable, as a retry
  repeats the steps before. A file that is no trajectory to the goldfinger replaying it is refused
  whole (`usage`), with nothing sent. One in trajectory format 1, whose line 1 holds
  `"trajectory": 1` in place of `"format"`, is refused so too, its message saying so: record it
  again.

## Diagnose: doctor, watch and Goldfinger Control

- **`goldfinger doctor --json`** checks the install its binary belongs to and prints one report,
  `{"checks": […], "fail_count", "warn_count"}`, with nine checks always in this order: `app`,
  `signature`, `notarization`, `path`, `daemon`, `versions`, `grants`, `orphans`, `control`. Each
  has `id`, `status` (`ok`, `warn`, `fail` or `skip`) and `summary`; one that warns, fails or skips
  may carry `remedy`, `{"kind": "auto" | "manual", "text"}`. Exit `0` when no check failed; `1`
  when one did, the report on stdout as on success, not an error object, so read `checks` either
  way; `2` for `usage` (an operand, `--session`, any flag but `--fix` and `--json`). It needs no
  grant, sends nothing to any app, and changes nothing: it starts, stops and replaces no daemon,
  asking it only `watch` and `status`. Give it a minute: it waits up to 30 s for a daemon that is
  starting or stopping, and reads a missing grant again 3 s later.
- **Run `goldfinger doctor --json` to diagnose** when goldfinger itself looks wrong: a
  `daemon_unavailable` or a read's `timeout` that comes back on retry, a `permission_missing`, a
  `version_mismatch`, or before you tell the user goldfinger is broken. `daemon` names a stuck
  daemon's reading and pid, `grants` a missing grant, `versions` a client and daemon apart.
- **Leave `--fix`, `setup` and the panel to a person.** Tell the operator each failing or warning
  check's `summary` and `remedy.text`, the `auto` ones as `goldfinger doctor --fix`, and run none
  of them yourself: `--fix` starts a daemon and registers and opens Goldfinger Control, `setup`
  restarts the daemon, and the manual remedies (`goldfinger stop`, `kill -9 <pid>`, a reinstall)
  stop or kill the daemon every agent shares, ending every live session.
- **`goldfinger watch --json`** prints the daemon's state as it changes, one object per line:
  `state` (`idle`, `working` or `exiting`), the verb `running` with its `elapsed` seconds,
  `waiting_count`, `main_age` and the live `sessions`, one line at once and one at least every
  2 s. It never queues behind a running verb, starts no daemon, holds no session and takes no
  `--session`; it runs until the daemon exits (exit `0`) or 25 s pass with no line (exit `1`,
  `daemon_unavailable`, also when no daemon runs), so end it once you have the line you need.
- **Goldfinger Control** is the menu bar app inside `Goldfinger.app`. Its icon shows whether the
  daemon is offline, idle, working or unresponsive; its panel, the verb running, the requests
  waiting and the live sessions, and a person's click there starts, stops, restarts or
  force-quits the daemon. It never starts one on its own. The panel is the person's: never press
  it with goldfinger. Its Stop, Restart and Force quit are daemon exits, which end every session
  and stale every snapshot: after one, a call fails `session_not_live` (start a new session) or,
  while the old daemon exits, `daemon_unavailable`. A Force quit kills the daemon mid-verb, so a
  `drag` can leave the mouse button held, a `hover` the pointer off its place, and a
  `--foreground` verb its app in front: observe before you act again.

## MCP

`goldfinger mcp` serves the same client as an MCP server on stdio. Register it once, and its
tools appear in agent sessions started after that (in one already running, use the CLI):
`claude mcp add --scope user goldfinger -- goldfinger mcp` for Claude Code; for Codex,
`codex mcp add goldfinger -- goldfinger mcp` or a `[mcp_servers.goldfinger]` table in
`~/.codex/config.toml` with `command = "goldfinger"` and `args = ["mcp"]`.

Its tools are named as the socket verbs: `status`, `setup`, `apps`, `windows`, `observe`,
`launch`, `quit`, `click`, `type`, `keys`, `scroll`, `set-value`, `stop`, `window-frame`,
`clipboard-read`, `clipboard-write`, `menu`, `drag`, `batch`, `session-cursor`, `glide`, `hover`
and `screenshot`: 23, with no `watch` or `doctor` tool (run those through the CLI). From 0.9.0
on, `find` is the 24th (`window_id` required; `role` and `text` strings; `limit` an integer),
`reveal` the 25th (`target` required, a string; `observe` a boolean), `ocr` the 26th (`snapshot`
required, a string; `region` an object) and `find-text` the 27th and last (`snapshot` and `text`
required, strings; `region` an object).
`screenshot` returns its path and no image: read the file. Parameters are the snake_case socket
args (`window_id`, `max_nodes`, `new_instance`); `window-frame`'s `frame` is
`{"x", "y", "width", "height"}`, and so are `observe`'s `ocr_region` and the `region` of `ocr` and `find-text`, `observe`'s `ocr` and `detect` booleans,
`batch`'s `steps` the array its stdin takes, `menu`'s path is
`menu_path`, `menu` and `drag` need `foreground: true`, and `session-cursor` takes only `cursor`, a boolean. A result is what
`goldfinger <verb> … --json` prints for the same call, marked `isError` exactly where the CLI
exits non-zero: an error, or a `batch` whose last entry failed. Arrays (`apps`, `windows`,
`batch`) come as text only; `observe` with `screenshot` adds the PNG as an image, and so does
`observe` with `ocr` or `detect`, whose entries are in `structuredContent.ocr` and
`structuredContent.detections`; `ocr` and `find-text` add
none. Not every model
sees that image: Codex 0.160.0 gives a model that calls MCP tools directly (gpt-5.5)
`structuredContent`, the result's JSON, in place of `content` wherever a result has both (all but
the arrays), while its code-mode models (gpt-6-astra) get the whole result. Without the image,
open the PNG at `screenshot.path` with the client's own image tool (Codex's `view_image`) while
its snapshot is kept (see Targets and staleness), as eviction deletes the file. A client caps a
result's size (Claude Code at `MAX_MCP_OUTPUT_TOKENS`, 25,000 by default): pass `max_nodes` on a
large window. An `observe` the node limit cut adds its `observe: tree cut at <n> nodes` line as a
second text block, beside the result's `truncated: true`; an action with `observe: true` adds no
such block, its `observe` holding the key alone. A `find` cut at its limit adds its
`find: matches cut at <n>` line the same way. The rest of this skill applies, but not the
CLI's syntax: no `--json`, no `--`, no exit code, and a flag like `--observe` is a boolean
parameter.

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
| `record_failed` | Its line could not be written, so replaying the recording skips that step. An action on a `find` target always gets it, as its match has no tree path to replay. |
| `hover_interrupted` | Someone moved the mouse pointer off `hover`'s point during its hold, or held a button at its end, so it was left where it was: what ran inside the hold may have run without the hover, and its `observe` may not show what the hover reveals. Observe before another hover. |
| `frame_adjusted` | `window-frame` put the window at the position asked for, but its app holds it at another size (its size steps, a minimum or a maximum), so `frame` has that size, not the one asked for: work with the size in `frame`. A replayed `window-frame` adds it to replay's `warnings` the same way. |

## Errors: what to do

| Code | Do this |
|---|---|
| `permission_missing` | A grant is missing, which the message names (`observe --detect` needs Screen Recording, as `--screenshot` and `--ocr` do, and so does an action on a text target; `ocr` and `find-text` need none): ask the operator to run `goldfinger setup`, and do not retry. |
| `not_found` | The pid, window or bundle id (`launch`) is gone, or the window has no accessibility tree (another desktop; for `window-frame`, no accessibility counterpart) or closed while `window-frame` moved it: list apps or windows again. A message ending `the screen is locked, …` (`observe`, `replay`): the Mac is locked, which only the operator can undo: tell them, and wait for the unlock (see Targets and staleness). A `replay` stopped there had already run its steps before `k`, and running the file again repeats them. `record-stop` on a live session that is not recording. `replay`: a missing file, or a step's app, window or element not found, a replayed `hover`'s pressed element included. `hover --click`: the observe in its hold found no window or tree, and nothing was clicked. `menu`: no menu bar, an item gone while the menus were walked, or a segment matching no item: fix the path from the titles the message lists. `find`: the window holds no web area, as a native one (Finder, a SwiftUI app) does, since AppKit offers no search, or its web engine offers no search: use `observe` (with `--max-nodes`), or act through the app's own UI. |
| `stale_snapshot` | Observe again, then act on the new snapshot. A web element its parent no longer holds counts as gone. A text target's text no longer shows at its point (a scroll, or the text changed), and nothing was sent; for `ocr` and `find-text`, the daemon no longer holds the snapshot. |
| `invalid_target` | Fix the target: a malformed id, an index past the snapshot, a pixel target without a screenshot or outside it, a text target past the snapshot's text, a pixel or text target for `set-value` or `reveal`, an `ocr` or `find-text` of a snapshot with no screenshot, a `step<k>:` target outside a `batch`, a `drag` whose `to` is in another window than its `from`, or a `hover --click` index past the observe taken in its hold. |
| `background_unavailable` | Nothing was activated or sent. A `cmd` combo (a menu shortcut reaches only the active app): click the control, or press its menu-bar command with `menu … --foreground`. `menu` or `drag` without `--foreground`: add it, which switches the user's front app for the action. A mouse event this platform cannot aim into a background window: use an element target, another route, or ask the user; for a `drag` refused even with `--foreground`, no flag or target lifts it. A single click into background web content outside Chromium, WebKit's or Firefox's (see Targets), a `hover --click` press's mouse fallback included: target an element whose press lands. |
| `action_failed` | The app rejected the action or value: observe the state before another try. An element that needed mouse events has no visible part in its window, or none its app's hit test names it at (nothing sent; see The loop): `reveal` it (web content, from 0.9.0 on; see Targets and staleness), then act on it; a native element has no such action, so `scroll` its scroll view, observe again and act on the new snapshot. `reveal`: the element offers no scroll-to-visible action, as no native element does, or the app rejected it; nothing scrolled. `type`: a WebKit field given no text (a date or time field, an element that is not editable, a field holding text whose count did not move), or a native secure field that holds text, is not being edited, or whose caret did not reach the text's end; no keys were sent. `window-frame`: the window is not movable or resizable (nothing written), a write was rejected (part may have landed), or no read-back matched: the platform held its position off the request (a title bar kept below the menu bar), or its frame kept changing, the message naming both frames: run `windows`. `clipboard-read`, `clipboard-write`: clipboard access is denied (nothing written), or the user refused the read at the paste alert: ask the operator to allow the setting the message names. A write refused after the clipboard was cleared left it empty, and says so. `menu`, `drag`: the app did not come frontmost within 1 s (nothing sent; the app before was put back if the focus moved). `menu`: nothing pressed, as the path ends at an item that opens a menu, like a menu bar title (end it at a command inside), or at a disabled one (it needs a state the app is not in, say a selection: observe, change it, press again). `record-start`: the session is already recording (that recording goes on: `record-stop` first), its files or video would not start, or another session's recording has video. `hover`: refused before the pointer moved, as another window, or none, is at the point, the hit test went unanswered, or a button is held; or the platform would not move the pointer, the message saying where it was left (see Hover); or its `--click` press failed as `click`'s does. `glide`: the element has no visible part or position, and the cursor did not move. `observe --ocr`, `ocr`, `find-text` and a text target's check (nothing sent): Vision failed, or a recognition abandoned at its 5 min ceiling still runs, which `goldfinger stop` clears: tell the operator before stopping the daemon every agent shares; for `ocr` and `find-text`, also the snapshot's native capture could not be read. `observe --detect` (no snapshot, nothing partial): the build ships no detection model ("this build has no detection model", refused before the walk), Core ML failed, or a detection abandoned at its 120 s ceiling still runs, which `goldfinger stop` clears: tell the operator first, as for `--ocr`. |
| `usage` | Malformed arguments (exit 2): fix the call; `goldfinger --help` lists the verbs. Also a refused `batch` (a step's own bad args fail only that step, after the ones before it ran), a `replay` file that is not a trajectory its version replays (format 1 included: record it again), a command that requires `--session` run without it (see Sessions), `find` with neither `--role` nor `--text` or a `--limit` outside 1–2,000, an `ocr` or `find-text` with a missing or malformed snapshot id or `--region`, a `find-text` whose text is empty once trimmed, and, when `goldfinger --version` is below 0.9.0, a call written as this skill writes it: tell the user the task needs goldfinger 0.9.0. |
| `timeout` | Reads (`status`, `apps`, `windows`, `observe`, `screenshot`, `clipboard-read`, `session-list`), `session-cursor`, `glide` and `reveal` may be retried; `observe --ocr` after a minute when it follows a first use (see The loop), or read a large window in parts with `--ocr-region`. `observe --detect` at once: a detection that passed its time (under 8 s and what is left of the verb's 20 s), one from an earlier request still running, or too little of the limit left; a slow first load runs on to finish, so the next call is warm. `find` may be retried too: a search past the 20 s limit keeps no snapshot. So may `ocr` and `find-text`, and any action whose text target's check timed out, which sent nothing (see Targets and staleness). Anything else may have landed and is not retryable: observe before repeating an action, list apps before a `launch` (it may still open), check a `window-frame` with `windows`, a `clipboard-write` with `clipboard-read` and a `session-start` with `session-list`. A `batch` timeout has no entries: observe before repeating any step. A `menu` timeout says whether it came while the menus were walked (nothing pressed) or at the press; after the press, observe the app's windows first. |
| `daemon_unavailable` | Retry when `retryable` is true (a `reveal` stays retryable once sent, as repeating it sets the same state). When the message says the action may have landed, check it as for `timeout` first: a `batch` may have run steps, a `record-start` started a recording. When it comes back on retry, run `goldfinger doctor --json` (see Diagnose). |
| `version_mismatch` | Two goldfinger versions met. Use the newer `goldfinger`. `goldfinger stop` and a retry also clears it, but stops the daemon other agents share. |
| `session_limit` | All six session colors are held, so `session-start` started nothing. End a session of yours, or wait for one to idle out, then retry. |
| `session_not_live` | The `--session` id is not live: never started, ended, idled out (its recording closed too) or an earlier daemon's. Nothing ran, and the same id fails again: run `goldfinger session-start`, and use the new id. |

Trust `retryable`: it says whether repeating the same request is safe, never whether it worked.
