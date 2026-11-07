# MCP: goldfinger as an MCP server

`goldfinger mcp` serves the same client as an MCP server on stdio. Register it once, and its
tools appear in agent sessions started after that (in one already running, use the CLI):
`claude mcp add --scope user goldfinger -- goldfinger mcp` for Claude Code; for Codex,
`codex mcp add goldfinger -- goldfinger mcp` or a `[mcp_servers.goldfinger]` table in
`~/.codex/config.toml` with `command = "goldfinger"` and `args = ["mcp"]`.

The rest of this skill applies, but not the CLI's syntax: no `--json`, no `--`, no exit code, and
a flag like `--observe` is a boolean parameter. Parameters are the snake_case socket args
(`window_id`, `max_nodes`, `new_instance`).

## The tools

54 tools, named as the socket verbs; the six VoiceOver tools take an underscore, not a hyphen.
"Required" marks a required parameter.

| Tool | Parameters |
|---|---|
| `status`, `apps`, `windows`, `stop`, `session-list`, `record-stop`, `policy` | none (`windows` takes `pid`) |
| `setup` | `safari`, `voiceover` (booleans). Do not call it: it raises grants only the operator gives (see [diagnose.md](diagnose.md)), and a plain `setup` ends every session. |
| `doctor` | none; it never runs `--fix`, so run `goldfinger doctor --fix` through the CLI |
| `watch` | none; one reading, the first line `goldfinger watch --json` prints, waited for up to 25 s |
| `observe` | `window_id`; `screenshot`, `ocr`, `detect`, `dom_classes`, `a11y` (booleans); `ocr_region` (`{"x", "y", "width", "height"}`); `ocr_language`; `via` (`ax` or `extension`); `max_nodes` (1–20,000) |
| `find` | `window_id` required; `role`, `text` (strings); `limit` (integer) |
| `ocr` | `snapshot` required; `region` (object); `ocr_language` |
| `find-text` | `snapshot`, `text` required; `region` (object); `ocr_language` |
| `screenshot` | `window_id`; returns its path and no image: read the file |
| `capture` | `window_id` required (integer); `region` (object); `scale` (number) |
| `text` | exactly one of `window_id` (integer) and `target`; `offset`, `limit` (integers); `via` (`ax`, `apple-events` or `extension`) |
| `safari-tabs` | `window_id` required (integer) |
| `launch` | `bundle_id`; `new_instance` (boolean) |
| `quit` | `pid`; `force` (boolean) |
| `open` | `items` required (an array of at least one path or URL); `bundle_id` (the CLI's `--app`); `new_instance` (boolean) |
| `hide`, `unhide` | `pid` required (integer) |
| `status-items` | `pid` (integer) |
| `status-item` | `pid`, `index` required (integers); `item` (the CLI's `--item`) |
| `click`, `type`, `keys`, `scroll`, `set-value` | their socket args: `target`, and `right`, `double`, `text`, `combos`, `direction`, `lines` or `value` as the verb takes them; `observe` |
| `reveal` | `target` required; `observe` |
| `perform` | `target` required; exactly one of `action` (one of the six short names, or `show-menu`) and `custom` (a label); `observe` |
| `hover` | `target`; `hold` (number); `click` (integer); `observe` |
| `drag` | `from`, `to`; `via` (an array of at least one target); `observe` |
| `glide` | `target` alone, in the connection's session |
| `menu` | `menu_path` |
| `window-frame` | `window_id`; `frame` (`{"x", "y", "width", "height"}`) |
| `window-state` | `window_id`, `state` required (`minimize`, `restore` or `full-screen`); `foreground` (boolean) |
| `batch` | `steps`, the array its stdin takes |
| `session-cursor` | `cursor` (boolean) only |
| `clipboard-read` | `all` (boolean) |
| `clipboard-write` | `text`, `rtf`, `html` (strings); `image` (a PNG file's path); `files` (an array of at least one path). None is required, but the call needs one. |
| `record-start` | `video`, `text_anchors` (booleans) |
| `replay` | `file` required (the trajectory's path) |
| `voiceover_start` | `pid` required (integer) |
| `voiceover_stop`, `voiceover_speech` | none |
| `voiceover_do` | `command` required (one of the fourteen) |
| `voiceover_type` | `text` required |
| `voiceover_press` | `combo` required |
| `web-launch` | `bundle_id` required |
| `web-pages` | `pid` required (integer) |
| `web-dom` | `pid` required; `page`; `offset`, `limit` (integers) |
| `web-script` | `pid`, `file` required (a path the server reads, as the CLI reads `--file`); `page`; `timeout` (integer, in ms) |

- Each tool that takes `observe` also takes `observe_ocr` and `max_nodes` beside it.
- Each tool whose verb takes `--background` takes `background`, a boolean (see the focus fallback
  in [focus.md](focus.md)). The foreground verbs take the front without `foreground: true`.
- `a11y` and a large `max_nodes` make a result larger: pass them only for the window that needs
  them.

## Which tools load first

Nine tools carry `"_meta": {"anthropic/alwaysLoad": true}` in `tools/list`: `apps`, `windows`,
`observe`, `click`, `type`, `keys`, `scroll`, `set-value` and `find`, the loop's core. Claude Code
loads their schemas before the model's first call, and its tool search keeps the other 45
deferred until the model looks one up. Call the nine at once, and search for any other tool
(`capture`, `menu`, `policy`) before its first call.

## Results

- **The result** is what `goldfinger <verb> … --json` prints for the same call, marked `isError`
  exactly where the CLI exits non-zero: an error, a `batch` whose last entry failed, or a
  `doctor` report with a failed check (`fail_count` above 0), whose `checks` you read either way.
  An object result comes as `structuredContent` too; arrays (`apps`, `windows`, `session-list`,
  `batch`) come as text only.
- **A `usage` error** ends with the tool's arguments in place of the CLI's help, whichever check
  refused it: the required ones first, each marked `(required)`, as in `the find tool takes no
  argument "query"; the find tool takes: window_id (required), role, text, limit`. Fix the call
  with those names, not the CLI's flags.
- **A `denied` tool** returns the `denied` error, marked `isError` (see [policy.md](policy.md)).
  The server's `initialize` instructions say the same: do not retry, do not reach the app another
  way, and tell the user.
- **Images.** `observe` with `screenshot`, `ocr` or `detect` adds the PNG as an image, its
  entries in `structuredContent.ocr` and `structuredContent.detections`. So do `capture` and
  `clipboard-read` with `all: true`, unless the image's width or height passes 1,568 px or the
  file is gone: then read the file, which stays yours to delete. `ocr` and `find-text` add none.
- **A model that sees no image.** Some clients give the model `structuredContent` in place of
  `content` wherever a result has both. Then open the PNG at `screenshot.path` with the client's
  own image tool (Codex's `view_image`) while its snapshot is kept (see
  [targets.md](targets.md)), as eviction deletes the file.
- **Size.** A client caps a result's size (Claude Code at `MAX_MCP_OUTPUT_TOKENS`, 25,000 by
  default): pass `max_nodes` on a large window, to `observe` and beside an action's
  `observe: true`. `text` and `web-dom` results may run to 500,000 characters, which Claude Code
  keeps in context (their `_meta` says so).
- **Stderr lines** come as extra text blocks: an `observe` cut by the node limit or by time (also
  an action's `observe`), a node that gave no answer, a `find` cut at its limit, and each `text`
  stderr line.

## Sessions

- Each connection has its own session, started at the first call that needs one, started again
  once it ends (an idle end, any agent's `stop`), and ended when the connection closes. There are
  no `session-start` or `session-end` tools: the server owns the session.
- `session-cursor` shows or hides that session's cursor, and `cursor: false` carries into the
  sessions the connection starts later.
- `session-list`, `doctor`, `watch` and `policy` hold no session and leave the connection's as it
  is. `stop` and a plain `setup` end every session; `setup` with `safari` or `voiceover` ends
  none.
- `record-start` and `record-stop` record the connection's own session, and the recording closes
  with that session, at the latest when the connection closes.
- `replay` sends its steps in that session, so a recording running there records them. A
  `replay` whose session ended after any of its requests succeeded returns `session_not_live`
  and is not run again, as a second run repeats those steps.
- A call whose session ended while it recorded is not sent again either: its `session_not_live`
  message says to call `record-start` again, and the next call starts a new session that records
  nothing.
- A call that fails `session_limit` ran nothing: retry later.

## After an upgrade

After a `brew upgrade`, the agent's `goldfinger mcp` is the old client, and the new daemon
answers it `version_mismatch`. Use the CLI for the rest of the session: it is the new client. Do
not call `stop`, which costs every other agent its daemon and still mismatches.
