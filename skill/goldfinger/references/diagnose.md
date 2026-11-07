# Install, grants and diagnosis

## Install and upgrade

- **Install** on macOS (Linux is not built yet), in the order goldfinger's README gives:
  `brew tap 21StarkCom/tap git@github.com:21StarkCom/homebrew-tap.git` (the tap is private, read
  over SSH), `brew install --cask 21StarkCom/tap/goldfinger`, which installs `Goldfinger.app` and
  puts `goldfinger` on `PATH`, then `goldfinger doctor --fix`, which starts the daemon and
  Goldfinger Control and lists what is left.
- **Upgrade** with `brew upgrade --cask 21StarkCom/tap/goldfinger`, then `goldfinger doctor --fix`.
  The upgrade quits the daemon every agent shares: it ends every live session and quits each app
  `web-launch` started. Read `goldfinger status --json` first, and name those sessions and apps in
  your report.

## Grants: the operator's

Each grant below is a macOS privacy grant or a Safari setting, which only a person can give.
Never click a grant, and never change a Safari setting yourself.

- **Accessibility and Screen Recording:** the operator runs `goldfinger setup` once, in a
  terminal they watch: it opens each settings pane in turn, and waits up to 5 minutes for both,
  else fails `permission_missing`. It restarts the daemon, ending every live session. When a
  pane's list shows no Goldfinger, the operator adds the app with the `+` button under the list,
  then turns its switch on.
- **VoiceOver:** the `voiceover` verbs need VoiceOver's AppleScript control and the Automation
  grant for VoiceOver. The operator runs `goldfinger setup --voiceover` once, in a terminal they
  watch: it opens VoiceOver Utility, where they turn on "Allow VoiceOver to be controlled with
  AppleScript" with the admin password, then starts VoiceOver unless it runs, raises the
  Automation prompt, waits up to 5 minutes for each, and turns off the VoiceOver it started. It
  restarts nothing. `status --json` shows `voiceover_applescript` and `voiceover_automation`.
- **Safari**, only for the Safari reads (see [safari.md](safari.md)): the operator runs
  `goldfinger setup --safari` with Safari open, which asks for the Automation grant for Safari
  alone and restarts nothing, so no session ends. `text --via apple-events` also needs Safari's
  own setting, Settings → Developer → "Allow JavaScript from Apple Events", and `--via extension`
  needs goldfinger's Safari extension turned on in Safari → Settings → Extensions and allowed on
  the page's site. No verb changes either.
- **Check:** `goldfinger doctor --json` (below), or `goldfinger status --json`, which shows
  `"permissions": {"accessibility": true, "screen_recording": true}`. Neither raises a prompt.
  `permissions` also holds `safari_automation` (`granted`, `denied`, `not_asked`, which
  `setup --safari` asks, `not_running`, as macOS answers only for a running Safari, or
  `unknown`) and `safari_extension` (`enabled`, `disabled`, `not_installed` or `unknown`).

## Diagnose: doctor, watch and Goldfinger Control

- **`goldfinger doctor --json`** checks the install its binary belongs to and prints one report,
  `{"checks": […], "fail_count", "warn_count"}`, with twelve checks always in this order: `app`,
  `signature`, `notarization`, `path`, `daemon`, `versions`, `grants`, `safari`,
  `safari_extension`, `orphans`, `control`, `policy`. Each has `id`, `status` (`ok`, `warn`,
  `fail` or `skip`) and `summary`; one that warns, fails or skips may carry `remedy`,
  `{"kind": "auto" | "manual", "text"}`. Exit `0` when no check failed; `1` when one did, the
  report on stdout as on success, not an error object, so read `checks` either way; `2` for
  `usage` (an operand, `--session`, any flag but `--fix` and `--json`). It needs no grant, sends
  nothing to any app, and changes nothing: it starts, stops and replaces no daemon, asking it
  only `watch` and `status`. Give it a minute: it waits up to 30 s for a daemon that is starting
  or stopping, and reads a missing grant again 3 s later.
  - `policy` reads the app policy's file with the daemon's parser, so it needs no daemon: `ok`
    with no file or one that parses, naming its count of entries; `fail` for one that does not
    parse, naming the file and why, since the daemon then refuses nearly every verb; `warn` when
    another user owns it or users other than its owner can write it. The file is the user's (see
    [policy.md](policy.md)): tell the user its remedy (fix or remove the file, `chmod 600`,
    `sudo chown`), and `--fix` never edits it.
  - `safari` reads the Automation grant for Safari and `safari_extension` goldfinger's Safari
    extension, both from `status`, with no prompt. Neither ever fails, as only the Safari reads
    need them. `safari` skips when the grant was never asked for or Safari does not run, and
    `safari_extension` when the extension is off; both skip when no idle daemon answered, and
    warn when the grant is refused, Safari does not list the extension, or the state cannot be
    read.
- **Run `goldfinger doctor --json` to diagnose** when goldfinger itself looks wrong: a
  `daemon_unavailable` or a read's `timeout` that comes back on retry, a `permission_missing`, a
  `version_mismatch`, or before you tell the user goldfinger is broken. `daemon` names a stuck
  daemon's reading and pid, `grants` a missing grant, `versions` a client and daemon apart.
- **Act on the report.**
  1. Run `goldfinger doctor --fix` for the `auto` remedies. It starts a daemon, and registers and
     opens Goldfinger Control.
  2. Before a manual remedy that stops the daemon (`goldfinger stop`, a reinstall), read
     `goldfinger status --json`: the stop ends every agent's session and quits each app
     `web-launch` started. Then run it, and name those sessions and apps in your report.
  3. Do not run a `kill -9 <pid>` remedy: the daemon is shared, and you did not start it. Put the
     command in your report for the operator.
  4. Give the operator each remedy that is a grant, a Safari setting or a `sudo` command, from
     its `remedy.text`.
- **`goldfinger watch --json`** prints the daemon's state as it changes, one object per line:
  `state` (`idle`, `working` or `exiting`), the verb `running` with its `elapsed` seconds,
  `waiting_count`, `main_age` and the live `sessions`, one line at once and one at least every
  2 s. It never queues behind a running verb, starts no daemon, holds no session and takes no
  `--session`; it runs until the daemon exits (exit `0`) or 25 s pass with no line (exit `1`,
  `daemon_unavailable`, also when no daemon runs), so end it once you have the line you need.
- **Goldfinger Control** is the menu bar app inside `Goldfinger.app`. Its icon shows whether the
  daemon is offline, idle, working or unresponsive; its panel, the verb running, the requests
  waiting and the live sessions, and a person's click there starts, stops, restarts or
  force-quits the daemon. It never starts one on its own. Never press the panel with goldfinger:
  use the CLI. Its Stop, Restart and Force quit are daemon exits, which end every session, stale
  every snapshot and quit each app `web-launch` started (see [web-apps.md](web-apps.md)): after
  one, a call fails `session_not_live` (start a new session) or, while the old daemon exits,
  `daemon_unavailable`. A Force quit kills the daemon mid-verb, so a `drag` can leave the mouse
  button held, a `hover` the pointer off its place, and a foreground verb its app in front:
  observe before you act again.
