# Observe a live Minion

Read from [the Gru skill](../SKILL.md#protocol).

An observation pass reads the Minion's `hermod msg peers` row
(`activity` busy or idle; `unknown`, which Codex and some Claude sessions
report, leaves it to the other two), the processes under its `surfaceId` in
`hermod ps --columns cmuxSurfaceId,pid,ppid,name` (a test runner, a build or
`git` under the agent is work; the MCP servers every agent keeps for its
whole life — `bun`, `node`, `cmux-cua` and the like — are not), and **one**
`hermod read-screen <surface UUID> --lines 40`. Classify it from those:
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
