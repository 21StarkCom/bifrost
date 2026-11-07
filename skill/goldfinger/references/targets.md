# Targets and staleness

- `k7.12:4` is the node whose `index` is 4 in snapshot `k7.12`, not `tree[4]`: nodes without
  an `index` (the window itself, labels) sit in `tree` too. Prefer element targets, which stay
  valid while their element exists, even if the window moves.
- `k7.12@640,210` is a pixel of that snapshot's PNG, so the observe needed `--screenshot`: a PNG
  pixel, never the screen points of a node's `frame`. It goes stale the moment its window moves
  or resizes. A pixel on a window the PNG showed over the snapshot's (a sheet or
  a popover in `screenshot.windows`) goes to that window, and goes stale once that window
  closes, moves or resizes (see Windows over it in [observe.md](observe.md)). Inside a `batch`, `step0:4`
  targets an earlier step's observe, and `step0:text=Counter` the one entry of
  that step's `--observe-ocr` read whose text holds `Counter` (see [batch.md](batch.md)). A `capture`'s snapshot takes pixel targets too, counted from its region's
  top-left at its own scale.
- **The Chromium page check.** In an app of the Chromium family, a pixel or text
  target whose point lies on the page its snapshot showed is `stale_snapshot`, with nothing sent,
  once that page has moved or resized inside its window by more than 1 pt. The daemon reads the
  page's frame when `observe --screenshot` or `capture` makes the snapshot, and again when the
  target acts. It checks where the page sits, not what it shows: a scroll inside the page still
  leaves a pixel target on its old point. A point off the page (the browser's toolbar), a snapshot
  whose centre showed no page, and a point under another window of the same app are not checked.
  Nor, is a point on a window the PNG showed over the target's: it is on no page
  of the target's window.
- An `observe --detect` entry's `target` is such a pixel target, at its box's
  centre: click it as any pixel target. Unlike a text target, it is never checked against the
  pixels: a scroll inside the window leaves it on its old point, over whatever is there now, and
  it goes stale only as a pixel target does. Observe again after anything that may move content.
- `k7.12:t4` is a text target: entry 4 of the text read in that snapshot, the
  `target` that `observe --ocr`, `ocr` and `find-text` give each entry. It acts as a pixel target
  at its box's centre, so `click`, `type`, `keys`, `scroll`, `hover`, `drag` and `batch` steps take
  it, but first goldfinger captures the window and checks that the entry's text still shows at
  that point, all before anything is sent:
  - text that moved (a scroll inside the unmoved window) or changed is `stale_snapshot`, as is a
    window that moved or resized: observe again. The check reads in the language the entry was
    read in (see `--ocr-language` in [observe.md](observe.md));
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
  until that tab is the active one, and the next `observe` then holds it. A tree with no `webarea` node does not mean the
  page is empty. The first `observe` of such an app waits for the app to build its web tree, at
  most 4 s, and returns a partial tree when the build takes longer: observe again. Read a
  background Chrome tab through Huginn (see [chrome.md](chrome.md)), but not while the operator types in that Chrome:
  wait. In another Chromium browser, an element `click` on the tab makes it the
  active one, and changes the tab the operator sees.
- While the Mac is locked, apps show goldfinger no windows: a window has no accessibility
  counterpart, so `observe` answers `not_found`, its message ending `; the screen is locked, and
  apps show goldfinger no windows until it is unlocked`, as does a `replay` step's window or
  element lookup. `window-frame` answers the same `not_found` without the clause, its message
  saying the window may be on another Space. An element target taken before the lock is
  `stale_snapshot`. Only the operator can unlock: report it, and wait.
  The first `observe` after the unlock has the tree.
- **A single left click into web content** of a background app outside the Chromium family
  (Safari or any other app built on WebKit, and Firefox too, as the tree names no engine) sends no
  mouse event: such content takes a first click only in the active app. That is a `click` without
  `--double` or `--right`, an element's mouse fallback, `hover --click`'s fallback, and the click
  that focuses a pixel target for `type` and `keys`. Such a click is the press of
  the element the app's hit test names at the point, or of its nearest parent below the web area
  that offers a press, as a link does for its text: `ok`, `route: "press"`, with
  `effect_unverified` in `warnings`, since the app accepting the press is all goldfinger knows.
  The page sees one `click`, with no `mousedown` or `mouseup`, and nothing raises or activates.
  Observe the window to see what it did. With no element there that offers a press (a `<canvas>`,
  where the hit test names the web area), an element in another window or in none, or a press
  the app rejects, the click is `background_unavailable`, no mouse event sent: target the element
  instead. `type` and
  `keys` at a pixel there follow their own rules (see [actions.md](actions.md)). Without
  `--background`, a single left click, or keys, there that no press carries runs with the app in
  front and its window raised (`"fallback": "web_click"`, see the focus fallback in [focus.md](focus.md)); a press the
  app rejected stays refused, as the app may have acted on it.
  `--double` lands too, but as a double click (two clicks and a `dblclick`), never a stand-in for
  a single one: it toggles a checkbox twice.
- **Out of view: `reveal`.** No action scrolls to its target on its own, so a
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
