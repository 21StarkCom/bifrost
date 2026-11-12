# The run's scope: joins and splits

Read from [the Gru skill](../SKILL.md#protocol).

## A ticket that joins the run

A ticket outside the run's set joins the run only when the run's
[settings](../SKILL.md#progress-pane) have it on, and both are on by default: a
follow-up a Minion files joins with `followUps`, and a ticket that blocks
one in scope (a `Blocked by` link, or a dependency the ticket names) joins
with `decideForMe`. Read them before each such change. Add a ticket that
joins to scope, rewrite the run's [progress file](../SKILL.md#progress-pane), and name
it in step 6's report; the ticket it blocks waits for it like any
dependency, and a rerun `start` finds it again in that ticket's links and
comments. A ticket that does not join stays on the board, and the ticket
that waits on it stays blocked.

## Split a ticket across repos

**A ticket whose PRs span two repos or more** (its Files, or the code its
scope names, land in each) is split before it launches, because one Minion
opens PRs in one repo: it works only in the worktree valkyrie cut for it
([the spine's §2](../../../standards/worker-spine.md#2-implement)) and reports
anything in another repo `blocked`
([§8](../../../standards/worker-spine.md#8-releases-and-other-repos)). A
release of the other repo, or a PR there that no live worker owns, is a
split too: its sub-ticket's Minion runs that release, or carries that PR
through review to merge. A PR there that a live worker owns is a
dependency: wait for it. The ticket keeps its own
repo's half; each other repo's half goes to a sub-ticket worked in that
repo by its own Minion. File the sub-ticket only when the run's
[settings](../SKILL.md#progress-pane) set `decideForMe` true. Otherwise stamp the
ticket `blocked`, do not launch it, and name the split in step 6's report.
Write the sub-ticket with `/stark-ticket` (`$stark-ticket` on Codex), file it with
`alfred task new --on-repo <other repo>`, and comment on the ticket with
`alfred task comment --body-file <file> STARK-n`, the file opening
`Gru: split — <the half that moved> moved to STARK-m`, since the ticket's
Minion reads its comments. A sub-ticket the operator already filed for
that half takes the same comment, naming theirs, and no second filing.
A half that needs the other merged first says so in
that comment, and waits for it like any dependency. That comment is the
split's record: a sub-ticket it names is in scope, in this run and every
rerun `start` (an epic's `list_children` and a `--tickets` list both miss
it), and a ticket that carries one is split already, so a rerun files and
raises nothing again.
