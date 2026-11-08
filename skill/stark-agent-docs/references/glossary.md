# Agent-doc glossary

The defined terms of the [playbook](playbook.md). Each term has one meaning in
every agent file. The meaning uses the words of the root rules,
`~/Code/CLAUDE.md`, where they define the term. Where this file and the root
rules differ, the root rules win. A review flags a term used in a second
meaning as a vague RULE (YELLOW).

| Term | Meaning | Do not use it for |
|---|---|---|
| operator | The one person who gives the agents their requests. Scope, taste, money, people, and words sent in the operator's name belong to the operator. | A peer session, or a GitHub role such as the admin. Call this person "the operator", not "the user". |
| GO | The operator's approval of a step. The request is the GO: a task from the operator approves every step to its result. A launch of a worker is the GO for all of its work, the items on "These still need a GO" included, but not for a new service on the Mac. | The word "go" in a request, which means "finish with no more questions". |
| gate | Text in an agent file that gives a step or a choice to the operator, in any words. The agent takes that step itself, unless the step is a kept gate. | A check that can block a merge, such as a required CI check or a hook. Write "check". |
| kept gate | An item on the root list "These still need a GO", or a new service on the Mac. | A step that only a person's own hands can do, such as a sign-in or Touch ID. The playbook keeps that gate GREEN too, but it is not a kept gate. |
| spine | The path of every change: [ticket →] PR → review → fix or answer → squash-merge (`njord pr-merge`) → close the ticket, if there is one. A worker runs it as `standards/worker-spine.md` writes it. | A release chain, or the steps of one skill. |
| worker | Gru, a Minion or Agnes. | A subagent, a review run, or a session that the operator drives. |
| ticket bar | The test for a ticket: a change gets a ticket first when it adds or changes a feature, fixes a bug someone hit, spans more than one PR or session, is handed to another agent, or records a decision (an ADR or a spec). Other work ships as a PR alone. | A ticket's acceptance criteria. |
| live proof | A run of the real thing (the CLI, the service, the API call) against the real surface that the change touches, which did what the ticket says. The command and its output go on the PR. | A unit test that passes, or a dry run. |

## Kept gates

This copy of the root list changes with it. Where they differ, the root list
wins.

- A write you cannot undo. Scratch that the run made is not one.
- A `terraform apply` that you run by hand.
- Publishing by hand outside the repo's release chain.
- A message to a person or channel that the request does not name.
- A secret value: making, reading out, copying or writing a token or a key.
- A new service on the Mac: a launchd job, a daemon, a cron entry or a
  schedule. It needs the operator's own request. This root rule is its own
  bullet, not an item of "These still need a GO", so a worker launch does not
  cover it.
