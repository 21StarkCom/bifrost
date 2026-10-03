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
- This adds `docs/specs/` back to bifrost, which had none since the
  marketplace retirement. The fleet rule puts specs there.

## Calls I made for you
- When Kevin may skip the review: only if GitHub shows a review on the PR's
  current commit from the same account. Your rule says the review gate is
  mandatory, so a "trust me" is never enough.
- A failed apply after a merge: Kevin reports it and doesn't rerun on his own,
  because ev-infra-group documents failures a rerun just repeats.
- One Kevin per repo, so merges there queue in one place.
- Kevin's id is `KEVIN-<n>`, not plain `KEVIN`: a leftover branch would block
  every second Codex launch.
