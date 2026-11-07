# Observe a window: the tree, find, text in pixels, detection and captures

## The tree

`goldfinger observe <window_id> --json` returns a `snapshot` id and a `tree`.
Each node has `role`, `frame` and `depth`, maybe `title` and `value`, and an `index` when it
can be acted on. An indexed node also lists what `perform` (see [actions.md](actions.md)) takes:
`actions`, those of `increment`, `decrement`, `confirm`, `cancel`, `show-alternate-ui` and
`show-default-ui` it offers, in that order, and `custom_actions`, the labels of its app's
custom actions, in the app's order, a label two actions share shown twice. Each is left out
when empty, and both on an unindexed node and on a window's green title-bar button. Text mode
prints them on the node's line: `[7] slider "Level" = "50"  actions increment,decrement`,
`[9] group "Actions"  actions cancel  custom "Mark","Dup","Dup"`. `--screenshot` adds a PNG at `screenshot.path` (longest edge at most
1,568 px). The walk stops at 2,000 nodes by default. `--max-nodes <n>` sets that node limit: it takes 1–20,000. Any other value is `usage`. A walk the node
limit cut (2,000 nodes, or `--max-nodes`) returns `"truncated": true`, after the whole `tree` as `--json` sorts the
keys, and prints `observe: tree cut at <n> nodes` on stderr; a walk it did not cut has
neither. A cut tree is not the whole window, so a node missing from it may still be there.
Nor is every uncut one: the walk takes nothing past level 25 (a group or scroll area counts as
no level), and that limit never sets `truncated`.
- **Long text.** A node's `title` and `value` are cut at 500 Unicode
  scalars, and a cut key adds `title_truncated: true` or `value_truncated: true` (text mode
  prints `truncated` after it). `goldfinger text <snapshot>:<index> --json` reads the whole
  value (see [safari.md](safari.md)).
- **Web keys.** A web area (`webarea`) and each node in it also carry what
  their engine reports of three keys: `url`, a link's target or the page's document, with only
  the origin and path for `http` and `https` (no user info, query or fragment, which can hold
  a token) and only the scheme for any other (`about:`, `file:`, `data:`); `dom_id`; and, with
  `--dom-classes`, `dom_classes`, the classes joined by one space. `url` and `dom_classes` are
  cut at 256 scalars (`url_truncated`, `dom_classes_truncated`). An engine may report none of
  them on a node. Text mode prints them after the value, each after two spaces:
  `[0] button "Web button"  dom_id "web"  dom_classes "primary wide"`.
- **`--via extension`** (`ax`, the engine's keys, by default) takes a Safari
  window's web nodes' `dom_id`, and with `--dom-classes` their `dom_classes`, from the page's
  DOM through goldfinger's Safari extension instead. A node gets them only when exactly one
  element of the page matches its frame and role, so a tie or no match gives it neither, even
  where the engine gives one, and a scroll during the walk drops them all. Every other key is
  the walk's. Another app's window is `invalid_target`, and the extension's needs and errors
  are `text --via extension`'s (see [safari.md](safari.md)).
- **Raw accessibility attributes: `--a11y`** (MCP `a11y: true`). Use it for an
  accessibility audit of a window: a control with no label, a field whose label is not linked
  to it, a state the app does not expose. Each node, a native one too, then carries one `a11y`
  object: the raw attributes, as the app answers them, read in the node's own read. `title`
  joins a title and a description and trims them; `a11y` keeps each apart, as the app gave it.
  Its keys, in this order:
  - `title`, `description`, `help`, `role_description`, `subrole`, `identifier`,
    `placeholder` and `value_description`: the platform's `AXTitle`, `AXDescription`,
    `AXHelp`, `AXRoleDescription`, `AXSubrole`, `AXIdentifier`, `AXPlaceholderValue` and
    `AXValueDescription`, each as its text, not trimmed.
  - `enabled`, `focused`, `selected`, `expanded` and `required`: `AXEnabled`, `AXFocused`,
    `AXSelected`, `AXExpanded` and `AXRequired`, each `true` or `false` (a number counts
    too, `0` as `false`).
  - `invalid`: `AXInvalid` as the text the engine gives. WebKit and Chromium give `"false"`,
    `"true"`, `"grammar"` or `"spelling"`; a boolean is written `"true"` or `"false"`.
  - `title_element`: the position in `tree`, from 0, of the node `AXTitleUIElement` names,
    the one whose text labels this node, as a `<label for>` labels its field. It is the
    node's place in the `tree` array, not its `index`.
  - `linked_elements`: the positions in `tree` of the nodes `AXLinkedUIElements` names, in
    the app's order.

  Each text key, `invalid` included, is cut at 500 Unicode scalars, as `title` is, and a cut
  key adds `<key>_truncated: true` in the object (`help_truncated`). A key the app does not
  answer, answers with another type or with empty text is left out, and a node with no key
  has no `a11y`. `title_element` and `linked_elements` name only nodes in `tree`: an element
  the walk did not reach, past a limit or outside the window, is left out, and a key left with
  none is left out too. WebKit and Chromium answer `enabled`, `focused`, `selected`,
  `expanded`, `invalid` and `required` on almost every web node, `false` or `"false"` where
  the state does not apply, so a key that is there says nothing: read its value. WebKit gives
  an empty `required` field `invalid: "true"`, and a `<label for>`'s field the label's text
  node as `title_element`; a `title` attribute's text is a button's `help`. The keys cost
  little time. `--json` sorts `a11y`'s keys as it sorts every object's. Text mode prints them
  last on the node's line, in the order above, each after two spaces as `a11y.<key>`, a
  space and its value as JSON, a cut one followed by a space and `truncated`:
  `[2] button "Menu"  a11y.title "Menu"  a11y.enabled true  a11y.expanded false`,
  `[5] textfield  a11y.placeholder "Your city"  a11y.title_element 4  a11y.linked_elements [4,7]`.
  Without `--a11y` no node has `a11y`. Only `observe`
  takes it: an action's `--observe` does not. `--a11y` with `--via extension` is `usage`.
- **The walk's time.** The walk also stops at a time limit: the verb's 20 s,
  its wait behind other requests included, less a reserve for what follows it. A plain walk
  has 19 s, one with `--screenshot` 18.5 s, one with `--ocr` or `--detect` 10 s, and one with
  both 1.5 s. A walk that limit cuts, as a slow app's can, is `ok` with the part read before
  the cut, `"truncated": true` and `"truncated_by": "time"`, and prints `observe: tree cut by
  its time limit at <n> nodes` in place of the node limit's line (text mode's header ends
  `truncated by time`). Its indexes still name their elements and its pixels still act, but
  it wakes no suspended web page (below), and replay re-finds no element in it (see [sessions-and-replay.md](sessions-and-replay.md)). For a slow app's whole tree, leave `--ocr` and `--detect` off: observe with
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
  moves its window 1 pt and back, which wakes the page, and waits up to 3 s for
  it (500 ms before), so a page still loading in a window that has just opened
  shows too. A window whose web view shows no page in that time is not moved again. A page read
  before it was suspended stays readable while covered.
- **A wholly covered Chromium window.** An app of the Chromium family (Chrome, an Electron app)
  builds a page's web tree only while part of its window is in view. A window that other
  windows cover wholly shows no web area, and a move under its cover does not change that. So
  `observe`, with `--a11y` and `--max-nodes` too, and `find` reach its web content only once a
  strip of the window is clear of its cover: move the window with `window-frame`, which
  activates and raises nothing. `web-dom` and `web-script`
  read an Electron app's page with its window wholly covered (see [web-apps.md](web-apps.md)).
- **Windows over it.** The PNG of `--screenshot`, `--ocr` and `--detect`
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

## Find: web content past the node limit

When the tree is cut and the element you need is in web content (a browser page, an Electron
app, a web view), use `find` instead of observing again: `goldfinger find <window_id>
[--role <role>] [--text <text>] [--limit <n>] --json` searches the window's
web areas with the engine's own search, which reaches elements past observe's node limit.
That limit is 2,000 nodes by default, and `--max-nodes` raises it to at most
20,000, at the cost of a longer walk and a larger result.
It searches web content only: a native window (Finder, a SwiftUI app) holds no web area and is
`not_found`, as AppKit offers no search, so there use `observe` with `--max-nodes`, or act through the app's own UI.
- It needs `--role`, `--text` or both, else `usage`. A role is matched as `observe` names it
  (`button`, `link`, `statictext`). The text is matched against the element's own `title` or
  `value`, ignoring case; give a text that starts with `-` as `--text=-x`.
- With `--text`, an element inside another match is left out, so a list item and its own text
  come back as one match: in Safari the list item (`group = "Item 2500"`), in Chrome Canary
  the text (`statictext = "Item 2500"`).
- It returns `{snapshot, window_id, pid, frame, matches: [{index, role, title?, value?,
  frame}]}`, matches in page order. That is a new snapshot: every match has an index, whether
  or not `observe` would give it one, so act on it as `<snapshot>:<index>` (`click k7.13:0`).
  A disabled match gets an index too; a `click` on it is `action_failed`,
  with nothing sent.
- `--limit` is 50 by default, from 1 to 2,000. More matches add `"truncated": true` after
  `matches` and print `find: matches cut at <n>` on stderr.
- The snapshot has no screenshot, so it takes no pixel targets, and its matches keep no tree
  path: a recorded action on a find target writes no line and is `record_failed`.

## Text in pixels: `--ocr`

`--ocr` also reads the window's text from its pixels, with Apple's Vision on
the Mac, for text the tree does not hold (custom-drawn lists, canvases, images of text). It
takes the screenshot, needing the Screen Recording grant too, and adds `ocr`:
`[{text, box, target}]` in reading order, rows top to bottom and each row left to right. `box`
is in the PNG's pixels, and `target` is the entry's text target, `<snapshot>:t<n>` (see [targets.md](targets.md)). It lists at most 500 entries, and adds `"ocr_truncated": true` when it cut the
list. A line splits into entries where its ink leaves a gap wider than half its height, so two
controls side by side are two entries. A single space of monospace text is no
such gap: a single-spaced line of SF Mono or Menlo, a terminal's, is one entry, glowing or not,
so `find-text` of two words in it matches and its `target` aims at the whole line's centre.
It can still split at two spaces or more, between words too short to show the character grid
(`OK GO`), beside a one-character word, and at a word Vision misreads into more or fewer
characters. `--ocr-region <x>,<y>,<w>,<h>`, in points from the window's top-left, reads only that
part; boxes and targets stay in the whole PNG's pixels. It reads `en-US` by default, and
other scripts then come back as confident false Latin text. `--ocr-language <code>` (with `--ocr` only, else `usage`) reads one of the 33 languages
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
gives no confidence: check what matters against the tree or the PNG. On
macOS 26, a capture under 1.5 pixels a point, as a 1x display gives, is read drawn at twice
its size, its boxes and targets still in the PNG's pixels: it reads far more of the text
right, and takes about three times as long, so read a large window in parts with
`--ocr-region`. On macOS 26 a lone `0` or `O` after a word can also read as a lowercase `o`.
The first `--ocr` after a goldfinger install, a macOS update or a purge of Vision's cache
compiles Vision's model, about 35 s alone and minutes behind other compiles, past the verb's
20 s limit: that call fails `timeout`, the compile runs on, and `--ocr` fails `timeout` at once
until it ends. The first read in each other `--ocr-language` compiles that
language's model the same way, about 14 s alone for `ar-SA`. Observe with `--ocr` again a
minute later. Anything else meanwhile, a plain
`observe` included, runs as usual. It reads print too small to see in the PNG, secrets
included, and your host may keep the text in its transcripts: read only windows the task
needs. The daemon keeps it in memory with its snapshot alone, never on disk or in its log,
but for a recording started with `--text-anchors` (see [sessions-and-replay.md](sessions-and-replay.md)).

## Controls in pixels: `--detect`

`--detect` also finds controls in the window's pixels, with a detection model
the app ships, for a control the tree, the screenshot and `--ocr` all miss, as an icon-only
button an app draws with no accessibility element: `goldfinger observe <window_id> --detect
--json`. It takes the screenshot, needing the Screen Recording grant too, goes with `--ocr`,
which runs first, and adds `detections`: `[{box, score, target}]` in reading order, rows as
`--ocr` builds them. It lists at most 300 entries, and adds `"detections_truncated": true` when
it cut the list. Text mode prints a `detect <target> <score>` line per entry after the tree and
any `ocr` lines.
- A detection is a `box` in the PNG's pixels, a `score` from 0 to 1 to 2 places, and a
  `target`, the pixel target of the box's centre (see [targets.md](targets.md)). It has no role,
  title or text: the model marks links, fields, rows and whole panels as well as controls, and
  a control can hold a box of its own inside a larger one. Tell which box is the control from
  the PNG, or from the tree and `--ocr` beside it.
- Scores are low by design: every box over 0.05 is kept. Rank by score, but never read a score
  as a probability.
- The model was trained on web pages, and it misses many native controls. Never take a
  control for absent because no box covers it.
- The model loads on the first `--detect`, not at the daemon's start: about 4 s after an
  install or an update, then about 0.1 s. A detection takes about 0.2 s, and 0.14 s warm. The
  daemon lets the model go 120 s after the last `--detect` (it holds 1.4 to 2.0 GB), so the
  next one loads again, fast. One detection runs at a time: one that passes its time fails
  `timeout` and runs on to finish, so call again; while it runs, another `--detect` fails
  `timeout` at once, and every other verb, a plain `observe` included, runs as usual.

## Read an earlier snapshot again: `ocr` and `find-text`

`goldfinger ocr <snapshot>
[--region <x>,<y>,<w>,<h>] --json` reads the text of a snapshot `observe` took with
`--screenshot` or `--ocr`, from the native-size capture the daemon keeps beside its PNG, and
returns `{snapshot, ocr, ocr_truncated?}`, its entries as `--ocr` gives them. The pixels are the
snapshot's, whatever the window shows now, moved, changed or closed.
- `--region` is `--ocr-region`'s, in points from the window's top-left as it was observed.
  `--ocr-language <code>` (on `ocr` and `find-text` both) is `observe`'s.
- The entries stay with the snapshot, numbered on from its last, so each `target` names one
  entry while the snapshot lives. A region the snapshot has already read (by `--ocr`, `ocr` or
  `find-text`; the whole window is one region) returns the same entries, numbers and all,
  without recognizing again.
- It needs no grant, sends nothing, is not recorded, and its `timeout` is retryable. A
  snapshot the daemon no longer holds (8 per window, 64 in all) is `stale_snapshot`; one
  without a screenshot, `invalid_target`.

`goldfinger find-text <snapshot> [--region <x>,<y>,<w>,<h>]
--json [--] <text>` is `ocr`'s read, or the one the snapshot holds, kept to the entries whose
text holds `<text>`, both lowercased with each run of whitespace made one space:
`{snapshot, matches, ocr_truncated?}`, matches in reading order, `"matches": []` when none.
An empty `<text>` is `usage`; the rest, errors included, is `ocr`'s. Act on a match's `target`:
`observe <win> --screenshot`, `find-text <snapshot> --json -- Save`, then `click` the match's
`target`. A `stale_snapshot` there means the window changed under you: observe again and
repeat.

## Pictures: `screenshot` and `capture`

For a picture alone, `goldfinger screenshot [<window_id>] --json` writes a PNG of the main display, or of that window
alone (with none of its sheets, popovers or other child windows, which
`observe` draws in), at its native pixels with no cap, and returns
`{"path", "width", "height"}`: a read under the Screen Recording grant, whose pixels no target names, in a file that is yours to delete.

`goldfinger capture <window_id> [--region
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
- It shows the window alone, as `screenshot` does, with no sheet or popover
  over it. A popover's own `window_id`, from `screenshot.windows`, captures the whole popover.

`goldfinger capture 4242 --region 120,300,400,300 --scale 2 --json`, then
`goldfinger click k7.12@200,150 --json` clicks the point 220,375 from the window's top-left.
