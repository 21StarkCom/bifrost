---
name: stark-gha-cost
description: >-
  Diagnose and cut GitHub Actions and GHAS bills for an org or enterprise: find
  where the money goes (product, repo, workflow, run), apply the best levers by
  PR, and escalate wrong billing to Support. Use for a high GitHub bill, slow or
  costly CI, runner choice, caching, storage or GHAS seats.
disable-model-invocation: true
model: opus
---

## Help

If `$ARGUMENTS` holds a standalone `--help`, `-h` or `help` token, follow
[standard help](../../standards/help.md), then stop.

# stark-gha-cost — GHA + GHAS cost optimizer

Cut GitHub Actions + GHAS spend without breaking CI. The trap is optimizing the
wrong thing (self-hosting runners to fix a GHAS-license bill, or rewriting
workflows to fix a billing bug). So **measure first, then aim** — most of a bill
is usually one repo, one workflow, or one wrong seat.

## The mental model (read `references/levers.md` for the full version)

GitHub bills two meters: Actions minutes (compute), and GHAS seats per
committer (Secret Protection ~$19, Code Security ~$30). Dependabot and the
dependency graph are free.

Self-hosted runners cut only Actions minutes, never the seat bill.

## Workflow

### 0. Check repo visibility FIRST — public Actions are free

Public repos get free GitHub-hosted Actions minutes and storage, so check
visibility first: `gh api repos/OWNER/REPO --jq .visibility`. When a public
repo's bill still looks high, chase the resource (step 2).

### 1. Diagnose — find where the money actually goes

Never guess. Run the breakdown before proposing anything:

```bash
GH_TOKEN=<admin:enterprise or admin:org PAT> \
  scripts/gha-cost-breakdown.sh --enterprise <slug> [--month YYYY-MM]
# or --org <login> for one org inside an enterprise
```

Read the PAT into the env; never print it.

The script ranks one month's spend (default: the current UTC month) by product
→ SKU → repo, gross and net, and shows GHAS seat usage. Public repos bill gross
but net $0, so it lists them apart from the ranking. It splits each repo's
minutes by runner SKU, since macOS bills 10× Linux. One or two repos usually
dominate.

Rank by gross: net is gross minus the included minutes, a pool the enterprise
draws down through the month, so the same run nets $0 on the 2nd and full price
on the 28th.

Run a few months to see the trend.

Then drill the top repo:

```bash
GH_TOKEN=<pat> scripts/gha-repo-actions-drill.sh <owner/repo> [since=YYYY-MM-DD]
```

This classifies the driver: high run **volume**, matrix **fan-out** (jobs ≫ 1),
a few **long** runs, or **none of the above**. The script prints how to read it.

One workflow or matrix is usually 80–98% of the bill. Find it with per-job
timings from `gh run view <run-id>`, and spend the effort there.

When the driver is a test matrix, read `references/matrix-runners.md` first:
the cost is per-job setup (token mint, dependency download, cold compilation,
no cache sharing) × job count, not the test logic.

**Measure the right number** (`references/advanced-practices.md §1`):
- Billing rounds each job up to a whole minute, with OS multipliers (Linux 1×,
  Windows 2×, macOS 10×). Compare billed minutes ÷ runtime per workflow to find
  the rounding waste.
- For a team, wait time often costs more than runner minutes. Measure cost per
  merged PR, queue time included; Actions Insights and
  `self-actuated/actions-usage` show it.

### 2. Decide — Actions minutes, a downstream resource, or a billing anomaly?

The trigger/workflow is rarely the cost itself — **chase the resource the
workflow touches.**

- **Actions minutes** (private repo, volume / fan-out / long runs explain it) →
  step 3, apply the runner levers.
- **A downstream cloud resource.** A "deploy" or "build" workflow may bill almost
  nothing in Actions but push a Docker image to a **registry** (GCP Artifact
  Registry storage), stash a large **artifact**, or spin up **Cloud Run** — the
  real charge lands on the *cloud* bill, attributed to the project, not GitHub.
  Trace what the workflow does (build → push → deploy) and check the cloud
  billing for those resources. On GCP this is `gcp_artifact_registry`
  (`idle_repositories` / repo storage) + Cloud Run. Editing the workflow's
  triggers won't touch this; right-sizing/cleaning the resource will.
- **A billing anomaly** — runs are short, no matrix, `runs/{id}/timing` reports
  `billable ~0`, yet the bill shows huge minutes. Workflow edits **cannot** fix
  mis-billing. Draft a Support ticket from `references/support-ticket.md` and say
  plainly this is the lever that might claw money back. Still do step 3 for any
  legit portion, but don't oversell it as the fix.

### 3. Apply levers — highest value ÷ friction first

Full ranked list + exact Terraform/API/YAML in `references/levers.md`. The short
version, in order:

1. `default_workflow_permissions: read` (the real supply-chain lever).
2. `can_approve_pull_request_reviews: false` (free).
3. Disable CodeQL default setup if Code Security is off / unused; prune redundant
   languages.
4. Cut over-frequent crons (hourly → daily).
5. `concurrency: cancel-in-progress` on PR / `check_run` workflows (collapses the
   per-commit check storm).
6. Path-filter expensive-runner jobs (macOS) / heavy matrices into their own
   workflow — skipped and free when untouched. A detector job is worse: it still
   bills 1 rounded minute every run. A `.github/**` trigger-all that runs the
   whole test matrix on infra-only PRs is a classic quiet overspend.
7. **When the driver is a test matrix**, attack `job_count × per-job_overhead`:
   bucket/shard jobs down (drop isolation the code already enforces), share/warm
   the build cache, template-clone DBs instead of replaying migrations. See
   `references/matrix-runners.md`.
8. Self-hosted runners: marginal if you'd stand up new compute, but **the biggest
   lever if you already own a cluster** — ARC ephemeral runners on an existing
   GKE (esp. Autopilot) take GitHub-billed minutes to ~0. Never a runaway, never
   macOS (no GCP Macs), never public repos.

Right-size seats too: if `code_security` committers = 0, you don't need the $30
product — turn its new-repo default off at the **org** tier (the enterprise flag
is availability-only and won't toggle off).

### 4. Ship it — every change via branch + PR

These are workflow, config and Terraform edits: ship each one through the root
spine (`ghx pr-open`, review, `ghx pr-merge`). Test live where you can: a PR
that touches only workflow files must not trigger the macOS job, and a
Terraform apply must show 0 drift. Config actions that are not files (disabling
CodeQL default setup, backfilling secret scanning) are API calls: note them in
the PR body.

**Then keep it cut.** Re-check the `billed÷actual` ratio after the change to
confirm the drop landed. A GitHub budget (a %-alert or a hard stop) or the org
spending limit stops the next regression before the invoice. Its amount is the
operator's money: end on `Needs you (Yours: money): <recommended amount>`.
Governance (budgets, cost centers, org allowed-actions and SHA-pin policy) is in
`references/advanced-practices.md §2`.

## Level up — the "done right" playbook

For practices that cut cost and add speed, reliability and security, read
`references/advanced-practices.md` (it opens with a table of contents). Runner
selection is in `references/matrix-runners.md`.

## Guardrails

- A CI cost PR can trigger the matrix it trims. Land the trigger narrowing
  first, so that later cost PRs do not re-run the matrix.
- A warm local cache hides breaks that cold CI hits, such as a dependency that
  stopped resolving after a module move. Fix a CI correctness break before cost
  work, or one masks the other.
- A skipped workflow leaves its required check Pending, and nothing merges; a
  skipped job reports Success. Before you disable or path-filter a workflow,
  remove its check from `required_status_checks` in the same change, or make
  one aggregate check job (`needs:` all jobs, `if: always()`) the only required
  check (`references/advanced-practices.md §4`).
- **`default_workflow_permissions: read` can break writers.** Scan for workflows
  that push/release/comment via the implicit token and lack an explicit
  `permissions:` block *before* flipping — fix those first.
- **Never hardcode a token.** Read the PAT into the process; keep it out of chat,
  commits, and PR bodies.
- **Don't retro-enable paid scanning blindly.** Secret-scanning backfill consumes
  a committer seat and can dump an alert backlog — confirm the seat math first.
- **Concurrency keys and workflow inputs** go in the `group:` string or `env:`,
  never interpolated into a `run:` shell line (injection).

## Gotchas

The API has sharp edges (deprecated endpoints, GraphQL-only enterprise metadata,
422s on `advanced_security`, 30-item list defaults). They're catalogued at the
bottom of `references/levers.md` — check there before assuming an API call is
"just failing."
