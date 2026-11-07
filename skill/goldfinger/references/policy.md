# App policy: apps the user limits

The user can name apps that goldfinger must not act on, or may act on only in part. The daemon
then refuses a verb on such an app with `denied`, before it sends anything.

- **The file is the user's.** It is `~/Library/Application Support/goldfinger/policy.json`,
  `{"apps": {"<bundle id>": "<tier>", …}}`, written by hand. Never create, edit, move, `chmod` or
  delete it, and never ask the user to loosen it so a task can go on: report the refusal, and
  the user decides. The daemon only reads it, and an edit takes effect at the next request.
- **Tiers.** A rule names one app by its bundle id, without case. Each tier allows its verbs and
  every verb of the tiers above it; an app no rule names is `full`:
  - `deny`: no verb that names the app, its reads included.
  - `view`: `windows --pid`, `status-items --pid`, `observe`, `find`, `text`, `safari-tabs`,
    `ocr`, `find-text`, `screenshot <window_id>`, `capture`, `glide`, `launch`,
    `voiceover start`, `voiceover speech`, `web-pages` and `web-dom`.
  - `click`: adds `click`, `scroll`, `hover`, `reveal`, `perform`, `drag`, `menu`,
    `status-item` (both forms), `window-frame`, `window-state`, `hide`, `unhide`, `quit` and
    `voiceover do`.
  - `full`: adds `type`, `keys`, `set-value`, `open`, `voiceover type`, `voiceover press`,
    `web-launch` and `web-script`.

  An action's `--observe` goes with its action. `click` means no keyboard, not no change: a click
  on a Paste item, or a `drag` of text, can still change the app. The built-in default list is
  empty, so with no file every app is `full`.
- **The app a verb acts on** is its target's: a snapshot target's pid, a `window_id`'s owner, a
  `pid`, or the `bundle_id` that `launch`, `open` and `web-launch` name. `voiceover do`,
  `voiceover type`, `voiceover press` and `voiceover speech` act on the frontmost app at the
  check. Verbs that name no app have no tier: `status`, `setup`, `stop`, `watch`, `apps`,
  `windows` and `status-items` without `--pid`, `screenshot` without a window, the clipboard
  verbs, the session verbs, `record-start`, `record-stop`, `voiceover stop`, `session-cursor` and
  `policy`.
- **A broken file fails closed.** While it does not parse or cannot be read, every verb but
  `status`, `stop`, `watch` and `policy` answers `denied`, naming the file and why. Tell the user;
  `goldfinger doctor --json`'s `policy` check names it too (see [diagnose.md](diagnose.md)).
- **Read the policy** with `goldfinger policy --json`: `{"file", "state", "apps"}`, `state` being
  `ok`, `none` (no file) or `unreadable` (then `error` says why), and `apps` every rule in force,
  each `{"bundle_id", "tier", "from"}`, `from` being `default` or `file`. It needs no grant, sends
  nothing, takes no `--session` (`usage`) and is never `denied`. `goldfinger status --json` also
  holds `"policy": {"file", "state", "entries"}`, and `status` is never `denied` either. Read the
  policy before a task in an app the user may have limited, so the plan uses only the verbs its
  tier allows.
- **No way around it.** On `denied`, do not retry, and do not reach the app another way: no
  other verb, CLI, script or other app's keys to get past the refusal. A display `screenshot`,
  an `observe --screenshot` whose PNG shows another app's window over its own, `clipboard-read`,
  and `apps`, `windows` and `status-items` without `--pid` still show a denied app's pixels,
  text and titles: never use them to read a denied app. The policy guards against mistakes; it
  is not a security boundary, so honoring it is your part.
