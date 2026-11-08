# A dead Minion

Read from [the Gru skill](../SKILL.md#protocol).

## When a peer is dead

A peer is dead only when Hermod reports its `liveness` dead or its `pid`
gone, never because it is missing from the list (a fresh Claude session is
absent for its first moments, and a relaunch then would attach a second
session to the same worktree). Read the board before you read a corpse: a
Minion that reported `done` goes dead on purpose moments later — it stands
down with `hermod poison-pill`, which exits it, removes its worktree and
closes its tab — and step 2 confirms and skips its now-`done` ticket. So read
the ticket, not the corpse: a dead peer whose ticket is already `done`/`Closed`
is a missing report, not a death — confirm it under step 5 and move on. A dead
peer whose ticket is **still open is a death, even when its PR already
merged**: a Minion can die between the merge and the ticket close, and nobody
else is going to close it. A dead Claude Minion that is a real death is
relaunched once with step 3's same `valkyrie minion` line, the agent it had
included whatever `minionAgent` says now, which re-enters its
worktree; the relaunch is a new session with no
`from` address, so make step 3's first contact again after its ack. A dead
Codex Minion is a blocker: `valkyrie minion` refuses its existing worktree, and
the branch `STARK-n` that outlives one, with exit 2; report the path. A second
death is a blocker.

## Reap a dead Minion's tab

A dead Minion's tab is yours to reap, with
`hermod close-session <surface UUID> --json`, never `poison-pill` —
poison-pill only ever targets the caller's own surface, and close-session is
the mirror of it, refusing that one alone. Reap it only once step 4 is done
with it (its ticket confirmed under step 5, or its death a blocker), never
before step 4's relaunch, which re-enters that worktree. Reap it only when
its worktree is clean and its branch has no unpushed commit, and never pass
`--force`: close-session's own gate refuses a dirty or unpushed tree, which
is the check. It takes the tab and the clean worktree, and leaves the
branch. On a refusal, or an ack whose `closed` is not `true`, report the
surface and leave it.
