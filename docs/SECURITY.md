# bifrost — Security & Governance

This is a **code-distribution system**, not just config. Every artifact body is
instruction text injected into a developer's agent, and every `mcp/` entry is a
command spawned on the developer's machine. The controls below treat those as the
highest-trust surfaces (design spec §7.4, §7.5, §11, §14).

## 1. Trust model

Integrity rests on **three things together**, not on self-computed digests:

1. **Protected, linear `main`** — no force-push, no deletions, linear history,
   `enforce_admins` on. **Those bind every merge, an admin's included; the
   required CI contexts do not.** Classic branch protection carries no
   `required_status_checks` key at all — the three contexts live only in the
   `Required CI on main` **ruleset**, and that ruleset grants repository admin
   `bypass_mode: "always"`. So the operator *can* merge red, by design, to keep
   an unblock path when CI itself is what is broken.
   `required_approving_review_count` is `0` and `require_code_owner_reviews` is
   `false` (§5 is the authority on both). Measured 2026-09-20;
   [`operations/branch-protection.md`](operations/branch-protection.md) §2–§3 is
   the authority on both surfaces and costs out dropping the bypass actor.
   Neither half binds an admin who **rewrites** the settings: `enforce_admins`
   stops an admin *using* a bypass, not one who PUTs `enforce_admins: false` or
   deletes the ruleset, and nothing in this repo detects that — §5's re-measure
   commands are the only control. What holds a change here in practice is the
   mandatory `/code-review xhigh --fix` round **plus `idun gh pr-merge`, which
   refuses a red or skipped required check whatever the ruleset allows**
   (`operations/branch-protection.md` §3) — not the ruleset.
2. **A CI-signed build manifest** — produced on merge by `sign-manifest.yml` via
   GitHub OIDC → sigstore/cosign **keyless** (Fulcio cert + Rekor transparency log).
   The signer identity is `repo:21StarkCom/bifrost` on the `main` ref.
3. **The commit SHA** — installs may pin it; the manifest binds digests to that SHA.

`stark verify-manifest` checks the cosign signature, the signer identity/issuer, and
that each recorded digest matches the committed bytes. **Self-computed digests alone
are only an anti-drift / consistency signal** — they prove the tree matches itself,
never that it is the official build. (spec §7.5 / red-team C1.)

### Where to get the signed manifest

`sign-manifest.yml` attaches `build-manifest.json`, `build-manifest.json.sig`,
`build-manifest.json.pem`, and `build-manifest.sha256` to the GitHub Release it
creates when `VERSION` changes (tag `v<VERSION>`).

End-to-end client verify:

```bash
# 1. Pull the signed bundle for a specific release (gh release download)
gh release download v0.1.0 \
  --repo 21StarkCom/bifrost \
  --pattern 'build-manifest.json*'

# 2. Verify signature (cosign keyless) + content digests against the local checkout
stark verify-manifest --root . build-manifest.json
```

A non-zero exit code means EITHER the signature failed (wrong signer, no Rekor
entry) OR a committed file's bytes drifted from the manifest digest. Treat both
as install blockers.

## 2. Command-allowlist governance

MCP `command` values must be on the positive allowlist in
`engine/internal/validate/allowlist.go`; `agent.tools` against the allowlist in
`engine/internal/validate/toolsallow.go`. Every entry in `allowlist.go` widens the set of
binaries an MCP server may spawn on a developer's machine, so additions carry an explicit
process (spec §15.4): both files have a dedicated, last-match-wins **CODEOWNERS** entry
(`@aryeh-stark`) on top of the `engine/**` rule. That entry names the owner; it is **not**
a merge gate today — see the note in §3. To add an entry:

- Open a PR touching only the allowlist file with a one-paragraph justification
  (what the binary/tool does, why it is needed, who maintains it).
- Requires **maintainer review** (`@aryeh-stark`) — CODEOWNERS marks it on
  `engine/internal/validate/allowlist.go` and `engine/internal/validate/toolsallow.go`.
- Keep the list minimal; prefer pinned, well-known binaries (`node`, `uvx`) and
  first-party `stark-*-mcp` servers over ad-hoc tools.

## 3. Review requirements (CODEOWNERS)

> **The table below is POLICY, not the live setting.** Every owner in `CODEOWNERS`
> is `@aryeh-stark`, and per §5's measured state
> `required_approving_review_count` is **0** and `require_code_owner_reviews` is
> **false** — so a CODEOWNERS match assigns a reviewer and blocks nothing, and no
> path clears two approvals today. What actually holds these paths is the
> mandatory `/code-review xhigh --fix` round on every PR; on the
> `auto/marketplace-sync` PR specifically, `publish-sync-pr` additionally refuses
> to merge without the operator's review attestation (that workflow is scoped to
> that one head ref and does not run on hand-authored PRs). Read the table as the
> process for the day a second maintainer exists. §5 is the authority on what is
> enforced; re-measure there before trusting any of it.
>
> An earlier draft named org teams `stark-maintainers` / `stark-reviewers` as a
> prerequisite. `CODEOWNERS` *did* carry `@GetEvinced/stark-maintainers` and
> `@GetEvinced/stark-reviewers` from the Slice 8 governance commit until
> `f84916f7` replaced every team slug with `@aryeh-stark`; neither team was ever
> created (`gh api orgs/GetEvinced/teams` and `gh api orgs/21StarkCom/teams` both
> show no `stark-*` team, measured 2026-09-20), so the entries never bound to
> anyone.

| Path | Policy reviewers | Policy min approvals |
|------|------------------|----------------------|
| `catalog/**/skills/**`, `catalog/**/commands/**`, `catalog/**/agents/**` (bodies) | maintainer **+ second reviewer** | **2** |
| `**/mcp/**` (code execution) | maintainer + reviewer **+ Aryeh** | **2** |
| `engine/internal/validate/allowlist.go`, `engine/internal/validate/toolsallow.go` (command/tool allowlists) | maintainer + Aryeh | 2 |
| `engine/**`, `schema/**`, `dist/claude/**`, `index.json`, `bundles/**` | maintainer + Aryeh | 2 |
| `.github/workflows/**`, `CODEOWNERS`, `.gitleaks.toml`, this file | maintainer + Aryeh | 2 |

**Why the policy says two approvals, not one:** a CODEOWNERS entry only guarantees *who*
must review; it does not raise the *count*. The high-trust body and `**/mcp/**` paths would
need **TWO** distinct approvals — the CODEOWNERS reviewer requirement **plus** repo-wide
`required_approving_review_count = 2`. One CODEOWNERS reviewer alone still merges on a
single approval, which is insufficient for instruction-text/code-exec surfaces. The count is
repo-wide (GitHub has no per-path count), so the strictest path would govern every PR — which
is exactly why it is not set on a one-human repo (§5).

## 4. CI gates (required — on who can bypass them, see §1)

`ci.yml` runs on every PR (and on every push to `main` that starts a workflow run
at all — the auto-published sync merge starts none; see
[`operations/branch-protection.md`](operations/branch-protection.md) §1). Its
three jobs are the three required contexts, and **every** step in each is
blocking — a failing step fails its job, which fails its context:

- **`engine (validate + drift + tests)`** — `gofmt`, `go vet`, `go test ./...`
  (golden + determinism + integration), `stark validate`, `stark build --check`
  (drift), `stark check-bumps` (version-bump immutability; errors when an
  artifact's canonical-source digest changed without a `version` bump),
  `stark lint --strict` (body suspicious-pattern scan), `stark allowlist --check`.
- **`secret scan (catalog)`** — gitleaks over the working tree *and* the PR
  commit range.
- **`actionlint`** — workflow lint.

This list is the one in `ci.yml` and in `docs/scripts/ci-local.sh`; it is pinned
against the workflow by `engine/cmd/stark/security_doc_test.go`, because the
previous copy silently drifted (it still called `stark lint` non-blocking two
gate-additions later).

**Non-blocking** (surfaced only): `stark lint` *without* `--strict` — the
informational mode, which CI does not use — and capability/array warnings from
`stark validate`.

Two things this section deliberately no longer claims.

**Not "non-bypassable".** A repository admin bypasses the ruleset that requires
these (§1). On a one-human repo that is the only human.

**A green gate is not automatically a gate that measured something.** Four of
these have been found green over content they never inspected.
Fixed: `check-bumps` had no `origin/main` baseline in a `pull_request` checkout
and compared each PR to itself (STARK-8161); `lint --strict` returned 0 when it
could not read the catalog at all (STARK-8165). Still live: both `validate` and
`lint --strict` pass over a catalog holding zero bundles (STARK-8243, open); and
`check-bumps` on the **`push: [main]`** run is vacuous by construction — after a
merge HEAD and `origin/main` are the same commit, so previous equals current for
every row. That last one is not a bug and will not be fixed: the question can
only be answered before the change lands, so read a green `check-bumps` on a
`main` push as evidence of nothing (`ci.yml` says so at the step). When one of
these matters to a decision, check what it inspected — `check-bumps` now prints
its baseline on every run for exactly this reason.

## 5. Branch protection — APPLY (manual admin step)

> **Operational runbook: [`operations/branch-protection.md`](operations/branch-protection.md).**
> That file carries the authoritative required-context list, the ruleset APPLY
> command, and the verification steps. This section states the policy; read both.

> **MEASURED 2026-09-20 (STARK-4989, STARK-4991, STARK-8166). This block and §1
> state the same measurement; if they ever disagree, re-measure rather than
> believing either.** Re-measure with the two `gh api` commands in
> [`operations/branch-protection.md`](operations/branch-protection.md) §2 (both
> surfaces) before trusting any of it — they existed here before and were never
> run, which is how the gap below survived.
>
> **Live and enforcing for everyone** (classic branch protection, which carries
> **no** `required_status_checks` key at all): `required_linear_history: true`,
> `enforce_admins: true`, `allow_force_pushes: false`, `allow_deletions: false`,
> `required_conversation_resolution: true`.
>
> **Live, and bypassable:** the `Required CI on main` ruleset — three contexts,
> `enforcement: active`, `bypass_actors:
> [{actor_id: 5, actor_type: RepositoryRole, bypass_mode: "always"}]`. That is
> repository admin, which on this repo is the only human, so the three required
> CI contexts are the one control here an operator can merge past (§1;
> `operations/branch-protection.md` §3 costs out dropping the actor).
>
> **Deliberately NOT live:** `required_approving_review_count` is **0** and
> `require_code_owner_reviews` is **false**. This is now a decision, not a gap.
> bifrost has one human. A repo-wide 2-approval rule on a single-operator fleet
> cannot be satisfied without a second account or an admin bypass, and a gate
> that is bypassed on every PR stops being read as a gate anywhere. The control
> that actually holds the high-trust paths is the mandatory
> `/code-review xhigh --fix` gate plus the operator attestation this repo's
> `publish-sync-pr` workflow requires before it will publish the sync PR
> (STARK-6208 moved that verification out of stark-skills' `marketplace-sync`,
> unchanged) — both of which are exercised per PR and neither of which a second
> rubber-stamp would strengthen.
>
> If bifrost ever gains a second maintainer, revisit: §3's two-approval
> reasoning holds, it just has no one to spend a second approval.

> **Required status checks now belong in a RULESET, not in the classic
> protection payload below.** Checking `branches/main/protection` alone is
> misleading — it can look configured while no check is required. See
> [`operations/branch-protection.md`](operations/branch-protection.md) §2–§3 for
> the ruleset that mirrors `21StarkCom/stark-skills`' `Required CI on main`, and
> the three contexts it must name. The classic-protection command below remains the
> source for the review / linear-history half only.

> These commands MUTATE repo settings. Run them once as a repo admin AFTER the
> required-status contexts have appeared at least once (push a PR so the job names
> register). **Do not run as part of automated plan execution.** Every owner in
> `CODEOWNERS` is `@aryeh-stark`; no team slug is referenced anywhere in this repo.
>
> **Why the block below sets `required_approving_review_count = 2`, and why it is
> NOT applied:** GitHub's review count is repo-wide — there is no per-path count. A
> CODEOWNERS entry alone only forces "review from a Code Owner"; it still merges on a
> **single** approval. So covering the high-trust body/MCP paths
> (`catalog/**/skills/**`, `catalog/**/agents/**`, `catalog/**/commands/**`, `**/mcp/**`)
> would need the count at 2 repo-wide. On a one-human repo that is unsatisfiable
> without an admin bypass per PR. Kept here as the recipe for the day a second
> maintainer exists; see the measured block above for what is actually enforced.

```bash
# NOT the live config — the recipe for the day a second maintainer exists.
# Note it writes the status checks into CLASSIC protection; today they live only in
# the ruleset (§1), and `enforce_admins` below binds admins to THIS payload only —
# it does not revoke the ruleset's `bypass_mode: "always"` actor.
gh api -X PUT repos/21StarkCom/bifrost/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "engine (validate + drift + tests)",
      "secret scan (catalog)",
      "actionlint"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 2,
    "require_code_owner_reviews": true,
    "dismiss_stale_reviews": true
  },
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "restrictions": null
}
JSON

# Verify it took.
gh api repos/21StarkCom/bifrost/branches/main/protection | \
  jq '{linear: .required_linear_history.enabled, force: .allow_force_pushes.enabled,
       admins: .enforce_admins.enabled, checks: .required_status_checks.contexts,
       codeowners: .required_pull_request_reviews.require_code_owner_reviews,
       approvals: .required_pull_request_reviews.required_approving_review_count}'
```

Expected verify output: `linear: true`, `force: false`, `admins: true`,
`codeowners: true`, `approvals: 2`, and the three required contexts listed.
(If the contexts live in the ruleset instead — the current plan — `checks` reads
`null` here and you verify them with `gh api repos/21StarkCom/bifrost/rulesets`.)

> **Note on the `engine` required context:** the job name is
> `engine (validate + drift + tests)` regardless of which steps it grows —
> required-status matching is by **job name**, not step. A failing `check-bumps`
> or `build --check` step fails the whole job, so requiring the `engine` context
> is all it takes to require them. **That is "required", not "non-bypassable"** —
> a repository admin still bypasses the ruleset that requires the context (§1).

## 6. Reporting

Suspected catalog tampering or a leaked credential: open a private security advisory
on the repo and ping `@aryeh-stark`. Rotate any exposed secret immediately — values
never live in the catalog (only `secretRef` names), so rotation is in the secret store.
