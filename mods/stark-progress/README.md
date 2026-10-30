# stark-progress

A Claude Code mod that shows a live view of each Gru, Minion and Agnes run.
Gru's tab gets the Gru pane beside the chat: a calm board of the run, and the
run's settings, which Gru reads before each launch. A Minion's or Agnes's tab
gets one progress row above the prompt for its ticket. Both say where a ticket
is, whether its worker is doing anything, and whether that work gets anywhere:
a worker that is busy for hours with no commit and no stage change reads
`stalled`, not "20% done". Neither ever forecasts the time left. The mod polls
the state files below once a second, and git once every 30 seconds.

Install it on its own; the seven skill plugins do not need it:

```
/plugin install stark-progress@bifrost
```

## What it looks like

Gru's tab, the Gru pane's Overview:

```
Overview   Settings

Gru · STARK-1200                                       ● this run
bragi · 4 tickets
━━━━━━━━━━━━ ━━━━━━━━━━━━ ━━━━━━━━━━━━ ━━━━━━━━━━━━
1 of 4 done · 2 in progress · 1 not started

╭──────────────────────────────────────────────────╮
│ 🙋 1 ticket is worth a look                       │
│                                                  │
│ Cache the export index                           │
│ no stage change or commit for 1h38m              │
╰──────────────────────────────────────────────────╯

🚇 Where each ticket is
  ticket PR     review merge  done
Add the export command
  ●━━━━━━●━━━━━━●━━━━━━●━━━━━━●  ✅ done
Document the export flags
  ●━━━━━━●━━━━━━◉┄┄┄┄┄┄○┄┄┄┄┄┄○  👀 in review · 36m
Cache the export index
  ●━━━━━━◉┄┄┄┄┄┄○┄┄┄┄┄┄○┄┄┄┄┄┄○  🧱 PR open · 1h50m
Sign the export bundle
  ○┄┄┄┄┄┄○┄┄┄┄┄┄○┄┄┄┄┄┄○┄┄┄┄┄┄○  💤 not started
Select a name to see more.

👉 Up next
Start STARK-1204
Then close STARK-1200 once all 4 tickets close.

Read from ~/.cache/stark-progress at 12:53.
```

A Minion's or Agnes's tab, above the prompt:

```
STARK-1202 ●━●━◉┄○┄○ review    36m  ▃▃◆▄◆▁─▂◆▃▃▄  moving · +234 −20  Document the export flags
```

## The Gru pane

The pane opens by itself in Gru's tab, once, when the poll first finds Gru's
run, and from 144 columns (110 once you opened it). `/gru-board` opens it in
any session, at any width. While the pane is not placed, Gru's tab keeps one
line above the prompt: `Gru · <epic> · <n> of <m> done · /gru-board opens the
board`. Gru's tab draws no band rows.

**Which run.** Gru's tab shows its own run. Another session shows the run
whose run file, ticket files or heartbeats changed last; a run file changes
only at launch, so its own time says little. A run is active when one of its
files changed in the last hour. The pane names the other active runs, and `r`
shows the next one, in Gru's tab too.

**Overview.** From the top:

- The epic, the repos (each from a title's `<repo>: ` lead) and the ticket count.
- One bar segment per ticket, in its color, and the counts
  `<n> of <m> done · <k> in progress · <j> not started`. Done means closed, as
  the band counts it.
- A box of the tickets worth a look, with the reason: the band calls it
  `blocked`, `idle` or `stalled`, or 5 of its last 10 calls failed. With none,
  `🌿 Nothing needs you right now.`
- `🚇 Where each ticket is`: a name (the title without its `<repo>: ` lead and
  `(slice n of m)` tail), then the track and one emoji and status: `✅ done`,
  `👀 in review · <time in stage>`, `🔨 PR open · <time>`, `🧱` for `stalled`,
  `⏳` for `blocked` or idle (`quiet <time>`), `💤 not started`. Select a name
  to open its detail: the whole title, the slice, the PR, when the step began,
  the diff size, the running or last tool call, the calls in the last 15
  minutes, and the failures among the last 10.
- `👉 Up next`: the tickets with no file yet, in run order.

**Settings.** Four rows, each a value you select to change. A press writes all
four to the run's settings file at once; Gru reads it before each launch and
each scope change ([the Gru skill](../../skill/gru/SKILL.md#progress-pane)):

| Row | Field | What Gru does |
|---|---|---|
| Decide for me | `decideForMe` | On: splits a ticket across repos, and adds a blocking ticket, by itself. Off: holds the ticket `blocked` and asks in its report. |
| Workers at once | `maxWorkers` | Keeps up to this many Minions alive, 1 to 8. |
| Pick up follow-ups | `followUps` | On: a ticket a Minion files joins the run. Off: it waits on the board, named in the report. |
| Worker type | `minionAgent` | The runtime of each new Minion, `claude` or `codex`. A relaunch keeps its runtime. |

**Colors.** Every text color is 4.5:1 or more on the pane's `#262626`
(secondary text 8.1:1); the track's lines and rings, which carry no words,
are 3.5:1. They suit a dark theme.

## How a row reads

A worker's band row:

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
- **Verdict**, the first rule that holds; the Gru pane reads the same verdicts:

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
  calls failed.
- **Diff size:** `git diff --shortstat` of the worktree against its base, with
  the commits since that base as milestones. The base is `git merge-base HEAD`
  with the first of `origin/HEAD`, `origin/main` and `main` that works. It
  counts tracked files only: a new file counts once it is added. A row whose
  worktree git cannot read shows no diff size. Git runs in the background, so
  a slow read never holds the poll.

## The state contract

The skills write the ticket and run files; the mod writes the heartbeat and
the settings file. The ticket, run and settings files are runtime-neutral: a
Codex Gru or worker writes and reads them too, and only a Claude Code session
draws them. Every file is whole JSON, written atomically: a writer writes
`<name>.json.tmp` beside it and renames it over `<name>.json`, so a poll never
reads a half-written file
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
{ "epic": "STARK-n", "session": "<Gru's session id>", "tickets": ["STARK-a", "STARK-b"], "maxWorkers": 3, "minionAgent": "claude" }
```

`session` is Gru's own session id (`$CLAUDE_CODE_SESSION_ID`, or
`$CODEX_THREAD_ID` on Codex). `maxWorkers` and `minionAgent` are the launch's
`--max-workers` and Minion runtime; a v1 file has neither. A ticket with no
file yet draws as `no file yet`.

`~/.cache/stark-progress/run-<id>.settings.json`, the run's settings, which
the Gru pane writes and Gru reads before each launch and each scope change:

```json
{ "decideForMe": true, "maxWorkers": 3, "followUps": true, "minionAgent": "claude" }
```

A field that is absent or of the wrong type takes the run file's value, else
the default: `decideForMe` `true`, `maxWorkers` 3, `followUps` `true`,
`minionAgent` `claude`. `maxWorkers` is 1 to 8. A `*.settings.json` file is
never a run file. Gru deletes it with the run file when the run ends.

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

- A session that a run file names as its `session` is Gru's tab, even though
  it stands in a worktree named for its launch id (the epic's own `STARK-n`,
  or `GRU-n`): it shows that run in the Gru pane.
- Any other session whose project root (where it started, or the worktree it
  moved to; a shell `cd` does not move it) is a folder named `STARK-n`, a
  worker's worktree, shows that ticket's band row once its file exists, and
  writes its heartbeat.
- Any session shows the Gru pane after `/gru-board`.
- Nothing matching draws nothing.

Each poll lists the directory and reads the run files, then only the ticket,
heartbeat and settings files the tab draws, so old files cost a listing and
nothing more.

## Not built (add when it hurts)

- The CI and review state of each PR on GitHub.
- Activity for Codex workers, from their session files.
- A toast or a sound when a row becomes `stalled`.
- A stage history that stays when the mod reloads.
- Settings Gru cannot honor yet: workers on devbox (valkyrie cannot launch
  there), a minimum worker count (Gru already fills to the maximum), and a
  merge hold, a review depth or a release stop (the Minion protocol).
- A light-theme palette for the Gru pane.

## Develop

```
claude plugin validate mods/stark-progress
claude plugin test mods/stark-progress
claude --plugin-dir mods/stark-progress
```
