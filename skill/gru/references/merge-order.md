# Merge order in one repo

Read from [the Gru skill](../SKILL.md#authority).

How many Minions merge at once depends on one thing per repo: whether its base
branch has a GitHub merge queue. Read it once per repo, when you launch that
repo's first Minion (step 3). A Minion merges on its own and says nothing
before it does, so a hold sent any later can arrive after its merge ran:

```
gh api graphql -f query='query { repository(owner: "<owner>", name: "<repo>") { mergeQueue { id } } }'
```

`<owner>` and `<repo>` are GitHub's, from the `remote` of the urd record
step 3 reads (`git -C <path> remote get-url origin` after a `--cwd`
launch), never the registry name alone: a wrong owner reads as a failed
read. With no `branch:` argument `mergeQueue` reads the default branch; add
`(branch: "<base>")` only for a ticket whose PR targets another base. Keep
the spaces: on Claude, a worktree session's guard refuses the compact
`'{repository(owner:"…",name:"…")…}'` form and passes this one.

- **A queue** (`mergeQueue` non-null): no sequencing. Every Minion runs
  `njord pr-merge` the moment its review gate is green, all at once. The
  queue tests each merge against the base itself, pr-merge never rebases
  there, and it waits for the PR to be MERGED before it stamps the ticket
  (`njord help pr-merge`, "Merge queue").
  A Minion the queue drops gets exit 38 and clears it by
  [the spine's merge-contention rule](../../../standards/worker-spine.md#4-the-spine).
- **No queue** (`mergeQueue` null), or a read that failed (nonzero exit,
  `repository` null): one Minion per repo merges at a time, by the hold the
  skill's [Authority](../SKILL.md#authority) names. A previous
  Minion that reports `blocked` instead keeps the hold until its block
  clears (step 2); when you escalate that block, name the Minions it
  holds. That holds on every such repo, whatever its branch protection
  says. pr-merge is strict on its own: it rebases, waits for green, and exits
  27 BASE_MOVED when the base moved meanwhile, so two concurrent runs keep
  rebasing each other whether or not the ruleset requires up-to-date
  branches.

Tickets whose code is disjoint are not disjoint at merge. A CHANGELOG, a
version file, a docs index, the README and the agent instructions file ride
in nearly every PR, so two Minions in one repo meet there however far apart
their code is. Never lift the hold on a no-queue repo because the tickets
look independent; a held Minion's rerun rebases through that seam by
[the spine's merge-contention rule](../../../standards/worker-spine.md#4-the-spine).
On a queue repo the seam is a refusal instead: a root `CHANGELOG.md` on the
base makes every `njord pr-merge` there exit 21, which the spine reports
blocked. Check for one when you read the queue, and raise it with the
operator then, not after the Minions' blocked reports.
