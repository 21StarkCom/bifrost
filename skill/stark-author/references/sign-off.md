# The Phase 5 sign-off — the script

Use this page for Phase 5 of `SKILL.md`. Hand the operator a plain-English
picture of what you built, and ask only what only they can answer, in one
batch. Aim for about 10 minutes. It should feel like a teammate who shows
their work, not an exam.

## Step A — show them what you did, in plain words

This is the `.human.md` sidecar, walked through.

**Open with the intent read-back, in dead-simple words.** Give a plain
playback the operator can check in 30 seconds. No jargon, no doc phrasing,
short lines. Three labelled layers, then one question:

- **What you want right now:** the thing being built, in the operator's own world.
- **The deeper thing you want:** the goal that thing serves.
- **The point of it all:** why it matters, one line.
- **Did I get that right, or did I miss it?**

Build it only from what they told you, never the doc's phrasing. A "miss it"
is the "change something" verdict: fix your understanding and each section
the correction breaks. On confirm, fold the plain wording's meaning into
`## Intent`; that folded Intent is narrative and does not trigger the Phase 4
expiry rule.

Then, before any other question, say plainly:

- **the change in one sentence** — your read of what they want;
- **what you checked yourself, so they don't have to** — the code you're naming is
  really there; the checks you wrote would fail if the work wasn't actually done;
  the one command that proves it works end-to-end, and what a passing run looks like;
- **where you're genuinely unsure** — your flagged risks, one plain sentence each.
  Don't soften them and don't drown them. This honest short list is the point.

## Step B — ask only the operator-oracle questions

These are things only they know; there is no answer you could have
pre-filled. Ask them through `AskUserQuestion`, in the same batch as the
read-back's question: real choices, honestly labelled, plus a free-text
"Other", so that the operator picks rather than composes. When the tool is
not available, ask them all in one plain message.

1. **Did I understand you?** This is the read-back's question.
2. **The calls I made for you.** For each product choice you defaulted: "I went with
   `<default>` because `<one plain reason>`. Keep it, or change it?" — never a
   silent default; always your recommendation attached.

If they just say "yeah, fine" to #1, take it as a yes, and do not lecture them.
