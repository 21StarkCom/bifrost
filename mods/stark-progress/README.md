# stark-progress

A Claude Code mod that draws a live progress row above the prompt for each
ticket of a Gru, Minion or Agnes run. A row says where the ticket is, whether
its worker is doing anything, and whether that work gets anywhere: a worker
that is busy for hours with no commit and no stage change reads `stalled`, not
"20% done". Gru's tab also shows an `n/m closed` total. The mod polls the state
files below once a second, and git once every 30 seconds.

Install it on its own; the seven skill plugins do not need it:

```
/plugin install stark-progress@bifrost
```

## What it looks like

Gru's tab, above the prompt:

```
Gru · STARK-1200 · 1/4 closed · 1 stalled · 1 idle
◆ milestone   ▃ tool calls per 5 min   ▃ most calls failed   ─ one long call   · no calls
STARK-1201 ●━●━●━●━● closed         ◆◆▅◆◆◆▅◆◆◆··  done                                    Add the export command
STARK-1202 ●━●━◉┄○┄○ review    36m  ▃▃◆▄◆▁─▂◆▃▃▄  moving · +234 −20                       Document the export flags
STARK-1203 ◉┄○┄○┄○┄○ ticket  1h50m  ▆▆▆▆▆▆▆▆▆▆▆▆  stalled 1h38m · 7/10 failed · +320 −22  Cache the export index
STARK-1204 ●━◉┄○┄○┄○ pr      1h17m  ────────────  idle 1h12m · in Bash · +92 −6           Sign the export bundle
```

A Minion's or Agnes's tab shows its own ticket's row, with no header and no
legend.

## How a row reads

`<id> <track> <stage> <time in stage>  <timeline>  <verdict> · <n>/10 failed · +<added> −<removed>  <title>`

- **Track:** one station per stage, `ticket`, `pr`, `review`, `merged`,
  `closed`. `●` is done (the theme's `suggestion` colour), `◉` is the stage now
  (its verdict's colour), and `○` is to come. A closed ticket draws all green.
  A blocked ticket draws `✕` at `pr` when its file has a PR URL, else at
  `ticket`, since the file keeps no stage history.
- **Timeline:** the last hour in 12 cells of 5 minutes, oldest first, from the
  worker's heartbeat. A bar is the tool calls in the cell: 1–6 calls draw `▁`,
  each next 6 one step higher, and 31 or more `▆`. A bar is red when more than
  half of its calls failed. A green `◆` marks a milestone (a stage change or a
  commit) and takes the cell. `─` is a cell with no calls while one call runs,
  `·` a cell with no calls, and a blank cell a row with no heartbeat (a Codex
  worker, or a Claude worker without the mod).
- **Verdict**, the first rule that holds:

  | Verdict | When | Colour |
  |---|---|---|
  | `no file yet` | Gru's run names the ticket, and it has no file | dim |
  | `done` | the stage is `closed` | green |
  | `blocked <time>` | the stage is `blocked` | red |
  | `idle <time>` | the heartbeat shows no call that started or ended for 15 min (`· in <tool>` when one still runs) | yellow |
  | `moving` | the last milestone is under 45 min old | green |
  | `slow <time>` | the last milestone is 45–90 min old | yellow |
  | `stalled <time>` | the last milestone is 90 min old or more | red |

  `<n>/10 failed`, in red, follows a live verdict when 5 or more of the last 10
  calls failed. Gru's header counts the `stalled`, `slow`, `idle` and `blocked`
  rows.
- **Diff size:** `git diff --shortstat` of the worktree against its base, with
  the commits since that base as milestones. The base is `git merge-base HEAD`
  with the first of `origin/HEAD`, `origin/main` and `main` that works. It
  counts tracked files only: a new file counts once it is added. A row whose
  worktree git cannot read shows no diff size. Git runs in the background, so
  a slow read never holds the poll.

## The state contract

The skills write the ticket and run files; the mod writes only the heartbeat.
The ticket and run files are runtime-neutral: a Codex worker writes them too,
and only a Claude Code session draws them. Every file is whole JSON, written
atomically: a writer writes `<name>.json.tmp` beside it and renames it over
`<name>.json`, so a poll never reads a half-written file
([the worker spine's command](../../standards/worker-spine.md#progress-file)
does this for a ticket's file). A field of the wrong type reads as absent: a
`stage` that is not one of the six draws as `ticket`.

`~/.cache/stark-progress/<STARK-n>.json`, one per ticket:

```json
{ "id": "STARK-n", "title": "<ticket title>", "stage": "pr", "pr": "<PR url or null>", "updated": "<ISO 8601>", "worktree": "<absolute path or null>" }
```

`stage` is one of `ticket`, `pr`, `review`, `merged`, `closed` (the track
fills in that order) or `blocked`. `updated` is when the stage was written, so
it is the stage's milestone and the start of its time. `worktree` is the folder
the spine's command ran in; git reads the folder named for the ticket that it
is or is inside, and nothing when there is none, so a stamp Gru writes from its
own worktree adds no git signal. A
file with no `worktree` (contract v1) reads git in a worker's own tab from its
project root, and nowhere else.

`~/.cache/stark-progress/run-<id>.json`, one per Gru run, `<id>` being Gru's
launch id (the epic's, or `GRU-n`):

```json
{ "epic": "STARK-n", "session": "<Gru's session id>", "tickets": ["STARK-a", "STARK-b"] }
```

`session` is Gru's own session id (`$CLAUDE_CODE_SESSION_ID`, or
`$CODEX_THREAD_ID` on Codex). A ticket with no file yet draws as `no file yet`.

`~/.cache/stark-progress/<STARK-n>.beat.json`, the heartbeat, one per ticket
whose worker is a Claude session with the mod installed:

```json
{ "id": "STARK-n", "session": "<the worker's session id>", "updated": "<ISO 8601>",
  "lastActivity": "<ISO 8601 or null>", "running": { "tool": "Bash", "since": "<ISO 8601>" },
  "minutes": [{ "at": 29872800, "calls": 6, "fails": 1 }], "recent": [false, true] }
```

The mod writes it in a worker's own tab, from that session's tool calls
(its subagents' included), at most once every 5 seconds, and only while the
ticket's file exists; once the file is gone (Agnes deletes it at stand-down)
the mod removes the heartbeat. `lastActivity` is when a call last started or
ended, `running` the oldest call still running or `null`, `minutes` the calls
and failures per minute for the last 60 minutes (`at` is minutes since the
epoch), and `recent` the outcomes of the last 10 calls that ended, oldest
first, `true` for a failure. After a reload the mod takes back the minutes,
outcomes and last activity of a heartbeat its own session wrote.

## Which tab shows what

- A session that a run file names as its `session` shows that run: Gru's tab,
  even though it stands in a worktree named for its launch id (the epic's own
  `STARK-n`, or `GRU-n`).
- Any other session whose project root (where it started, or the worktree it
  moved to; a shell `cd` does not move it) is a folder named `STARK-n`, a
  worker's worktree, shows that ticket's row once its file exists, and writes
  its heartbeat.
- Nothing matching draws nothing.

Each poll lists the directory and reads the run files, then only the ticket
and heartbeat files the tab draws, so old files cost a listing and nothing
more.

## Not built (add when it hurts)

- The CI and review state of each PR on GitHub.
- Activity for Codex workers, from their session files.
- A toast or a sound when a row becomes `stalled`.
- A stage history that stays when the mod reloads.

## Develop

```
claude plugin validate mods/stark-progress
claude plugin test mods/stark-progress
claude --plugin-dir mods/stark-progress
```
