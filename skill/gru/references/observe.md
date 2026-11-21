# Observe a live Minion

Read from [the Gru skill](../SKILL.md#protocol).

## When to observe

Run one observation pass on each live Minion once a tick, then wait for its
next report or the next pass, whichever comes first.

- **Claude:** while a Minion of yours is live, keep one 10-minute timer
  armed: a Bash `sleep 600` with `run_in_background`, which wakes you when it
  exits. Arm it after the first launch, re-arm it on each tick, and let it
  lapse once no Minion is live. With a muninn leader, the listener of
  [leader-muninn.md](leader-muninn.md#wait) is this timer.
- **Codex:** a Codex Gru has no timer. It runs the pass on a live Minion
  that has sent nothing for over 30 minutes, since `/minion` sends a
  progress note at least that often.

## The pass

An observation pass reads the Minion's `muxctl msg peers` row
(`activity` busy or idle; `unknown`, which Codex and some Claude sessions
report, leaves it to the other two), the processes under its `surfaceId` in
`muxctl ps --columns cmuxSurfaceId,pid,ppid,name` (a test runner, a build or
`git` under the agent is work; the MCP servers every agent keeps for its
whole life — `bun`, `node`, `cmux-cua` and the like — are not), and **one**
`muxctl read-screen <surface UUID> --lines 40`. Classify it from those:
- **working** — busy, with a work process or a tool call in flight: leave
  it alone.
- **waiting** — idle on a menu or a question, or idle on you: holding its
  merge because you told it to, or waiting on your answer to something it
  sent you. An idle session cannot send a progress note, so its silence is
  not a stall. A Minion that reported `held` waits on the operator's
  ticket settings: it is not stuck, and you do not nudge it. Read a menu or a question and answer it under
  [Terminal control](../SKILL.md#terminal-control) when the answer is yours to give;
  otherwise escalate it.
- **stuck** — busy with no work process under it and no tool call in
  flight, or idle with its ticket open and none of the above: interrupt a
  busy one under [Terminal control](../SKILL.md#terminal-control), ask it for its
  status through [Coordination route](../SKILL.md#coordination-route), and escalate
  one that still does not move by the next pass.
- **lazy** — it stops short with its ticket open: it asks for a GO, which
  its launch already gave for every step of its ticket (a live write, a
  merge, a close), offers to do the next spine step instead of doing it, skips
  the review tier or the live verification, or reports `done` with no
  merged PR. Send it one message through
  [Coordination route](../SKILL.md#coordination-route) that names the step and tells
  it to carry on; never type it into its terminal. A second lazy pass on
  the same step is a blocker: escalate it.

## A held Minion

A Minion can report `held: <merge or release> by the ticket's settings`: the
operator's ticket settings hold that step
([the spine's holds](../../../standards/worker-spine.md#holds)). It is not a
block. Do not stamp its file, do not escalate it, and send no `unblocked`:
the Minion goes on by itself once the operator clears the setting.

On a no-queue repo ([Authority](../SKILL.md#authority)), a `held: merge`
gives up its merge turn: let the next Minion there merge. When the hold
clears, the held Minion's `ghx pr-merge` rebases through any merge that ran
meanwhile. A `held: release` keeps the turn, since two release chains never
run there at once. Name the Minions it holds in your report.
