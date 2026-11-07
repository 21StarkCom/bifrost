# Find the window: apps, windows, menu bar icons, open and hide

## Apps and windows

`goldfinger apps --json` lists running apps (`pid`, `bundle_id`, `name`,
`active`, `hidden`). `goldfinger windows [--pid <pid>] --json` lists windows front to back
(`window_id`, `pid`, `title`, `frame`, `on_screen`, and `space`: the 1-based
index of the window's Space, a macOS desktop, on its display, in Mission Control's order, or
`null` for a window on every Space, on none, or on one no display lists). `goldfinger launch <bundle_id>
[--new-instance] --json` opens an app without activating it and returns its `pid`.

## Menu bar icons

- **Find a menu bar icon:** `goldfinger status-items [--pid <pid>] --json`
  lists the menu bar icons of each running Dock or accessory (menu bar only) app, or of the
  `--pid` process alone, left to right: `{"items": [{"pid", "bundle_id", "name", "index",
  "title"?, "description"?, "frame", "menu"?}], "unanswered": [<pid>]}`. `index` is the icon's
  place among its app's icons, from 0, and can skip; `frame` is in whole points, as `windows`
  gives a window's; `title` and `description` are there only when they hold text (most icons
  have one of the two, or neither). An icon whose closed menu lists a titled
  item also has `menu`: `[{"title", "enabled", "menu"?}]`, in the app's order, a submenu's
  items under its item as `menu`, down to 8 levels. AppKit lists an `NSStatusItem`'s menu under
  its icon whether or not it shows. A separator, or any other item with no title, is left out.
  An icon that opens a panel lists no menu, so it has no `menu`, and neither has an icon whose
  menu lists no titled item. An app that fills its menu as it opens shows what it held before,
  as in `observe`. A read of the menu that gets no answer puts its app in `unanswered`. It reads
  only: it opens no menu, presses or raises nothing, keeps no snapshot and is not recorded.
  `status-item` (next step) names an icon by its `pid` and `index`. It needs the Accessibility
  grant. `unanswered` names
  each app that gave a read no answer within 0.25 s, or that the verb's time cut, with none of
  its icons; a process that serves no accessibility answers at all is there at every call (on
  macOS 27.0.1, WebKit's helper processes, `ARDAgent` and `UniversalControl`): ignore those,
  and call again, or with `--pid`, for an app you expected an icon from.
- **Open or press a menu bar icon,** the icon by its `pid` and `index` from
  `status-items`. List the icons again before you act: an app that adds or removes an icon
  moves the indexes after it. Both forms run in the background, through accessibility, with no
  mouse event, and need the Accessibility grant. Neither takes a target, `--observe` or
  `--foreground`; neither is a `batch` step or recorded, and both leave a session's cursor
  where it is.
  - `goldfinger status-item <pid> <index> --item <path> --json` presses the item at `<path>` in
    the icon's closed menu, the menu `status-items` lists as `menu`. `<path>` is titles from the
    icon's menu down, joined by `>`, as `menu`'s path is: `One`, `Recent>Clear`. Each segment
    matches one title exactly, case and spaces included, and the first item with that title is
    taken. The menu does not open: no window shows, the key window stays, and nothing is
    raised. Prefer this form whenever `menu` lists the item. An icon that lists no menu has no
    item to press: `not_found`. Its other errors are `menu`'s: `not_found` names the segment,
    where it looked and the titles there; a disabled item, or one that opens a submenu, is
    `action_failed` with nothing pressed. A `timeout` at the press may have landed: check the
    app's state before you press again.
  - `goldfinger status-item <pid> <index> --json` opens the icon's menu or panel by the icon's
    press, and returns `{"warnings", "menu_window_id"?, "window_id"?}` after its 1 s hold. It
    has `menu_window_id` for a menu: `observe <menu_window_id>` reads it as a `click --right`
    menu (see The menu `--right` opens in [actions.md](actions.md)), `click <menu-snapshot>:<index>` presses an item, which
    fires it once and closes the menu, and `perform <menu-snapshot>:0 cancel` closes it with
    nothing fired. It has `window_id` for a panel, as Goldfinger Control's, which `observe`
    reads as any window when the app lists it among its windows. A popover under the icon is
    in no `AXWindows`, so `observe <window_id>` answers `not_found`. A panel takes no cancel: the same `status-item` call again
    closes it, and returns neither key. Neither key also means that nothing new showed, or
    that a menu or panel opened and closed inside the hold. While the menu or panel shows, it
    stands over the user's window, and a menu takes the key window until it closes: close it
    as soon as the task allows.

## Open, hide and show

- **Open files in an app:** `goldfinger open <path|url>... [--app <bundle_id>]
  [--new-instance] --json` hands files, or URLs whose scheme the app claims, to the `--app` app,
  else to the files' default app, never activating it, and returns `{pid, bundle_id, name,
  warnings, windows}`. `windows` holds the ids of the app's windows new since the open (less the text input window that never shows: untitled, 500 × 500 at the main
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
- **An app that re-executes itself,** as LibreOffice's `soffice` does as it
  starts: on macOS 27.0.1 LaunchServices loses its pid and reads -1 for it. goldfinger then
  takes the pid of the one process that runs the app's executable, so `apps`, `open`, `launch`
  and `quit` name that process. An instance with no such process, or more than one, keeps -1,
  and an `open` into one whose process is not found is still `action_failed`, its message
  saying so.
- **Hide and show an app:** `goldfinger hide <pid> --json` hides every window
  of the app, and `goldfinger unhide <pid> --json` shows them again at their place in the
  stack, not in front, both without activating any app: `{pid, hidden, warnings}`, `hidden` read
  back from the app. An app already in that state is `ok`, nothing sent. `hide` of the
  frontmost app is `background_unavailable`, nothing sent, since it would move the user's
  focus: with `hide <pid> --background`. Without `--background`, it hides that app (`"fallback": "front_app"`) once the user's keys
  and mouse are still (the input gate, see the focus fallback in [focus.md](focus.md)): macOS gives the front and the
  keyboard to the next app, and nothing gives them back, since the hide is the focus change
  itself. A hidden app's windows read `on_screen: false`.
- **A hidden app's window.**
  The app's tree still holds the window and answers, so these reach it, the app staying
  hidden and inactive: `observe` without `--screenshot`, `--ocr` or `--detect`, an action's
  `--observe`, and an element target's `click` (its press), `type` (its insert), `set-value`
  (but on a native pop-up button), `perform` and `reveal`. A target from a
  snapshot taken before the hide still resolves, as the window has not closed. These verbs
  need the window on screen: `observe
  --screenshot`, `--ocr` or `--detect`, `screenshot`, `capture`, a pixel or text target,
  `click --right` and `--double`, an element click's mouse fallback, `type`'s key fallback and
  `type` into Chromium web content, `keys`, `scroll`, `hover`, `drag`, `glide`, `perform …
  show-menu`, `set-value` on a native pop-up button, whose menu
  only a window on screen shows, `window-frame`, `window-state`, `find`, `text` and
  `safari-tabs`. With `--background`, each is
  `background_unavailable`, nothing sent, its message naming `unhide <pid>`: `unhide` the app
  before you act on its windows any other way. Without `--background`, the
  focus fallback unhides the app for the verb and hides it again after
  (`"fallback": "hidden"`, see the focus fallback in [focus.md](focus.md)), but where its rules keep the refusal.
  An action's `--observe-ocr` there gives `observe_failed`, as the window shows no pixels. A
  hidden app's minimized window, or its window on another Space, is still `not_found`.
