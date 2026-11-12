# stark-progress

A Claude Code mod that shows a live view of each Gru, Minion and Agnes run.
Gru's tab gets the Gru pane beside the chat: a calm board of the run, a log
of the big steps in plain words, the stats of Gru and of the whole run, and
the run's settings, which Gru reads before each launch. A Minion's or Agnes's
tab gets the ticket pane beside the chat: its one ticket, its log, its stats,
and the ticket's settings, which the worker reads before its review, its
merge and its release; one progress row above the prompt stands in while that
pane is not placed. Each says where a ticket
is, whether its worker is doing anything, and whether that work gets anywhere:
a worker that is busy for hours with no commit and no stage change reads
`stalled`, not "20% done". Neither ever forecasts the time left. Both draw in
the terminal and in the Claude desktop app's Code tab. The mod polls
the state files below once a second, and git once every 30 seconds; it asks
alfred for an epic's title until it has one, and GitHub once a minute while
the Gru pane shows its GitHub tab.

Install it on its own; the seven skill plugins do not need it:

```
/plugin install stark-progress@bifrost
```

## What it looks like

Gru's tab, the Gru pane's Overview:

```
Overview   Log   Stats   GitHub   Settings

Gru · STARK-1200                                       ● this run
Export the reading list
bragi · 4 tickets · started 11:02, 1h51m ago
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

── In progress · 2 ────────────────────────────────

 STARK-1202  Document the export flags
  ●━━━━━━●━━━━━━◉┄┄┄┄┄┄○┄┄┄┄┄┄○  IN REVIEW · 36m
[STARK-1203] Cache the export index
  ●━━━━━━◉┄┄┄┄┄┄○┄┄┄┄┄┄○┄┄┄┄┄┄○  🐢 SLOW · 1h38m

── To do · 1 ──────────────────────────────────────

[STARK-1204] Sign the export bundle
  ○┄┄┄┄┄┄○┄┄┄┄┄┄○┄┄┄┄┄┄○┄┄┄┄┄┄○  NOT STARTED

── Done · 1 ───────────────────────────────────────

[STARK-1201] Add the export command
  ●━━━━━━●━━━━━━●━━━━━━●━━━━━━●  DONE
Select a name to see more, or a highlighted id to go to its tab.

👉 Up next
Start STARK-1204
Then close STARK-1200 once all 4 tickets close.

Read from ~/.cache/stark-progress at 12:53.
```

A Minion's or Agnes's tab, the ticket pane's Overview, with its merge held:

```
Overview   Log   Stats   Settings

[STARK-1202] Document the export flags
bragi · started 12:21, 32m ago
Part of [STARK-1200] Export the reading list

🚇 Where it is
  ticket PR     review merge  done
  ●━━━━━━●━━━━━━◉┄┄┄┄┄┄○┄┄┄┄┄┄○  ✋ HELD · merge · 12m

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

Last hour  ····▃▅▆▆▂◆··  now
◆ milestone  ▃ tool calls per 5 min  · no calls

👉 Up next
Wait for your merge OK.

Read from ~/.cache/stark-progress at 12:53.
```

The same tab, above the prompt, while the ticket pane is not placed:

```
STARK-1202 ●━●━◉┄○┄○ review    36m  ▃▃◆▄◆▁─▂◆▃▃▄  moving · +234 −20  Document the export flags
```

Gru's tab, the Gru pane's Stats:

```
Overview   Log   Stats   GitHub   Settings

📊 Stats for STARK-1200
Gru's own counts, and the whole run's: Gru's and each ticket's, added. The run started 11:02, 1h51m ago. Counted since 11:02.

                        Gru  Whole run
Time
  session time        1h51m      5h12m
  working time          22m      3h40m
Tokens
  input               1,000        10k
  output              2,000        32k
  cache read           300k       2.3M
  cache write          4,000        94k
  model requests          1         41
Work
  lines added             —       +234
  lines removed           —        −20
  commits                 —          3
  PRs opened              —          2
  PRs merged              —          1
  review rounds           0          1
Tools
  tools used              1          2
  tool calls              2         44
  failed calls            0          2
Prompts and messages
  prompts from you        1          1
  from other sessions     0          2
  other prompts           0          1
  messages sent           0          3
  workers launched        2          2

Most used tools, whole run
  Bash               32 calls · 2 failed
  Edit               12 calls

Model and effort
  Gru claude-opus-5-5 · high
  [STARK-1201] claude-opus-5-5 · xhigh
  claude-opus-5-5: 41 requests, 32k output tokens

One ticket has no stats: a Codex worker, a session without the mod, or no worker in this run.
  [STARK-1202]
```

Gru's tab, the Gru pane's Log:

```
Overview   Log   Stats   GitHub   Settings

📜 What got done
The big steps, newest first, each told in plain words by whoever did it.

12:51  Gru
       Checked the export command is really done, then sent a helper to the next job.
12:48  Add the export command
       The change is now part of the main code.
12:30  Document the export flags
       A careful check found two unclear lines. I made them plain.
11:02  Gru
       Started 4 jobs for the export, with 3 helpers at once.
```

Gru's tab, the Gru pane's GitHub tab, with `Done tickets last` On:

```
Overview   Log   Stats   GitHub   Settings

🐙 GitHub
2 PRs: 1 merged · 0 open · 1 draft · 0 closed
runs: 3 passed · 0 failing · 1 running · 0 queued
Read from GitHub at 12:53. The tab asks again each minute while it is open.

── Open · 1 ───────────────────────────────────────

[STARK-1202] Document the export flags
  PR #447 DRAFT · opened 12:41 · open 12m · +275 −26
  Checks       ● ci #1280 running 2m  ✓ secret-scan #582 11s
  Commits      1 · last 12:40 5e09724 feat(STARK-1202): document the flags

── Merged · 1 ─────────────────────────────────────

[STARK-1201] Add the export command
  PR #446 MERGED · opened 12:02 · merged 12:17 · open 15m · +681 −120
  Checks       ✓ ci #1278 1m43s  ✓ secret-scan #580 15s
  After merge  ✓ ci #1279 1m40s  ✓ secret-scan #581 14s
  Commits      3 · last 12:14 0966587 chore(changelog): stark-progress 0.1…

Select a name to see each job and the newest commits.

No PR yet:
  [STARK-1203] [STARK-1204]
```

## The Gru pane

The pane opens by itself in Gru's tab, once, when the poll first finds Gru's
run, and from 144 columns (110 once you opened it). `/gru-board` opens it in
any session, at any width. While the pane is not placed, Gru's tab keeps one
line above the prompt: `Gru · <epic> · <n> of <m> done · /gru-board opens the
board`. Gru's tab draws no band rows.

**Which run.** Gru's tab shows its own run. A session that ran `/gru-board`
shows the run whose run file, ticket files, heartbeats or logs changed last; a
run file changes only at launch, so its own time says little. It then stays on
that run until you press `r` or the run ends, even when another run gets busier,
so a Settings press always writes to the run on screen (a press that finds the
board moved writes nothing and says so). The session's state keeps the
`/gru-board` ask, so a reload of the mod keeps it too. A run is active when one
of its files changed in the last hour. The pane names the other active runs, and
`r` shows the next one by launch id, in Gru's tab too, so each run is reached.
An `r` press in Gru's tab is a look, not a `/gru-board` ask: once Gru deletes
its run file at the end, the tab shows no run and says `The run <epic> ended`,
never the busiest other run; `/gru-board` there shows one. A poll that lists
Gru's run file but cannot read it leaves the pane and the band as they are. A
tab that never had a run of its own says `No Gru run yet` when no run file is
left.

**Overview.** From the top:

- The epic; its title on its own line; then the repos (each from a title's
  `<repo>: ` lead), the ticket count, and when the run started:
  `started 11:02, 1h51m ago`, or `started Sat 31 Oct 11:02, 26h05m ago` on an
  earlier day. The title loses its `EPIC:`, `[tag]` and `<repo>: ` leads, in
  either order. A `--tickets` run's epic is its first ticket, so its title is
  that ticket's name as its row has it. Any other epic's title is
  `alfred task show <epic> --json`'s `item.name`, run in the session's working
  folder, in the background, with a 30 s timeout; the mod keeps the answer
  until it loads again, and a failed ask shows no title and is tried again
  5 minutes later. The start is the oldest
  line of the run's log (Gru writes one at launch), else when Gru's stats
  began; with neither, the line names no start.
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
- `🚇 Where each ticket is`: a name, `[STARK-n] <title>` (the title without
  its `[tag]`, `<repo>: ` lead and `(slice n of m)` tail), then the track and
  its state: a word in UPPERCASE in its own color, then the words after it.
  Six states move along the spine, with no emoji: `NOT STARTED`,
  `STARTING · <time in stage>`, `PR OPEN · <time>`, `IN REVIEW · <time>`,
  `MERGED · <time>` and `DONE`. Five want a look, and only these draw bold
  with an emoji: `🚧 BLOCKED · <time>` (the stage is `blocked`), `✋ HELD ·
  <merge or release> · <time>`, `⏳ LONG RUNNING · <time>` (no call started or
  ended for 15 min while one call runs and the tab lives, the time that call
  has run), `💤 QUIET · <time>` (no call started or ended for 15 min, and none
  runs; a call left running by a session that died, whose heartbeat stopped
  3 min ago or more, reads quiet too) and
  `🐢 SLOW · <time>` (no stage change or commit for 45 min; it joins the box
  of tickets worth a look at 90, where the band says `stalled`). A ticket
  with 5 of its last 10 calls failed keeps its step's state; the box says why.
  With `Done tickets last` On, the list draws three groups, each under a line
  with its name and count, with an empty row above and below the line:
  `In progress`, `To do`, then `Done`, each in run order; an empty group draws
  no line. Off, the list keeps the run order with no line. Select a name to open its detail: the whole title, the slice, the PR, when the step began,
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

Each ticket the pane names (its row, the box of tickets worth a look, Up
next and the Log tab) reads `[STARK-n] <title>`: the id in its own color,
then the title in the text's color, dimmed on a done or not started row (and
on the Log tab). In the terminal the id is lavender (`#c9b3f5`, 8.1:1 on the
pane), a color no state uses; elsewhere it takes the app's accent. The title is
the ticket file's, else the run file's `titles` entry; a ticket that neither
names shows its id alone.

**An open worker tab.** A row whose worker tab is open draws its id as
` STARK-n `, bold, on the id's lavender (the pane's `#262626` on `#c9b3f5`,
8.1:1; the app's accent elsewhere), as wide as `[STARK-n]`. It is a button: a
press runs `hermod focus <surface>`, which brings that cmux tab to the front,
and a toast says why when hermod fails. The title beside it is a button of its
own that opens the row's detail (`details` when no file names a title). A tab
is open when the ticket's heartbeat is under 3 minutes old and names a
surface: a worker's tab writes it at least once a minute, with no call too.
Only the list's rows draw it; the box, Up next and the Log and Stats tabs keep
`[STARK-n]`.

**Log.** `l` opens it. The big steps of the run, newest first: Gru's own,
from the run's log, merged with each ticket's, from its worker's log. Each
step shows its local time `HH:MM`, then whose it is (`Gru`, or the ticket's
`[STARK-n] <title>`) over its words. The writer words each step for a five-year-old, in 20
words or fewer ([the worker spine's log file](../../standards/worker-spine.md#log-file));
the pane keeps each to one line and cuts it at the 20th word, with `…`. On a
tie, the later line of the later file comes first. Unless every step shown
is today's, a day line (`Today`, `Yesterday`, `Thu 29 Oct`) heads each day, so
a closed ticket's old steps never read as today's. The tab shows the 50 newest steps and counts the ones it leaves
out. With no step yet, it says who writes them.

**Stats.** `t` opens it. A table of counts in two columns: `Gru`, Gru's own,
from the run's stats file, and `Whole run`, Gru's added to each ticket's,
from the tickets' stats files. The counts begin when the mod loaded in each
session, and the tab says when the earliest began. The rows:

| Group | Rows | From |
|---|---|---|
| Time | session time, working time | each poll: the time since the last one counts as open, and as working while the main loop or a subagent is inside a turn (`turn.start` to `turn.complete`; a background subagent that runs after the main turn ended counts too, and overlapping turns count once); a gap over 5 s counts as 5 s, so a sleep of the computer adds almost nothing. The whole run adds each session's: three workers busy for one hour add three hours |
| Tokens | input, output, cache read, cache write, model requests | each model request of the main loop and its subagents (`turn.step`'s usage) |
| Work | lines added and removed, commits | each ticket's git signal while its worktree is there, else the last one its stats file kept |
| Work | PRs opened and merged | the ticket files: a `pr` URL is a PR opened, and one at `merged` or `closed` a PR merged |
| Work | review rounds | each `/code-review` typed (`command.run`), and each Skill call of `code-review` and each `codex review` run that did not fail; `skill.prompt` would see both forms, but a built-in plugin above the mod passes it on past the mod |
| Tools | tools used, tool calls, failed calls | each tool call (`tool.call`), subagents' included; a refused call is a failed one |
| Prompts and messages | prompts from you, from other sessions, other prompts | each prompt that entered, by its origin: typed, from a phone or a Slack ping is yours; a peer session's, a SendMessage delivery or a coordinator's is another session's; a notification, a schedule or a plugin's is other |
| Prompts and messages | messages sent, workers launched | each SendMessage call that carries a message, each `hermod msg send` or `reply`, and each `valkyrie agnes`, `minion` or `gru` run, that did not fail; a tool named only in quoted text or a here-document (a commit message, a PR body) is not a run |

Gru writes no code, so its lines, commits and PRs read `—`. Under the table:
the five tools with the most calls in the whole run, each session's main-loop
model and effort (Gru's, then each ticket's), the requests and output tokens
per model, and the started tickets with no stats file: a Codex worker, a
session without the mod, or a ticket Gru found closed. With no stats file at
all, the tab says where the counts come from. A hermod message reaches a
Claude session through its own inbox, so it counts as from another session.
The first prompt of a Gru or a worker, which valkyrie passes on the command
line, arrives as typed, so `prompts from you` counts it too.

**GitHub.** `g` opens it. For each ticket whose file names a PR (`pr`, a
`https://github.com/<owner>/<repo>/pull/<n>` URL), in run order, with an empty
row between two PRs:

- `PR #<n>`, its state in UPPERCASE and its own color (`OPEN` periwinkle,
  `DRAFT` gray, `MERGED` lime, `CLOSED` red), when it opened and merged or
  closed, how long it was open, and its size: `+<lines added>` in green and
  `−<lines removed>` in red.
- `Checks`: each GitHub Actions workflow run on its head commit, with its
  mark, its name, then `#<run number>` and duration (`1m43s`, `running 2m`,
  or `queued`) in the hint's color. `After merge`: the runs on its merge
  commit, once it merged.
- `Commits`: how many, then the newest one's time, short id (in the id's
  color) and headline. Select a name to open each run's jobs with their
  durations, and the newest 10 commits, each with its checks' mark.

With `Done tickets last` On, the PRs draw in three groups, each under the
Overview's line with an empty row above and below it: `Open` (open and draft
PRs), `Merged`, then `Closed`, each in run order; an empty group draws no
line. Off, the PRs keep the run order with no line.

A mark is `✓` passed, `✕` failed (also timed out, a startup failure or an
action required), `●` running, `○` queued or waiting, and `–` cancelled,
skipped, neutral or stale: a different glyph each, so none rests on its color
alone. A commit's mark is its status rollup's. Above the PRs: the counts of
PRs by state, and of the head commits' runs that passed, fail, run or wait to start (a check
suite of another app, with no workflow run, never counts; nor do the runs
after a merge). Each count above 0 draws bold with its word in its own color
(merged lime, open periwinkle, draft gray, closed red; passed green, failing
red, running blue, queued gray), and each 0 in the hint's. Below them: the tickets GitHub has not answered for yet, and the
tickets with no PR.

The tab asks GitHub only while the Gru pane is placed and shows it: one
`gh api graphql` call a repo for all of its PRs, with a 30 s timeout, in the
background, once a minute, and at once when the tab opens (10 s after the
last ask at the soonest). A closed pane, or another tab, asks nothing. Each
repo keeps its last good answer; a failure keeps it and adds one line,
`<owner>/<repo>: GitHub did not answer at <HH:MM>: <first line of the error>`.
An answer with an error (a PR number GitHub does not know) keeps the PRs it
holds and adds one line,
`<owner>/<repo>: GitHub answered at <HH:MM> with an error: <first line of the error>`.
The tab shows only the lines of this run's repos. `Read from GitHub at <HH:MM>` is the oldest answer the tab draws. The calls
read only, as the `gh` login of the machine.

**Settings.** Four rows for the run, each a value in a frame you select to change. A
press on one writes all four to the run's settings file at once; Gru reads it
before each launch and each scope change ([the Gru skill](../../skill/gru/references/progress-pane.md)):

| Row | Field | What Gru does |
|---|---|---|
| Decide for me | `decideForMe` | On, the default: splits a ticket across repos, and adds a blocking ticket, by itself. Off: holds the ticket `blocked` and asks in its report. |
| Workers at once | `maxWorkers` | Keeps up to this many Minions alive, 1 to 8. A launch above 8 shows its own value; `−` steps it down to 8, and `+` does not change it. |
| Pick up follow-ups | `followUps` | On, the default: a ticket a Minion files joins the run. Off: it waits on the board, named in the report. |
| Worker type | `minionAgent` | The runtime of each new Minion, `claude` or `codex`. A relaunch keeps its runtime. |

Under `This pane`, one more row that the pane alone reads, in every run:
`Done tickets last`, Off by default. On, `🚇 Where each ticket is` lists the
tickets in three groups, each under its own line: in progress, to do, then
done, each in run order; the GitHub tab lists open and draft PRs, then merged, then
closed, the same way. The plugin's own
store (`$.store`, key `doneLast`) keeps it across sessions; it loads in the
background at session start, and presses apply one at a time behind it. It is
never in the run's settings file, and Gru never reads it. A store that cannot
be read leaves it Off; a write that fails keeps the press on screen and says
`The choice was not saved.`

**Colors.** In the terminal, every text color is 4.5:1 or more on the pane's
`#262626` (secondary text 8.1:1); the track's lines and rings, which carry no
words, are 3.5:1. They suit a dark theme. Each state's word has its own:

| State | Terminal | Contrast | Elsewhere |
|---|---|---|---|
| `NOT STARTED` | `#a7adc2` gray | 6.8:1 | `inactive` |
| `STARTING` | `#8ecae6` blue | 8.5:1 | `ide` |
| `PR OPEN` | `#a5b4fc` periwinkle | 7.6:1 | `planMode` |
| `IN REVIEW` | `#f4a6cd` pink | 8.1:1 | `bashBorder` |
| `MERGED` | `#c5e384` lime | 10.6:1 | `merged` |
| `DONE` | `#95d5b2` green | 9.0:1 | `success` |
| `BLOCKED` | `#ff8f87` red | 6.9:1 | `error` |
| `HELD`, `LONG RUNNING`, `QUIET`, `SLOW` | `#e9c46a` amber | 9.1:1 | `warning` |

The id's color is none of them, so an id never reads as a state: lavender in
the terminal, and elsewhere `suggestion`, which no state uses (nor
`permission`, which is close to it in the app's own themes). On every other
surface, the desktop app's Code tab included, each color is a theme key, so
it follows the app's light or dark theme: on the desktop's light theme, each
word measured 5.7:1 or more on the pane's white (the five state keys added in
0.13.0, `ide`, `planMode`, `bashBorder`, `merged` and `error`, are not measured
there yet). A moving bar and track take the app's accent, which
is blue in the active window and gray, as all of the app's accent, in an
inactive one. The desktop draws text in a face of mixed widths, so the bar
graph, the station words, the tracks and the last hour draw in its fixed-width
face, and a Log tab's times in digits of one width; the terminal ignores both.

## The ticket pane

The pane opens by itself in a Minion's or Agnes's own tab, at any width.

- **At the launch.** The prompt that starts the worker opens it, before the
  ticket's file exists: `/minion` or `/agnes`, with a plugin prefix
  (`/stark-ops:minion`) or not, or either one as the first word of a `/goal`
  (valkyrie starts Agnes with `/goal /agnes STARK-n`). Until the file comes,
  the pane says `No ticket file yet`.
- **Why a prompt.** The engine places a pane opened from the hook of a prompt
  the person entered at any width, and a launch's first prompt counts. A pane
  the mod opens on its own (the poll's) waits undrawn below 144 columns (110
  once you opened it), until you open it or widen the terminal.
- **Later.** A later prompt in that tab opens the pane again while it is not
  placed, once the poll found the ticket's file. When no prompt opened it
  yet, the poll opens it once, when it first finds that file. A prompt that a
  hook drops opens nothing.
- **Your close holds.** Once you close the pane by hand, no prompt or poll in
  that session opens it again. `/ticket-board` opens it in that tab at any
  width, and clears your close; in any other tab it says the tab has no
  ticket.

While the pane is not placed, the tab keeps its one band row above the
prompt. It draws with the Gru pane's parts, palette
and rules: counts and elapsed times only, one emoji at most per section
header and per status, and none in Settings.

**Overview.** All of it at once, since the pane holds one ticket:

- `[STARK-n] <name>`, bold, as the Gru pane names a ticket: the id in its
  own color, then the name (the title without its `[tag]`, `<repo>: ` lead
  and `(slice n of m)` tail). A ticket file with no title shows the id alone.
- Under it, the repo, the slice and `started <when>, <elapsed> ago`, each
  only when it exists. The start is the oldest line of the ticket's log, else
  when its stats began, as a run's start is.
- `Part of [<epic>] <epic title>` when an epic's run file lists the ticket
  (a `--tickets` run, launched as `GRU-n`, has no epic to name). The title
  comes as the Gru pane's does: from alfred, asked once in the background, or
  from the run file when the epic is a ticket of its run. With no title yet,
  `Part of <epic>`.
- `🚇 Where it is`: the five stations and the state, as the Gru pane draws
  them. A held ticket reads `✋ HELD · <merge or release> · <time>`.
- A box when the ticket is worth a look: the band calls it `blocked`, `idle`
  or `stalled`, 5 of its last 10 calls failed, or a setting holds it
  (`Held by your settings: <merge or release>`, and the setting that clears
  it). Else `🌿 Nothing needs you right now.`
- `🔧 Activity`: the running or last tool call, the calls in the last 15
  minutes, the failures among the last 10, the diff size, and the commits,
  then its last hour, drawn as the Gru pane's opened row draws it (marks,
  legend and when it shows nothing are the same).
- `👉 Up next`: the next spine step. With a hold, `Wait for your merge OK.` or
  `Wait for your release OK.` Else by stage: `ticket` opens the PR, `pr`
  reviews it, `review` merges it, `merged` releases or closes, and `blocked`
  waits for the block to clear. A closed ticket has none.

**Log.** `l` opens it. The ticket's own steps, from its worker's log, read
as the Gru pane's Log reads them, with no name over a step: each one is the
worker's.

**Stats.** `t` opens it. The Gru pane's table in one column: the counts of
the ticket's worker sessions, from its stats file, its lines and commits from
git, and its PR from the ticket file. Under it, the most used tools, the
session's model and effort, and the requests and output tokens per model. A
relaunch on the same ticket adds to the counts the file holds. The line under
the title adds `The ticket started <when>.`, unless the start is only when the
counts began, which `Counted since` already says.

**The end.** Once the ticket's file is gone (Agnes removes it at stand-down),
the pane says `The ticket <STARK-n> ended`. The session's state keeps the
ticket the tab found, so a reload of the mod says the same. A tab whose ticket
never had a file, or that moved to another ticket's worktree, says
`No ticket file yet`. A poll that lists the ticket's file but cannot read it
is not the end: it leaves the pane, the band row and the heartbeat as they
are.

**Settings.** Three rows, each a value in a frame you select to change. A press writes
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

The skills write the ticket, run and log files; the mod writes the heartbeat,
the stats and the settings files. The ticket, run, log and settings files are runtime-neutral: a
Codex Gru or worker writes and reads them too, and only a Claude Code session
draws them. Every file but a log is whole JSON, written atomically: a writer writes
`<name>.json.tmp` beside it and renames it over `<name>.json`, so a poll never
reads a half-written file
([the worker spine's command](../../standards/worker-spine.md#progress-file)
does this for a ticket's file). A field of the wrong type reads as absent: a
`stage` that is not one of the six draws as `ticket`.

A log is JSON Lines, one whole object a line, appended with `>>`:
`~/.cache/stark-progress/<STARK-n>.log.jsonl`, one per ticket, which its
worker appends to, and `~/.cache/stark-progress/run-<id>.log.jsonl`, one per
Gru run, which Gru appends to:

```json
{"at":"<ISO 8601>","text":"<the step, in plain words, 20 words or fewer>"}
```

[The worker spine's log command](../../standards/worker-spine.md#log-file)
writes each line with `jq -nc`, which writes it in one append. The mod skips
a line that does not parse (a write not yet whole), and one with no words or
no valid `at`. A worker appends at each big step, and Gru at each of its own;
Gru's stamps on a ticket's file add no line to that ticket's log. A Minion's
log stays after the close, as its ticket file does; Agnes deletes hers at her
stand-down, and Gru deletes the run's log with the run file.

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
{ "epic": "STARK-n", "session": "<Gru's session id>", "tickets": ["STARK-a", "STARK-b"],
  "titles": { "STARK-a": "<ticket title>", "STARK-b": "<ticket title>" }, "maxWorkers": 3, "minionAgent": "claude" }
```

`session` is Gru's own session id (`$CLAUDE_CODE_SESSION_ID`, or
`$CODEX_THREAD_ID` on Codex). `titles` is each ticket's title at launch, which
names a ticket on the Gru pane until its own file does; the ticket file's
`title` wins, and a title that is not a string, or names no ticket of the run,
is skipped. `maxWorkers` and `minionAgent` are the launch's `--max-workers` and
Minion runtime; a v1 file has none of the three, and a file written before
`titles` has no `titles`. A ticket with no file yet
draws as `no file yet`.

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
  "minutes": [{ "at": 29872800, "calls": 6, "fails": 1 }], "recent": [false, true],
  "surface": "<the tab's CMUX_SURFACE_ID, or null>" }
```

The mod writes it in a worker's own tab, from that session's tool calls
(its subagents' included), at most once every 5 seconds after a call, and at
least once every 60 seconds with no call (the first poll writes at once), so
an `updated` under 3 minutes old says the tab is open. A keep-alive never takes
the heartbeat from another session whose tab lives (a second session in the
worktree); that session's own calls still write it, as before 0.13.0. It writes only while the
ticket's file exists; once the file is gone the mod removes the heartbeat.
`surface` is the tab's `CMUX_SURFACE_ID`, `null` outside cmux, and absent in a
heartbeat before 0.13.0; the Gru pane passes it to `hermod focus` only when it
is a UUID.
Agnes deletes her heartbeat and stats files herself at stand-down, with her
ticket's file, since her tab can close before the mod's next poll. `lastActivity` is when a call last started or
ended, `running` the oldest call still running or `null`, `minutes` the calls
and failures per minute for the last 60 minutes (`at` is minutes since the
epoch), and `recent` the outcomes of the last 10 calls that ended, oldest
first, `true` for a failure. After a reload the mod takes back the minutes,
outcomes and last activity of a heartbeat its own session wrote.

`~/.cache/stark-progress/<STARK-n>.stats.json`, one per ticket whose worker
is a Claude session with the mod installed, and
`~/.cache/stark-progress/run-<id>.stats.json`, one per Gru run whose Gru is:

```json
{ "session": "<the session that wrote it last>", "since": "<ISO 8601>", "updated": "<ISO 8601>",
  "model": "claude-opus-5-5", "effort": "xhigh", "requests": 41,
  "tokens": { "input": 10000, "output": 32000, "cacheRead": 2300000, "cacheWrite": 94000 },
  "models": { "claude-opus-5-5": { "input": 10000, "output": 32000, "cacheRead": 2300000, "cacheWrite": 94000, "requests": 41 } },
  "prompts": { "operator": 1, "peer": 2, "other": 1 }, "sent": 3, "launches": 0, "reviews": 1,
  "tools": { "Bash": { "calls": 32, "fails": 2 } }, "git": { "added": 234, "removed": 20, "commits": 3 },
  "openMs": 6660000, "busyMs": 1320000 }
```

Every session with the mod counts these in memory from its start (the Stats
tab names each source); a worker's own tab writes the ticket's file and Gru's
own tab the run's, at most once every 5 seconds after a count changed, and
only while the ticket's or the run's file exists. Once that file is gone the
mod removes the stats file; a Minion's stays after its close, as its ticket
file does, so the Gru pane still adds it in. The first write of a tab adds
its counts to the ones the file holds, so a reload or a relaunch on the same
ticket or run keeps the total, and `session` names the last writer. `since`
is when the counts began; `model` and `effort` are the main loop's at its
last request (`null` before one); `git` is a worker's last git signal for its
worktree, kept after the worktree goes, and `null` in a run's file. `openMs`
is how long the session was open and `busyMs` how long its main loop or a
subagent was in a turn, in ms, as the Stats tab's `Time` rows count them;
`since` is the session's first poll at the latest; time alone writes
the file only when one of them reaches a new minute. A file written before
0.14.0 has neither, and reads as no time. A field of the wrong type reads as
zero or absent. A `*.stats.json` file is never a run file.

## Which tab shows what

- A session that a run file names as its `session` is Gru's tab, even though
  it stands in a worktree named for its launch id (the epic's own `STARK-n`,
  or `GRU-n`): it shows that run in the Gru pane, and writes the run's stats
  file. Once Gru deletes the run file, the tab names that run's end and shows
  no other run until `/gru-board`.
- Any other session whose project root (where it started, or the worktree it
  moved to; a shell `cd` does not move it) is a folder named `STARK-n`, a
  worker's worktree, shows that ticket in the ticket pane once its file
  exists, its band row while the pane is not placed, and writes its
  heartbeat and its stats file. `/ticket-board` opens the pane there, and
  only there.
- Any session shows the Gru pane after `/gru-board`.
- Nothing matching draws nothing, and writes no stats file.

Each poll lists the directory and reads the run files, then only the ticket,
heartbeat, stats, settings and log files the tab draws, so old files cost a
listing and nothing more. A tab reads its own stats file once, for its first
write: its counts are in memory after that.

## Not built (add when it hurts)

- The CI and review state of each PR on GitHub.
- Activity for Codex workers, from their session files.
- A toast or a sound when a row becomes `stalled`.
- A stage history that stays when the mod reloads.
- Log lines the mod writes itself, from commits or stage changes, or words
  a model writes: the worker words its own steps. Add one when a worker's log
  proves unreliable.
- A Gru run's log after the run: Gru deletes it with the run file, when the
  pane has no run left to show.
- Settings Gru cannot honor yet: workers on devbox (valkyrie cannot launch
  there), and a minimum worker count (Gru already fills to the maximum).
- A merge hold, a review depth or a release stop for a whole Gru run: each
  ticket has its own, in its worker's ticket pane.
- Activity for a Codex worker in its ticket pane (it writes no heartbeat).
- A held worker whose session died reads `held` on the Gru pane, with its
  time held: the state does not read the heartbeat's age, though its id
  loses the open-tab button. Gru's observation pass reads it from Hermod. The
  ticket pane dies with its tab.
- A button to a worker tab in tmux or outside cmux: the heartbeat names only
  a cmux surface.
- A light-theme palette for the Gru pane and the ticket pane in the terminal.
- Stats for a Codex Gru or worker, or for a Claude session's time before the
  mod loaded: the mod counts events as they happen and reads no transcript.
  A reload in the middle of a turn counts that turn's rest as open, not as
  working, until the next turn starts.
- An epic's title for an epic alfred does not know (an EI epic, or no alfred),
  or in a `/gru-board` session whose working folder is no git checkout:
  `alfred task show` refuses there. Gru's own tab is always in a checkout.
- Stats from GitHub (a PR's own line count, its review threads), or a cost in
  dollars.
- On the GitHub tab: commits that are not pushed, a branch with no PR, reviews
  and review threads, a GitHub tab in the ticket pane, and any write to GitHub
  (a re-run of a failed job, a merge, a comment).

## Develop

```
claude plugin validate mods/stark-progress
claude plugin test mods/stark-progress
claude --plugin-dir mods/stark-progress
```
