# stark-progress

A Claude Code mod that shows a live view of each Gru, Minion and Agnes run.
Gru's tab gets the Gru pane beside the chat: a calm board of the run, and the
run's settings, which Gru reads before each launch. A Minion's or Agnes's tab
gets the ticket pane beside the chat: its one ticket, and the ticket's
settings, which the worker reads before its review, its merge and its
release; one progress row above the prompt stands in while that pane is not
placed. Each says where a ticket
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

A Minion's or Agnes's tab, the ticket pane's Overview, with its merge held:

```
Overview   Settings

Document the export flags
STARK-1202 · bragi
Part of STARK-1200

🚇 Where it is
  ticket PR     review merge  done
  ●━━━━━━●━━━━━━◉┄┄┄┄┄┄○┄┄┄┄┄┄○  ✋ held · merge · 12m

╭──────────────────────────────────────────────────╮
│ 🙋 Worth a look                                   │
│ Held by your settings: merge                     │
│ Set Merge when checks pass to On in Settings,    │
│ and the worker merges.                           │
╰──────────────────────────────────────────────────╯

🔧 Activity
Last tool call 12m ago.
0 tool calls in the last 15 minutes.
1 of the last 10 calls failed.
+234 −20 in its worktree.
3 commits since its base.

👉 Up next
Wait for your merge OK.

Read from ~/.cache/stark-progress at 12:53.
```

The same tab, above the prompt, while the ticket pane is not placed:

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
only at launch, so its own time says little. It then stays on that run until
you press `r` or the run ends, even when another run gets busier, so a Settings
press always writes to the run on screen (a press that finds the board moved
writes nothing and says so). A run is active when one of its files changed in
the last hour. The pane names the other active runs, and `r` shows the next one
by launch id, in Gru's tab too, so each run is reached. When no run file is
left, the pane says `No Gru run yet`.

**Overview.** From the top:

- The epic, the repos (each from a title's `<repo>: ` lead) and the ticket count.
- The counts `<n> of <m> done · <k> in progress · <j> not started`. Done
  means closed, as the band counts it.
- A bar graph of the tickets at each step, one row a step in the spine's
  order: `not started`, `ticket`, `PR`, `review`, `merge`, `done`. A blocked
  ticket counts at the station it stopped at. All rows share one scale (the
  full bar is all the run's tickets), so a bar grows as its step fills and
  the graph never rescales. Each bar is drawn in eighths of a cell, and a step
  with a ticket always shows one. The count comes before the bar,
  right-aligned in a column as wide as the run's ticket count, and
  `· <k> worth a look` follows the bar in amber. The scale leaves room for the
  longest note the run can have, so a full bar keeps its note; in a pane too
  narrow for a 20-cell bar beside it, a note that does not fit is dropped
  whole, and the box below still names each ticket.
- A box of the tickets worth a look, with the reason: the band calls it
  `blocked`, `idle` or `stalled`, or 5 of its last 10 calls failed. With none,
  `🌿 Nothing needs you right now.`
- `🚇 Where each ticket is`: a name (the title without its `<repo>: ` lead and
  `(slice n of m)` tail), then the track and one emoji and status: `✅ done`,
  `👀 in review · <time in stage>`, `🔨 PR open · <time>`, `🧱` for `stalled`,
  `⏳` for `blocked` or idle (`quiet <time>`), `💤 not started`. Select a name
  to open its detail: the whole title, the slice, the PR, when the step began,
  the diff size, the running or last tool call, the calls in the last 15
  minutes, the failures among the last 10, and its last hour: the band's
  12 cells of 5 minutes, oldest first, with a legend of the marks it shows
  (`◆` milestone, `▃` tool calls per 5 min, amber `✕` most calls failed, `─`
  one long call, `·` no calls, and `blank: no heartbeat` when the worker
  writes none). The band draws a failed 5 minutes as a red bar; the pane
  draws `✕`, so a failure never rests on its color alone. An hour with no
  milestone, call or long call shows nothing, so a closed ticket's leftover
  heartbeat draws no row of dots.
  On a closed ticket, a call the heartbeat still marks running is ignored,
  in the hour, the detail and the band: a worker stands down inside its last
  call, which never ends.
- `👉 Up next`: the tickets with no file yet, in run order.

**Settings.** Four rows, each a value you select to change. A press writes all
four to the run's settings file at once; Gru reads it before each launch and
each scope change ([the Gru skill](../../skill/gru/SKILL.md#progress-pane)):

| Row | Field | What Gru does |
|---|---|---|
| Decide for me | `decideForMe` | On: splits a ticket across repos, and adds a blocking ticket, by itself. Off: holds the ticket `blocked` and asks in its report. |
| Workers at once | `maxWorkers` | Keeps up to this many Minions alive, 1 to 8. A launch above 8 shows its own value; `−` steps it down to 8, and `+` does not change it. |
| Pick up follow-ups | `followUps` | On: a ticket a Minion files joins the run. Off: it waits on the board, named in the report. |
| Worker type | `minionAgent` | The runtime of each new Minion, `claude` or `codex`. A relaunch keeps its runtime. |

**Colors.** Every text color is 4.5:1 or more on the pane's `#262626`
(secondary text 8.1:1); the track's lines and rings, which carry no words,
are 3.5:1. They suit a dark theme.

## The ticket pane

The pane opens by itself in a Minion's or Agnes's own tab, once, when the
poll first finds the tab's ticket file, and from 144 columns (110 once you
opened it). `/ticket-board` opens it in that tab at any width; in any other
tab it says the tab has no ticket. While the pane is not placed, the tab keeps
its one band row above the prompt. It draws with the Gru pane's parts, palette
and rules: counts and elapsed times only, one emoji at most per section
header and per status, and none in Settings.

**Overview.** All of it at once, since the pane holds one ticket:

- The name (the title without its `[tag]`, `<repo>: ` lead and
  `(slice n of m)` tail), then the id, the repo and the slice, and
  `Part of <epic>` when an epic's run file lists the ticket (a `--tickets`
  run, launched as `GRU-n`, has no epic to name).
- `🚇 Where it is`: the five stations, one emoji and the status, as the Gru
  pane reads them. A held ticket reads `✋ held · <merge or release> · <time>`.
- A box when the ticket is worth a look: the band calls it `blocked`, `idle`
  or `stalled`, 5 of its last 10 calls failed, or a setting holds it
  (`Held by your settings: <merge or release>`, and the setting that clears
  it). Else `🌿 Nothing needs you right now.`
- `🔧 Activity`: the running or last tool call, the calls in the last 15
  minutes, the failures among the last 10, the diff size, and the commits.
- `👉 Up next`: the next spine step. With a hold, `Wait for your merge OK.` or
  `Wait for your release OK.` Else by stage: `ticket` opens the PR, `pr`
  reviews it, `review` merges it, `merged` releases or closes, and `blocked`
  waits for the block to clear. A closed ticket has none.

**Settings.** Three rows, each a value you select to change. A press writes
all three to the ticket's settings file at once, one press at a time, each
over the one before it. The worker reads the file at three points of
[the worker spine](../../standards/worker-spine.md#ticket-settings):

| Row | Field | What the worker does |
|---|---|---|
| Merge when checks pass | `mergeOnGreen` | On: merges once the review and the checks pass. Off: holds the merge until you set it On. |
| Review depth | `reviewDepth` | `by what the PR changes`: the spine's tier. `deep`: a code PR gets `/code-review xhigh`, even after a live run. |
| Release | `release` | `run the chain`: runs the repo's release chain after the merge. `stop before publish`: holds the release until you set it back. |

A hold is no stop: the worker writes `hold` into its ticket file, reports
`held`, and waits in one background command until you clear the setting.

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
  | `held · <merge or release>` | the file's `hold` is set | yellow |
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
the settings files. The ticket, run and settings files are runtime-neutral: a
Codex Gru or worker writes and reads them too, and only a Claude Code session
draws them. Every file is whole JSON, written atomically: a writer writes
`<name>.json.tmp` beside it and renames it over `<name>.json`, so a poll never
reads a half-written file
([the worker spine's command](../../standards/worker-spine.md#progress-file)
does this for a ticket's file). A field of the wrong type reads as absent: a
`stage` that is not one of the six draws as `ticket`.

`~/.cache/stark-progress/<STARK-n>.json`, one per ticket:

```json
{ "id": "STARK-n", "title": "<ticket title>", "stage": "pr", "pr": "<PR url or null>", "hold": null, "updated": "<ISO 8601>", "worktree": "<absolute path or null>" }
```

`stage` is one of `ticket`, `pr`, `review`, `merged`, `closed` (the track
fills in that order) or `blocked`. `hold` is `"merge"` or `"release"` while
the ticket's settings hold that step, else absent or `null`; the stage does
not change during a hold, and a closed or blocked ticket reads no hold.
`updated` is when the stage was written, so
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
`minionAgent` `claude`. `maxWorkers` is 1 to 8 in the settings file; in the
run file it is the launch's `--max-workers`, with no cap. A `*.settings.json` file is
never a run file. Gru deletes it with the run file when the run ends.

`~/.cache/stark-progress/<STARK-n>.settings.json`, the ticket's settings,
which the ticket pane writes and the worker reads at three points of the
spine:

```json
{ "mergeOnGreen": true, "reviewDepth": "by-change", "release": "run" }
```

`mergeOnGreen` is a bool (default `true`), `reviewDepth` is `by-change` or
`deep` (default `by-change`), and `release` is `run` or `stop` (default
`run`). A field that is absent or of the wrong type takes its default. The mod
never reads this file as a ticket file. The worker deletes it when it closes
the ticket (Agnes at her stand-down), and Gru deletes each of its run's at
the run's end.

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
  worker's worktree, shows that ticket in the ticket pane once its file
  exists, its band row while the pane is not placed, and writes its
  heartbeat. `/ticket-board` opens the pane there, and only there.
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
  there), and a minimum worker count (Gru already fills to the maximum).
- A merge hold, a review depth or a release stop for a whole Gru run: each
  ticket has its own, in its worker's ticket pane.
- Activity for a Codex worker in its ticket pane (it writes no heartbeat).
- A held worker whose session died reads `held` on the Gru pane, with its
  time held, since no file says whether a worker lives; Gru's observation
  pass reads that from Hermod. The ticket pane dies with its tab.
- A light-theme palette for the Gru pane and the ticket pane.

## Develop

```
claude plugin validate mods/stark-progress
claude plugin test mods/stark-progress
claude --plugin-dir mods/stark-progress
```
