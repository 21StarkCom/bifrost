# Agent-doc review, in plain English

Your agent files grew into 8.2M characters. About a fifth of that text is old
stories. About 45 lines contradict each other. Memory notes act as hard rules.
Nothing checks any of it, so the model gets mixed orders and acts on them
differently each time.

This spec reviews those files the way a legal team reviews a contract:

- **A playbook** says what a good clause looks like: a rule, a trap or a
  pointer. It also says what is never allowed: a contradiction of the root
  rules, an extra gate, work beyond the request, text that tells agents to grow
  the file, and old stories.
- **A fast triage** with no model runs before each merge. A RED clause stops the
  merge.
- **A full review** reads a file clause by clause. It marks each clause GREEN,
  YELLOW or RED, and writes the exact new text. It can open the PR itself.
- **A weekly run** on the devbox: each Monday, an odin agent reviews what changed
  in the fleet, files a ticket for each real new RED, and posts a summary to
  Slack. Your memory notes and settings get a check on the Mac when you ask.

It reuses two tools that exist today: `rules_audit.ts` and
`/stark-rules-optimizer`. The cleanup of today's files runs now as its own epic,
with the first version of the same standard.
