# Window frames, window state and the clipboard

These take no target and no `--observe`; the clipboard verbs need no grant and reach no app.

- `goldfinger window-frame <window_id> <x>,<y>,<w>,<h> --json` moves and resizes a window, in
  whole points from the top left of the primary display, as `windows` reports frames: `x` and
  `y` at least 0, `w` and `h` at least 1, else `usage`. So a window left of or above the primary
  display (a negative `x` or `y` in `windows`) cannot be framed there. It returns
  `{"frame": {"x", "y", "width", "height"}, "warnings": []}`, `frame` being the window server's
  read-back, never the request, as `windows` reports. It is `ok` once that read-back matches the
  request within 2 points, or when an app holds the window at a size of its own (its size steps,
  a minimum or a maximum): with the position matched and the size held, `frame` has the app's
  size, and `warnings` holds `frame_adjusted`. For a minimized window, the focus fallback
  restores it for the write and minimizes it again after (`"fallback": "minimized"`, see the
  focus fallback in [focus.md](focus.md)); with `--background` it is `action_failed`, nothing
  written: restore it first.
- `goldfinger window-state <window_id> minimize --json` minimizes the window to the Dock in the
  background, and returns `{window_id, pid, state, changed, warnings}`, `state` read back as
  `minimized` or `normal`. The window keeps its `window_id`, and `windows` lists it
  `on_screen: false`. `restore` brings it back as a foreground verb (see the foreground verbs in
  [focus.md](focus.md)); `minimize --foreground` is `usage`. A window already in the asked state
  is `ok` with `changed: false`, nothing written. One that cannot be minimized is
  `action_failed`, as is a write that does not read back within 2 s. The focus fallback reaches
  a window on another Space, which is `not_found` with `--background`. A hidden app's window is
  reached by the fallback too; with `--background` it is `background_unavailable`, nothing
  written: `unhide` the app first (see A hidden app's window in
  [find-windows.md](find-windows.md)). A `timeout` may still land, so check with `windows`. Zoom
  is not a state it sets: to fill the screen without full screen, give `window-frame` the
  display's visible frame.
- **Full screen:** `goldfinger window-state <window_id> full-screen --json` puts the window into
  native full screen, as a foreground verb (see the foreground verbs in [focus.md](focus.md)),
  and `state` reads back `full-screen`. macOS moves the window to a full-screen Space of its own
  and activates its app, so goldfinger restores the app before only once macOS has switched to
  that Space, which brings back the Space that showed before. With `--background` it is
  `background_unavailable`. A window that cannot go full screen (one that cannot be resized, a
  panel, a window with a sheet open, one its app keeps out, or a minimized one) is
  `action_failed`, nothing activated. `windows` lists a full-screen window whose Space does not
  show as `on_screen: false`, at its display's frame. `restore` takes it out of full screen in
  the background, activating nothing (no `activated` or `restored`), and `minimize` of it is
  `action_failed`, nothing written. A window the daemon did not make full screen, or made so
  before it restarted, is `not_found` while its Space does not show: the message names the app's
  Exit Full Screen menu item, as `goldfinger menu <pid> "View>Exit Full Screen"` in most apps.
- `goldfinger clipboard-read [--all] --json` returns the plain text as `{"text": "…"}`, or `{}`
  when the clipboard holds no plain text or an empty string; text beside other content is
  returned. It holds no 1 s guard, but may put the platform's paste alert in front of the user,
  which is not background: read it only when the task needs it. A denied read is an error, never
  an empty clipboard.
  - `--all` adds a key for each of these types the clipboard holds, each left out when it holds
    none or an empty one: `rtf` and `html`, strings (bytes that are not UTF-8 read as U+FFFD);
    `image`, `{"path": "…/goldfinger-clipboard-<uuid>.png", "width", "height"}`, a PNG file and
    its size in pixels, never the bytes (the clipboard's PNG, else its TIFF converted); and
    `files`, the absolute path of each file or folder on the clipboard, in order. Every other
    type (a PDF, a web archive, an app's own types) is left out.
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
  replaces everything on the clipboard with the types given and returns `{"warnings": []}`. Give
  at least one type, and none empty (`usage`). goldfinger adds no type of its own: `--rtf` alone
  writes no plain text, though a read then gets the plain text the platform derives from the RTF.
  - `--rtf` and `--html` take the RTF or HTML as a string. One that starts with `-` goes as
    `--rtf=<rtf>` or `--html=<html>`.
  - `--image` takes a PNG file (checked by its signature, at most 32 MiB, else `usage`), which the
    client reads and sends. The clipboard gets it as PNG and as TIFF, which some apps take alone.
  - `--file`, once per file or folder, puts files that paste in Finder as a copy of them. Each path
    resolves from your working directory and must exist (`usage`, naming it). The client checks
    them, never the daemon, so no folder-access prompt takes the user's focus.
  - What the user had copied is gone, and only what `clipboard-read --all` returns can be put
    back: no PDF and no app's own types. Write only when the task needs it.
