# stark-progress

A Claude Code mod that draws live progress bars above the prompt for Gru,
Minion and Agnes runs: one bar per ticket, filled by stage, and an `n/m closed`
total in Gru's tab. It polls the state files below once a second.

Install it on its own; the seven skill plugins do not need it:

```
/plugin install stark-progress@bifrost
```

## What it looks like

Gru's tab, above the prompt (each bar is 20 cells, a fifth per stage, and
draws green when `closed`, red when `blocked` and cyan otherwise; the header
is bold and each ticket's title dim):

```
Gru · STARK-1200 · 1/4 closed
████████████████████ STARK-1201  closed  Add the export command
████████████░░░░░░░░ STARK-1202  review  Document the export flags
████████░░░░░░░░░░░░ STARK-1203  pr      Cache the export index
░░░░░░░░░░░░░░░░░░░░ STARK-1204  blocked Sign the export bundle
```

A Minion's or Agnes's tab, its own ticket's bar and no header:

```
████████████░░░░░░░░ STARK-1202  review  Document the export flags
```

## The state contract

The skills write these files; the mod only reads them. They are runtime-neutral:
a Codex worker writes them too, and only a Claude Code session draws them.
Every file is whole JSON, written atomically: a writer writes `<name>.json.tmp`
beside it and renames it over `<name>.json`, so a poll never reads a
half-written file ([the worker spine's command](../../standards/worker-spine.md#progress-file)
does this for a ticket's file). A field of the wrong type reads as
absent: a `stage` that is not a string draws as `ticket`.

`~/.cache/stark-progress/<STARK-n>.json`, one per ticket:

```json
{ "id": "STARK-n", "title": "<ticket title>", "stage": "pr", "pr": "<PR url or null>", "updated": "<ISO 8601>" }
```

`stage` is one of `ticket`, `pr`, `review`, `merged`, `closed` (the bar fills
in that order) or `blocked` (drawn empty and red).

`~/.cache/stark-progress/run-<id>.json`, one per Gru run, `<id>` being Gru's
launch id (the epic's, or `GRU-n`):

```json
{ "epic": "STARK-n", "session": "<Gru's session id>", "tickets": ["STARK-a", "STARK-b"] }
```

`session` is Gru's own session id (`$CLAUDE_CODE_SESSION_ID`, or
`$CODEX_THREAD_ID` on Codex). A ticket with no file yet draws as `ticket`.

## Which tab shows what

- A session that a run file names as its `session` shows that run: Gru's tab,
  even though it stands in a worktree named for its launch id (the epic's own
  `STARK-n`, or `GRU-n`).
- Any other session whose project root (where it started, or the worktree it
  moved to; a shell `cd` does not move it) is a folder named `STARK-n`, a
  worker's worktree, shows that ticket's bar, once its file exists.
- Nothing matching draws nothing.

Each poll lists the directory and reads the run files, then only the ticket
files the tab draws, so old ticket files cost a listing and nothing more.

## Develop

```
claude plugin validate mods/stark-progress
claude plugin test mods/stark-progress
claude --plugin-dir mods/stark-progress
```
