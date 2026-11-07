# Page text and Safari's tabs

These are reads: they keep no snapshot, act on nothing and are not recorded,
and their `timeout` is retryable. In Chrome and Chrome Canary, read a page through Huginn
instead (see [chrome.md](chrome.md)).

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
    each a grant or a Safari setting the operator gives (see [diagnose.md](diagnose.md)). It activates, raises and focuses nothing.
  - **`--via extension`** reads the same text through goldfinger's Safari extension instead,
    which finds the one Safari window at the window's frame whose current tab bears its title.
    A window id of Safari's only, as above. It needs neither the Automation grant nor the
    JavaScript setting, but the extension turned on and allowed on the page's site: each missing
    one is `permission_missing`, naming the Extensions pane, the extension's Edit Websites list,
    or `goldfinger doctor` for an extension Safari does not list. `not_found` also covers a
    window the extension cannot see (a private one) and a tab with no web page it may read (the
    Start Page).
  - A hidden app's window, or a target in one, needs the window on screen on every route,
    Safari's included: the focus fallback unhides the app for the read, and with `--background`
    it is `background_unavailable` (see A hidden app's window in [find-windows.md](find-windows.md)).
- `goldfinger safari-tabs <window_id> --json` lists a Safari window's tabs, left to right:
  `[{"index": 1, "title": "Example Domain", "url": "https://example.com/docs"}, {"index": 2,
  "title": "New Tab", "current": true}]`. `index` counts from 1, `title` is cut at 500 scalars,
  `url` follows the web keys' rule (origin and path only) and is left out for a tab with none,
  and `current` marks the current tab. It needs the Automation grant for Safari alone, as
  `--via apple-events` does, and fails as that does; another app's window is `invalid_target`,
  and tabs that change between its reads are `action_failed`.
