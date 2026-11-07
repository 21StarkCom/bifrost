# Act on a target: click, type, keys, scroll, set-value, perform and hover

## Act

Act on a target from a snapshot (see [targets.md](targets.md)).

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
    clicked window in front of the frontmost app's. It stays there only until
    the verb that closes the menu ends its guard, which puts the frontmost app's window back
    on top (the counter). The open menu can take
    the key window. Nothing is activated. That is the background guarantee's exemption for the
    menu `--right` shows; the
    other exemption for a menu is `set-value`'s on a native pop-up button. So
    is the menu or panel `status-item <pid> <index>` opens, for as long as it shows: the
    menu's window at the menu level, or the panel's above layer 0, stands over the front app's
    window, and the menu takes the key window until it closes. Nothing is activated, and no
    window of the icon's app at layer 0 is raised. `status-item --item` shows no window and
    keeps both guarantees. A `click` or `keys`
    that fires an item, or `keys <target> escape`, closes the menu, and a pixel target inside
    the open menu goes to the menu's window; on macOS 26, a single left click there presses the item at the point instead, and is
    `background_unavailable` on no item or a disabled one.
  - **The menu `--right` opens.** The result carries `"menu_window_id": <id>`
    when exactly one new window of the target's app is at the pop-up menu level after the
    hold, and no such key when none or several are (an element with no menu, or a menu that
    closed inside the hold). `goldfinger observe <menu_window_id> --json` reads the open menu:
    `tree[0]` is the `menu`, index 0, which lists `cancel`, and its items follow as `menuitem`
    nodes, an enabled one indexed, a separator or a disabled item not. A
    submenu's items sit under their submenu's item, one level deeper, indexed the same way,
    read while the submenu is closed; an app that fills a submenu as it opens shows what it
    held before (Finder's Quick Actions held only Customize…). `click <menu-snapshot>:<index>`
    presses an item through accessibility, which fires it once and closes the whole menu, and
    `perform <menu-snapshot>:0 cancel` closes it with nothing fired.
    `observe` reads no other window at the pop-up menu level but the menu that `show-menu` or `status-item` reports (a menu an app opened on its own
    is `not_found`, naming all three verbs), the menu
    snapshot goes stale once the menu
    closes, and an action's `--observe` on one of its targets gives `observe_failed`, as the
    press closed that window. A recording keeps no line for a menu snapshot's targets (see [sessions-and-replay.md](sessions-and-replay.md)). An app that gives the show-menu action no answer
    within 5 s (Finder answers a file's only once the menu closes) may still have opened the
    menu: the click then succeeds with `menu_window_id` when exactly one is new, after about
    6 s, else fails `timeout`. A `batch` `click` step's result carries `menu_window_id` too,
    but no later step can read the menu, as `observe` is no step. A web page's own menu,
    Safari's or Chrome's, lists `cancel` but does not take it.
  - **The route:** the result names how the click went: `"route": "press"`,
    an accessibility press, which goes through any cover over the element; `"mouse"`, mouse
    events, which a cover in the target's window takes (a pixel target, `--double`, or the
    fallback of a press the app rejected); `"select"`, on macOS 26 a table row's selection
    that stands in for a pixel click; or `"focus"`, in LibreOffice the focus
    of an element that stands in for a click (below). `press` says the press went, not that it
    acted: observe to see what it did.
  - **LibreOffice** (bundle id `org.libreoffice.script`, Calc, Writer and
    every other module). It places each mouse, drag and wheel event at the mouse pointer, not
    at the event's point, active or not, so it gets no mouse event from goldfinger, which never
    moves the pointer. A single left click at a pixel is the accessibility action of the
    element the app's hit test names at the point, or of its nearest parent in the target
    window that takes one: its press when it offers one (`route: "press"`), else its focus
    (`route: "focus"`). The focus moves Calc's cell cursor to a cell and Writer's caret to the
    start of a paragraph, and on a text area, as Writer's paragraph, puts the caret at the
    character at the point. An element target that offers no press, as Calc's cell, takes its
    focus the same way; one that offers it is pressed. Each is `ok` with `effect_unverified`,
    as LibreOffice answers every press and write with success whether it acted or not: observe
    to see what it did (Calc's Name Box names the cell). `--double`, `--right` at a pixel, a
    rejected press's mouse fallback, a point where no element takes either, and a point whose
    element reads disabled are `background_unavailable`, nothing sent.
  - **macOS 26 table rows.** There, an AppKit table selects a row on a click
    only in its key window. So a single left click at a pixel (and the click of a pixel
    target's `type` and `keys`) on an AppKit table's or outline's row, or on a cell, text or
    image in one, outside the frontmost app's key window sends no mouse event: it selects that
    row (`route: "select"`), replacing the table's selection as a click does, but does not run
    the table's action, which a click in the key window runs. A row the table's delegate
    refuses stays unselected, and a selection the app rejects is `background_unavailable`,
    nothing sent. A control in a row (a button), a point outside the rows, `--right` and
    `--double` still get mouse events, and a `--double` on a row selects nothing in the
    background. Observe to see the selection.
  - **A disabled target is refused:** an element that reads disabled
    (`AXEnabled` false) is `action_failed` ("the element is disabled (AXEnabled is false);
    nothing was sent"), not retryable, and nothing is sent. `observe` gives a disabled element
    no index, so this meets a target that became disabled after its observe, or a `find`
    match. Observe again, and act on what enables it. It covers `--double`, `--right`,
    `hover --click` and a `batch` `click` step; a pixel target is not checked.
- `goldfinger type <target> <text> --json`: the text arrives exactly once
  - **Route, and a field that ignores the insert:** the result names how the
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
    A pixel target in such content is clicked by the press of its element
    (see the single click in [targets.md](targets.md)), and the text goes into that element under
    this rule once it reads focused. A press that left the element unfocused is
    `background_unavailable`, the press sent and no text; no element there that offers a
    press is `background_unavailable`, nothing sent.
  - **Chromium fields** (an element in a `webarea` of an app of the Chromium
    family, Chrome's and Electron's among them) take the text as key events alone
    (`route: "keys"`): a background Chromium page answers an accessibility insert and drops
    it. The page sees each character as a key and an `input` event. A tab in the text goes in
    as a tab character, and a line break is dropped: send a line break as its own
    `keys <target> return`. The keys go only into the app's key window, else
    `background_unavailable` with nothing sent, and a hidden app's window is refused the same
    way. Chromium's native fields, such as Chrome's address bar, still take the insert.
  - **Native secure fields** (AppKit's and SwiftUI's password fields, outside web content, in
    an app outside the Chromium family) in a background app take the text as their value, and only while empty and
    being edited, the caret at the start; the caret must then read at the text's end. One that
    holds text, is not being edited or reports no selection, or whose caret did not reach the
    end is `action_failed`, with no keys sent, so typing again cannot double it. An empty
    WebKit password field that drops the insert takes the text as its value too.
  - **LibreOffice** answers the insert with success whether it took it or
    not: Writer's paragraph takes it, Calc's cell drops it. So the insert counts
    (`route: "insert"`) only when the element's character count, selection or value moved;
    otherwise the text goes as key events (`route: "keys"`), under the key window's rule, to
    where the click or the focus left Calc's cell cursor or Writer's caret. Those keys can drop
    too: in a window LibreOffice opened in the background and never showed active, Calc
    dropped every key, while Writer took them once a paragraph was focused. So after the hold
    goldfinger reads the element, the app's focused element and how often the text shows in
    the window's tree (Calc's input line shows it), and again 250 ms later: all as before both
    times adds `text_unchanged`, and the verb stays `ok`. A read with no answer judges nothing,
    so observe either way. A pixel target is clicked as `click` clicks in LibreOffice, and the
    text goes into that element, not the app's focused element, which can be in another of its
    windows; a point where no element takes a press or the focus is `background_unavailable`,
    nothing sent.
- `goldfinger keys <target> <combo>... --json`: combos such as `shift+tab` or `ctrl+a`,
  modifiers first and one key last. Modifiers are `shift`, `option`/`alt`, `ctrl`/`control`
  and `fn`; keys are `return`, `tab`, `space`, `delete`, `escape`, `up`, `down`, `left`,
  `right`, `home`, `end`, `pageup`, `pagedown`, `f1`–`f12`, `a`–`z` and `0`–`9`, nothing else
  (no `enter`, no `esc`). A `cmd` combo, and keys at an element target in a window that is not
  its app's key window, run with the app in front (`"fallback": "not_key"`, see the focus
  fallback in [focus.md](focus.md)); keys at a pixel target stay refused there. With
  `--background`, a `cmd` combo is `background_unavailable`: click the control it would reach
  instead, or use `menu`. A dead key composes with the next combo, as
  typing them would: `option+e e` gives `é` under a U.S. or ABC input source, and before a
  combo that types no text of its own (`return`, `ctrl+a`) the accent is typed alone first. A
  dead key that is the last combo is sent as its own press, which the app may compose with the
  next key it gets. A pixel target in web content outside the Chromium family is
  `background_unavailable` before its click, nothing sent: key events
  reach no background web content, whatever a press focused there. Use `type` or `set-value`
  on the element. A pixel target in LibreOffice is clicked as `click` clicks
  there, by the press or the focus of its element, and its keys land as `type`'s keys do there;
  a point where no element takes either is `background_unavailable`, nothing sent.
- `goldfinger scroll <target> up|down|left|right [lines] --json` (3 lines by default). A target in LibreOffice is `background_unavailable`, nothing sent, as the app
  places the wheel event at the mouse pointer: reach the cell with `click` or `keys` instead.
- `goldfinger set-value <target> <value> --json`: element targets only, read back, compared.
  For a text field the read-back is its text, not the value its app makes of it: an AppKit
  field with a formatter reads back the text as written, so the verb is `ok`, and then rejects
  it, leaving its value empty (a field that takes 0 to 100, given 250). No accessibility read
  tells the two apart, so there `ok` means written and read back, not accepted.
  In an app of the Chromium family, Chrome's and Electron's among them, a
  read-back that differs is read again each 50 ms, up to ten more times, until it matches, as
  that tree follows a write a moment behind it; one that still differs is `action_failed`.
  - **A pop-up button.** A native pop-up button (role `popupbutton`) outside
    web content, in an app outside the Chromium family, takes no value write, so `set-value`
    picks the item whose title is the value, exactly, from the button's menu: it sends the
    show-menu action, waits up to 1 s for the menu's items, presses the first item with that
    title, and reads the value back for up to 1 s. While the menu shows, it sits over every app and
    holds the user's key window, as `click --right`'s menu does; nothing activates, and after
    a pick the guard's end puts the user's window back on top (the counter). A web page's
    `<select>` and a Chromium-family app's pop-up button keep the value write.
  - **When the pick fails.** A title no item has is `not_found`, the message listing the
    titled items in order: pick one of those. A disabled item is `action_failed`; for either,
    nothing is pressed. A menu that shows no items within 1 s is `action_failed`, a read-back
    that still differs is `action_failed` ("pressed the pop-up button's item …, but the element
    reads back …"), and a menu whose items show only after the verb's limit is `timeout`, no
    item pressed. An app that gives the show-menu action no answer within 5 s still gets the
    pick when its menu shows the items, as with `click --right`, and is `timeout` when it shows
    none. A disabled pop-up button is `action_failed` and a hidden app's is
    `background_unavailable` (`unhide` the app first), both with nothing sent.
  - **The menu closes.** After a `not_found`, a disabled item, a rejected press, a press
    that left the menu showing (an item with a submenu) or the verb's limit, the verb cancels
    the menu through one of its items, which closes it before the reply (on macOS 27.0.1 the
    menu's own `AXCancel` leaves it open). The message says "the menu was closed". When it
    says the menu "was sent AXCancel and still showed" or "may still show", tell the user a
    menu may be open over every app, holding their key window, so they close it with escape
    or a click elsewhere.
  - Each pick is a `popup-pick` line in the unified log, `done=picked` or the failure's
    `done=` (`not-found`, `disabled`, `no-menu`, `differs`, `timeout`, an AX error number or
    `error`), with no title.
- `goldfinger perform <target> <action> --json` or `goldfinger perform <target> --custom
  <label> --json` sends one accessibility action the element lists in its
  node's `actions`, or one of its `custom_actions` by label, in the background:
  `goldfinger perform k7.12:7 increment --json` returns
  `{"warnings": [], "action": "increment", "value": {"before": "50", "after": "55"}}`.
  - Element targets only; a pixel or text target is `invalid_target`. The element's list is
    read again when the action runs: one it does not list is `action_failed`, nothing sent,
    naming what it offers. A label no custom action has, or two share, is `not_found`
    ("ambiguous" for the second), nothing sent.
  - `action` is one of the six short names, or its `AX` name (`AXIncrement`). `raise` and
    `zoom-window` raise a window; `press` and `pick` are `usage` (use `click`), `scroll-to-visible` is `usage` (use `reveal`), and so is any other
    name. `--foreground` on any other action, or with `--custom`, is `usage`. The focus fallback runs
    `raise` and `zoom-window` with the app in front, `show-menu` by its foreground route, and a
    `perform` on the green title-bar button as `window-state full-screen`, each
    `"fallback": "needs_front"`; that button's `show-menu` stays refused (see the focus fallback
    in [focus.md](focus.md)). With `--background`, each is `background_unavailable`; the
    message for `show-menu` names `click --right`, and to pick a native pop-up button's item,
    use `set-value`.
  - **`show-menu` in front:** `goldfinger perform <target> show-menu --json` is a foreground verb (see the foreground verbs in [focus.md](focus.md)). It activates the
    element's app, sends its show-menu action once, and returns `menu_window_id` as
    `click --right` does, which `observe` reads and whose items `click` presses (see The menu `--right` opens, above), also when the app gave no answer within 5 s but opened the menu. An app's
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
    error the app answered, may have run, so observe before sending it again. It is a `batch` step, by `action` or by `custom` (see [batch.md](batch.md)).

## Observe again

Observe again once the UI may have changed, or add `--observe` to `click`, `type`, `keys`,
`scroll`, `set-value`, `reveal` or `perform` (not `launch` or `quit`) to get the window's new observe result back as `observe` in
the same call. A cut one holds its `truncated` there. It also prints
`observe`'s cut line on stderr, `observe: tree cut at <n> nodes` or the time form, with or
without `--json`, and the line for a node that gave no answer when it carries `unanswered`.

- **`--max-nodes <n>`** (it needs `--observe`, else `usage`, nothing sent)
  sets that observe's node limit as `observe --max-nodes` does, on every verb that takes
  `--observe` and on a `batch` step (see [batch.md](batch.md)): 1–20,000, any
  other value `usage`, and without it the default, 2,000. On `hover` it cuts only the observe returned: the observe in the hold that
  `--click` presses from keeps the default limit (see Hover, below).
- **`--observe-ocr`** (it needs `--observe`, else `usage`) also reads the
  window's text in that observe, as `observe --ocr` does, its whole window and no region, so
  the `observe` gains `ocr` and its text targets: the way a `batch` reads text between its
  steps. Every verb that takes `--observe` takes it, `hover` and `drag` included. The verb
  needs the Screen Recording grant before it acts (`permission_missing`, nothing sent). Once
  the action has landed, a capture or recognition that fails or runs out of time, one still
  running from an earlier request (Vision's model compiling), or a hidden app's window gives
  `observe_failed`, and the verb stays `ok`. The read has what is left of the 20 s limit, at
  most 8 s; a warm one takes under 2 s.

Every action (`click`, `type`, `keys`, `scroll`, `set-value`, `reveal`, `perform`, `window-frame`, `window-state`, `clipboard-write`,
`menu`, `drag`, `hover`, each `batch` step) and every `launch`, `open`, `hide` and `unhide` takes
at least 1 s, its guard.
`goldfinger quit <pid> [--force] --json` returns `exited`: `false`, still running after 15 s, is
not an error. `goldfinger stop` stops the daemon every agent shares, staling all snapshots and
ending all sessions; run it only as the errors say.

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
    `--max-nodes` cuts this observe alone, and `--click`'s keeps the default
    limit. A cut walk is a prefix of the whole one, indexes included, so an index a first
    `hover --observe --max-nodes <n>` returned is the element's in `--click`'s observe too, up to
    that observe's 2,000 nodes. An index past them, from a `--max-nodes` above
    2,000, is `invalid_target` there.
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
  `observe`, `observe_ocr` and `max_nodes`. A
  `--click` press whose mouse fallback goes into web content outside the Chromium family is the
  press of the element at the point, with `effect_unverified` (see the single click in [targets.md](targets.md)).
