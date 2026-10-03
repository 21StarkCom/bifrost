# Kevin — the brief (not normative; the spec wins)

## What this does
Adds Kevin, a worker who stands in one repo and takes instructions from whoever
launched him (Gru, another agent, or you). He carries that repo's existing PRs
through its review, fixes what the review finds, merges them, and watches what
the merge sets off, like ev-infra-group's apply. He answers each instruction in
one line and waits for the next until his leader dismisses him.

## What it will NOT do
- Write new changes. A request for one is refused with "that needs a ticket and
  a Minion".
- Touch tickets: no binding, moving or closing.
- Take anything that needs you: an apply by hand, credentials, a force push, an
  admin merge, closing PRs, deleting branches.
- Take orders from anyone but his leader and you.
- Teach Agnes to use him (later, if wanted).

## What I checked myself, so you don't have to
- Every file and test the plan names exists today. I read the worker skills,
  the shared docs, the manifest and the smoke tests.
- Every "done when" check fails on today's code, so none can pass without the
  work being done. I ran each one.
- A session in a worktree really can't run git on another repo. That is
  measured: this session hit the guard while I wrote the spec.
- The tests pass (`cd tools && npm test`); the end-to-end proof is a live
  run: Kevin merges a README-only PR on ev-infra-group, refuses a stranger and
  a "write code" request, and stands down.

## Where I'm genuinely unsure
- The live run needs two agents and a real PR, so no single command proves it.
  It's a checklist item, the weakest check here.
- Most of the skill's checks match on strings in the skill's text. They prove
  the rules are written down, not that an agent follows them; only the live
  run proves that.
- Kevin can't start until the idun launcher (STARK-10444) ships.
- Kevin can't merge a PR whose branch is open in a live author's worktree. idun's
  merge tool needs that branch in Kevin's own worktree. He reports it blocked
  and the author merges it. This is the most likely surprise in real use.
- This adds `docs/specs/` back to bifrost, which had none since the
  marketplace retirement. The fleet rule puts specs there.

## Calls I made for you
- Kevin always runs the review himself. You picked "run the review if it
  hasn't run", but the red team showed nothing on GitHub proves an earlier
  review left no open finding, and your rule makes the review mandatory. The
  cost is one extra review when the author already ran one.
- A failed apply after a merge: Kevin reports it and doesn't rerun on his own,
  because ev-infra-group documents failures a rerun just repeats.
- One Kevin per repo, so merges there queue in one place.
- Kevin's id is `KEVIN-<repo>-<n>`, not plain `KEVIN`. A leftover branch would
  block every second Codex launch, and a bare `KEVIN-1` in one repo would
  block `KEVIN-1` in every other.
