# Cloud or local: the brief (not normative; the spec wins)

## What this does
When a ticket is written, `/stark-ticket` decides whether it can run in a
Claude cloud session or needs this machine, and records that on the ticket.
Gru routes on it alone. A cloud session stops at an open PR, the repo's Kevin
reviews it, re-runs the ticket's checks on the final code, merges it, and Gru
closes the ticket. A cloud failure is redone by a local Minion, unless the
session might still open a PR; then you're told instead, so a ticket never
gets two PRs.

## What it will NOT do
- No `cloud` tag, and no per-run override: set a ticket's field to force it
  local. Old tickets have no verdict and stay local.
- No Minion picks up a half-done cloud PR; a redo starts fresh.
- Kevin gains one thing only: `merge … for STARK-n`. Only Gru routes.
- Gru never chats with or archives a cloud session, and never merges.
- No change to the cloud pools; `## Runs in` stays optional to alfred.

## What I checked myself
- About 62 claims re-checked against the source by a separate reviewer.
  Every bifrost task's check fails on today's code (I ran them); the idun
  headless check, which 11 old tests already passed, now needs a new name.
- The proof: a small bifrost ticket goes from stark-ticket through the cloud,
  Kevin's merge (his comment shows the re-run) and Gru's close, unaided.

## Where I'm genuinely unsure
- The session is only told not to merge or push after its PR. A merge anyway
  lands unreviewed code; a push mid-review gets the ticket redone locally.
- The session API's status words are unverified (the idun ticket pins
  them); an unpinned word counts as "maybe running", so Gru waits.
- Only cloud-agent-1 is confirmed able to open PRs (others: STARK-9577).
- Cloud PRs queue behind Kevin's other work, releases included. Whether he
  can merge a PR a cloud seat's account opened, the live test shows.
- A session that never finishes: you hear at 3 hours; a Gru rerun resumes it.

## Calls I made for you
- **"Same as --max-workers"** read as N cloud sessions alongside N Minions,
  counted separately. If you meant one shared budget, only one line changes.
- **A Codex Gru** has no timer to watch a session, so its tickets all go local.
