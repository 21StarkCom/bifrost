# Kevin as a request desk: the brief (not normative; the spec wins)

## What this does
Kevin becomes Gru in reverse. Each repo has at most one Kevin, and any agent
can ask him for something: merge this PR, review that one, cut a release,
tell me your status. He works through requests one at a time and answers
each to whoever asked. Nobody leads him. A release goes all the way: he
writes the version bump, runs it through review, tags it, watches the build,
gets the Homebrew tap PR merged by the tap's own Kevin, upgrades the binary
on this machine, and checks the version. He leaves on your word, or after two
quiet hours.

Minions and Agnes stop releasing on their own. They merge their PR, then ask
the repo's Kevin for the release. Anything they need in another repo (a PR
there that has to merge first) they ask that repo's Kevin for, instead of
going through Gru. Gru stops launching Kevins at all.

## What it will NOT do
- Let any agent's message stand in for your approval. Applies, credentials,
  keychain or Touch ID prompts, environment approvals and force pushes stay
  yours, whoever asks.
- Release a repo whose release steps aren't written down. He refuses, and the
  repo gets its steps written first.
- Stand down a Codex Kevin after two idle hours. Codex has no timer to wake
  him, so a Codex Kevin leaves when you say so, or when a message finds him
  idle.
- Fix `/stark-release` (it pushes straight to `main`). Kevin does the same
  bump as a PR.

## What I checked myself
- How 48 fleet repos actually release: five patterns, written down in the
  spec. Most leave a tap PR open, and some sign locally with prompts only you
  can answer.
- That `hermod msg send --to` takes Kevin's session name or id, and that
  Claude's session cron fires only while the session is idle.

## Where I'm unsure
- How the coalescing of release requests feels in practice. Two Minions
  finishing minutes apart get one release between them, which is the point,
  but the second one waits for the first one's whole chain.
- The live release test needs a fleet repo with a real unreleased change. I
  pick one at verification time.
