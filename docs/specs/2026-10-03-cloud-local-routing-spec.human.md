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
- No `cloud` tag. Old tickets have no verdict and stay local.
- No Minion picks up a half-done cloud PR; a redo starts fresh.
- Kevin gains one thing only: `merge … for STARK-n`. Only Gru routes.
- Gru never chats with or archives a cloud session, and never merges.

## What I checked myself
- About 62 claims about the code, re-checked against the source by a
  separate reviewer. Every task's check fails on today's code (I ran
  bifrost's), so none can pass without the work.
- The proof it works: a small bifrost ticket goes from stark-ticket through
  the cloud, Kevin's merge (his comment shows the re-run) and Gru's close,
  with no step from you.

## Where I'm genuinely unsure
- The cloud session is only told not to merge or push after its PR. If it
  does either anyway, Gru sees it and nothing is lost.
- The session API's status words are unverified; the idun ticket pins them.
- Only cloud-agent-1 is confirmed able to open PRs (others: STARK-9577).
- Cloud PRs queue behind Kevin's other work, releases included.
- Whether Kevin's merge accepts a PR opened by a cloud seat's account; the
  live test shows it.

## Calls I made for you
- **"Same as --max-workers"** read as N cloud sessions alongside N Minions,
  counted separately. If you meant one shared budget, only one line changes.
