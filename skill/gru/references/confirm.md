# Confirm a done

Read from [the Gru skill](../SKILL.md#protocol).

A `done` report is a claim. Check the PR is merged
(`gh pr view <PR> --json state,mergeCommit,baseRefName`), that its
`mergeCommit` is the sha the Minion reported (when there is a report), that
`baseRefName` is the base the ticket lands on — the repo's default branch
unless the ticket names another, since a PR merged into some other branch
passes a check against its own base — and that the commit is on that base:
`gh api repos/<owner>/<repo>/compare/<sha>...<base> --jq .status` must
print `identical` or `ahead` — `diverged` or `behind` means it is not —
with `<owner>/<repo>` read the way [merge-order.md](merge-order.md)'s merge-queue
read gets them. A pr-merge exit 0 can come with no merge behind it, so the
sha in a report is a claim too. Then check alfred shows the
ticket `done` or `Closed` (in a repo whose `CLAUDE.md` defines done as
released, the Minion closes at the end of the release chain, so wait for
that, and read the version output
[the spine's §8](../../../standards/worker-spine.md#8-releases-and-other-repos)
step 6 has it comment on the ticket). The report
names the live verification the Minion ran and the PR carries that run's
command and output as a comment — read the comment (`gh pr view <PR>
--comments`; the `--json` form above does not return them),
not just the claim. When the PR had a `--fix` round, a second comment
carries the re-run on the final head and names what it covers
([the spine's §5](../../../standards/worker-spine.md#5-re-verify-after---fix-and-post-the-runs-on-the-pr));
the first run alone does not confirm it. A `done` that names no verification, or names one with
nothing on the PR behind it, is not confirmed. The one exception is
`verified none (<why>)`: a ticket with no live surface has no run to post, so
judge the stated reason and confirm on the merged PR alone. A sub-ticket
for a release alone, whose chain bumps nothing, has no PR of its own: its
report names the tag in place of the PR, so confirm the tag on the remote
(`git ls-remote --tags origin <tag>` in that repo), the version output §8
step 6 comments on the ticket, and the ticket status. If a check fails,
tell the Minion what is missing if it
is live; if it has ended, treat the report as a death — but only under step
4's rule: a still-open ticket is relaunched, a ticket already `done`/`Closed`
whose check fails is an operator escalation, never a relaunch into a closed
ticket. Either way, do not assume its worktree is gone. The reaper removes it
only *after* it has closed the tab, and a `partial` can leave it standing:
a dead Claude Minion's relaunch re-enters it, so check the path before you
relaunch. A dead Codex Minion stays step 4's blocker even once its worktree
is gone, because its branch `STARK-n` outlives it.
