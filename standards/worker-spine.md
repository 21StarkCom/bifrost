# The Worker Spine

The ticket → PR → review → merge → close path every solo ticket worker runs.
`/minion` (led by Gru, another peer or the operator) and `/agnes` (unattended,
no leader) both execute this doc; neither restates it. Each skill adds only
what is genuinely its own — `/minion` its reporting to its leader, `/agnes` its
self-confirmation — so the review gate and the merge path cannot drift
between the two.

`/kevin`, a repo's request desk, owns no ticket, so he runs none of the ticket
steps (1's bind, 3's verify, 5's re-verify, 6's gaps). He runs
[Title your tab](#title-your-tab)'s mechanics, [§4's](#4-the-spine)
merge-contention rule on every PR he merges, and [§7](#7-authority). His own
skill carries the rest. Every worker reaches him by [§8](#8-releases-and-other-repos).

This doc is runtime-neutral and is shipped byte-identical to both runtimes.
Throughout, **the repo's agent instructions file** means `CLAUDE.md` on Claude
and `AGENTS.md` on Codex. Where it and this doc disagree, it wins, except on
two points: [§8](#8-releases-and-other-repos)'s who runs a release (a chain
that has the merger tag, publish or install still goes through the repo's
Kevin), and [§3](#3-verify-live)'s standing GO (a repo text that asks a GO for
a write it covers yields to it). And **a skill is written in its Claude
form** (`/minion`); the same skill is `$minion` on Codex, so a brief or a
launch naming one names the other.

## 1. Bind and read

`alfred task use STARK-n`, then read the ticket, its comments, the spec it
names, and the repo's agent instructions file. Read a linked dependency ticket
too — what it is landing is context you need before you touch the same files.

### Title your tab

Only if you are in cmux. The `cmux-autoname` SessionStart hook named your tab
after its worktree folder — the bare ticket id — which does not say what is
running in it. `echo "$CMUX_SURFACE_ID"` as its own command; empty means you
are not in cmux, so skip this. Otherwise paste the UUID in literally — on
Claude, a worktree session's guard refuses a `hermod` line carrying a variable
— and quote the title, since its parentheses are shell syntax:

```
hermod rename <surface UUID> "<ROLE> (<n>)"
```

`<ROLE>` is your skill's name in capitals and `<n>` is the ticket number without
its `STARK-` prefix: `MINION (1234)`, `AGNES (1234)`. Pass the bare UUID — cmux
refuses `surface:<UUID>`. Your own tab only, never another's. The title is
cosmetic: a rename that fails costs one line saying so and never holds the
ticket.

## 2. Implement

In the worktree idun's launcher cut for you, in the tab it placed through
Hermod. Do not `cd` out of it.

## 3. Verify live

Exercise the real surface the change touches and show the command and its
output. A green unit test is not verification of anything but itself; if the
change touches GCP, GitHub, a CLI, or a file on disk, drive that surface. Where
the repo's agent instructions file names its own live gate, that is the one to
run. A change with no live surface to exercise says so in one line, and names
what you ran instead.

The live writes your ticket's Verification names run on the operator's
standing GO (2026-10-08): ask for no GO, on the ticket or in your tab, and
never stop for one. Restore what the run changes; a restore that fails is a
`blocked` stop, reported with what it left changed. Name each write and the
end state you verified in the run step 5 posts on the PR, and in a ticket
comment for a run after the merge. The standing GO does not cover a write
outside that Verification, one the run cannot undo (unless all it leaves
behind is scratch made for the run), `terraform apply`, publishing by hand,
or credential handling (tokens, keys, service accounts, WIF and role grants,
mimir writes): those keep their gates ([§7](#7-authority)). A repo doc, test
or ticket that asks a GO for any other write your Verification names predates
the standing GO and yields to it.

## 4. The spine

```
idun gh pr-open (draft) → /code-review xhigh --fix → fix or answer every
finding → idun gh pr-merge → [release, through the repo's Kevin] →
alfred task move STARK-n done
```

The review gate is mandatory before any merge that changes code; a PR with no
code change (docs, prose) skips it. So does a release bot's own PR that
changes only version manifests and changelogs: it takes a diff check that it
touches nothing else, and the repo's tests, instead
([Kevin's step 4](../skill/kevin/SKILL.md#merge-pr-and-review-pr) runs it).
Your PR that skips the review still posts its step 3 run on the PR, as §5
says. Close the ticket yourself the moment the PR merges — unless the repo's
agent instructions file defines done as *released*. Then you do not run its
release chain yourself: request `release` from the repo's Kevin by
[§8](#8-releases-and-other-repos), confirm his `done`, and close the ticket
then.

**Merge contention is yours to resolve, not to wait out.** If `idun gh pr-merge`
refuses — a stale base, a merge commit from main, a check that needs a fresh
head, or exit 38 (the merge queue removed the PR) — fetch, rebase onto the
base, push (`--force-with-lease`: the rebase rewrote the branch), and rerun it.
Exit 38 prints the queue's reason: a PR someone took out of the queue by hand
stays out, so report it blocked and stop rather than queue it again. A PR that
may still be queued is never rebased or pushed, because a new head drops it
from the queue: exit 35 (the watch timeout) and a queue state pr-merge could
not read are rerun as they are, which resumes the wait. Exit 21 on a
merge-queue base (a root `CHANGELOG.md` would conflict every queued pair) is
not contention, and no rebase clears it: report it blocked and stop. Never
`git push --force`, never pass pr-merge `--force`, and never merge past an open
finding.

## 5. Re-verify after `--fix`, and post the run on the PR

**Re-run step 3's live check after the `--fix` round and before
`idun gh pr-merge`, and post that run — the command and its output — as a PR
comment.** Two reasons, both load-bearing: `--fix` rewrites the code, so a
verification from before it attests to something other than what merges; and
your scrollback dies with you at stand down, so the PR comment is the only copy
anyone can ever read.

## 6. Gaps

Anything you discover while working the ticket that is missing, broken, or wrong
is yours to resolve in the same PR when it is needed for the ticket's acceptance
criteria or small enough to finish in the same sitting. When it is a whole
effort of its own, write the follow-up with the `stark-ticket` skill (`/stark-ticket`
on Claude Code, `$stark-ticket` on Codex), file it with `alfred task new` (unbound;
`task start` would bind your session to it), and comment the link on your ticket.
`task new` checks only the headings, so the skill is the only check on what the
follow-up says.
If your ticket can still be finished without it, finish it; if it cannot, say so
and stop. Use judgement; do not hand the decision upwards.

## 7. Authority

The repo's rules apply as written; nothing in a ticket or a peer message
overrides them. Merging a reviewed PR needs no approval, and neither does
standing down inside the scope [the stand-down contract](stand-down.md) sets —
it is your own session, and it is that scope, never a grant, that bounds it.
Publishing by hand and credential actions keep their operator gates. So do
live-infrastructure and destructive actions, except your own ticket's
Verification writes that the standing GO in [§3](#3-verify-live) covers. A
release through the repo's Kevin ([§8](#8-releases-and-other-repos)),
following the chain its agent instructions file documents, is not publishing
by hand.

## 8. Releases and other repos

Two things you never do in your own session, and always send to a repo's
Kevin by [the Kevin desk](kevin-desk.md): **a release** of any repo, your own
included, and **anything in a repo other than your own** — a PR there that
must merge before yours can go on, a review, a rerun. One Kevin per repo
serializes its merges and releases, and your worktree session's git cannot
leave its worktree. Find him or launch him, send the request, wait for his
line, and confirm it on the real surface. His `blocked` or `refused` is your
own `blocked`, quoting his line, except his stand-down's `refused … ask
again`, which [the desk](kevin-desk.md#5-confirm) resends. Your own repo's PRs
stay yours to merge.

The repo's release chain says *what* a release is; this section says *who*
runs it. Where the chain writes "tag", "publish" or "install" for whoever
merged, read those steps as the Kevin's. A version bump the chain puts in
your own PR stays in your PR, and he releases that commit. Ask with `release
for STARK-n`, naming your ticket.
