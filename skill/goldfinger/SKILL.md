---
name: goldfinger
description: "Operate desktop apps in the background with the goldfinger CLI: list apps and windows, observe a window's accessibility tree, then click, type, press keys, scroll or set a value, move or resize a window, and read or write the clipboard (its text, and from 0.10.0 on its rich text, HTML, image and files), without taking the user's focus; open files in an app, hide or show an app, minimize a window, and send an element an accessibility action such as increment or a custom action; hover a target with the mouse pointer, held there and then put back, so hover-only UI shows; read a Safari page's or a web view's whole text, and Safari's tabs; press a menu-bar command, drag, restore a minimized window or put one in full screen, which briefly bring the app to the front; batch actions, record a session to replay it, take a full-resolution screenshot or a fixed-scale capture, drive the real VoiceOver screen reader and read what it speaks, and diagnose goldfinger itself with `goldfinger doctor`. Use when a task needs a native app that has no API, CLI or browser route, a menu-bar command, a drag or a hover in one, a window moved or resized, the clipboard read or written, or an app heard through VoiceOver; and before acting in a Chrome window, since Chrome page work goes to Huginn."
argument-hint: "[help]"
---

## Help

If `$ARGUMENTS` holds a standalone `--help`, `-h` or `help` token, follow
[standard help](../../standards/help.md), then stop.

# goldfinger

`goldfinger` gives an agent in any terminal background computer use. One daemon, shared by every
agent on the machine, holds the OS grants and does the work; every other command is a client that
starts it on demand (`stop`, `watch` and `doctor` without `--fix` never do). No verb activates an
app or raises a window but `setup` (interactive), `quit` of the frontmost app, and `menu`,
`drag` and `window-state restore` under `--foreground`, from 0.13.0 on with `window-state
full-screen` and `perform … show-menu` under it too, from 0.15.0 on `voiceover start`, which
leaves its app frontmost until `voiceover stop`, and `voiceover stop`, which makes the app before
frontmost again, and only `hover` moves the mouse pointer, for its hold alone.
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
  session. Ask the operator; never click a grant. When a pane's list shows no Goldfinger, the
  operator adds the app with the `+` button under the list, then turns its switch on.
- **VoiceOver** (from 0.15.0 on): the `voiceover` verbs need VoiceOver's AppleScript control and
  the Automation grant for VoiceOver. The operator runs `goldfinger setup --voiceover` once, in a
  terminal they watch: it opens VoiceOver Utility, where they turn on "Allow VoiceOver to be
  controlled with AppleScript" with the admin password, then starts VoiceOver unless it runs,
  raises the Automation prompt, waits up to 5 minutes for each, and turns off the VoiceOver it
  started. It restarts nothing. `status --json` shows `voiceover_applescript` and
  `voiceover_automation`.
- **Safari** (from 0.13.0 on), the operator's too, and only for the Safari reads (see Page text
  and Safari's tabs): `goldfinger setup --safari`, run with Safari open, asks for the Automation
  grant for Safari alone and restarts nothing, so no session ends. `text --via apple-events` also
  needs Safari's own setting, Settings → Developer → "Allow JavaScript from Apple Events", and
  `--via extension` needs goldfinger's Safari extension turned on in Safari → Settings →
  Extensions and allowed on the page's site. No verb changes either: ask the operator.
- **Check:** `goldfinger doctor --json` (see Diagnose), or `goldfinger status --json`, which shows
  `"permissions": {"accessibility": true, "screen_recording": true}`. Neither raises a prompt.
  From 0.13.0 on, `permissions` also holds `safari_automation` (`granted`, `denied`, `not_asked`,
  which `setup --safari` asks, `not_running`, as macOS answers only for a running Safari, or
  `unknown`) and `safari_extension` (`enabled`, `disabled`, `not_installed` or `unknown`).

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
   - **Open files in an app** (from 0.11.0 on): `goldfinger open <path|url>... [--app <bundle_id>]
     [--new-instance] --json` hands files, or URLs whose scheme the app claims, to the `--app` app,
     else to the files' default app, never activating it, and returns `{pid, bundle_id, name,
     warnings, windows}`. `windows` holds the ids of the app's windows new since the open (from
     0.14.0 on, less the text input window that never shows: untitled, 500 × 500 at the main
     display's bottom-left corner), `[]` when the item went into a window it had or its window
     comes later: poll `windows --pid`. It needs no grant. The client checks each item first and
     refuses with `usage`, nothing sent: a web or network URL (`http`, `https`, `ssh`, `smb` and
     the rest: a web page is Huginn's work), a `file` URL (give the path), a URL without `--app`, a
     path under Desktop, Documents, Downloads, iCloud Drive, cloud storage, `~/Library/Containers`,
     `~/Library/Group Containers` or `/Volumes`, a file that runs code or opens a URL (an app, a
     script, a disk image, a `webloc`, an alias), a quarantined file, a file type the `--app` app
     does not open, an app that opens web pages, files whose default apps differ, and an app that
     runs what it opens (a terminal, Script Editor, Automator, Shortcuts, Installer). An open is
     sent once and never retried, so a `timeout` may still open the items: list windows before
     opening again. `goldfinger open /tmp/report.txt --app com.apple.TextEdit --json`
   - **Hide and show an app** (from 0.11.0 on): `goldfinger hide <pid> --json` hides every window
     of the app, and `goldfinger unhide <pid> --json` shows them again at their place in the
     stack, not in front, both without activating any app: `{pid, hidden, warnings}`, `hidden` read
     back from the app. An app already in that state is `ok`, nothing sent. `hide` of the
     frontmost app is `background_unavailable`, since it would move the user's focus. A hidden
     app's windows read `on_screen: false`.
   - **A hidden app's window** (from 0.13.0 on; below it, every verb answers one `not_found`).
     The app's tree still holds the window and answers, so these reach it, the app staying
     hidden and inactive: `observe` without `--screenshot`, `--ocr` or `--detect`, an action's
     `--observe`, and an element target's `click` (its press), `type` (its insert), `set-value`,
     `perform` and `reveal`. A target from a snapshot taken before the hide still resolves, as
     the window has not closed. Every verb that needs the window on screen is
     `background_unavailable`, nothing sent, its message naming `unhide <pid>`: `observe
     --screenshot`, `--ocr` or `--detect`, `screenshot`, `capture`, a pixel or text target,
     `click --right` and `--double`, an element click's mouse fallback, `type`'s key fallback and
     `type` into Chromium web content, `keys`, `scroll`, `hover`, `drag`, `glide`, `perform …
     show-menu --foreground`, `window-frame`, `window-state`, `find`, `text` and `safari-tabs`.
     An action's `--observe-ocr` there gives `observe_failed`, as the window shows no pixels. A
     hidden app's minimized window, or its window on another Space, is still `not_found`.
     `unhide` the app before you act on its windows any other way.
2. **Observe it.** `goldfinger observe <window_id> --json` returns a `snapshot` id and a `tree`.
   Each node has `role`, `frame` and `depth`, maybe `title` and `value`, and an `index` when it
   can be acted on. From 0.11.0 on, an indexed node also lists what `perform` (below) takes:
   `actions`, those of `increment`, `decrement`, `confirm`, `cancel`, `show-alternate-ui` and
   `show-default-ui` it offers, in that order, and `custom_actions`, the labels of its app's
   custom actions, in the app's order, a label two actions share shown twice. Each is left out
   when empty, and both on an unindexed node and on a window's green title-bar button. Text mode
   prints them on the node's line: `[7] slider "Level" = "50"  actions increment,decrement`,
   `[9] group "Actions"  actions cancel  custom "Mark","Dup","Dup"`. `--screenshot` adds a PNG at `screenshot.path` (longest edge at most
   1,568 px). `--max-nodes <n>` caps the walk (1–2,000). A walk the node limit cut (2,000 nodes,
   or `--max-nodes`) returns `"truncated": true`, after the whole `tree` as `--json` sorts the
   keys, and prints `observe: tree cut at <n> nodes` on stderr; a walk it did not cut has
   neither. A cut tree is not the whole window, so a node missing from it may still be there.
   Nor is every uncut one: the walk takes nothing past level 25 (a group or scroll area counts as
   no level), and that limit never sets `truncated`.
   - **Long text** (from 0.13.0 on). A node's `title` and `value` are cut at 500 Unicode
     scalars, and a cut key adds `title_truncated: true` or `value_truncated: true` (text mode
     prints `truncated` after it). `goldfinger text <snapshot>:<index> --json` reads the whole
     value (see Page text and Safari's tabs).
   - **Web keys** (from 0.13.0 on). A web area (`webarea`) and each node in it also carry what
     their engine reports of three keys: `url`, a link's target or the page's document, with only
     the origin and path for `http` and `https` (no user info, query or fragment, which can hold
     a token) and only the scheme for any other (`about:`, `file:`, `data:`); `dom_id`; and, with
     `--dom-classes`, `dom_classes`, the classes joined by one space. `url` and `dom_classes` are
     cut at 256 scalars (`url_truncated`, `dom_classes_truncated`). An engine may report none of
     them on a node. Text mode prints them after the value, each after two spaces:
     `[0] button "Web button"  dom_id "web"  dom_classes "primary wide"`.
   - **`--via extension`** (from 0.13.0 on; `ax`, the engine's keys, by default) takes a Safari
     window's web nodes' `dom_id`, and with `--dom-classes` their `dom_classes`, from the page's
     DOM through goldfinger's Safari extension instead. A node gets them only when exactly one
     element of the page matches its frame and role, so a tie or no match gives it neither, even
     where the engine gives one, and a scroll during the walk drops them all. Every other key is
     the walk's. Another app's window is `invalid_target`, and the extension's needs and errors
     are `text --via extension`'s (see Page text and Safari's tabs).
   - **The walk's time** (from 0.14.0 on). The walk also stops at a time limit: the verb's 20 s,
     its wait behind other requests included, less a reserve for what follows it. A plain walk
     has 19 s, one with `--screenshot` 18.5 s, one with `--ocr` or `--detect` 10 s, and one with
     both 1.5 s. A walk that limit cuts, as a slow app's can, is `ok` with the part read before
     the cut, `"truncated": true` and `"truncated_by": "time"`, and prints `observe: tree cut by
     its time limit at <n> nodes` in place of the node limit's line (text mode's header ends
     `truncated by time`). Its indexes still name their elements and its pixels still act, but
     it wakes no suspended web page (below), and replay re-finds no element in it (see Recording
     and replay). For a slow app's whole tree, leave `--ocr` and `--detect` off: observe with
     `--screenshot` and read its text with `ocr`. A walk left under 0.5 s (a request that waited
     behind others most of its limit), or one whose time cut the window's own reads, fails
     `timeout`, retryable, keeping no snapshot: observe again.
   - **A node that gives no answer.** The first node below the window that answers nothing within
     5 s is left out, with every node it holds, and the walk goes on: the result says
     `"unanswered": true` (after any `truncated`) and prints `observe: a node gave no answer
     within 5 s and is left out, with what it holds` on stderr. A web view whose page shows a
     JavaScript `alert`, `confirm` or `prompt` answers nothing until the dialog closes, while the
     window and the dialog's sheet do: the sheet's buttons and field are indexed and the page's
     content is missing. Such a walk takes 5 s longer. A second node that gives no answer, or the
     window itself, fails the walk `timeout`. A Firefox window that shows a dialog over its page,
     such as a new profile's Terms of Use dialog, has only that dialog in its tree: answer the
     dialog first.
   - **A suspended web page.** WebKit suspends a web view's page a few seconds after its window
     shows, if the window is fully covered and no accessibility client has read the page yet. When
     `observe` or `find` meets such an empty web view, outside the Chromium family, goldfinger
     moves its window 1 pt and back (from 0.9.1 on), which wakes the page, and waits up to 3 s for
     it (from 0.14.0 on; 500 ms before), so a page still loading in a window that has just opened
     shows too. A window whose web view shows no page in that time is not moved again. A page read
     before it was suspended stays readable while covered.
   - **Windows over it** (from 0.14.0 on). The PNG of `--screenshot`, `--ocr` and `--detect`
     draws in the app's own windows that are over the window, as the screen shows them, at most
     the front four: its sheets and popovers, and another window of the app that covers part of
     it, but never an open menu. The result lists them front to back as `screenshot.windows`,
     `[{"window_id", "frame"}]`, and has no `windows` key when none is over it. `--ocr` and
     `--detect` entries can lie on them. A pixel or text target there takes its events in that
     window, stamped with it and measured from its top-left, so a click on a sheet's or a
     popover's pixel reaches its control; a text target there is checked with those windows
     drawn in again. Once that window closes, moves or resizes, the target is `stale_snapshot`.
     The part of a popover that sticks out of the window is cut off, its text too: `capture` the
     popover by its own `window_id` to see all of it.
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
     A disabled match gets an index too; from 0.14.0 on a `click` on it is `action_failed`,
     with nothing sent.
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
   part; boxes and targets stay in the whole PNG's pixels. It reads `en-US` by default, and
   other scripts then come back as confident false Latin text. From 0.13.0 on,
   `--ocr-language <code>` (with `--ocr` only, else `usage`) reads one of the 33 languages
   Vision reads on macOS 27.0.1: `en-US`, `fr-FR`, `it-IT`, `de-DE`, `es-ES`, `pt-BR`,
   `zh-Hans`, `zh-Hant`, `yue-Hans`, `yue-Hant`, `ko-KR`, `ja-JP`, `ru-RU`, `uk-UA`, `th-TH`,
   `vi-VT`, `ar-SA`, `ars-SA`, `tr-TR`, `id-ID`, `cs-CZ`, `da-DK`, `nl-NL`, `no-NO`, `nn-NO`,
   `nb-NO`, `ms-MY`, `pl-PL`, `ro-RO`, `sv-SE`, `fi-FI`, `hi-IN` and `mr-IN`. None is Hebrew. It
   takes the list Vision gives on the Mac it runs on, and any other code is `usage`, naming each.
   A right-to-left line's `text` is in reading order, while a row's entries still run left to
   right. A text target's check reads in its entry's language. In `en-US`, a lone digit after a word can read as a letter
   (`row 0` as `row O`), and a `C` as the Cyrillic `С`. `⌘` can read as nothing or as one or two
   other characters (`Save ⌘S` as `Save 9S` or `Save 3tS`), and an emoji as nothing or as one or
   two (`Ship it 🚀` as `Ship it` or `Ship it P`); text turned to run vertically is not read; and
   at 7 pt and under, a letter or two of a word can misread (`Seven point` as `Seven poins`). It
   gives no confidence: check what matters against the tree or the PNG. From 0.14.0 on, on
   macOS 26, a capture under 1.5 pixels a point, as a 1x display gives, is read drawn at twice
   its size, its boxes and targets still in the PNG's pixels: it reads far more of the text
   right, and takes about three times as long, so read a large window in parts with
   `--ocr-region`. On macOS 26 a lone `0` or `O` after a word can also read as a lowercase `o`.
   The first `--ocr` after a goldfinger install, a macOS update or a purge of Vision's cache
   compiles Vision's model, about 35 s alone and minutes behind other compiles, past the verb's
   20 s limit: that call fails `timeout`, the compile runs on, and `--ocr` fails `timeout` at once
   until it ends. From 0.13.0 on, the first read in each other `--ocr-language` compiles that
   language's model the same way, about 14 s alone for `ar-SA`. Observe with `--ocr` again a
   minute later. Anything else meanwhile, a plain
   `observe` included, runs as usual. It reads print too small to see in the PNG, secrets
   included, and your host may keep the text in its transcripts: read only windows the task
   needs. The daemon keeps it in memory with its snapshot alone, never on disk or in its log,
   but for a recording started with `--text-anchors` (from 0.13.0 on; see Recording and replay).
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
     `--ocr-language <code>` (from 0.13.0 on, on `ocr` and `find-text` both) is `observe`'s.
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
   `goldfinger screenshot [<window_id>] --json` writes a PNG of the main display, or of that window
   alone (from 0.14.0 on with none of its sheets, popovers or other child windows, which
   `observe` draws in), at its native pixels with no cap, and returns
   `{"path", "width", "height"}`: a read under the Screen Recording grant, whose pixels no target names, in a file that is yours to delete.
   **Capture at a fixed scale** (from 0.11.0 on): `goldfinger capture <window_id> [--region
   <x>,<y>,<w>,<h>] [--scale <s>] --json` writes a PNG of the window, or of that region of it, as
   a new snapshot whose pixels are pixel targets, and returns
   `{snapshot, window_id, pid, frame, region, scale, screenshot: {path, width, height}}`:
   - The region is in whole points from the window's top-left, as `--ocr-region` takes it, and
     must lie inside the window; without it, the whole window.
   - The scale is the PNG's pixels per point, 0.25 to 4, 1 by default, whatever the window's size
     or its display's. So pixel `x,y` is always the point `region.x + x ÷ scale,
     region.y + y ÷ scale` from the window's top-left, and coordinates read off one capture carry
     to the next of the same region and scale, where `observe --screenshot`'s scale follows the
     window's size. A PNG past 4,096 px on its longest edge is `usage`: take a smaller region or
     scale.
   - The snapshot holds pixels alone: an element target on it, and an `ocr` or `find-text` of it,
     are `invalid_target`. It counts against its window's 8 snapshots like any.
   - It walks no tree, so it is faster than `observe`; it needs both grants, sends nothing, is not
     recorded, and its `timeout` is retryable.
   - From 0.14.0 on, it shows the window alone, as `screenshot` does, with no sheet or popover
     over it. A popover's own `window_id`, from `screenshot.windows`, captures the whole popover.

   `goldfinger capture 4242 --region 120,300,400,300 --scale 2 --json`, then
   `goldfinger click k7.12@200,150 --json` clicks the point 220,375 from the window's top-left.
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
       menu, and a pixel target inside the open menu goes to the menu's window; on macOS 26, from
       0.14.0 on, a single left click there presses the item at the point instead, and is
       `background_unavailable` on no item or a disabled one.
     - **The menu `--right` opens** (from 0.12.0 on). The result carries `"menu_window_id": <id>`
       when exactly one new window of the target's app is at the pop-up menu level after the
       hold, and no such key when none or several are (an element with no menu, or a menu that
       closed inside the hold). `goldfinger observe <menu_window_id> --json` reads the open menu:
       `tree[0]` is the `menu`, index 0, which lists `cancel`, and its items follow as `menuitem`
       nodes, an enabled one indexed, a separator or a disabled item not. From 0.13.0 on, a
       submenu's items sit under their submenu's item, one level deeper, indexed the same way,
       read while the submenu is closed; an app that fills a submenu as it opens shows what it
       held before (Finder's Quick Actions held only Customize…). `click <menu-snapshot>:<index>`
       presses an item through accessibility, which fires it once and closes the whole menu, and
       `perform <menu-snapshot>:0 cancel` closes it with nothing fired (both from 0.12.0 on).
       `observe` reads no other window at the pop-up menu level (a menu an app opened on its own
       is `not_found`, naming `click --right`), the menu snapshot goes stale once the menu
       closes, and an action's `--observe` on one of its targets gives `observe_failed`, as the
       press closed that window. A recording keeps no line for a menu snapshot's targets (see
       Recording and replay). From 0.13.0 on, an app that gives the show-menu action no answer
       within 5 s (Finder answers a file's only once the menu closes) may still have opened the
       menu: the click then succeeds with `menu_window_id` when exactly one is new, after about
       6 s, else fails `timeout`. A `batch` `click` step's result carries `menu_window_id` too,
       but no later step can read the menu, as `observe` is no step. A web page's own menu,
       Safari's or Chrome's, lists `cancel` but does not take it.
     - **The route** (from 0.14.0 on): the result names how the click went: `"route": "press"`,
       an accessibility press, which goes through any cover over the element; `"mouse"`, mouse
       events, which a cover in the target's window takes (a pixel target, `--double`, or the
       fallback of a press the app rejected); or `"select"`, on macOS 26 a table row's selection
       that stands in for a pixel click. `press` says the press went, not that it acted: observe
       to see what it did.
     - **macOS 26 table rows** (from 0.14.0 on). There, an AppKit table selects a row on a click
       only in its key window. So a single left click at a pixel (and the click of a pixel
       target's `type` and `keys`) on an AppKit table's or outline's row, or on a cell, text or
       image in one, outside the frontmost app's key window sends no mouse event: it selects that
       row (`route: "select"`), replacing the table's selection as a click does, but does not run
       the table's action, which a click in the key window runs. A row the table's delegate
       refuses stays unselected, and a selection the app rejects is `background_unavailable`,
       nothing sent. A control in a row (a button), a point outside the rows, `--right` and
       `--double` still get mouse events, and a `--double` on a row selects nothing in the
       background. Observe to see the selection.
     - **A disabled target is refused** (from 0.14.0 on): an element that reads disabled
       (`AXEnabled` false) is `action_failed` ("the element is disabled (AXEnabled is false);
       nothing was sent"), not retryable, and nothing is sent. `observe` gives a disabled element
       no index, so this meets a target that became disabled after its observe, or a `find`
       match. Observe again, and act on what enables it. It covers `--double`, `--right`,
       `hover --click` and a `batch` `click` step; a pixel target is not checked. Before 0.14.0
       the press went, the app ignored it, and the click answered `ok`.
   - `goldfinger type <target> <text> --json`: the text arrives exactly once
     - **Route, and a field that ignores the insert** (from 0.14.0 on): the result names how the
       text went: `"route": "insert"` (inserted at the selection), `"value"` (written as the
       field's whole value) or `"keys"` (key events). When `warnings` holds `text_unchanged`, the
       app accepted the insert into an element target, but 1 s later the field's character count
       and selection read as before it, so the text may not have landed. Observe the field before
       you type again; do not repeat the call blind.
     - **WebKit fields** (an element in a `webarea` of an app outside the Chromium family) take
       the text over accessibility, as VoiceOver inserts it, never as keys: key events reach no
       background WebKit web content. So the page sees the text arrive with no key event, and a
       combobox that searches on `keyup` does not search. An element WebKit gives no text is
       `action_failed`, nothing sent: a date or time field (its parts are separate steppers), an
       element that is not editable, and a field holding text whose character count did not move.
       From 0.13.0 on, a pixel target in such content is clicked by the press of its element
       (see the single click in Targets and staleness), and the text goes into that element under
       this rule once it reads focused. A press that left the element unfocused is
       `background_unavailable`, the press sent and no text; no element there that offers a
       press is `background_unavailable`, nothing sent.
     - **Chromium fields** (from 0.14.0 on; an element in a `webarea` of an app of the Chromium
       family, Chrome's and Electron's among them) take the text as key events alone
       (`route: "keys"`): a background Chromium page answers an accessibility insert and drops
       it. The page sees each character as a key and an `input` event. A tab in the text goes in
       as a tab character, and a line break is dropped: send a line break as its own
       `keys <target> return`. The keys go only into the app's key window, else
       `background_unavailable` with nothing sent, and a hidden app's window is refused the same
       way. Chromium's native fields, such as Chrome's address bar, still take the insert. Before
       0.14.0 a Chromium web field that held text answered `ok` with nothing typed: observe it
       before you trust the text.
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
     next key it gets. A pixel target in web content outside the Chromium family is
     `background_unavailable` before its click, nothing sent, from 0.13.0 on too: key events
     reach no background web content, whatever a press focused there. Use `type` or `set-value`
     on the element.
   - `goldfinger scroll <target> up|down|left|right [lines] --json` (3 lines by default)
   - `goldfinger set-value <target> <value> --json`: element targets only, read back, compared.
     For a text field the read-back is its text, not the value its app makes of it: an AppKit
     field with a formatter reads back the text as written, so the verb is `ok`, and then rejects
     it, leaving its value empty (a field that takes 0 to 100, given 250). No accessibility read
     tells the two apart, so there `ok` means written and read back, not accepted.
   - `goldfinger perform <target> <action> --json` or `goldfinger perform <target> --custom
     <label> --json` (from 0.11.0 on) sends one accessibility action the element lists in its
     node's `actions`, or one of its `custom_actions` by label, in the background:
     `goldfinger perform k7.12:7 increment --json` returns
     `{"warnings": [], "action": "increment", "value": {"before": "50", "after": "55"}}`.
     - Element targets only; a pixel or text target is `invalid_target`. The element's list is
       read again when the action runs: one it does not list is `action_failed`, nothing sent,
       naming what it offers. A label no custom action has, or two share, is `not_found`
       ("ambiguous" for the second), nothing sent.
     - `action` is one of the six short names, or its `AX` name (`AXIncrement`). `raise` and
       `zoom-window` raise a window and are `background_unavailable`, as is `show-menu` without
       `--foreground` and any action on a window's green title-bar button; `press` and `pick` are
       `usage` (use `click`), `scroll-to-visible` is `usage` (use `reveal`), and so is any other
       name. `--foreground` on any other action, or with `--custom`, is `usage`.
     - **`show-menu --foreground`** (from 0.13.0 on): `goldfinger perform <target> show-menu
       --foreground --json` is a foreground verb (see Menus, drag and restore). It activates the
       element's app, sends its show-menu action once, and returns `menu_window_id` as
       `click --right` does, which `observe` reads and whose items `click` presses (see The menu
       `--right` opens), also when the app gave no answer within 5 s but opened the menu. An app's
       menu closes once the app loses the front, so the app stays frontmost while the menu is
       open: the result has `activated` and no `restored`, and the app before gets the front back
       within 0.1 s of the menu's window leaving the window list (an item pressed, the cancel, or
       a click elsewhere), unless a person switched away first. A menu that stays open keeps its
       app frontmost: close it with `perform <menu-snapshot>:0 cancel`. With no menu window
       within 1 s the app before is restored at once, and an app that also gave no answer is
       `timeout`. Prefer `click --right`, which activates nothing. `observe` does not list
       `show-menu` in `actions`, as nearly every element offers it. It is no `batch` step, a
       hidden app's window refuses it (its activation would unhide the app), and a recording
       writes no line for it, with no warning.
     - `ok` means the app accepted the action, not that it took effect. `value` comes only with
       `increment` and `decrement`, read before and up to 100 ms after: equal `before` and `after`
       are a control at its bound, or one whose value updates later (Chromium): observe again.
     - No mouse fallback and no retry: a `timeout` (not retryable), or an `action_failed` for an
       error the app answered, may have run, so observe before sending it again. From 0.13.0
       on it is a `batch` step, by `action` or by `custom` (see Batch).
4. **Observe again** once the UI may have changed, or add `--observe` to one of these five,
   `reveal` or `perform` (not `launch` or `quit`) to get the window's new observe result back as `observe` in
   the same call. A cut one holds its `truncated` there, and prints no line on stderr.
   - **`--observe-ocr`** (from 0.13.0 on; it needs `--observe`, else `usage`) also reads the
     window's text in that observe, as `observe --ocr` does, its whole window and no region, so
     the `observe` gains `ocr` and its text targets: the way a `batch` reads text between its
     steps. Every verb that takes `--observe` takes it, `hover` and `drag` included. The verb
     needs the Screen Recording grant before it acts (`permission_missing`, nothing sent). Once
     the action has landed, a capture or recognition that fails or runs out of time, one still
     running from an earlier request (Vision's model compiling), or a hidden app's window gives
     `observe_failed`, and the verb stays `ok`. The read has what is left of the 20 s limit, at
     most 8 s; a warm one takes under 2 s.

Every action (these five, `reveal`, `perform`, `window-frame`, `window-state`, `clipboard-write`,
`menu`, `drag`, `hover`, each `batch` step) and every `launch`, `open`, `hide` and `unhide` takes
at least 1 s, its guard.
`goldfinger quit <pid> [--force] --json` returns `exited`: `false`, still running after 15 s, is
not an error. `goldfinger stop` stops the daemon every agent shares, staling all snapshots and
ending all sessions; run it only as the errors say.

## Targets and staleness

- `k7.12:4` is the node whose `index` is 4 in snapshot `k7.12`, not `tree[4]`: nodes without
  an `index` (the window itself, labels) sit in `tree` too. Prefer element targets, which stay
  valid while their element exists, even if the window moves.
- `k7.12@640,210` is a pixel of that snapshot's PNG, so the observe needed `--screenshot`: a PNG
  pixel, never the screen points of a node's `frame`. It goes stale the moment its window moves
  or resizes. From 0.14.0 on, a pixel on a window the PNG showed over the snapshot's (a sheet or
  a popover in `screenshot.windows`) goes to that window, and goes stale once that window
  closes, moves or resizes (see Windows over it, in The loop). Inside a `batch`, `step0:4`
  targets an earlier step's observe, and from 0.13.0 on `step0:text=Counter` the one entry of
  that step's `--observe-ocr` read whose text holds `Counter` (see Batch). A `capture`'s snapshot (from 0.11.0 on) takes pixel targets too, counted from its region's
  top-left at its own scale.
- **The Chromium page check** (from 0.11.0 on). In an app of the Chromium family, a pixel or text
  target whose point lies on the page its snapshot showed is `stale_snapshot`, with nothing sent,
  once that page has moved or resized inside its window by more than 1 pt. The daemon reads the
  page's frame when `observe --screenshot` or `capture` makes the snapshot, and again when the
  target acts. It checks where the page sits, not what it shows: a scroll inside the page still
  leaves a pixel target on its old point. A point off the page (the browser's toolbar), a snapshot
  whose centre showed no page, and a point under another window of the same app are not checked.
  Nor, from 0.14.0 on, is a point on a window the PNG showed over the target's: it is on no page
  of the target's window.
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
    window that moved or resized: observe again. The check reads in the language the entry was
    read in (from 0.13.0 on; see `--ocr-language`);
  - a check that cannot run is `timeout`, retryable on any verb: a recognition still running, the
    check past its 3 s, or too little of the verb's 20 s left (it keeps the last 2 s). A capture
    or recognition that fails is `action_failed`;
  - it needs the Screen Recording grant too, else `permission_missing`;
  - an entry past the snapshot's text is `invalid_target`, and so is a text target for
    `set-value`, `reveal` or `perform`, as a pixel target is.
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
- **A single left click into web content** of a background app outside the Chromium family
  (Safari or any other app built on WebKit, and Firefox too, as the tree names no engine) sends no
  mouse event: such content takes a first click only in the active app. That is a `click` without
  `--double` or `--right`, an element's mouse fallback, `hover --click`'s fallback, and the click
  that focuses a pixel target for `type` and `keys`. From 0.13.0 on, such a click is the press of
  the element the app's hit test names at the point, or of its nearest parent below the web area
  that offers a press, as a link does for its text: `ok`, `route: "press"`, with
  `effect_unverified` in `warnings`, since the app accepting the press is all goldfinger knows.
  The page sees one `click`, with no `mousedown` or `mouseup`, and nothing raises or activates.
  Observe the window to see what it did. With no element there that offers a press (a `<canvas>`,
  where the hit test names the web area), an element in another window or in none, or a press
  the app rejects, the click is `background_unavailable`, no mouse event sent: target the element
  instead. Below 0.13.0, every such click is `background_unavailable`, nothing sent. `type` and
  `keys` at a pixel there follow their own rules (The loop).
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

## Page text and Safari's tabs

These are reads, from 0.13.0 on: they keep no snapshot, act on nothing and are not recorded,
and their `timeout` is retryable. In Chrome and Chrome Canary, read a page through Huginn
instead (see Chrome).

- `goldfinger text <window_id | target> [--offset <n>] [--limit <n>] [--via ax | apple-events |
  extension] --json` reads a whole web page's text, or one element's, a page of it at a time,
  past `observe`'s node limit and its 500-scalar cut. It takes exactly one of a window id (a
  positive whole number) and an element target, else `usage`. It returns
  `{"text": "Web b", "offset": 0, "length": 5, "next_offset": 5}`.
  - **A window** reads every web area it holds, as `find` finds them, joined by one newline; a
    window with none, as every native one, is `not_found`. **An element target** reads the
    element's web text, else its `value` uncut; one with neither is `not_found`, and a pixel or
    text target is `invalid_target`.
  - **Pages.** `offset`, `limit` and `length` count Unicode scalars (an emoji is one).
    `--offset` is 0 and `--limit` 8,000 by default, 1 to 100,000. Each call reads the whole text
    again and returns from `offset`: call again with `--offset <next_offset>` while
    `next_offset` is there, and the pages join to one text only while the page holds still.
    `"loading": true` means the page has not finished loading. Text mode prints the text as it
    is, and on stderr `text: more from --offset <n>` and `text: the page is still loading`.
  - The text is the engine's: Safari and WebKit put a newline between blocks and U+FFFC where a
    control sits, while Chrome Canary puts none. Safari's page leaves out a cross-site iframe's
    text: read that iframe's own web area by its target.
  - **`--via apple-events`** reads a Safari window's current tab's `document.body.innerText`
    through goldfinger's own fixed script (no verb takes JavaScript), text hidden from
    accessibility included. A window id only (a target is `usage`), of Safari's (another app's is
    `invalid_target`). It needs no Accessibility grant, but the Automation grant for Safari and
    Safari's "Allow JavaScript from Apple Events" setting: each missing one is
    `permission_missing`, naming `goldfinger setup --safari`, the Automation pane or the setting,
    which are the operator's (see Install, once). It activates, raises and focuses nothing.
  - **`--via extension`** reads the same text through goldfinger's Safari extension instead,
    which finds the one Safari window at the window's frame whose current tab bears its title.
    A window id of Safari's only, as above. It needs neither the Automation grant nor the
    JavaScript setting, but the extension turned on and allowed on the page's site: each missing
    one is `permission_missing`, naming the Extensions pane, the extension's Edit Websites list,
    or `goldfinger doctor` for an extension Safari does not list. `not_found` also covers a
    window the extension cannot see (a private one) and a tab with no web page it may read (the
    Start Page).
  - A hidden app's window, or a target in one, is `background_unavailable` on every route,
    Safari's included (see A hidden app's window, in The loop).
- `goldfinger safari-tabs <window_id> --json` lists a Safari window's tabs, left to right:
  `[{"index": 1, "title": "Example Domain", "url": "https://example.com/docs"}, {"index": 2,
  "title": "New Tab", "current": true}]`. `index` counts from 1, `title` is cut at 500 scalars,
  `url` follows the web keys' rule (origin and path only) and is left out for a tab with none,
  and `current` marks the current tab. It needs the Automation grant for Safari alone, as
  `--via apple-events` does, and fails as that does; another app's window is `invalid_target`,
  and tabs that change between its reads are `action_failed`.

## Chrome: page work goes to Huginn

Chrome and Chrome Canary page work (reading a page, finding an element in it, opening or
navigating a tab, filling a form, a page screenshot) goes to Huginn, sleipnir's browser companion,
for every agent: `slp huginn <action> <uuid> --tab <id>` (each action needs its own grant, and a
mutation adds `--yes`), or the sleipnir MCP server's `huginn` and `huginn_batch` tools
(`confirm: true`), taught in sleipnir's `docs/huginn.md`. It does not go through goldfinger's tree
too: when `slp huginn list --json` shows no Huginn online for that Chrome, or the action has no
grant, ask the operator. goldfinger's
part in a Chrome window is a background element action, `click`, `type`, `keys` or `set-value`
on an element target, from 0.11.0 on a pixel target under the page check (below), and the
`observe` or `capture` that finds that target or reads a Chrome the operator is typing in (below). The rules below come from goldfinger's browser DOM spec
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
- **Pixel targets in a Chrome that Huginn drives need goldfinger 0.11.0.** Below it, use none
  there, by any agent: act by element, since content that moves inside an unmoved window, as the
  bar moves it, leaves a pixel target on its old point. From 0.11.0 on, the Chromium page check
  (Targets and staleness) catches the bar: it moves the page 56 pt down without moving the window,
  so a pixel or text target taken before it showed or left is `stale_snapshot`, and nothing is
  sent. So:
  - Take the snapshot after your own last Huginn call in that window: a `capture`, or an
    `observe --screenshot`. One taken before it may show the page where it no longer is.
  - On `stale_snapshot`, take a new capture and read the point off it again. Never retry the old
    target: it stays stale, and no agent sees another's Huginn calls, so the bar can come or go
    again at any time.
  - The check sees where the page sits, not what it shows: content the page moved itself, as a
    scroll does, still leaves a pixel target on its old point. Prefer an element target, which
    reads its element's frame when it acts, and a text target, which checks its text.
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

## Window frames, window state and the clipboard

These take no target and no `--observe`; the clipboard verbs need no grant and reach no app.

- `goldfinger window-frame <window_id> <x>,<y>,<w>,<h> --json` moves and resizes a window, in
  whole points from the top left of the primary display, as `windows` reports frames: `x` and
  `y` at least 0, `w` and `h` at least 1, else `usage`. So a window left of or above the primary
  display (a negative `x` or `y` in `windows`) cannot be framed there. It returns
  `{"frame": {"x", "y", "width", "height"}, "warnings": []}`, `frame` being the window server's
  read-back, never the request, as `windows` reports. It is `ok` once that read-back matches the
  request within 2 points, or when an app holds the window at a size of its own (its size steps,
  a minimum or a maximum): with the position matched and the size held, `frame` has the app's
  size, and `warnings` holds `frame_adjusted`. From 0.11.0 on, a minimized window is
  `action_failed`, nothing written: restore it first.
- `goldfinger window-state <window_id> minimize --json` (from 0.11.0 on) minimizes the window to
  the Dock in the background, and returns `{window_id, pid, state, changed, warnings}`, `state`
  read back as `minimized` or `normal`. The window keeps its `window_id`, and `windows` lists it
  `on_screen: false`. `restore` brings it back, but only with `--foreground` (see the foreground
  verbs), and `minimize --foreground` is `usage`. A window already in the asked state is `ok`
  with `changed: false`, nothing written. One that cannot be minimized is `action_failed`, as is
  a write that does not read back within 2 s; a window on another Space is `not_found`, and from
  0.13.0 on a hidden app's window is `background_unavailable`, nothing written (`unhide` the app
  first); a `timeout` may still land, so check with `windows`. Zoom is not a state it sets: to
  fill the screen without full screen, give `window-frame` the display's visible frame.
- **Full screen** (from 0.13.0 on): `goldfinger window-state <window_id> full-screen
  --foreground --json` puts the window into native full screen, as a foreground verb (see the
  foreground verbs), and `state` reads back `full-screen`. macOS moves the window to a
  full-screen Space of its own and activates its app, so goldfinger restores the app before
  only once macOS has switched to that Space, which brings back the Space that showed before.
  Without `--foreground` it is `background_unavailable`. A window that cannot go full screen (one
  that cannot be resized, a panel, a window with a sheet open, one its app keeps out, or a
  minimized one) is `action_failed`, nothing activated. `windows` lists a full-screen window
  whose Space does not show as `on_screen: false`, at its display's frame. `restore
  --foreground` takes it out of full screen in the background, activating nothing (no
  `activated` or `restored`), and `minimize` of it is `action_failed`, nothing written. A
  window the daemon did not make full screen, or made so before it restarted, is `not_found`
  while its Space does not show: the message names the app's Exit Full Screen menu item, as
  `goldfinger menu <pid> "View>Exit Full Screen" --foreground` in most apps.
- `goldfinger clipboard-read [--all] --json` returns the plain text as `{"text": "…"}`, or `{}`
  when the clipboard holds no plain text or an empty string; text beside other content is
  returned. It holds no 1 s guard, but may put the platform's paste alert in front of the user,
  which is not background: read it only when the task needs it. A denied read is an error, never
  an empty clipboard.
  - `--all` (from 0.10.0 on) adds a key for each of these types the clipboard holds, each left
    out when it holds none or an empty one: `rtf` and `html`, strings (bytes that are not UTF-8
    read as U+FFFD); `image`, `{"path": "…/goldfinger-clipboard-<uuid>.png", "width", "height"}`,
    a PNG file and its size in pixels, never the bytes (the clipboard's PNG, else its TIFF
    converted); and `files`, the absolute path of each file or folder on the clipboard, in order.
    Every other type (a PDF, a web archive, an app's own types) is left out.
  - `text` is the plain-text type alone: goldfinger derives none from the RTF, the HTML or a
    file's name. An app that copies rich text puts its plain text beside it, and a Finder copy
    of files their names; the platform derives plain text from RTF alone, never from HTML, an
    image or a file.
  - The PNG goes to the user's temporary directory (`$TMPDIR`), mode `0600`, as `screenshot`'s
    does. It is yours: the daemon never deletes it, so delete it when the task is done.
  - Text mode prints the text as it is when no other type came, else one line per type:
    `text <n> characters`, `rtf <n> characters`, `html <n> characters`, `image <path>  <w>x<h>`,
    then `file <path>` for each file. Read `--json` for the RTF and HTML themselves.
- `goldfinger clipboard-write --json [--rtf <rtf>] [--html <html>] [--image <png>] [--file <path>]... [--] [<text>]`
  replaces everything on the clipboard with the types given and returns `{"warnings": []}`. The
  flags are from 0.10.0 on; below it, the text is the one type and required. Give at least one
  type, and none empty (`usage`). goldfinger adds no type of its own: `--rtf` alone writes no
  plain text, though a read then gets the plain text the platform derives from the RTF.
  - `--rtf` and `--html` take the RTF or HTML as a string. One that starts with `-` goes as
    `--rtf=<rtf>` or `--html=<html>`.
  - `--image` takes a PNG file (checked by its signature, at most 32 MiB, else `usage`), which the
    client reads and sends. The clipboard gets it as PNG and as TIFF, which some apps take alone.
  - `--file`, once per file or folder, puts files that paste in Finder as a copy of them. Each path
    resolves from your working directory and must exist (`usage`, naming it). The client checks
    them, never the daemon, so no folder-access prompt takes the user's focus.
  - What the user had copied is gone, and only what `clipboard-read --all` returns can be put
    back (below 0.10.0, plain text alone): no PDF and no app's own types. Write only when the task
    needs it.

## Menus, drag and restore: the foreground verbs

`menu`, `drag` and, from 0.11.0 on, `window-state restore`, and from 0.13.0 on
`window-state full-screen` (see Window frames, window state and the clipboard) and
`perform … show-menu` (see The loop), run only with `--foreground`, else
they fail `background_unavailable`. With it, goldfinger activates the target's app for the action
alone, which may raise its window, then restores the app frontmost before, even when the action
failed; `show-menu` restores it only once its menu closes. The user sees a brief switch and loses focus that long: use these only where no
background verb reaches. `menu` and `window-state` take no `--observe`, and `drag` takes it from
0.11.0 on. A foreground verb run while a `show-menu` holds the front restores the app before
that `show-menu`, which closes its menu.

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
  slider with `set-value`. On macOS 26, AppKit's drag and drop drops nothing: a view's drag
  source, a table's row reorder and a web page's HTML5 drag and drop in WebKit end where they
  started while the verb succeeds, since the drag session there follows only the mouse pointer;
  SwiftUI's drags still drop. Check the drop with `--observe`.
- `goldfinger drag <from> <to> [--via <target>]... [--observe] --foreground --json` (from 0.11.0
  on) drags along a path: one `--via` per point it passes through, in order, 1 to 64, each a
  target in `from`'s window, resolved and aimed as `to` is before anything is activated. Each
  segment is cut into steps of 10 pt at most, with an event at every via, at about 400 pt a
  second. A via in another window, or a path past 400 events (about 4,000 pt), is
  `invalid_target`, nothing activated or sent. `--observe` observes the window once the release
  is taken and the app before is back, so the drop's effect reads back in the same call:
  `goldfinger drag k7.12:3 k7.12@880,210 --via k7.12@500,400 --via k7.12@700,120 --observe
  --foreground --json`.
- `goldfinger window-state <window_id> restore --foreground --json` (from 0.11.0 on) restores a
  minimized window: macOS brings a restored window in front of the front app's, so its app is
  activated for the restore, and the app before is put back in front. A window that is not
  minimized is `ok` with `changed: false` and activates nothing, so no `activated` or `restored`.
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
  and `observe`, and from 0.13.0 on `observe_ocr`. From 0.13.0 on, a `--click` press whose mouse
  fallback goes into web content outside the Chromium family is the press of the element at the
  point, with `effect_unverified` (see the single click in Targets and staleness).

## Batch

`goldfinger batch` reads at most 10 steps, a JSON array on stdin, and runs them in order,
stopping at the first that fails. A step is `{"verb", "args"}`: `click`, `type`, `keys`, `scroll`
or `set-value`, or from 0.13.0 on `perform`, with its arguments as snake_case JSON (`target`,
`text`, `combos`, `direction`, `lines`, `value`, `right`, `double`, `observe`, and from 0.13.0 on
`action`, `custom` and `observe_ocr`). A step runs in the background, so one whose args carry
`foreground` is `usage` from 0.13.0 on, and a `perform` step's `show-menu` is refused as alone
without `--foreground`. A step with `"observe": true` lets a later one
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

**Text references** (from 0.13.0 on). `step<k>:text=<text>` names an entry of the text step `k`'s
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
- **`--text-anchors`** (from 0.13.0 on; MCP `text_anchors`; the result and the trajectory's
  first line carry `"text_anchors": true`): each text target a recorded step acts on, a batch step's text
  reference included, keeps its entry's text as recognized beside its point, and its
  `ocr_language` when it is not `en-US`, so replay finds that text again before it acts. That
  writes screen text, secrets included, into the trajectory, in the recordings directory that
  Time Machine skips: start it only when the task needs a replay that survives a moved layout.
  Off, a recording writes no recognized text.
- **Recorded:** every action (see The loop) that succeeded in that session, `batch` steps
  included, and `glide`, with whichever it acted on of the app's bundle id, window title and
  element's role, title and tree path (or pixel point); a `hover --click` also keeps the pressed
  element's. From 0.11.0 on, `hide`, `unhide`, `open`, `window-state` and `perform` are recorded
  too: `hide`, `unhide` and `open` keep the app alone, `window-state` the app and window, and
  `perform` its element with the action's short name or the custom action's label, never the
  platform's name; from 0.13.0 on a `perform` batch step too, but no `perform … show-menu`,
  which writes no line and adds no warning. A text target is kept as its box centre's point,
  and without `--text-anchors` never its text, so it replays there, unchecked. From 0.13.0 on, a
  batch step's text reference is kept as the text target it resolved to, and its `observe_ocr`
  is left out. Not reads, `launch`, `quit` or failures. Text and values are written verbatim,
  passwords included, to a file only the user can read. From 0.12.0 on, an action on a target of
  a menu snapshot (an `observe` of a `menu_window_id`, or a `capture` of a window at the pop-up
  menu level) writes no line and is `ok` with `record_failed`: the menu is gone by replay. From
  0.14.0 on, an action on a pixel or
  text target on a window the PNG showed over its window (a sheet or a popover; see Windows over
  it) writes no line and is `ok` with `record_failed`: that window is gone by replay.
- `goldfinger replay <file> [--session <id>] --json` does the steps again, in order, and returns
  `{"step_count": 7, "warnings": []}`, the steps run. Each finds its app by bundle id (launching
  it if none runs), its window by title, and its element by that role, title and tree path in a
  fresh observe, never a look-alike, as far as its step keeps them (a `menu` keeps no window, a
  `clipboard-write` no app, but all its args, an image's bytes and the file paths included, so a
  file moved since pastes as a missing one); on an app replay launched, the observe and the
  re-find are retried for 10 s. From 0.14.0 on, a fresh observe that the walk's time cut
  (`truncated_by: "time"`) re-finds no element, a `reveal`'s, a `glide`'s and a replayed
  `hover --click`'s pressed element included, since an element past the cut can match too:
  `not_found`, its message naming the cut. A `menu`, `drag`, `window-state restore` or, from
  0.13.0 on, `window-state full-screen` activates its app again, as under `--foreground`.
  A text anchor (from 0.13.0 on) is found again by its text, never at its point: replay runs
  `find-text` on a fresh observe's whole window, in the anchor's language, and takes the entry
  whose text equals the anchor's, else the one that holds it. Two such entries, or none, are
  `not_found`, naming the snapshot, the count and the text, and the step's verb is not sent; the
  verb's own check then reads the box again. A first recognition (about 35 s after an install,
  about 14 s for a language's first read) fails `timeout`: replay again in a minute. A
  goldfinger before 0.13.0 refuses a trajectory with anchors as `usage`. A replayed `open` runs the client's checks on its items again,
  and a file moved since or refused now is `usage`, stopping replay; a replayed `perform` matches
  its custom action's label again on that launch. A
  `hover --click` re-finds its pressed element in the observe of the replayed hold, else
  `not_found` with nothing clicked, and a `glide` is skipped, uncounted, without `--session`. The
  first step that fails stops it, its error prefixed `step <k>: ` and not retryable, as a retry
  repeats the steps before. A file that is no trajectory to the goldfinger replaying it is refused
  whole (`usage`), with nothing sent. One in trajectory format 1, whose line 1 holds
  `"trajectory": 1` in place of `"format"`, is refused so too, its message saying so: record it
  again.

## Diagnose: doctor, watch and Goldfinger Control

- **`goldfinger doctor --json`** checks the install its binary belongs to and prints one report,
  `{"checks": […], "fail_count", "warn_count"}`, with eleven checks always in this order: `app`,
  `signature`, `notarization`, `path`, `daemon`, `versions`, `grants`, `safari`,
  `safari_extension`, `orphans`, `control` (nine before 0.13.0, which adds `safari` and
  `safari_extension`). `safari` reads the Automation grant for Safari and `safari_extension`
  goldfinger's Safari extension, both from `status`, with no prompt. Neither ever fails, as only
  the Safari reads need them (see Page text and Safari's tabs). `safari` skips when the grant was
  never asked for or Safari does not run, and `safari_extension` when the extension is off; both
  skip when no idle daemon answered or the daemon is older than 0.13.0, and warn when the grant
  is refused, Safari does not list the extension, or the state cannot be read. Their remedies (`goldfinger setup --safari`, the Extensions pane,
  `pluginkit -a`) are the operator's, like every other. Each
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

## VoiceOver: the real screen reader

From 0.15.0 on, goldfinger drives the real VoiceOver, for an agent that must hear a page as a
blind user does. VoiceOver reads only the frontmost app, so these verbs take the user's front:
use them only when the task asks for VoiceOver, and stop VoiceOver when done.

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
  verb's `permission_missing` names `goldfinger setup --voiceover` or the Automation pane: ask
  the operator.
- The `voiceover` verbs are not recorded, keep no snapshot, and run in no `batch`.
- A `timeout` from `start`, `stop` or `speech` may be retried. One from `do`, `type` or `press`
  may have landed, unless `retryable` is true: run `voiceover speech` before you send it again.

## MCP

`goldfinger mcp` serves the same client as an MCP server on stdio. Register it once, and its
tools appear in agent sessions started after that (in one already running, use the CLI):
`claude mcp add --scope user goldfinger -- goldfinger mcp` for Claude Code; for Codex,
`codex mcp add goldfinger -- goldfinger mcp` or a `[mcp_servers.goldfinger]` table in
`~/.codex/config.toml` with `command = "goldfinger"` and `args = ["mcp"]`.

Its tools are named as the socket verbs: `status`, `setup`, `apps`, `windows`, `observe`,
`launch`, `quit`, `click`, `type`, `keys`, `scroll`, `set-value`, `stop`, `window-frame`,
`clipboard-read`, `clipboard-write`, `menu`, `drag`, `batch`, `session-cursor`, `glide`, `hover`
and `screenshot`: 23. From 0.9.0 on, `find` is the 24th (`window_id` required; `role` and `text`
strings; `limit` an integer), `reveal` the 25th (`target` required, a string; `observe` a
boolean), `ocr` the 26th (`snapshot` required, a string; `region` an object) and `find-text` the
27th (`snapshot` and `text` required, strings; `region` an object). From 0.10.0 on,
`session-list` is the 28th (no parameters), `record-start` the 29th (`video` a boolean),
`record-stop` the 30th (no parameters), `replay` the 31st (`file` required, a string: the
trajectory's path), `doctor` the 32nd (no parameters, and never `--fix`, which stays the CLI's
and the operator's) and `watch` the 33rd (no parameters): 33 in all. MCP's `watch` is one
reading, the first line `goldfinger watch --json` prints, waited for up to 25 s; it never starts a
daemon, and fails as the CLI's would before that line (`daemon_unavailable` when none runs).
Below 0.10.0, run those six through the CLI. From 0.11.0 on, `capture` is the 34th (`window_id`
required, an integer; `region` an object; `scale` a number), `hide` the 35th and `unhide` the
36th (`pid` required, an integer), `open` the 37th (`items` required, an array of at least one
path or URL; `bundle_id`, the CLI's `--app`, a string a call may leave out; `new_instance` a
boolean), `window-state` the 38th (`window_id` required, an integer; `state` required,
`minimize` or `restore`; `foreground` a boolean, `true` for `restore`) and `perform` the 39th
(`target` required, a string; exactly one of `action`, one of the six short names, and
`custom`, a label string; `observe` a boolean): 39 in all. From 0.11.0 on,
`drag` takes `via`, an array of at least one target, and `observe`. From 0.13.0 on, `text` is the
40th (exactly one of `window_id`, an integer, and `target`, a string; `offset` and `limit`
integers; `via` one of `ax`, `apple-events` and `extension`) and `safari-tabs` the 41st
(`window_id` required, an integer).
From 0.15.0 on, `voiceover_start` (`pid` required, an integer), `voiceover_stop`,
`voiceover_do` (`command` required, one of the fourteen), `voiceover_type` (`text` required),
`voiceover_press` (`combo` required) and `voiceover_speech` are the 42nd to 47th: 47 in all.
Their names take an underscore, not the socket verb's hyphen. `setup` takes `voiceover`, a
boolean.
`text`'s result may run to 500,000 characters,
which Claude Code keeps in context (its `_meta` says so), and each of its stderr lines comes as
a text block too. The other parameters from 0.13.0 on: the booleans `safari` on `setup`,
`dom_classes` on `observe`, `text_anchors` on `record-start`, and `observe_ocr` on each tool
that takes `observe` as a boolean; `ocr_language`, a string, on `observe`, `ocr` and
`find-text`; `observe`'s `via`, `ax` or `extension`; `full-screen` as `window-state`'s `state`;
and `show-menu` as `perform`'s `action`, the last two with `foreground: true`. `setup` with
`safari` or, from 0.15.0 on, `voiceover` ends no session.
`screenshot` returns its path and no image: read the file. Parameters are the snake_case socket
args (`window_id`, `max_nodes`, `new_instance`); `window-frame`'s `frame` is
`{"x", "y", "width", "height"}`, and so are `observe`'s `ocr_region` and the `region` of `ocr` and `find-text`, `observe`'s `ocr` and `detect` booleans,
`batch`'s `steps` the array its stdin takes, `menu`'s path is
`menu_path`, `menu`, `drag` and `window-state` with `restore` need `foreground: true`, and `session-cursor` takes only `cursor`, a boolean.
From 0.10.0 on, `clipboard-read` takes `all`, a boolean, and `clipboard-write` takes `text`,
`rtf` and `html` strings, `image`, a PNG file's path (the CLI's `--image`), and `files`, an array
of at least one path; no `clipboard-write` parameter is required, but the call needs one. A result is what
`goldfinger <verb> … --json` prints for the same call, marked `isError` exactly where the CLI
exits non-zero: an error, a `batch` whose last entry failed, or a `doctor` report with a failed
check (`fail_count` above 0), whose `checks` you read either way. Arrays (`apps`, `windows`,
`session-list`, `batch`) come as text only; `observe` with `screenshot` adds the PNG as an image, and so do
`capture` (unless its width or height passes 1,568 px) and `observe` with `ocr` or `detect`, whose entries are in `structuredContent.ocr` and
`structuredContent.detections`; `ocr` and `find-text` add
none. From 0.10.0 on, `clipboard-read` with `all: true` adds the clipboard's PNG as an image too,
unless its width or height passes 1,568 px, `observe`'s cap, or the file is gone: then read the
file at `image.path`, which stays yours to delete. Not every model
sees that image: Codex 0.160.0 gives a model that calls MCP tools directly (gpt-5.5)
`structuredContent`, the result's JSON, in place of `content` wherever a result has both (all but
the arrays), while its code-mode models (gpt-6-astra) get the whole result. Without the image,
open the PNG at `screenshot.path` with the client's own image tool (Codex's `view_image`) while
its snapshot is kept (see Targets and staleness), as eviction deletes the file. A client caps a
result's size (Claude Code at `MAX_MCP_OUTPUT_TOKENS`, 25,000 by default): pass `max_nodes` on a
large window. An `observe` the node limit cut adds its `observe: tree cut at <n> nodes` line as a
second text block, beside the result's `truncated: true` (from 0.14.0 on, one the walk's time
cut adds `observe: tree cut by its time limit at <n> nodes` instead); an action with `observe: true` adds no
such block, its `observe` holding the key alone. A `find` cut at its limit adds its
`find: matches cut at <n>` line the same way. The rest of this skill applies, but not the
CLI's syntax: no `--json`, no `--`, no exit code, and a flag like `--observe` is a boolean
parameter.

Each connection has its own session, started at the first call that needs one, started again once
it ends (an idle end, any agent's `stop`), and ended when the connection closes. `session-cursor`
shows or hides that session's cursor, and `cursor: false` carries into the sessions the
connection starts later. There are no `session-start` or `session-end` tools: the server owns the
session. `session-list`, `doctor` and `watch` hold none and leave the connection's as it is, and
`setup` and `stop` end every session. From 0.10.0 on, `record-start` and `record-stop` record the
connection's own session, and the recording closes with that session, at the latest when the
connection closes. `replay` sends its steps in that session, so a recording running there records
them; a `replay` whose session ended after any of its requests succeeded returns `session_not_live` and is
not run again, as a second run repeats those steps. A call whose session ended while it recorded
is not sent again either: its `session_not_live` message says to call `record-start` again, and
the next call starts a new session that records nothing. Below 0.10.0, record and replay through
the CLI, acting through it too while recording, as MCP calls stay in the connection's session. A
call that fails `session_limit` ran nothing: retry later. `setup` is a tool but stays the operator's.
After a `brew upgrade`, the agent's `goldfinger mcp` is the old client, and the new daemon answers
it `version_mismatch`: ask the operator to restart the agent. Do not call `stop`, which would cost
every other agent its daemon and still mismatch.

## Warnings

Actions return `"warnings": [...]`, usually empty. With each, the action happened: do not repeat it.
For `text_unchanged`, the insert was sent but the field did not change: observe before you repeat it.
For `effect_unverified`, the press was sent and nothing read what it did: observe before you repeat it.

| Warning | Meaning |
|---|---|
| `app_self_activated` | An app activated itself during the action, and the app that was in front was put back. |
| `observe_failed` | Its `--observe` failed: run `observe` yourself. A later batch step that references it fails `stale_snapshot`. |
| `restore_failed` | A `--foreground` `menu`, `drag`, `window-state restore`, or from 0.13.0 on `window-state full-screen` or `perform … show-menu`, acted, but the app frontmost before had quit or did not come back to the front within 1 s, so there is no `restored`. The target's app may still be in front and no verb brings the user's app back: tell the user. |
| `record_failed` | Its line could not be written, so replaying the recording skips that step. An action on a `find` target always gets it, as its match has no tree path to replay; from 0.12.0 on so does one on a menu snapshot's target, the menu gone by replay; and from 0.14.0 on so does one on a pixel or text target on a window the PNG showed over its window, a sheet or a popover gone by replay. |
| `hover_interrupted` | Someone moved the mouse pointer off `hover`'s point during its hold, or held a button at its end, so it was left where it was: what ran inside the hold may have run without the hover, and its `observe` may not show what the hover reveals. Observe before another hover. |
| `frame_adjusted` | `window-frame` put the window at the position asked for, but its app holds it at another size (its size steps, a minimum or a maximum), so `frame` has that size, not the one asked for: work with the size in `frame`. A replayed `window-frame` adds it to replay's `warnings` the same way. |
| `text_unchanged` | From 0.14.0 on: `type` inserted its text into an element target and the app accepted it, but 1 s later (and again 250 ms after) the field's character count and selection read as before the insert. The text may not have landed: observe the field before you type again. |
| `effect_unverified` | From 0.13.0 on: a single left click into web content outside the Chromium family (a `click`, or a `hover --click` press's fallback) went as the press of the element at its point, which the app accepted, and nothing reads its effect back (see the single click in Targets and staleness). Observe the window to see what the click did. |

## Errors: what to do

| Code | Do this |
|---|---|
| `permission_missing` | A grant is missing, which the message names (`observe --detect` needs Screen Recording, as `--screenshot` and `--ocr` do, and so does an action on a text target; `ocr` and `find-text` need none; from 0.13.0 on, so does an action with `--observe-ocr`): ask the operator to run `goldfinger setup`, and do not retry. The Safari reads (from 0.13.0 on; see Page text and Safari's tabs) need more, which the message names: `text --via apple-events` and `safari-tabs` the Automation grant for Safari (the operator runs `goldfinger setup --safari`, or turns it on in the Automation pane when refused), `text --via apple-events` also Safari's "Allow JavaScript from Apple Events" setting, and `--via extension` goldfinger's Safari extension turned on and allowed on the page's site. Each is the operator's: never change a Safari setting yourself. |
| `not_found` | The pid, window or bundle id (`launch`) is gone, or the window has no accessibility tree (another desktop; for `window-frame`, no accessibility counterpart) or closed while `window-frame` moved it: list apps or windows again. A message ending `the screen is locked, …` (`observe`, `replay`): the Mac is locked, which only the operator can undo: tell them, and wait for the unlock (see Targets and staleness). A `replay` stopped there had already run its steps before `k`, and running the file again repeats them. From 0.14.0 on, a `replay` step or a replayed `hover --click` whose observe the walk's time cut, its message naming the cut: the app answered too slowly for a whole walk (see Recording and replay). `record-stop` on a live session that is not recording. `replay`: a missing file, or a step's app, window or element not found, a replayed `hover`'s pressed element included. `hover --click`: the observe in its hold found no window or tree, and nothing was clicked. `menu`: no menu bar, an item gone while the menus were walked, or a segment matching no item: fix the path from the titles the message lists. `find`: the window holds no web area, as a native one (Finder, a SwiftUI app) does, since AppKit offers no search, or its web engine offers no search: use `observe` (with `--max-nodes`), or act through the app's own UI. From 0.11.0 on: `open`, a file no app opens by default, an `--app` no installed app has, an item no app claims, or a file gone since the client's check (nothing opened); `hide`, `unhide`, a pid `apps` does not list; `window-state`, a window on another Space; `perform --custom`, a label no custom action has, or two share ("ambiguous"), nothing sent: read the labels in `custom_actions` again. From 0.12.0 on: `observe` of a window at the pop-up menu level that no `click --right` (or, from 0.13.0 on, `show-menu`) reported, or whose menu neither lookup finds: open the menu with `click --right`. From 0.13.0 on: a hidden app's minimized window, or its window on another Space; `window-state restore` of a full-screen window the daemon did not make so, while its Space does not show (the message names the app's Exit Full Screen menu item); `text`, a window with no web area or an element with no text; `text --via apple-events` and `safari-tabs`, a Safari that quit or a window it has no id for; `--via extension`, a window the extension does not find (a private one) or a tab with no web page it may read (the Start Page); `setup --safari`, Safari does not run (ask the operator to open it); a `batch` text reference whose text no entry of its step's read holds, or two do ("ambiguous"), nothing sent: act on the entry's own `target` instead. |
| `stale_snapshot` | Observe again, then act on the new snapshot. A web element its parent no longer holds counts as gone. A text target's text no longer shows at its point (a scroll, or the text changed), and nothing was sent; for `ocr` and `find-text`, the daemon no longer holds the snapshot. In a Chromium-family app (from 0.11.0 on), a pixel or text target whose page moved inside its window, as Chrome's debugger bar moves it, and nothing was sent: take a new `capture` or `observe --screenshot` and read the point off it, never the old target again (see Chrome). From 0.14.0 on, a pixel or text target on a window its PNG showed over its window (a sheet or a popover) once that window closed, moved or resized: observe again. |
| `invalid_target` | Fix the target: a malformed id, an index past the snapshot, a pixel target without a screenshot or outside it, a text target past the snapshot's text, a pixel or text target for `set-value`, `reveal`, `perform` or, from 0.13.0 on, `text`, a window not Safari's for `text --via apple-events`, `--via extension`, `observe --via extension` or `safari-tabs` (from 0.13.0 on), an element target on a `capture`'s snapshot, an `ocr` or `find-text` of a snapshot with no screenshot or of a `capture`'s, a `step<k>:` target outside a `batch`, a `drag` whose `to` or a `via` is in another window than its `from`, or whose path needs more than 400 events, or a `hover --click` index past the observe taken in its hold. |
| `background_unavailable` | Nothing was activated or sent. A `cmd` combo (a menu shortcut reaches only the active app): click the control, or press its menu-bar command with `menu … --foreground`. `menu`, `drag`, `window-state restore`, or from 0.13.0 on `window-state full-screen` or `perform … show-menu`, without `--foreground`: add it, which switches the user's front app for the action. From 0.11.0 on: `hide` of the frontmost app, which would move the user's focus (hide another app, or leave it); a `click` on a window's green title-bar button, which would enter full screen (frame the window with `window-frame`, or from 0.13.0 on use `window-state <window_id> full-screen --foreground`); a `perform` of `raise` or `zoom-window`, or of any action on that button (a context menu opens with `click --right`). From 0.13.0 on, a verb that needs a hidden app's window on screen, its message naming `unhide <pid>` (see A hidden app's window, in The loop): `unhide` the app, or use a verb that reaches it hidden. A mouse event this platform cannot aim into a background window: use an element target, another route, or ask the user; for a `drag` refused even with `--foreground`, no flag or target lifts it. A single left click into background web content outside Chromium, WebKit's or Firefox's (see Targets and staleness), a `hover --click` press's mouse fallback included: from 0.13.0 on only when no element at the point offers a press (a `<canvas>`), the element is in another window or none, or the app rejected the press; target the element. Also a `keys` pixel target in such content (nothing sent), and a `type` pixel target there whose press left its element unfocused (the press was sent, no text). |
| `action_failed` | The app rejected the action or value: observe the state before another try. An element that needed mouse events has no visible part in its window, or none its app's hit test names it at (nothing sent; see The loop): `reveal` it (web content, from 0.9.0 on; see Targets and staleness), then act on it; a native element has no such action, so `scroll` its scroll view, observe again and act on the new snapshot. `reveal`: the element offers no scroll-to-visible action, as no native element does, or the app rejected it; nothing scrolled. `type`: a WebKit field given no text (a date or time field, an element that is not editable, a field holding text whose count did not move), or a native secure field that holds text, is not being edited, or whose caret did not reach the text's end; no keys were sent. `perform` (from 0.11.0 on): the element does not list the action (nothing sent; the message names what it offers), or the app answered an error, and the action may have run: observe first. `window-state` (from 0.11.0 on): the window cannot be minimized (nothing written), the app rejected the write, the state did not read back within 2 s, or, for `restore` and `full-screen`, the app did not come frontmost (nothing written); from 0.13.0 on, a `minimize` of a full-screen window (nothing written: `restore --foreground` takes it out first), or a `full-screen` of a window that cannot go full screen, as one that cannot be resized, a panel, a window with a sheet open or a minimized one (nothing activated). `open` (from 0.11.0 on): LaunchServices refused the open, its codes in the message. `hide`, `unhide` (from 0.11.0 on): the app's hidden state did not change within 1 s. `window-frame`: the window is minimized (from 0.11.0 on; nothing written: `window-state <window_id> restore --foreground` first), not movable or resizable (nothing written), a write was rejected (part may have landed), or no read-back matched: the platform held its position off the request (a title bar kept below the menu bar), or its frame kept changing, the message naming both frames: run `windows`. `clipboard-read`, `clipboard-write`: clipboard access is denied (nothing written), or the user refused the read at the paste alert while the clipboard held a type the read asked for: ask the operator to allow the setting the message names. A write refused after the clipboard was cleared left it empty, and says so. `clipboard-read --all` (from 0.10.0 on): the clipboard's image reads as neither a PNG nor a TIFF, and no file was written. `menu`, `drag`: the app did not come frontmost within 1 s (nothing sent; the app before was put back if the focus moved). `menu`: nothing pressed, as the path ends at an item that opens a menu, like a menu bar title (end it at a command inside), or at a disabled one (it needs a state the app is not in, say a selection: observe, change it, press again). `record-start`: the session is already recording (that recording goes on: `record-stop` first), its files or video would not start, or another session's recording has video. `hover`: refused before the pointer moved, as another window, or none, is at the point, the hit test went unanswered, or a button is held; or the platform would not move the pointer, the message saying where it was left (see Hover); or its `--click` press failed as `click`'s does. `glide`: the element has no visible part or position, and the cursor did not move. `text --via apple-events` and `safari-tabs` (from 0.13.0 on): Safari answered with no page text, or with another error, named with its number; for `safari-tabs`, the tabs changed between its reads: call again. `text --via extension`: Safari could not say whether the extension is on, or the extension gave another error. `setup --safari`: the grant's first read was `unknown`, so nothing was raised. `observe --ocr`, `ocr`, `find-text` and a text target's check (nothing sent): Vision failed, or a recognition abandoned at its 5 min ceiling still runs, which `goldfinger stop` clears: tell the operator before stopping the daemon every agent shares; for `ocr` and `find-text`, also the snapshot's native capture could not be read. `observe --detect` (no snapshot, nothing partial): the build ships no detection model ("this build has no detection model", refused before the walk), Core ML failed, or a detection abandoned at its 120 s ceiling still runs, which `goldfinger stop` clears: tell the operator first, as for `--ocr`. |
| `usage` | Malformed arguments (exit 2): fix the call; `goldfinger --help` lists the verbs. Also a refused `batch` (a step's own bad args fail only that step, after the ones before it ran), a `replay` file that is not a trajectory its version replays (format 1 included: record it again), a command that requires `--session` run without it (see Sessions), `find` with neither `--role` nor `--text` or a `--limit` outside 1–2,000, an `ocr` or `find-text` with a missing or malformed snapshot id or `--region`, a `find-text` whose text is empty once trimmed, a `clipboard-write` with no type or an empty one, an `--image` that is not a PNG or passes 32 MiB, a `--file` where nothing is (the message names it), a `capture` region outside the window (the message gives its size), a scale outside 0.25–4 or a PNG past 4,096 px, an `open` item the client's checks refuse (see The loop; nothing sent), a `perform` with neither or both of an action and `--custom`, or of `press`, `pick`, `scroll-to-visible` or any name outside the six (the message names `click`, `reveal` or the six), `window-state minimize --foreground`, and from 0.13.0 on `--ocr-language` without `--ocr` or with a code Vision does not read (the message names each), `--observe-ocr` without `--observe`, `--foreground` on a `perform` of any action but `show-menu` or with `--custom`, a `batch` step whose args carry `foreground`, a `batch` text reference to a step without both `observe` and `observe_ocr`, or with an empty text, and `text` with both or neither of a window id and a target, a target with `--via apple-events` or `--via extension`, or a `--limit` outside 1–100,000; and, when `goldfinger --version` is below 0.9.0, a call written as this skill writes it: tell the user the task needs goldfinger 0.9.0. |
| `timeout` | Reads (`status`, `apps`, `windows`, `observe`, `screenshot`, `capture`, `clipboard-read`, `session-list`), `session-cursor`, `glide`, `reveal`, `hide` and `unhide` may be retried; a `clipboard-read --all` that passed its limit after writing its PNG leaves that file in `$TMPDIR` with no path in the reply. `observe --ocr` after a minute when it follows a first use (see The loop), or read a large window in parts with `--ocr-region`. `observe --detect` at once: a detection that passed its time (under 8 s and what is left of the verb's 20 s), one from an earlier request still running, or too little of the limit left; a slow first load runs on to finish, so the next call is warm. `find` may be retried too: a search past the 20 s limit keeps no snapshot. So may `text` and `safari-tabs` (from 0.13.0 on). From 0.13.0 on, the first read in each other `--ocr-language` compiles its model (about 14 s for `ar-SA`): observe again a minute later. So may `ocr` and `find-text`, and any action whose text target's check timed out, which sent nothing (see Targets and staleness). So may any verb that waited its whole 20 s limit behind other requests (from 0.14.0 on; the message says `<verb> waited 20 s behind other requests and did not run`, and `retryable` is true): it never ran, so nothing landed. From 0.14.0 on, a verb that captures the screen (`observe --screenshot`, `--ocr` or `--detect`, `screenshot`, `capture`, a text target's check) is `timeout`, retryable, when ScreenCaptureKit gave no image within 5 s, or at once, naming it, when an earlier capture, or the Screen Recording check of `status` or `record-start --video`, still runs: retry. One in flight past a minute says that `goldfinger stop` clears it: tell the operator before stopping the daemon every agent shares. So is an `observe` whose walk had under 0.5 s left or whose time cut the window's own reads, keeping no snapshot (see The loop, The walk's time). Anything else may have landed and is not retryable: observe before repeating an action, list apps before a `launch` (it may still open), list windows before an `open` again (it may still open the items), observe before a `perform` again, check a `window-frame` or a `window-state` with `windows`, a `clipboard-write` with `clipboard-read` and a `session-start` with `session-list`. A `batch` timeout has no entries: observe before repeating any step. A `menu` timeout says whether it came while the menus were walked (nothing pressed) or at the press; after the press, observe the app's windows first. From 0.13.0 on, a `click --right` or `perform … show-menu --foreground` whose app gave no answer within 5 s but opened one new menu is no `timeout`: it succeeds with `menu_window_id`, after about 6 s. |
| `daemon_unavailable` | Retry when `retryable` is true (a `reveal` stays retryable once sent, as repeating it sets the same state). When the message says the action may have landed, check it as for `timeout` first: a `batch` may have run steps, a `record-start` started a recording. When it comes back on retry, run `goldfinger doctor --json` (see Diagnose). |
| `version_mismatch` | Two goldfinger versions met. Use the newer `goldfinger`. `goldfinger stop` and a retry also clears it, but stops the daemon other agents share. |
| `session_limit` | All six session colors are held, so `session-start` started nothing. End a session of yours, or wait for one to idle out, then retry. |
| `session_not_live` | The `--session` id is not live: never started, ended, idled out (its recording closed too) or an earlier daemon's. Nothing ran, and the same id fails again: run `goldfinger session-start`, and use the new id. |
| `not_running` | From 0.15.0 on: a `voiceover` verb found no VoiceOver running, and nothing was sent; or VoiceOver quit before it answered, and a `do`, `type` or `press` may have landed. Run `goldfinger voiceover start <pid>`, then `goldfinger voiceover speech` to see where the cursor is, before you send the verb again. |

Trust `retryable`: it says whether repeating the same request is safe, never whether it worked.
