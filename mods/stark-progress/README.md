# stark-progress

A Claude Code mod that draws live progress bars above the prompt for Gru,
Minion and Agnes runs: one bar per ticket, filled by stage, and an `n/m closed`
total in Gru's tab. It polls the state files below once a second.

Install it on its own; the seven skill plugins do not need it:

```
/plugin install stark-progress@bifrost
```

## The state contract

The skills write these files; the mod only reads them. They are runtime-neutral:
a Codex worker writes them too, and only a Claude Code session draws them.
Every file is whole JSON, written in one go.

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

- A session whose working directory is a folder named `STARK-n` (a worker's
  worktree) shows that ticket's bar, once its file exists.
- Any other session shows the run file whose `session` is its own: Gru's run.
- Nothing matching draws nothing.

## Develop

```
claude plugin validate mods/stark-progress
claude plugin test mods/stark-progress
claude --plugin-dir mods/stark-progress
```
