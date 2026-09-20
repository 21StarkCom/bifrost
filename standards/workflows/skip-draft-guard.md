# Skip-draft guard — keep CI off WIP pull requests

**Policy:** PRs open as **drafts** by default (`idun gh pr-open` and the review /
author / build skills all do this). Work is verified locally while
the PR is a draft; when it's ready, it's marked ready-for-review — which is the
moment CI should run. A draft PR should **not** burn CI minutes or trigger any
`pull_request`-driven automation.

**The catch:** a draft PR still fires `pull_request` events (`opened`,
`synchronize`) by default. Opening drafts alone does **not** stop Actions — each
`pull_request`-triggered workflow must be guarded. This is a two-part change per
workflow.

## The pattern

1. **Add `ready_for_review` to the trigger types** so the workflow fires the
   moment a draft is un-drafted (that's when CI should finally run):

   ```yaml
   on:
     pull_request:
       types: [opened, synchronize, reopened, ready_for_review]
   ```

2. **Gate the job on the PR not being a draft:**

   ```yaml
   jobs:
     build:
       runs-on: ubuntu-latest
       if: github.event.pull_request.draft == false
       steps: ...
   ```

Net effect: while the PR is a draft, `opened`/`synchronize` events fire but the
job is skipped; when it's marked ready, `ready_for_review` fires and the job
runs on the current head. Marking ready is the single CI-triggering moment.

## `== false` vs `!= true` — pick by event set

- **`if: github.event.pull_request.draft == false`** — use when **every** trigger
  is a `pull_request` / `pull_request_review` event. Those payloads always carry
  `pull_request.draft`, so the comparison is well-defined.
- **`if: github.event.pull_request.draft != true`** — use when the workflow also
  triggers on events **without** a `pull_request` object (e.g. `check_run`,
  `workflow_run`, `schedule`, `push`). There `draft` is `undefined`, and
  `undefined == false` is **false** — a `== false` guard would wrongly skip those
  runs. `!= true` runs unless the PR is *explicitly* a draft, so non-PR events
  keep working and only explicit-draft `pull_request` events are skipped.

## What is NOT guarded

- **`push`-triggered workflows** (deploy-on-merge, tag-and-release, a downstream
  sync job) — a merge to the default branch is never "draft", so leave them
  alone. A workflow that itself *opens* a downstream PR still follows the review
  gate.
  - **Anything that MERGES a PR reads that PR's checks, so the checks it reads
    must not be draft-guarded.** `idun gh pr-merge` rebases, force-pushes, marks
    the draft ready, then waits on the head's checks before it squashes. Guard
    the workflow behind those checks and every one of them reports `skipped` on
    the draft: the watch exits 0 and it merges a suite that never ran. That is
    the unrepairable false green described below.
  - Use `gh pr checks --required --watch --fail-fast`, never the same command
    without `--required`. Two reasons, and both bite. Without it the watch
    includes every optional check on the head — so an advisory job's failure
    blocks a merge the branch ruleset would allow; and if the watcher is itself
    running inside a workflow whose check run attaches to that same head, it
    waits on itself and never converges.
- **Merge gates that read PR status** — a draft never reaches "Ready to Merge",
  so a status-driven gate is already a no-op on drafts; the guard is just
  belt-and-suspenders (and, for `check_run`-triggered gates, must use `!= true`).
- **Any workflow whose check is a REQUIRED status check.** See below — this one
  is not a preference, it is a correctness rule.

## Never guard a required check

**A guarded job reports `skipped`, and GitHub counts `skipped` as satisfying a
required status check.** In the merge box it is indistinguishable from a pass.
So the guard converts "CI did not run" into "CI is green", which is the exact
failure the required check exists to prevent.

It is not theoretical. `21StarkCom/stark-skills#877` merged on 2026-08-11 with
the only `pull_request` run on its head commit being the draft-time one:
`test: SKIPPED`. The suite never executed against what landed on `main`.

**There is also no repair path once it happens:**

- **Re-running the workflow replays the original event payload** — a run that
  skipped because `draft` was true skips again, forever.
- **A `workflow_dispatch` run does not join the pull request's status rollup.**
  Measured on the same commit: the dispatch produced `test: SUCCESS` in
  `gh run list`, while the GraphQL `statusCheckRollup` — which is what every
  merge gate reads — still carried only the SKIPPED entry. A manual re-fire
  *looks* like it fixed the problem and changes nothing that matters.

Only a new commit clears it.

**The rule:** if a check is required (or you intend to require it), the job runs
unconditionally and the workflow is kept cheap enough that running it on every
draft push is fine. Cost the guard would have saved is measured in
runner-minutes; cost of a skipped required check is a merge with no verification
at all.

### Two things that follow from removing the guard

- **Set `cancel-in-progress: false`.** Unguarded jobs take minutes instead of
  seconds, and `idun gh pr-merge` force-pushes then marks the PR ready moments later —
  two events for the same commit. Cancelling means the second run kills the
  first and leaves `test: CANCELLED` on the head sha. GitHub counts CANCELLED as
  a *failing* required check, so it can block the merge, and if the replacement
  never materializes it is the only row: a required check reporting failure for
  a commit whose suite passed. A workflow backing a required check should not
  manufacture rows for runs it means to discard.
- **Never require a check whose step carries `continue-on-error: true`.** It
  reports SUCCESS whether the step passed or not, so requiring it satisfies the
  gate unconditionally — the same false-green shape, wearing a different hat.
  Drop the flag first, then require the check. The `typecheck` job that is now a
  required context in `.github/workflows/ci.yml` sat in exactly that trap while
  it lived in stark-skills' `tests.yml`: left out of the ruleset because it was
  advisory, and advisory because of this flag (STARK-5008). Both were fixed
  together, and the ban is now a comment on the step itself.
- **List EVERY job of a workflow whose checks are required, or decide out loud
  that one is not.** Sibling jobs share triggers and look interchangeable, so a
  new one silently reports a check nobody gates on. `typecheck` sat unrequired
  next to `test` for five weeks that way. The defence is a test that reads the
  real workflow file and fails when the job set moves; **this repo has none
  today** — the job-set pin (`tools/typecheck_gate.test.ts`) was not carried over
  when the suite moved — so a fifth job added to `ci.yml` reports a check nobody
  gates on and nothing goes red. Until one exists, adding or renaming a job means
  editing the branch ruleset in the same change
  (`docs/operations/branch-protection.md` §1, §3).
- **`if:` is not the only way to lose a run.** A *step*-level `if:` leaves the
  job concluding SUCCESS with nothing executed; a job-level `name:` renames the
  check-run so the required context never reports; a narrowed `types:` or a
  `paths:` filter means no run exists for the head sha at all. Ban all four
  alongside the guard, not just the job-level conditional.

`.github/workflows/ci.yml` in this repo is the reference: no draft guard, no
`paths:` filter, `cancel-in-progress: false` on a per-PR concurrency group, no
`continue-on-error` anywhere, and all four jobs required by the branch ruleset.
Two details it gets right that a "no `if:`, no `name:`" summary would get wrong.
`test` and `typecheck` carry no job-level `name:` **because the bare job id is
then the context string** — the point is not that a `name:` is forbidden, it is
that the name IS the required context, so `secrets` carries `name: secret scan
(tree)` and the ruleset names that. And the `secrets` job does carry one
step-level `if:`, on its PR-range scan, which is correct precisely because the
unconditional fail-closed scan above it is what the context proves: a step-level
`if:` is fatal when it skips the *only* substantive step, leaving the job green
having executed nothing.

## Reference implementations in this repo

- `standards/workflows/doc-staleness.yml` — `== false`, the adoptable template:
  `types: [opened, synchronize, ready_for_review]` plus a job-level
  `if: github.event.pull_request.draft == false`.
- `.github/workflows/ci.yml` — **deliberately unguarded**, per "Never guard a
  required check" above. All four of its checks are required.
- `.github/workflows/secret-scan.yml` — also unguarded, and it must stay that way
  even though its check is not required here: the same bytes are the fleet's
  secret-scan caller in every other rolled-out repo, and they are a Terraform
  render this repo may not edit.

## Downstream, per target repo

The skills open drafts in whatever repo you run them against, but each **target
repo owns its own workflows** — apply this guard to every `pull_request`-triggered
workflow there for the "no CI on WIP" guarantee to actually hold. Without the
guard, the target repo's CI still runs on the draft; the draft only suppresses
*your* intent, not GitHub's default event delivery.
