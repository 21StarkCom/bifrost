# The focus: background by default, the guard, the counter and the fallback

## Background by default

- **No verb takes the front by default.** A verb activates no app and raises no window, with
  these exceptions:
  - `setup` (interactive), and `quit` of the frontmost app.
  - The foreground verbs: `menu` (after its background try), `drag`, `window-state restore` and
    `full-screen`, and `perform … show-menu` (see the foreground verbs, below).
  - `voiceover start`, which leaves its app frontmost until `voiceover stop`, and
    `voiceover stop`, which makes the app before frontmost again.
  - The focus fallback (below), when a verb's task is impossible without the focus. The result's
    `fallback` key names it, and `--background` forbids it.
- **Only `hover` moves the mouse pointer,** for its hold alone.
- **The one window a background verb may raise is the user's own,** back in front of the target
  app's window (the counter, below), and it stays key.

## The guard and the give-back

- **The guard.** When any app activates during an action's 1 s guard, goldfinger puts back the
  app that was in front, even over the user's switch.
- **The watch.** goldfinger then watches the verb's target app (or the app `launch` or `open`
  opened) 5 s more. It puts the front back when that app takes the front with no key, click or
  mouse move from a person since the guard ended. A person's input since always wins.
- **Do not bring a target app forward yourself** (`open -a`, AppleScript `activate`) within 5 s of
  a verb on it: wait 5 s, or use a foreground verb, which ends the watch first. The verb has
  replied by then, so no warning says so; each give-back is a `give-back` line in the unified log:
  `/usr/bin/log show --info --last 10m --predicate 'subsystem == "com.21stark.goldfinger"' | grep give-back`.

## The counter

- **What it does.** At the end of each background verb's 1 s guard, goldfinger puts the user's
  window back on top when a window of the verb's target app stands in front of it at the normal
  level. It sends `AXRaise` to the user's app's key window, which stays key and keeps the
  keyboard, and the verb replies once that window is back on top (0.5 s at most).
- **What it does not do.** It lowers no window of the target app's and activates nothing. It
  raises nothing when the covered window is not the user's key window, as under a key panel at
  the floating level. It skips the raise while the target app shows an open menu (a later verb
  closes it) or a foreground verb holds the front.
- **What it misses.** An app can still raise its own window after a background action without
  activating, and so can a `web-script` whose script calls the app's own code (see
  [web-apps.md](web-apps.md)). A window the app moves to a higher level, such as the floating
  one, or raises after the guard, stays in front with no warning, while the user's app keeps its
  key window and the keyboard.
- **The log.** Each raise is a `counter-raise` line in the same log (`done=on-top`,
  `still-under`, `gone`, `not-key` or an AX error number).

## Menus over the user's window

These activate nothing, but show a window over the user's (see [actions.md](actions.md) and
[find-windows.md](find-windows.md)):

- `click --right`'s menu sits over every app and can bring the clicked window in front of the
  user's; the verb that closes the menu puts the user's window back on top.
- `set-value` on a native pop-up button does the same for the menu it shows to pick the item:
  that menu holds the user's key window until the pick closes it. After a pick, the button's
  window stays in front only until the verb's guard ends.
- `status-item <pid> <index>` opens a menu bar icon's menu or panel, which also shows over the
  user's window and, for a menu, holds the user's key window until it closes.

## The focus fallback: when goldfinger takes the front

Goldfinger takes the focus only when a verb's task is impossible without it, and
only for that verb's span. With `--background`, each case here is a refusal (below).

- **The background try comes first.** Each verb runs in the background first, as everywhere
  above. Only a refusal named below falls back: goldfinger puts the window on screen or the app
  in front, runs the request again, and puts back what it changed, even when the verb failed.
  Only the commands that take `--background` fall back, and each `batch` step does as its verb
  does.
- **The result names it.** A fallback adds `"fallback": "<reason>"`: `other_space`, `hidden`,
  `minimized`, `needs_front`, `not_key`, `web_click` or `front_app`. One that activated an app
  adds `activated` and `restored`, as a foreground verb does (see the foreground verbs, below). An
  error's message ends with what was switched, shown or activated, and whether it was put back.
- **The input gate.** Before a fallback switches a Space, activates an app (a minimized
  window's restore included) or hides the frontmost app, goldfinger waits for the keyboard and mouse to be still for 0.5 s, up to 3 s,
  so the user's next keystroke does not land in an app that is not theirs. Without that quiet it
  fails `timeout`, retryable, with nothing switched or sent. So does a request whose 20 s limit
  leaves less time than the fallback can take at its bounds. A `hidden` fallback takes no focus,
  so it runs no gate.
- **A window on another desktop** (`"fallback": "other_space"`), a macOS Space that does not
  show. The try reaches some of it: an element target there takes its press, insert or value
  write through its snapshot, and `screenshot` and `capture` of the window work, all with no
  switch. Mouse and key events go to the window as to any background window. What needs the window's accessibility window, as `observe`,
  `find`, `text`, `window-frame` and `window-state` do, is refused in the try, since the app's
  accessibility windows (`AXWindows`) leave out every window on a Space that does not show. Then
  goldfinger:
  1. fails `background_unavailable`, with nothing sent, when Mission Control's "Move left a space"
     or "Move right a space" shortcut is off, or set to a key other than Control-← and Control-→:
     its message names System Settings > Keyboard > Keyboard Shortcuts > Mission Control. The
     setting is the user's: tell them.
  2. waits for the input gate;
  3. posts Control-→ or Control-← once for each Space between, each read back within 2 s
     (about 0.6 s each); one that does not read back is `action_failed`, with nothing of the verb
     sent;
  4. runs the verb on that Space, whose front app macOS has made frontmost;
  5. switches back by as many keys the other way, then makes the app frontmost before frontmost
     again, even when the verb failed.

  The result adds `"space": {"from": <index>, "to": <index>}`, the 1-based indexes of the two
  Spaces on the window's display, as `windows`' `space` gives them, with `activated` and
  `restored`. A switch back that does not read back adds `space_restore_failed` to `warnings`,
  and a restore that does not, `restore_failed`. The verb is still `ok`: it landed.
- **A hidden app's window** (`"fallback": "hidden"`). A verb that needs it on screen (see A hidden app's window in [find-windows.md](find-windows.md)) runs again with the app unhidden, which activates nothing,
  once the window shows, and the app is hidden again after. A request whose limit leaves less
  than the 3 s the unhide, the wait and the hide can take fails `timeout`, retryable, nothing
  sent. An app that does not hide again adds `hide_restore_failed`. What reaches the window by
  element still runs in the try, the app staying hidden.
- **A minimized window** (`"fallback": "minimized"`). The try reaches it as a hidden app's
  window: `observe` walks it, and an element target takes its press or insert, the window staying
  in the Dock. A verb that needs it on screen, as a screenshot, `window-frame` or a pixel target,
  runs again once `window-state restore`'s foreground route has restored it, after the input
  gate, and the window is minimized again after, in the background. The result adds the
  restore's `activated` and `restored`, and a window that does not minimize again adds
  `minimize_restore_failed`. A window the restore finds shown already stays shown.
- An unhide or a restore that fails is put back too: its error's message ends with whether the
  app is hidden, or the window minimized, again.
- **A verb that needs its app frontmost** (`"fallback": "needs_front"`): `drag`,
  `window-state restore` and `full-screen`, `perform … show-menu`, a `menu` press the app
  rejected in the background, and a `menu` item disabled in the background of an app that is not
  frontmost run again by their foreground route (see the foreground verbs, below), after the input
  gate. A disabled `menu` item of the frontmost app stays `action_failed`. A `click` or `perform`
  on a window's green title-bar button enters full screen, so it runs as
  `window-state full-screen`, and its result has no `observe`: the window is then on a Space of
  its own, so observe it again. A right click on that button, or its `show-menu`, whose menu
  tiles the window, stays refused.
- **A verb that needs the key window of the frontmost app** (`"fallback": "not_key"`,
  `"web_click"` or `"needs_front"`): `keys` at an element target in a window that is not its
  app's key window, and a `cmd` combo, which macOS hands only to the active app (`not_key`); a
  single left click, or keys, into web content outside the Chromium family that no press carries
  (`web_click`); and `perform` of `raise` or `zoom-window` (`needs_front`). Each runs again after
  the input gate with its app activated and read back frontmost and the window raised, which
  makes it key; then the app before is restored. What went before the refusal is never sent
  twice, so these stay refusals: `keys` at a pixel target, whose focusing click went first;
  `type`'s key fallback, whose insert went first; a press into web content the app rejected,
  which the app may still have acted on; and a window off screen, hidden, minimized or on another
  Space, which an activation would show with no put-back. An app whose own refusal stands with it
  in front, as a menu's disabled item, returns that refusal.
- **`hide` of the frontmost app** (`"fallback": "front_app"`): after the input gate it hides the
  app, macOS gives the front and the keyboard to the next app, and nothing gives them back, since
  the hide is the focus change itself.
- **Still out of reach:** a window on a Space that does not show on another display, a hidden
  app's window on another Space, and a window on no Space. A put-back the app policy refuses for
  the app (`unhide`, or a `window-state` restore) leaves the try's refusal (see [policy.md](policy.md)).
- **`--background`** (MCP `background: true`) keeps the try alone: no fallback runs, and each case
  above fails: `not_found` for a window on another desktop that its app's
  `AXWindows` leaves out, `background_unavailable` for the others. `observe`, `find`, `text`,
  `ocr`, `find-text`, `screenshot`, `capture`, `click`, `hover`, `type`, `keys`, `scroll`,
  `set-value`, `reveal`, `perform`, `window-frame`, `window-state`, `menu`, `drag`, `hide` and
  `batch` (for each step) take it. Any other command takes no `--background` (`usage`), and
  `--background` with `--foreground` is `usage`. Pass it when the user must keep the screen as it is, as when they ask that
  goldfinger never take the front: then a refusal is the answer, and you tell the user what the
  task needs.
- **The log.** Each fallback is a `fallback` line in the unified log, at notice, naming the verb,
  the reason and `done=ok` or the error code, and each put-back the app policy refused one with
  `done=denied`, at info. Nothing typed or read is logged:
  `/usr/bin/log show --info --last 10m --predicate 'subsystem == "com.21stark.goldfinger"' | grep fallback`.

## Menus, drag and restore: the foreground verbs

`menu`, `drag`, `window-state restore` and `full-screen` (see
[windows-and-clipboard.md](windows-and-clipboard.md)) and `perform … show-menu` (see
[actions.md](actions.md)) run in the foreground by the focus fallback
(`"fallback": "needs_front"`, above). With `--background` and without `--foreground` they fail
`background_unavailable`, before anything is resolved, activated or sent, and `menu` runs its
background press alone. Leave `--foreground` off: goldfinger then waits for the
input gate before it takes the front, and `menu` tries its press in the background first.
`--foreground` still asks for the foreground route at once, and `--foreground --background` is
`usage`. No other verb takes `--foreground` (`usage`).
In the foreground, goldfinger activates the target's app for the action
alone, which may raise its window, then restores the app frontmost before, even when the action
failed; `show-menu` restores it only once its menu closes. The user sees a brief switch and loses focus that long: use these only where no
background verb reaches. `menu` and `window-state` take no `--observe`, and `drag` takes it. A foreground verb run while a `show-menu` holds the front restores the app before
that `show-menu`, which closes its menu.

- `goldfinger menu <pid> "<menu_path>" --json` presses an item in the menu bar of
  app `pid`. The menu path is titles from the menu bar down, joined by `>` and quoted, or the shell
  takes `>` as a redirect: `"File>Export…"`, `"Edit>Find>Find…"`. Each segment matches one title
  exactly, case and spaces included (a title's `…` is usually one character, not three dots),
  and the first match is taken; an empty path or segment is `usage`. Only the last item is
  pressed, without opening the menus above it. `menu` names no window: find the app's with
  `windows --pid`, and observe the effect.
  - **Background first.** Without `--foreground`, `menu` presses the item in the
    background first, inside the 1 s guard, with no app activated; such a result has no
    `activated`, `restored` or `fallback`. A press the app rejects (`action_failed`), and an item
    disabled in the background of an app that is not frontmost, run again with the app activated:
    an app enables many items only while it is active, as TextEdit's `Window>Minimize` reads
    disabled from the background. A disabled item of the frontmost app stays `action_failed`, with
    nothing pressed. Every other error stands: a walk that fails and an item that opens a menu fail
    the same in front, and a `timeout` at the press may have landed. With `--background` the
    background press alone runs.
- `goldfinger drag <from> <to> --json` presses the left button
  at `from`, drags in a straight line to `to` and releases there, its events sent to the app as `click`'s are, so the
  mouse pointer stays where it is. `from` and `to` are targets in one window, aimed as `click`
  aims: an element at its visible centre, a pixel at its point. A control that tracks a press in
  its own loop may ignore the drags while the verb succeeds: check with `observe`, and set a
  slider with `set-value`. On macOS 26, AppKit's drag and drop drops nothing: a view's drag
  source, a table's row reorder and a web page's HTML5 drag and drop in WebKit end where they
  started while the verb succeeds, since the drag session there follows only the mouse pointer;
  SwiftUI's drags still drop. Check the drop with `--observe`. A `from` in
  LibreOffice is `background_unavailable`, even with `--foreground`, before anything is activated:
  the app places each mouse event at the mouse pointer, active or not.
  No background route is known for a drag, so without `--foreground` it always
  takes the front by the focus fallback (`"fallback": "needs_front"`), after the input gate, and
  with `--background` it is `background_unavailable`, nothing activated or sent.
- **The drag's window comes to the front.** Before the press, `drag` raises the
  window its targets are in, then the app's window over it at `from`, on every macOS. A drop lands
  on whichever window is in front at the point. After the restore those windows
  stay in front of the windows they were behind. A window the app does not list, or a raise it
  refuses, still drags.
- `goldfinger drag <from> <to> [--via <target>]... [--observe] --json` drags along a path: one `--via` per point it passes through, in order, 1 to 64, each a
  target in `from`'s window, resolved and aimed as `to` is before anything is activated. Each
  segment is cut into steps of 10 pt at most, with an event at every via, at about 400 pt a
  second. A via in another window, or a path past 400 events (about 4,000 pt), is
  `invalid_target`, nothing activated or sent. `--observe` observes the window once the release
  is taken and the app before is back, so the drop's effect reads back in the same call:
  `goldfinger drag k7.12:3 k7.12@880,210 --via k7.12@500,400 --via k7.12@700,120 --observe
  --json`.
- `goldfinger window-state <window_id> restore --json` restores a minimized window: macOS brings a restored window in front of the front app's, so its app is
  activated for the restore, and the app before is put back in front. A window that is not
  minimized is `ok` with `changed: false` and activates nothing, so no `activated` or `restored`.
- **Result:** `{"warnings": [], "activated": {…}, "restored": {…}}`: the apps brought to the
  front and put back, as `pid`, `bundle_id` and `name`, both omitted when the target's app was
  already frontmost, and `restored` alone omitted when no app was frontmost before or with
  `restore_failed`. After activation was asked for, an error's message ends saying which app was
  activated and whether the one before was restored. A run the focus fallback
  made adds `"fallback": "needs_front"`.
