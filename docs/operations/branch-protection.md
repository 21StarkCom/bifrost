# stark-marketplace — branch protection + required checks on `main`

**What this file is:** the contract for what `main` gates on, and the exact
admin commands that put it there. Read [`SECURITY.md`](../SECURITY.md) §5 for
*why* — this file is the operational half.

> **Every command in the "APPLY" sections MUTATES repo settings.** They change
> who can merge what, permanently, for every future PR including the automated
> `marketplace-sync` ones. They are an **operator gate**: run them by hand as a
> repo admin. **Do not run them from an agent, a skill, a hook, or CI.**

---

## 1. The contract — five required contexts

`.github/workflows/ci.yml` defines exactly five jobs, and every PR to `main` gets
all five. These are the required contexts, spelled exactly as GitHub reports them
in the PR status rollup:

| Required context                   | ci.yml job | Gates |
| ---------------------------------- | ---------- | ----- |
| `engine (validate + drift + tests)` | `engine`     | gofmt · `go vet` · `go test` · `stark validate` · **`stark build --check` (drift)** · `check-bumps` · `lint --strict` · `allowlist --check` |
| `secret scan (catalog)`             | `secrets`    | gitleaks over the working tree **and** the PR commit range |
| `web build`                         | `web`        | `tsc --noEmit` · eslint · vitest · `vite build` |
| `server (static origin)`            | `server`     | gofmt · `go vet` · `go test` |
| `actionlint`                        | `actionlint` | workflow lint |

**The context string is the job's `name:`, not its YAML key.** Renaming a job's
`name:` silently orphans the required context: the old name never reports again,
so the merge box waits forever on a check that no longer exists. If you rename a
job, update the ruleset in the same change.

**Why `engine (validate + drift + tests)` is the one that matters most.** It runs
the `stark build --check` drift gate — the only thing between a bad `stark sync`
and a marketplace whose committed `dist/` no longer matches its catalog. On push
to `main`, `sign-manifest.yml` then signs and publishes whatever landed. An
unrequired drift gate means a PR that broke it could merge and get signed.

Source of truth for the exact strings — read them off a real green PR, never off
the workflow file:

```bash
gh pr checks <PR#> --repo 21StarkCom/bifrost --json name,state
```

### The sixth check that reports and is NOT required

`.github/workflows/secret-scan.yml` is the second `pull_request` workflow in this
repo (it also fires on push to `main`). It produces **`secret-scan / secret-scan`**,
and that context is **deliberately absent from the table above**.

It is the fleet's uniform secret scan — a thin caller, pinned by SHA, for the one
reusable workflow in `21StarkCom/.github`. Terraform in `21StarkCom/21stark`
(`repos/secret_scan.tf`) writes that caller into 63 repos and puts a
`require-secret-scan` ruleset on each; **bifrost is in `local.secret_scan_excluded`**
because `main` here carries `enforce_admins = true` plus required PR reviews, so the
provider's direct commit is rejected even for an admin token (STARK-7490). The file
arrived by PR instead, byte-identical to the render.

**Do not add `secret-scan / secret-scan` to the ruleset in §3.** Two reasons:

1. **It would be an unowned rule.** Every other repo's requirement is Terraform
   state in 21stark. A hand-made one here is invisible to that tier's audit
   (`repos/README.md`, "Require the `secret-scan / secret-scan` check"), and the
   next fleet pin bump — which **renames the right half of the context** if the
   reusable workflow's job name ever changes — would silently orphan it, blocking
   every merge here on "Expected — waiting for status".
2. **It buys nothing this repo does not already have.** `secret scan (catalog)`
   is required, blocking, and *stricter*: it scans the whole working tree **and**
   the PR commit range, against the fleet caller's incoming commits only. The
   fleet check is the fleet's uniform reporting surface, not bifrost's gate.

What the caller is for, then: it makes bifrost visible in the fleet-wide sweep
(`gh api repos/21StarkCom/<repo>/commits/main/check-runs`) instead of being the one
repo that answers nothing, and it is the pre-existing green run that enrolment would
need if STARK-7599 ever gives the tier a PR-shaped write path.

## 2. Enforcement lives in a RULESET, not classic branch protection

Checking `branches/main/protection` **alone is misleading** — it can return a
populated object while required status checks are configured (or absent)
somewhere else entirely. Always check both surfaces:

```bash
# Classic branch protection (linear history, force-push, deletions, reviews)
gh api repos/21StarkCom/bifrost/branches/main/protection

# Repository rulesets (where the required status checks live)
gh api repos/21StarkCom/bifrost/rulesets
gh api repos/21StarkCom/bifrost/rulesets/<id>
```

The two surfaces are **additive**: a ruleset does not replace classic protection,
and the most restrictive rule across both wins. Bypass actors configured on a
ruleset do **not** grant a bypass of classic protection.

`21StarkCom/stark-skills` uses the same shape — an active ruleset named
`Required CI on main` targeting `~DEFAULT_BRANCH`. Keep the two repos aligned.

## 3. APPLY — the `Required CI on main` ruleset (operator, once)

`integration_id: 15368` is the GitHub Actions app. Pinning it means a check of
the same name reported by a *different* app cannot satisfy the requirement.
Confirm it for this repo before running:

```bash
SHA=$(gh api repos/21StarkCom/bifrost/pulls/<PR#> --jq .head.sha)
gh api "repos/21StarkCom/bifrost/commits/$SHA/check-runs?per_page=100" \
  --jq '.check_runs[] | {name: .name, app_id: .app.id, app_slug: .app.slug}'
```

Then create the ruleset:

```bash
gh api -X POST repos/21StarkCom/bifrost/rulesets \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "name": "Required CI on main",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] }
  },
  "rules": [
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "engine (validate + drift + tests)", "integration_id": 15368 },
          { "context": "secret scan (catalog)",             "integration_id": 15368 },
          { "context": "web build",                          "integration_id": 15368 },
          { "context": "server (static origin)",             "integration_id": 15368 },
          { "context": "actionlint",                         "integration_id": 15368 }
        ]
      }
    }
  ],
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ]
}
JSON
```

Verify it took:

```bash
gh api repos/21StarkCom/bifrost/rulesets
gh api repos/21StarkCom/bifrost/rulesets/<id> \
  --jq '{name, enforcement, refs: .conditions.ref_name.include,
         contexts: [.rules[] | select(.type=="required_status_checks")
                    | .parameters.required_status_checks[].context]}'
```

### The two parameters worth understanding before you run it

- **`strict_required_status_checks_policy: false`** — does not force a PR branch
  to be up to date with `main` before merging. Set it to `true` and every merge
  to `main` invalidates every other open PR's green run, which for the automated
  `marketplace-sync` PRs means a rebase-and-rerun loop. `idun gh pr-merge`
  rebases onto the base before it merges anyway, so `false` costs little.
- **`bypass_actors` = repository admin (`actor_id: 5`)** — mirrors stark-skills
  and keeps an unblock path when CI itself is what is broken (a workflow rename,
  a GitHub Actions outage). It is a real weakening: the operator *can* merge red.
  Drop the whole `bypass_actors` array for a hard gate; the cost is that fixing a
  broken workflow then requires flipping `"enforcement"` to `"evaluate"` or
  `"disabled"` first. Either way `idun gh pr-merge` still refuses a red or
  skipped required check, so the practical gate holds.

## 4. NEVER add a draft skip guard to a required workflow

Do **not** add `if: github.event.pull_request.draft == false` to any job whose
check is required. A guarded job reports `skipped`; **GitHub counts `skipped` as
SATISFYING a required check**, and the merge box renders it identically to a
pass. That turns "CI did not run" into "CI is green" over a suite that never ran
against what landed.

There is no repair once it happens on a given sha: re-running replays the
original payload so it skips again, and a `workflow_dispatch` run **does not join
the PR's status rollup**. Only a new commit clears it.

Neither `ci.yml` nor `secret-scan.yml` carries a draft guard today, and `ci.yml`'s
`pull_request` trigger uses the default event types (`opened`, `synchronize`, `reopened`) — so CI runs on draft
PRs, and `gh pr ready` does not fire a fresh run that `cancel-in-progress: true`
could cancel out from under the head sha. Keep it that way.

The same reasoning bars a `paths:` filter on `ci.yml`: a filtered-out workflow
never reports at all, and a required context that never reports blocks the merge
box forever. `secret-scan.yml` has neither guard nor filter and must keep it that
way even though its check is unrequired here — the same bytes are a required check
on 63 other repos, and `engine/cmd/stark/secret_scan_caller_test.go` fails if this
copy drifts.

`idun gh pr-merge --allow-skipped-checks` opts back in, and should not be needed
here.

## 5. Verifying the gate actually gates

The vacuous-pass failure mode is that everything *looks* green because nothing
was ever required. Three checks, in order:

```bash
# 1. The ruleset exists, is active, and names all five contexts.
gh api repos/21StarkCom/bifrost/rulesets

# 2. GitHub marks them required ON A PR — this is the ruleset-aware view, and
#    the same field `idun gh pr-merge` reads.
gh api graphql -f query='
  query($pr: Int!) {
    repository(owner: "21StarkCom", name: "bifrost") {
      pullRequest(number: $pr) {
        statusCheckRollup: commits(last: 1) { nodes { commit { statusCheckRollup {
          contexts(first: 20) { nodes {
            ... on CheckRun { name isRequired(pullRequestNumber: $pr) }
          } }
        } } } }
      }
    }
  }' -F pr=<PR#>

# 3. `idun gh pr-merge` completes WITHOUT --allow-no-required-checks.
```

If step 3 still demands `--allow-no-required-checks`, the contexts in the ruleset
do not match the strings GitHub is reporting — re-read them per §1 and fix the
ruleset; do not pass the override.
