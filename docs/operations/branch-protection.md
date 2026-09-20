# bifrost — branch protection, required checks, and review policy on `main`

**What this file is:** the repo's **single governance document**. It carries the
contract for what `main` gates on, the measured state of *both* protection
surfaces, the operator-only commands that change them, and the review and
vulnerability-reporting policy. `docs/SECURITY.md` no longer exists — its
surviving content is §6 here, and `CLAUDE.md` / `AGENTS.md` point at this file.

> **Every command under an "APPLY" heading MUTATES repo settings.** They change
> who can merge what, permanently, for every future PR. They are an **operator
> gate**: run them by hand as a repo admin. **Do not run them from an agent, a
> skill, a hook, or CI.**

Every measured value below was re-read live on **2026-09-20** with the commands
in §2. Settings are changed through an API, not through this file, and **nothing
in this repo detects a change to them** — re-measure before trusting any number
here, and fix the file when it is wrong.

---

## 1. The contract — four required contexts

`.github/workflows/ci.yml` defines exactly four jobs, and every PR to `main` gets
all four. These are the required contexts, spelled exactly as GitHub reports them
in the PR status rollup:

| Required context    | ci.yml job  | What a pass proves |
| ------------------- | ----------- | ------------------ |
| `test`              | `test`      | `npm test` in `tools/` — `./check-rest-only.sh`, then `node --test *.test.ts`. With the Go engine deleted this is the repo's whole functional suite, over the tools every skill body shells out to. |
| `typecheck`         | `typecheck` | `npm run typecheck` in `tools/` — a real `tsc` pass. **`node --test` does not typecheck**: it runs `.ts` through Node's type stripping, which *erases* annotations rather than checking them, so a wrong generic or an unsound cast passes every test in `test`. The two jobs do not overlap. |
| `secret scan (tree)`| `secrets`   | A pinned gitleaks CLI over the **whole working tree**, fail-closed, plus a second pass over the PR's commit range (`base..head`) that catches a secret added and then removed inside the PR. |
| `actionlint`        | `actionlint`| Workflow lint over `.github/workflows/`. |

**A context string is the job's `name:` when it has one, and its job id
otherwise.** That is exactly why `test` and `typecheck` carry **no** `name:` in
`ci.yml`: the bare job ids are the context strings, and they are the same strings
stark-skills' ruleset required before those two jobs moved here. `secrets` does
carry a `name:`, so its context is `secret scan (tree)` and not `secrets`.

Adding a `name:` to `test` or `typecheck`, or editing `secrets`' `name:`, renames
the context. The old string then never reports again and the merge box waits
forever on "Expected — waiting for status", which only the admin bypass (§3) or a
matching ruleset edit clears. **Rename a job and update the ruleset in the same
change.**

Read the exact strings off a real PR head, never off the workflow file — the
`app_id` in the same output is what §3's `integration_id` pins:

```bash
SHA=$(gh api repos/21StarkCom/bifrost/pulls/<PR#> --jq .head.sha)
gh api "repos/21StarkCom/bifrost/commits/$SHA/check-runs?per_page=100" \
  --jq '.check_runs[] | {name, app_id: .app.id, app_slug: .app.slug, conclusion}'
```

**Why `test` is now the one that matters most.** The gates it replaced —
`stark build --check` drift, `check-bumps`, `lint --strict`, `allowlist --check`
— went with `engine/`, and there is no generated `dist/` left to drift: the seven
plugins in `.claude-plugin/marketplace.json` are served straight from `skill/` at
the repo root. So this suite plus human review is the entire thing standing
between a broken tool and `main`.

**Signing is gone too, and nothing reports its absence.** `sign-manifest.yml` was
deleted with the marketplace machinery, so pushes to `main` no longer produce a
signed build manifest, a `v<VERSION>` tag, or a GitHub Release. Integrity here
now rests on protected linear history plus the commit SHA a consumer resolves —
there is no signature left to verify, and existing tags keep working, so a
consumer pinned to one never learns the chain stopped. Recorded in `CHANGELOG.md`
and here because no gate will ever say it.

**No workflow in this repo holds a write permission.** `ci.yml` and
`secret-scan.yml` both declare `permissions: contents: read`, and they are the
only two workflows. Nothing in CI can push to `main`, open a PR, or merge one;
every merge is an operator merge under a user token. That also closes the old
`GITHUB_TOKEN` anti-loop gap — a push made with `GITHUB_TOKEN` starts no workflow
run, which used to leave the auto-published sync merge unscanned on `main`. The
workflow that did that (`publish-sync-pr.yml`) is deleted, so every push to
`main` now fires both `ci` and `secret-scan`. **STARK-7717** is still open and
describes machinery that no longer exists here; close it against this file rather
than implementing it.

### The fourth check that reports and is not required

`.github/workflows/secret-scan.yml` is the second `pull_request` workflow in this
repo (it also fires on push to `main` and on `merge_group`). It produces
**`secret-scan / secret-scan`**, and that context is **absent from the table
above**.

It is the fleet's uniform secret scan — a thin caller, pinned by SHA, for the one
reusable workflow in `21StarkCom/.github`. Terraform in `21StarkCom/21stark`
(`repos/secret_scan.tf`) writes that caller into the rolled-out repos;
**bifrost is in `local.secret_scan_excluded`** because `main` here carries
`enforce_admins = true` plus a required pull request, so the provider's direct
commit is rejected even for an admin token (STARK-7490). The file arrived by PR
instead, **byte-identical to the render**, and must stay that way: 21stark's
`check "bifrost_runs_the_current_secret_scan_caller"` byte-compares it over the
API on every plan and only *warns*, which is the only signal anyone gets that a
fleet pin bump has not reached bifrost. Change the template there and copy the
new render; never edit the body here.

**Do not add `secret-scan / secret-scan` to the ruleset in §3 by hand**, for two
reasons that now point the same way:

1. **No repo in the org requires it any more.** STARK-7967 withdrew the
   requirement fleet-wide on 2026-09-20: `local.secret_scan_enforced` is
   `toset([])` and every `require-secret-scan` ruleset was destroyed (51 by that
   apply; a 52nd had already been deleted outside Terraform). That ticket's own
   verification recorded "repos still carrying require-secret-scan: 0" and left
   bifrost's and stark-skills' `Required CI on main` as the only *branch*
   rulesets in the org. Spot-checked again here on 2026-09-20: `tyr`, `frigg`,
   `alfred`, `idun` and `plume` each return an empty ruleset list. Requiring the
   context here would reinstate on one repo a control deliberately removed from
   all of them. **STARK-7635**, which owned the enrol-or-not decision for the two
   hand-PR'd repos (bifrost and `.github`), was **cancelled** on the same day for
   exactly that reason; nothing was built and nothing should be. If the fleet
   control is ever restored (the commented-out derivation in 21stark's
   `repos/locals.tf`, plus an apply), bifrost and `.github` really are the two
   repos left uncovered — re-file then, in 21stark.
2. **It would be an unowned rule.** Every other repo's requirement, when there
   was one, was Terraform state in 21stark. A hand-made one here is invisible to
   that tier's audit, and the next fleet pin bump — which **renames the right
   half of the context** if the reusable workflow's job name ever changes —
   silently orphans it and blocks every merge on "Expected — waiting for status".
   Enrolment belongs in 21stark, not in `gh api ... /rulesets` from here.

**Neither scan dominates the other**, which is why the in-repo one is the
blocking gate and the fleet caller is not:

| | scope | assurance |
| --- | --- | --- |
| `secret scan (tree)` (in-repo) | **wider** — whole working tree *plus* the PR commit range | **weaker** — no checksum on the binary it downloads, the `secrets` job self-tests nothing, and it sits outside `local.secret_scan_pin`, so a fleet gitleaks bump never reaches it |
| `secret-scan / secret-scan` (fleet caller) | narrower — incoming commits only | **stronger** — pinned binary + published checksum, and it refuses a clean scan until it has watched the scanner fire |

**The fleet caller is now the only thing proving this repo's gitleaks rules
fire.** `engine/cmd/stark/gitleaks_config_test.go` ran the pinned binary over
`.gitleaks.toml` and failed if the `google-oauth-client-secret` rule stopped
firing; it went with `engine/`. What replaced it is the reusable workflow's own
self-test, which writes a fresh `GOCSPX-` probe through **this repo's config**
and fails the job unless that rule id appears in the report. Observed firing on
PR #306 (run `35528023774`, `self-test OK: the scanner fires with the caller's
config`), with `selftest_rule_id: google-oauth-client-secret` — which is the
reusable workflow's *default*, taken because bifrost's caller passes no inputs.
**So the `google-oauth-client-secret` rule in `.gitleaks.toml` is load-bearing:**
removing or renaming it turns a reporting check RED on a repo with no secrets in
it, and carrying it is what lets bifrost run the fleet's default caller with no
`selftest_rule_id` override. Keeping that check reporting — even unrequired — is
therefore worth more than its status column suggests.

## 2. Enforcement lives in a RULESET — and *also* in classic protection

**Read both endpoints. Neither alone is the answer, and they disagree about what
exists.**

```bash
# Classic branch protection — PR requirement, linear history, force-push,
# deletions, conversation resolution, enforce_admins.
gh api repos/21StarkCom/bifrost/branches/main/protection

# Repository rulesets — where the required status checks live.
gh api repos/21StarkCom/bifrost/rulesets
gh api repos/21StarkCom/bifrost/rulesets/23544063
```

Measured 2026-09-20:

**Ruleset `23544063` — "Required CI on main".** `target: branch`,
`enforcement: active`, condition `ref_name.include: ["~DEFAULT_BRANCH"]`,
`strict_required_status_checks_policy: false`, `do_not_enforce_on_create: false`,
and one rule of type `required_status_checks` holding the §1 contexts. Bypass
actors: exactly one — `{actor_id: 5, actor_type: RepositoryRole, bypass_mode:
"always"}`, i.e. repository admin, which on this repo is the only human.

**Classic protection on `main`** carries **no `required_status_checks` key at
all**. Reading that endpoint alone is therefore actively misleading: it returns a
populated object with the status-check field simply absent, which reads as "no
checks required" when four are. What it does carry, and what binds *everyone*
including an admin because `enforce_admins` is `true`:

- `required_pull_request_reviews` present with
  `required_approving_review_count: 0`, `require_code_owner_reviews: false`,
  `dismiss_stale_reviews: true`, `require_last_push_approval: false` — the
  object's *presence* is what requires a pull request at all. So: a PR is
  mandatory for every change; approvals are not (§6).
- `required_conversation_resolution: true` — every review thread must be resolved
  before merge. This is what makes an unresolvable inline review comment a hard
  blocker rather than a note.
- `required_linear_history: true`, `allow_force_pushes: false`,
  `allow_deletions: false`, `block_creations: false`, `lock_branch: false`,
  `required_signatures: false`, `allow_fork_syncing: false`.

The two surfaces are **additive**: a ruleset does not replace classic protection,
and the most restrictive rule across both wins. **A ruleset's bypass actor grants
no bypass of classic protection** — the admin can merge past a red required
check, and cannot push to `main` directly, cannot force-push, and cannot leave a
review thread unresolved.

Neither half binds an admin who **rewrites** the settings. `enforce_admins` stops
an admin *using* a bypass, not one who PUTs `enforce_admins: false` or deletes
the ruleset, and nothing here detects that. The re-measure commands above are the
only control.

**`21StarkCom/stark-skills` is not the same shape, despite the identical ruleset
name.** It carries ruleset `20607400` "Required CI on main" (same
`RepositoryRole: 5, always` bypass actor, contexts `Analyze (go)`,
`Analyze (javascript-typescript)`, `test`, `typecheck`) and **no classic branch
protection at all** — `gh api repos/21StarkCom/stark-skills/branches/main/protection`
returns `404 Branch not protected`. bifrost is the stricter of the two on
everything classic protection covers. Do not infer either repo's settings from
the other.

## 3. APPLY — the `Required CI on main` ruleset (operator, once)

`integration_id: 15368` is the GitHub Actions app; pinning it means a check of
the same name reported by a *different* app cannot satisfy the requirement.
Confirm it against a real head with the §1 command before running (every check
run on PR #306 reported `app_id=15368`, `slug=github-actions`).

**Sequence matters, and getting it wrong hangs the merge box.** The PUT names
context strings; a context only exists once a job has reported it on some head.
`test` and `typecheck` already report — they were added to `ci.yml` before the
engine job was removed — but `secret scan (tree)` does not exist until the commit
that renames the `secrets` job is **pushed**. So: push the `ci.yml` rewrite, let
CI report the new names on that head, then run the PUT, then merge. Run the PUT
first and `secret scan (tree)` is an orphan the whole time (§5).

```bash
gh api -X PUT repos/21StarkCom/bifrost/rulesets/23544063 \
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
          { "context": "test",                "integration_id": 15368 },
          { "context": "typecheck",           "integration_id": 15368 },
          { "context": "secret scan (tree)",  "integration_id": 15368 },
          { "context": "actionlint",          "integration_id": 15368 }
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

**Send the complete object, not a partial.** The endpoint accepts a partial
update, and this file does not document which omissions GitHub treats as "leave
unchanged" versus "clear" — a full payload makes the resulting state readable off
the command instead of off merge semantics. In particular, do not omit
`bypass_actors` unless you mean to decide the question below.

Verify it took, then confirm §5:

```bash
gh api repos/21StarkCom/bifrost/rulesets/23544063 \
  --jq '{name, enforcement, refs: .conditions.ref_name.include,
         bypass: .bypass_actors,
         contexts: [.rules[] | select(.type=="required_status_checks")
                    | .parameters.required_status_checks[].context]}'
```

### The two parameters worth understanding before you run it

- **`strict_required_status_checks_policy: false`** — does not force a PR branch
  to be up to date with `main` before merging. Set it to `true` and every merge
  to `main` invalidates every other open PR's green run. `idun gh pr-merge`
  rebases onto the base before it merges anyway, so `false` costs little.
- **`bypass_actors` = repository admin (`actor_id: 5`, `bypass_mode: "always"`)**
  — **the operator CAN merge red.** This is a real weakening and it is stated
  plainly on purpose: an earlier version of this file claimed the gate had no
  admin bypass, which was false (corrected in `bc1da22a`, STARK-8166). Do not
  reintroduce that claim. It exists to keep an unblock path when CI itself is
  what is broken — a workflow rename that orphans a context (§1), a GitHub
  Actions outage. Drop the whole `bypass_actors` array for a hard gate; the cost
  is that fixing a broken workflow then requires flipping `"enforcement"` to
  `"evaluate"` or `"disabled"` first, with no way back in if that is also what is
  broken. Either way `idun gh pr-merge` still refuses a red or `skipped` required
  check on its own, so the practical gate holds one level above the ruleset —
  which is where it actually gets exercised.

## 4. NEVER add a draft skip guard, or a `paths:` filter, to a required workflow

Do **not** add `if: github.event.pull_request.draft == false` to any job whose
check is required. A guarded job reports `skipped`; **GitHub counts `skipped` as
SATISFYING a required check**, and the merge box renders it identically to a
pass. That turns "CI did not run" into "CI is green" over a suite that never ran
against what landed. `21StarkCom/stark-skills#877` merged exactly that way.

There is no repair once it happens on a given SHA: re-running replays the
original event payload so it skips again, and a `workflow_dispatch` run **does
not join the PR's status rollup**. Only a new commit clears it. Of the merge
paths here, only `idun gh pr-merge` catches it — and only without
`--allow-skipped-checks`, which should never be needed in this repo.

The same reasoning bars a `paths:` filter: a filtered-out workflow never reports
at all, and a required context that never reports blocks the merge box forever
(§5). **This is now more load-bearing than it was, not less.** `test` and
`typecheck` are the jobs a tidy-up is most tempted to scope with
`paths: tools/**` — they are slower than the scanners and most PRs touch `tools/`
anyway. Doing it would silently unrequire the repo's entire functional suite on
every PR that does not.

Today: neither `ci.yml` nor `secret-scan.yml` carries a draft guard or a `paths:`
filter, and **both** `pull_request` triggers use the default event types
(`opened`, `synchronize`, `reopened`) — so both run on draft PRs, and `gh pr
ready` fires nothing extra that `cancel-in-progress` could cancel out from under
the head SHA.

`ci.yml` sets `cancel-in-progress: false` with a per-PR concurrency group, and
that is deliberate: **GitHub counts a CANCELLED required check as FAILING**, and
`main` has already carried commits with `engine: cancelled` from back-to-back
merges sharing one `ci-refs/heads/main` group. With `test` and `typecheck`
required, a cancelled run is a blocked merge that only a new commit clears.
`secret-scan.yml` cancels in progress **on PR events only**
(`cancel-in-progress: ${{ github.event_name == 'pull_request' }}`) — never on a
push or a merge_group run, each of which scans its own commit range. Keep both as
they are; `secret-scan.yml`'s bytes are not this repo's to design (§1b).

The one `if:` in `ci.yml` is step-level and correct: the second gitleaks pass
carries `if: github.event_name == 'pull_request'` because a push has no
`base..head` range to scan. The unconditional fail-closed whole-tree scan above
it is what the context actually proves, so the job never concludes SUCCESS having
executed nothing. That is the distinction — a step-level `if:` that skips the
*only* substantive step is the same false green wearing a different hat.

## 5. Verifying the gate actually gates

The vacuous-pass failure mode is that everything *looks* green because nothing
was ever required. In order:

```bash
# 1. The ruleset is active and names all four contexts.
gh api repos/21StarkCom/bifrost/rulesets/23544063 \
  --jq '[.rules[] | select(.type=="required_status_checks")
         | .parameters.required_status_checks[].context]'
# expect exactly: test, typecheck, secret scan (tree), actionlint

# 2. ORPHAN CHECK — a required context no job produces.
#    Left column = required but never reported. Must be empty.
SHA=$(gh api repos/21StarkCom/bifrost/pulls/<PR#> --jq .head.sha)
comm -23 \
  <(gh api repos/21StarkCom/bifrost/rulesets/23544063 \
      --jq '[.rules[]|select(.type=="required_status_checks")
             |.parameters.required_status_checks[].context]|sort|.[]') \
  <(gh api "repos/21StarkCom/bifrost/commits/$SHA/check-runs?per_page=100" \
      --jq '[.check_runs[].name]|sort|.[]')

# 3. GitHub marks them required ON A PR — the ruleset-aware view, and the same
#    field `idun gh pr-merge` reads.
gh api graphql -f query='
  query($pr: Int!) {
    repository(owner: "21StarkCom", name: "bifrost") {
      pullRequest(number: $pr) {
        commits(last: 1) { nodes { commit { statusCheckRollup {
          contexts(first: 20) { nodes {
            ... on CheckRun { name isRequired(pullRequestNumber: $pr) }
          } }
        } } } }
      }
    }
  }' -F pr=<PR#>

# 4. `idun gh pr-merge` completes WITHOUT --allow-no-required-checks.
```

**Step 2 is not redundant with step 3, and it is not optional.** An **orphaned
required context — one named by the ruleset that no job reports — is invisible to
`gh pr checks --required`.** The status rollup contains a node per check run that
actually *reported*; a context with no run contributes no node at all, so the
command most likely to be reached for to diagnose a hung merge box cannot see the
thing hanging it. Measured on PR #306: the rollup carried exactly the six check
runs that had reported (`isRequired` true for three of them), and
`gh pr checks 306 --required` printed those three and nothing else. Only a direct
comparison of the ruleset's strings against the head's reported names — step 2 —
finds an orphan.

An orphan is also **not a red check you can re-run**: nothing ever ran. Re-running
replays nothing, a `workflow_dispatch` run never joins the rollup (§4), and the
merge box sits on "Expected — waiting for status". The exits are the admin bypass
(§3), or a ruleset PUT that matches reality.

If step 4 still demands `--allow-no-required-checks`, the contexts in the ruleset
do not match the strings GitHub is reporting — re-read them per §1 and fix the
ruleset; do not pass the override.

## 6. Reviews, ownership, and reporting

**`required_approving_review_count` is `0` and `require_code_owner_reviews` is
`false`, deliberately.** bifrost has one human. A repo-wide approval requirement
on a single-operator repo cannot be satisfied without a second account or an
admin bypass on every PR, and a gate that is bypassed on every PR stops being
read as a gate anywhere. GitHub's review count is repo-wide — there is no
per-path count — so the strictest path would govern every PR, which is precisely
why it is not set.

**`CODEOWNERS` records ownership, not a merge gate.** With
`require_code_owner_reviews: false`, a match assigns a reviewer and blocks
nothing; every owner in the file is `@aryeh-stark`. Read it as who must look at a
path, and as the gate it becomes the day a second maintainer exists — at which
point revisit this section, because the reasoning for two approvals on
instruction-text and code-execution surfaces holds, it just has no one to spend a
second approval.

**What actually holds the high-trust paths is the mandatory
`/code-review xhigh --fix` round on every PR**, plus `idun gh pr-merge`, which
refuses a red or `skipped` required check whatever the ruleset allows. Those are
exercised per PR. Note there is no longer any workflow-side attestation: the
`publish-sync-pr` operator-attestation gate was deleted with the marketplace
machinery, and nothing replaced it. Every merge is a hand merge now.

Why the trust bar is where it is: this repo distributes **code and instruction
text**. Every `skill/*/SKILL.md` body is injected into a developer's agent, and
every tool under `tools/` is executed on a developer's machine by those bodies.
A change to either is a change to what runs on every installed machine on the
next `claude plugin marketplace update` — with no signature to verify (§1) and
no drift gate left, the review round *is* the control.

**Reporting a vulnerability.** Private vulnerability reporting is **disabled** on
this repo (`gh api repos/21StarkCom/bifrost/private-vulnerability-reporting` →
`{"enabled": false}`, measured 2026-09-20), so GitHub shows no "Report a
vulnerability" button and an outside reporter has no private channel here.
Contact `@aryeh-stark` directly. To open one, an operator runs:

```bash
gh api -X PUT repos/21StarkCom/bifrost/private-vulnerability-reporting
```

Rotate any exposed secret immediately, and rotate it in `mimir` — the store of
record. No secret **value** lives in this repo under any circumstances; if one
did, the `secret scan (tree)` context is fail-closed over the whole working tree
and should have caught it before the merge (§1).
