# Changelog

All notable changes to `bifrost`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html). Bumping `VERSION` on `main` triggers a tag + signed release.

## [Unreleased]

### Removed
- **The web registry is gone (STARK-7972).** Deleted the `web/` React SPA, the `server/` Go static origin, the `Dockerfile`, the `web-deploy` workflow, `docs/scripts/deploy-web.sh` and `docs/web-hosting.md`. Nothing in the install or publish path read `marketplace.21stark.com`: Claude Code installs from `.claude-plugin/marketplace.json` + `dist/claude/` on GitHub, `stark install/search/info` load `index.json` from disk, and `sign-manifest` signs the committed `index.json` regardless of hosting. `index.json` / `bundles/*.json` stay. `ci.yml` drops the `web build` and `server (static origin)` jobs, so the required contexts on `main` go **five → three**; **this is a merge blocker, not a same-PR step** — narrowing the ruleset is an operator-only `gh api .../rulesets` mutation (`docs/operations/branch-protection.md`; SECURITY.md §5 forbids running it from an agent, skill, hook, or CI), so it must land *before* this change merges or every subsequent PR to `main` sits blocked waiting on two checks that no longer report (tracked live on STARK-7972). `publish.sh` loses `--deploy`. Codex plugin `homepage` / `websiteURL` now fall back to the GitHub repo URL. The GCP teardown in `ev-infra-group` is tracked separately.

### Added
- **`sync-pr-watchdog` — the first thing that reports a stranded `auto/marketplace-sync` PR (STARK-8164).** `publish-sync-pr` refuses to merge unless `compare(main...head).status` is `ahead`, and it runs **only** on `pull_request_review: [submitted]`. Those two facts do not compose: the precondition is falsified by a *different* event — any merge to `main` leaves the sync branch `diverged` — and that event starts no publication attempt, so nothing evaluates the precondition and nothing reports it. **An event-triggered workflow cannot observe the absence of its own event**, which is why no amount of hardening inside `publish-sync-pr` would ever have caught this. Measured live 2026-09-20: PR #293 opened 03:52, six hand merges landed on `main` between 08:10 and 13:30 (`sign-manifest` ran on each, so operator merges *do* fire push workflows), and the strand was found by hand at ~15:24 — **11.5 hours, six causing events, zero runs, zero alarms**, with publication of *every* stark-skills change stopped for the window, not just #293's. The new workflow asks one question — can `publish-sync-pr` still succeed on the open sync PR — on `push: main` (which names the causing merge at the instant it happens), on a half-hourly cron (which covers a merge made with `GITHUB_TOKEN`, for which GitHub starts no push run, plus an attestation spent on a publish run that then failed), and on `workflow_dispatch`. A non-ok verdict upserts **one** comment on the sync PR naming the remediation and fails the run (and re-posts nothing while the body is unchanged, so a half-hourly cron does not rewrite it 48 times a day). Two details are load-bearing in the query rather than in the verdict: the backstop clock runs from the **head commit**, not from `createdAt` — the sync branch is long-lived and force-pushed, so one reused PR carries regeneration after regeneration and #293's creation time was already 11.5 hours behind its head — and the PR it watches is filtered on `isCrossRepository`, the same guard `publish-sync-pr` carries, because `--head` matches a ref name that carries no owner and `gh pr list` answers newest-first. It deliberately does **not** restate `publish-sync-pr`'s attestation predicate (two copies of a gate is how one drifts, and every other publication failure already produces a red run of its own), and it deliberately does **not** repair: repair is a *regeneration*, needing a stark-skills checkout and a token for that repo which bifrost does not have, and a rebase instead would silently revert whatever `main` changed under `catalog/`/`dist/` — exactly the damage the refusal exists to prevent. The verdict jq is **extracted from the shipped workflow** and driven through real jq by `engine/cmd/stark/sync_pr_watchdog_test.go` (the `publish_sync_pr_test.go` idiom), covering `ahead`/`behind`/`diverged`/`identical` and the age boundary; the trigger and red-exit pins are asserted structurally after both were mutation-tested and the first drafts of each were found to pass a broken workflow.
<!-- idun:pr-merge pr=298 runId=298 sha=14de9477 -->
- Removed the unused private-repo GitHub Contents API fetcher and corrected stale organization links and governance claims in the docs.
<!-- stark-gh:pr-merge pr=297 runId=1e0c38e3-1b5b-4ed8-9289-fc231458cd5b -->
- **The root-`VERSION` "gap" is not one, measured (STARK-7998)** — **supersedes the STARK-7977 bullet below (pr=296), which flagged it as an open gap.** A native Codex consumer does not key re-fetch on the manifest `version`: it tracks the marketplace's git branch, `codex plugin marketplace upgrade` re-installs from the refreshed snapshot regardless of version, and `version` only names the cache directory. So `check-bumps` gains **no** root-`VERSION` row — and the fifth row family for `dist/codex-plugins/<bundle>/.codex-plugin/plugin.json` stays refused on the STARK-7977 reasons that never depended on this measurement, not as a consequence of it. Codex-only — Claude Code still pins an install to `plugin.json`'s `version`, which is why the four row families stand. The measurement is pinned by nothing (CI has no Codex; codex-cli 0.155.1, 2026-09-20) — re-measure before leaning on it. It also does not cover withdrawal: `upgrade` leaves a plugin dropped from the marketplace cached and enabled, which `docs/operations/rollback.md` §1 now records.
<!-- idun:pr-merge pr=296 runId=296 sha=82dcc084 -->
- Document and pin why engine-derived Codex manifest bytes (e.g. homepage fallback) are exempt from `check-bumps`; flags the root-VERSION gap as STARK-7998.
<!-- stark-gh:pr-merge pr=294 runId=46a45aaf-be1f-43ef-99b3-589ae1338ad9 -->
- Removed the unused web registry hosting stack and pointed Codex marketplace homepage metadata to the GitHub repository.
<!-- idun:pr-merge pr=291 runId=291 sha=dfc329da -->
- `stark`'s help output now renders in the shared 21Stark fleet look (colorized title, usage, headings, commands, and flags) via a pinned stark-tui snapshot.
- **bifrost runs the fleet secret scan (STARK-7490).** `.github/workflows/secret-scan.yml` is the fleet's thin caller for the one reusable gitleaks workflow in `21StarkCom/.github`, pinned by commit SHA, producing the `secret-scan / secret-scan` check on every PR and on every push to `main` that starts a workflow run at all — note the auto-published sync merge, made with `GITHUB_TOKEN`, starts none, so those `main` SHAs carry no check run (`docs/operations/branch-protection.md` §1 records the gap). It is **byte-identical** to what `21StarkCom/21stark`'s `repos/templates/secret-scan-caller.yml.tftpl` renders (verified against the template render and three live repos' copies) but it arrived by PR, not by apply: `main` here carries `enforce_admins = true` plus required PR reviews, which reject the Terraform provider's direct commit even for an admin token, so bifrost sits in that tier's `local.secret_scan_excluded`. `.gitleaks.toml` gains the fleet's `google-oauth-client-secret` rule verbatim, which is what lets the caller run the default self-test with no per-repo `selftest_rule_id` override — the rule is now load-bearing, and removing it turns the check red on a tree with no secrets in it. `engine/cmd/stark/secret_scan_caller_test.go` pins the context halves, the SHA pin, that rule-or-override invariant, and the absence of a skip guard, because nothing else in this repo's CI can see the other half of the contract.

### Changed
- **A bare `help` positional now prints route help instead of being consumed as data (STARK-8083, under STARK-8000).** `stark build help` treated `help` as a catalog directory and could generate files; `stark verify-manifest help` read it as a manifest and could launch cosign; `install`/`doctor`/`allowlist`/`version`/`self-update` ignored it and reached their handlers. `installPositionalHelp` wraps every runnable command's `Args` validator, which cobra calls after pflag parses and before any hook, and returns `pflag.ErrHelp` — the same signal `--help` produces. `newRootCmd` now forces `InitDefaultCompletionCmd` so cobra's four `completion <shell>` leaves are covered too; the `help` command and the hidden `__complete` protocol command are attached later by `ExecuteC` and stay unguarded on purpose, and **`search` is exempt** because its positional is a free-text query. Escape hatches for a path or bundle literally named `help`: `-- help` or `./help` (the guard reads parsed positionals and honours pflag's `ArgsLenAtDash`, so `--from help` and `--from=help` keep their literal flag values). The four `docs/scripts/*.sh` entrypoints parse or reject their whole argument list before resolving a path or starting a subprocess — `ci-local.sh` and `verify-native-install.sh` previously ignored every argument, and now refuse an unknown one with exit 2; `coverage-gate.sh` gains `[--]`/`help` handling (its cross-repo single-checkout invocation is unchanged) and `publish.sh` stops shelling to `sed` to print its own header. `docs/operations/positional-help-audit.md` records the per-route baseline; `engine/cmd/stark/positional_help_test.go` pins it with parser/hook tripwires plus a process matrix that builds the real binary and runs it and all four scripts under an isolated `HOME`/cwd, a tripwire `PATH`, and before/after fixture snapshots.
- **The yank runbook now says what a native Codex consumer actually receives (STARK-8031).** `docs/operations/rollback.md` §1 read as though every consumer were version-pinned, so an operator following it during an incident would believe a bad bundle had been withdrawn from Codex users when it had not. It now records both halves of the STARK-7998 measurement: the replacement bytes do arrive, but on `codex plugin marketplace upgrade` rather than on the SemVer bump, and *deleting* a bundle withdraws nothing — it stays cached and enabled — so the no-op shell is the only yank that works and the step 3 advisory is the only control that reaches a consumer who never upgrades. **The circular half of that finding is now measured rather than assumed:** the original probe hand-wrote its own `ref = "main"` into a sandbox config and then concluded consumers follow `main`. A real `codex plugin marketplace add https://github.com/21StarkCom/bifrost.git` records the source with **no** `ref` key and clones the full repo at the default branch — not a commit SHA — so an upgrade is never frozen to a pin. `CLAUDE.md` also stops claiming that the `codexAssets` row keeps a `vendor/runtime-overrides/codex/` overlay edit out of Codex installs while the bundle version stands still — it is an `index.json` content lock, not consumer reach — and its `build --check` line now names `dist/codex-plugins/` among the managed roots the drift gate rebuilds.
<!-- idun:pr-merge pr=295 runId=295 sha=201a5017 -->
- ci: sync `secret-scan.yml` to the current fleet render (STARK-7922 pin bump + STARK-7637 `merge_group` trigger), verified byte-identical to Terraform's rendered default
- **`ci` is no longer the only `pull_request` workflow** — `secret-scan` is the second. The five required contexts on `main` are unchanged and remain exactly `ci.yml`'s five jobs: `secret-scan / secret-scan` reports but is **not required here today**, and the blocking secret gate stays `ci`'s own `secret scan (catalog)` job. `docs/operations/branch-protection.md` records the reasoning, and the known gap that its push-to-`main` run does not fire on the auto-published merge (STARK-7717); `CLAUDE.md` and `AGENTS.md` correct the "only `pull_request` workflow" claim.
- **"Not required" is bifrost's current state, not a settled verdict (STARK-7490).** The first draft of the docs above read as though non-enrolment were decided here. It is not: **STARK-7635** owns the enrol-or-not call for both hand-PR'd repos (bifrost and `.github`) and is still open, and STARK-7490 has already met that ticket's stated precondition by landing the caller and observing a green `secret-scan / secret-scan` on `main`. What stands unchanged is the narrower rule — do not add the context to this repo's ruleset **by hand**, because a hand-made requirement is invisible to the Terraform tier that owns every other repo's and is orphaned by the next pin bump that renames the context's right half. Also corrects the claim that the in-repo `secret scan (catalog)` job is strictly "stricter": it is wider in scope (whole working tree plus the PR commit range) but weaker in assurance (no checksum on the downloaded binary, no self-test in the `secrets` job, outside `local.secret_scan_pin`), while the fleet caller is narrower and better-assured — neither dominates. Two smaller fixes in the same section: the repo's `.gitleaks.toml` *is* self-tested, by `TestGitleaksConfigContract` in the required `engine` context; and enrolment is not gated on STARK-7599, whose subject is the reverse write path for an already-enrolled repo's caller.

### Fixed
- **`stark lint --strict` reported success over a catalog it could not read (STARK-8165).** `runLint` printed `load error: …` and returned **0** — strict or not — so a blocking CI gate passed having scanned nothing. Same "passes by finding nothing to measure" shape as check-bumps' missing baseline. Its exposure in `ci.yml` today was nil, but only by accident of step ordering: `stark validate` runs one step earlier over the same `load.Load` and is fail-closed. That is ordering, not a property of the gate — reorder the steps, or call `lint --strict` from anywhere else, and the fail-open is live. `--strict` now returns 2 and prints no `LINT-SUMMARY` (a "0 findings" line over an unread catalog is not a measurement); plain `lint` keeps its spec §7.4 surfacing-only exit-0 contract, pinned so the fix cannot quietly turn it into a blocking command.
- **`sync-pr-watchdog` was broken the moment it merged, and the first live run is what found it (STARK-8217).** `gh api` refuses `--slurp` together with `--jq` — "the `--slurp` option is not supported with `--jq` or `--template`", on every version, not a runner quirk — so run `35523084147` printed gh's usage text and exited 1 before reaching any verdict. The flag had been copied from `publish-sync-pr.yml` without its shape: that workflow slurps into a variable and pipes to `jq` as two steps, which is the only form gh accepts. Nothing that ran before the merge could see it — the line is valid shell and valid YAML so `actionlint` and `shellcheck` pass it, the Go suite exercises the jq predicate rather than the gh command line, and the review round that introduced the flag verified it against a **stubbed** `gh`, which accepts every flag the real binary rejects. Fixed to the two-step shape, and pinned by `TestWorkflowsNeverCombineSlurpWithJq` — the mistake is a copy of someone else's flag, so the pin is read as wide as the copy can travel: **all four spellings** of the refusal (`--jq`, `-q`, `--template`, `-t` — measured on gh 2.101.0, all rejected identically, and a gate that knew only `--jq` passed three of them), matched as whole arguments rather than substrings so two-character flags cannot fire on a path; `.yaml` as well as `.yml`, because GitHub Actions reads both; `docs/scripts/*.sh`, which runs the same shell in the same CI; and continuation lines joined first, CRLF included, since the broken call spanned two. The same round guarded two things the rewrite left exposed in the step itself: the comments read now refuses with a named cause instead of dying on a bare `set -e` — it runs *after* the verdict, so a transport blip would otherwise redden a perfectly publishable PR with nothing but gh's error to explain it — and the marker filter takes `.body // ""`, because `startswith` on a null body aborts jq with exit 5 and `pipefail` turns that into a run that died before saying anything (the same guard `publish-sync-pr`'s review filter already carries, for the same reason).
- **`check-bumps` could not fail in CI, and never had (STARK-8161).** The gate asks whether content already published on `main` changed under an unchanged version, so it needs `main`'s `index.json`. `actions/checkout@v4` on a `pull_request` event at its default depth fetches only `refs/pull/N/merge` and creates **no** remote-tracking branch, so `origin/main` did not resolve; `prevIndexJSON` then fell through to `HEAD:index.json`, which on that checkout is the PR's own index — and the drift gate has already forced that to agree with the change. Previous equalled current for every row, so `bumps.Check` had nothing to find and the step printed `OK`. Measured by A/B on one violating commit (a line appended to a `vendor/stark-skills/tools/*.ts`, `build --fix`, committed, no version bump), same tree and same binary: `OK: no un-bumped source changes` with only `refs/remotes/pull/N/merge` present, 7 `shared-assets` violations once `refs/remotes/origin/main` was fetched in. `build --check` printed `OK: no drift` either way. It stayed invisible because `docs/scripts/ci-local.sh` and `docs/scripts/publish.sh` run the identical command in a full local clone, where the baseline exists — the local mirror was stronger than the gate it mirrored — and because every `checkbumps*_test.go` fixture is a bare `git init` with no remote that deliberately commits a stale index, exercising the `HEAD` path in a state the drift gate makes impossible in a real PR. Two halves, neither sufficient alone: `ci.yml`'s `engine` job now fetches `main` into `refs/remotes/origin/main` before the gate runs, and `prevIndexJSON` **refuses** — naming the missing ref and the fetch that fixes it — whenever a remote is configured but `origin/main` does not resolve, rather than falling back. Every run now prints the baseline it used. The `HEAD` fallback survives only for a repo with no remote at all (scratch trees, the existing fixtures). A probe that *fails* is a refusal too: git not on PATH or a `detected dubious ownership` checkout otherwise answers every probe with the same emptiness as "no remote", takes the dead `HEAD` path, finds nothing there either, and prints `OK` having read no baseline at all — so the two are discriminated (text-free, since git's messages are translated) and the refusal carries git's own reason. `docs/scripts/publish.sh` likewise stopped reading a nonzero gate that names no bundle as "version-bump gate clean". Scope: this was bifrost's own `pull_request` CI only. A branch checkout *does* create the remote-tracking ref, so stark-skills' `marketplace-sync` — which checks bifrost out at `main` — has always had a real baseline, which is why sync-PR bumps were enforced. **And one thing this does not fix, deliberately:** the `push: [main]` run of the same job stays vacuous, because after a merge HEAD and `origin/main` are the same commit and previous == current for every row. That is inherent to the question — "did this change publish content under an unchanged version" can only be answered before it lands — but a green `check-bumps` on a `main` push is evidence of nothing, and `ci.yml` now says so at the step. `docs/scripts/ci-local.sh` also stops claiming to mirror `ci.yml` "exactly": it deliberately does not fetch, so it measures against whatever `origin/main` the developer last pulled.
- **`TestGitleaksConfigContract` had never run in CI, while its own comment said it did.** It shells to the `gitleaks` binary and `t.Skip`s when it is absent; only the `secrets` job installed gitleaks, and Go tests run in `engine`. A skip and a pass are indistinguishable in `go test` output without `-v`, so the one assertion that exercises the real scanner over the real `.gitleaks.toml` was silently absent from every green run. The `engine` job now installs the same pinned CLI (the version hoisted to a single workflow-level `env` so the gate and the test cannot scan with different rulesets), and the test **fails** instead of skipping when `CI` is set. This matters more now than it did: STARK-7490 makes the config's `google-oauth-client-secret` rule load-bearing for a check in a different repo's workflow, and a drifted regex or a raised entropy floor leaves the rule id spelled in the file — passing a grep — while turning `secret-scan / secret-scan` red.

## [0.32.3] - 2026-09-19

### Changed
- Refresh marketplace packages from [stark-skills@84caafb](https://github.com/21StarkCom/stark-skills/commit/84caafba8b3cf9398a9afbad0457878d1649e2a5).

## [0.32.2] - 2026-09-19

### Changed
- Refresh marketplace packages from [stark-skills@21b69b2](https://github.com/21StarkCom/stark-skills/commit/21b69b2188ee25a297dd481179c868986386cf43).
- **The coverage gate now runs on the paths that publish, not just the manual one (STARK-6468 part 2).** stark-skills' `marketplace-sync.yml` runs `docs/scripts/coverage-gate.sh` before its regen — the hole that let `agnes` ship un-membered at 0.31.2 — and its `tests.yml` runs the same script on every `pull_request`, so an unclaimed skill goes red on the PR that adds it rather than halting publication from `main`. Both callers check the script is executable first and emit a named annotation on a cross-repo contract break, rather than dying at exit 126/127 as an apparently broken workflow. The reciprocal obligation is on this repo: that path and its exec bit are now a cross-repo contract, so `docs/scripts/coverage-gate.sh` cannot be moved, renamed or un-`chmod +x`'d without editing both stark-skills workflows in the same window.

## [0.32.1] - 2026-09-19

### Changed
- Refresh marketplace packages from [stark-skills@f8c22bd](https://github.com/21StarkCom/stark-skills/commit/f8c22bd4837e1ec219117161c8d5844ce39ceaf0).
- **The coverage gate is its own script, `docs/scripts/coverage-gate.sh` (STARK-6468).** It lived inline in `publish.sh`, which is the MANUAL regen path. The path that actually publishes is stark-skills' `marketplace-sync.yml`, which regenerates bifrost and opens the sync PR on ~every release and never invokes `publish.sh` — its gate list (`validate`, `sync --check`, `build --check`, `check-bumps`) is entirely internal-consistency checks between bifrost's own catalog and dist, none of which looks back at the stark-skills tree to ask whether every skill is claimed. So the automated path had no coverage gate at all, which is how `agnes` shipped un-membered at v0.31.2 (STARK-6249) with every gate green. `publish.sh` now delegates; `EXCLUDED_SKILLS` moved with the gate so the two callers cannot disagree about what is deliberately unpublished. Wiring `marketplace-sync.yml` to call it is part 2, a stark-skills PR — **until that lands the automated path is still ungated.** Pinned by `engine/cmd/stark/coverage_gate_test.go`, which runs the real script (including the exact v0.31.2 orphan state) rather than a copy of its logic.

### Fixed
- **The coverage gate no longer reports `clean` over a tree it read nothing from.** An unmatched `skill/*/` glob (an empty or restructured stark-skills checkout) left the literal pattern in the loop variable, which carries no `SKILL.md`, so it fell through the fail-OPEN "not a skill" skip and the gate printed `coverage gate clean … (not checked, no SKILL.md: *)` and exited 0. The existing `-d "$STARK_SKILLS/skill"` check only catches a *missing* checkout; a false green here is indistinguishable from success, which is the one thing a gate must never do.
- **An unreadable catalog now names itself instead of aborting silently.** The membership parse passed the bare `catalog/*/bundle.yaml` glob to awk, so an unmatched glob (wrong `$REPO_ROOT`, sparse checkout, renamed dir) handed awk a literal path it could not open: `2>/dev/null` ate the only diagnostic and `set -e -o pipefail` killed the script at **exit 2 having printed nothing**, with the "blame the parser, not the catalog" guard written for exactly this case unreachable. The manifests are collected and counted before parsing, every non-zero exit now carries an `ERROR:` prefix, and the script's documented exit contract covers the could-not-run paths.

## [0.32.0] - 2026-09-19

### Added
- **`agnes` ships in the `stark-ops` bundle (`0.16.14 → 0.17.0`, STARK-6249).** stark-skills STARK-6182 added `skill/agnes/SKILL.md` alongside the shared `standards/worker-spine.md` + `standards/stand-down.md`, and bifrost 0.31.2 published *those two docs* — `worker-spine.md` line 4 already reads "/minion (led by Gru) and /agnes (unattended, no leader) both execute this doc" — while `catalog/stark-ops/bundle.yaml`'s hand-authored `skills:` manifest never listed `agnes`. `stark sync` only pulls declared members, so the skill itself shipped nowhere: no `catalog/stark-ops/skills/agnes.md`, no `dist/claude/stark-ops/skills/agnes/`, no `dist/codex-plugins/stark-ops/skills/agnes/`. An operator installing `stark-ops@bifrost` got a published contract naming a skill the same release did not carry. A membership add is a MINOR per the semver policy, so root `VERSION` takes a MINOR too.

### Changed
- `stark-ops`'s description now names the solo unattended worker, so the bundle copy on the marketplace card, both plugin manifests and the web registry match what the bundle actually contains.
- `docs/scripts/publish.sh` ends with a **release-notes gate**. The script bumps `VERSION`, and a `VERSION` bump on `main` is what makes `sign-manifest` cut `v<VERSION>` and a signed GitHub Release — but it never wrote (or asked for) the `## [<VERSION>]` section that release's body is read from, and the extractor falls back to the bare string "Release <VERSION>." rather than failing. The omission had already shipped once: 0.31.0's own commit message records that "CHANGELOG gained the `## [0.31.0]` section the manual publish path doesn't write". The gate reads the section with `sign-manifest.yml`'s own line-anchored awk rather than a `grep -F` lookalike that a prose mention of the heading would satisfy, and drops the heading from the captured text so an empty section fails too. It runs last, after the regen is drift-clean: add the section and commit, do NOT re-run the script — the `VERSION` bump is not idempotent.
- `docs/scripts/publish.sh` now also asserts `VERSION` actually changed after its bump. `bump` only rewrites a line that is exactly `X.Y.Z` and is silent otherwise, so a `v`-prefixed or commented `VERSION` previously left the run green while `sign-manifest` skipped the already-existing tag — new content on `main`, no release, no alarm.


## [0.31.3] - 2026-09-19

### Changed
- Refresh marketplace packages from [stark-skills@ccb955b](https://github.com/21StarkCom/stark-skills/commit/ccb955b76ab7d8ab5c90f1e2ed020fafefe9eac3).

## [0.31.2] - 2026-09-19

### Changed
- Refresh marketplace packages from [stark-skills@e82ac14](https://github.com/21StarkCom/stark-skills/commit/e82ac149ba67ef547947fafa4b94278c4b338161).

### Fixed
- **`publish-sync-pr` fails closed when the attestation predicate itself is broken (STARK-6208).** `completed_review` returned jq's exit status raw and the callers read every non-`2` status as "not attested", which exits **green** on purpose so an ordinary review comment doesn't redden the sync PR. But `jq -e` exits `1` only for a false/null *result*: `2` is a usage/system error, `3` a compile error, `4` "no valid result was ever produced" (what an empty `gh` stdout yields), `5` a runtime error, and `127` means jq is not installed. A typo in the predicate — or a payload shape it can't handle, such as the `body: null` GitHub really sends, which aborts with `5` the moment the `// ""` guard is dropped — was therefore indistinguishable from "nobody attested": publication would have stopped forever, every run green, no alarm anywhere. That is the same silent stall the 20-minute window was replaced to end, except the window at least went red. The check now has **three** outcomes, never two — `0` attested, `1` not attested, `2` could-not-tell — and both could-not-tell causes (an unreadable reviews API, a predicate that returns no verdict) name themselves on stderr and take the existing fail-closed path. Pinned by `TestPublisherFailsClosedWhenThePredicateReturnsNoVerdict`, which runs the workflow's real `completed_review` against stubbed `gh`/`jq` exit codes.
- The same conflation is gone from two neighbouring guards in that job. `head` is now shape-checked like `$PR` already was, because `jq -r` prints the literal string `null` for a missing field and exits `0` — a malformed `gh pr view` snapshot would have matched no review and exited green with "nothing to publish". And the required-check-count loop no longer folds `gh pr checks`' documented exit `8` ("checks pending" — the normal state there) into the count via `|| echo 0`, which appended a second line to a perfectly good number and made `[ "$count" -gt 0 ]` an integer-expression error that never broke the loop.

## [0.31.1] - 2026-09-19

### Added
<!-- idun:pr-merge pr=277 runId=277 sha=48fcd571 -->
- Added a Go test suite that runs the publisher's attestation predicate through real jq, pinning every acceptance/rejection case and load-bearing merge invocation detail.
- **The `auto/marketplace-sync` PR now publishes on the operator's attestation event instead of inside a 20-minute window (STARK-6208).** New `.github/workflows/publish-sync-pr.yml` fires on `pull_request_review: [submitted]` — not `pull_request`, so `ci` remains the only `pull_request` workflow and no required context is added — and merges once the attestation verifies. The gate itself is byte-for-byte the one it replaces: same author, same `<!-- stark-code-review:complete -->` marker alone on line 1, same `/code-review xhigh --fix` requirement, same exact-head binding, same CRLF normalization, same latest-submitted-review-wins, same pre-merge recheck, same `--match-head-commit`. A review that is not an attestation exits green having merged nothing. Publication had been failing for six consecutive runs: four expired the in-run window and two were killed at 6 and 9 minutes by `marketplace-sync`'s `cancel-in-progress` when the next stark-skills merge landed, stranding every regeneration since `e5d2441`. Three things the event shape forces that the polled design did not need: the job sets `GH_REPO` because it never checks out and `gh` resolves repositories from git remotes rather than `GITHUB_REPOSITORY`; it watches `gh pr checks --required` because a `pull_request_review` run attaches its own check run to the PR head and an unfiltered `--watch` would wait on itself until the job timeout; and it refuses a cross-repository head, since `pull_request_review` fires for fork PRs and `headRefName` carries no owner.
- `sign-manifest` accepts `workflow_dispatch`, and `publish-sync-pr` dispatches it after merging. A squash push made with `GITHUB_TOKEN` starts no `push` workflow run under GitHub's anti-loop guard — the same guard `sign-manifest.yml` already names for tag pushes — so without this a published sync would land on `main` unsigned, untagged and unreleased. The old path only signed because the merge came from stark-skills' `stark-meridian-ci` App token. Idempotent per-SHA, and the OIDC cert subject is the workflow path @ ref on either trigger.

### Changed
- Refresh marketplace packages from [stark-skills@22e14a2](https://github.com/21StarkCom/stark-skills/commit/22e14a2af0e6d5016d306d6c6d8e83ed781fd1e0).

## [0.31.0] - 2026-09-19

### Changed
- Refresh marketplace packages from [stark-skills@2a35a6e](https://github.com/21StarkCom/stark-skills/commit/2a35a6e0821a9da22b7abc3945187fd53644c1a5) — the head of [stark-skills#1002](https://github.com/21StarkCom/stark-skills/pull/1002), landed here first because `stark sync` treats a bundle member with no source as a hard error. It also carries the two commits `main` had not published yet: STARK-6091 (Gru is a protocol over alfred + Hermod; `gru/references/` is gone) and STARK-5637.

### Removed
- **`stark-review`** and **`stark-review-improvement`** from the **stark-analyze** bundle (`0.5.57 → 0.6.0`, STARK-6099). Both were buried upstream (STARK-6098; nastrond grave `graves/stark-skills/stark-review`). The vendored snapshot drops `stark_review*.ts`, the review worktree tools, the per-agent review prompt corpus and the triage prompts from every dist tree, and keeps the two survivor libraries `finding_lib.ts` + `review_post_lib.ts`. The bundle description no longer claims spec authoring, red-teaming, or review-prompt improvement, and the `red-team` tag is gone.

### Fixed
- **Two engine tests no longer pin stark-skills internals, so an upstream deletion cannot redden a correct publish.** `TestCodexPluginConfigDoesNotClobberShared` probed the installed `config.json` for the `"domain_agents"` key, which STARK-6098 removed with the review config; it now compares the installed file byte-for-byte with the committed source it must come from (the bundle's Codex overlay, else the shared snapshot). `TestInstalledRootedSkillSupportRef` was anchored to `gru/references/operations.md`, which STARK-6091 deleted — that alone kept the auto-sync bifrost#267 red; it now discovers a sibling support file from the installed tree and fails loudly if there is none. Both are mutation-checked (wrong source file; a resolver that never reports dangling).

## [0.30.8] - 2026-09-18

### Changed
- Refresh marketplace packages from [stark-skills@be032b7](https://github.com/21StarkCom/stark-skills/commit/be032b71ad9e7d94474103ec7205772819924fc3).

## [0.30.7] - 2026-09-18

### Added
<!-- idun:pr-merge pr=265 runId=265 sha=f4475de5 -->
- Refiled 13 already-shipped `[Unreleased]` CHANGELOG bullets under the version headings that actually shipped them, creating 10 missing sections.

### Changed
- Refresh marketplace packages from [stark-skills@2a593fd](https://github.com/21StarkCom/stark-skills/commit/2a593fde35d17cd95988f12684df1bd691b29fc5).

### Fixed
- Preserve complete rooted and parent-relative support references in the Codex native-contract check (STARK-5068), including `${VAR}/skills/<name>/…`, the standalone adapter's `../../skills/<name>/…` path, and `../references/…`. Resolve variable roots against the install under test and report the full dangling path even when the citing skill carries a same-named file. The root grammar covers every spelling the Codex targets actually emit — the standalone `${STARK_PLUGIN_ROOT:-$HOME/…}`, the native plugin's required-root `${STARK_PLUGIN_ROOT:?resolve…}` (the only form `dist/codex-plugins/` carries), the overlay's nested `${STARK_ASSET_ROOT:-${STARK_PLUGIN_ROOT:?…}}`, and the preamble's own `${SKILL_DIR}` — from one shared pattern, so the extractor and the resolver cannot disagree about where a root ends. `cross-skill` vs `skill-local` is now decided by where the reference RESOLVES rather than by its leading characters, and the install root comes from `codex.AssetsRoot` instead of a second spelling of `.agents/stark/<bundle>`. Both committed plugin corpora retain identical extraction; bundle-only roots such as `standards/` remain in the separate bundle-asset check.

## [0.30.6] - 2026-09-17

### Changed
- Refresh marketplace packages from [stark-skills@4f2c161](https://github.com/21StarkCom/stark-skills/commit/4f2c1612cad852f25bce5f508403cccb6c9a6ed7).

### Fixed
- **A skill citing a sibling skill's support file no longer fails the Codex native contract (STARK-5065).** `skillSupportRefRe` in `engine/cmd/stark/codex_compliance_test.go` was unanchored, so in `../gru/references/operations.md#deterministic-re-brief-check` it matched only the `references/operations.md` tail — the `../gru/` prefix dropped, the scan stopping at `#` because neither character is in its class. Line 196 then resolved that fragment against the CITING skill's directory and reported `dangling skill-local support reference` for a path nobody wrote. Skills of one bundle install side by side under `skills/`, so the citation was correct: at the blocked sync head `3dc9afeb`, `skills/gru/references/operations.md` (38291 bytes) sits beside `skills/minion/SKILL.md`. The reference is now matched as written and resolved from the skill directory, and a dangling one that leaves the skill is reported as `cross-skill` rather than `skill-local`. A `../` run was REQUIRED before the sibling segment as this landed: admitting a bare segment head instead traded one false report for another, reading `$SKILL_DIR/scripts/gha-cost-breakdown.sh` as `SKILL_DIR/scripts/…` and failing a script `stark-gha-cost` actually ships (measured). **That head requirement was superseded after this release by STARK-5068 (#262, unreleased)**, which admits a braced `${VAR}/` root as a second head spelling; a bare segment head is still rejected, for the reason measured here. Extraction is now a `skillSupportRefs` helper with its own table test plus a resolution test over a real two-skill tree; the fix is mutation-checked three ways (original regex, over-wide head, missing punctuation trim). **Impact:** `marketplace-sync` had a valid operator attestation on bifrost#260's exact head and four of five checks green, un-drafted the PR, then aborted on this test — stark-skills#989 (STARK-5046) merged to `main` but never published, leaving every install on the old `/minion`.

## [0.30.5] - 2026-09-17

### Changed
- Refresh marketplace packages from [stark-skills@7d08799](https://github.com/21StarkCom/stark-skills/commit/7d08799202c032d067deed930ec1a7830c5bf728).

## [0.30.4] - 2026-09-17

### Changed
- Refresh marketplace packages from [stark-skills@56786d7](https://github.com/21StarkCom/stark-skills/commit/56786d7ad433402bad4cad3eb1e50cf6cc7d0fbb).

## [0.30.3] - 2026-09-17

### Changed
- Refresh marketplace packages from [stark-skills@0a509b2](https://github.com/21StarkCom/stark-skills/commit/0a509b2133491a660fb1e8b8801256e95345595d).

## [0.30.2] - 2026-09-17

### Changed
- Refresh marketplace packages from [stark-skills@4161cb0](https://github.com/21StarkCom/stark-skills/commit/4161cb0724e3893b220bc4efd8b5a678e8b76dc8).

## [0.30.1] - 2026-09-17

### Changed
- Refresh marketplace packages from [stark-skills@c706467](https://github.com/21StarkCom/stark-skills/commit/c70646728a5f6878a274df4923d1a8e30ff1db17).

## [0.30.0] - 2026-09-17

### Removed
- `stark-plan` no longer ships the `simple-gate` skill (STARK-5016, stark-skills PR #974). Skill removal is a MINOR bump: `stark-plan` 0.4.28 → 0.5.0, root 0.29.2 → 0.30.0. Installed copies keep serving it until `/plugin update stark-plan@bifrost`. Regenerated from `stark-skills#974`'s head (`b583950`, unmerged at publish) because `stark sync` fails closed on a member that no longer exists upstream, so this side had to land first. Until #974 merges, `stark sync --check` against stark-skills `main` drifts on `catalog/stark-plan/skills/stark-author.md` (main still offers the removed skill), and any other stark-skills push would auto-sync that text back — land #974 immediately behind this release.

## [0.29.2] - 2026-09-16

### Changed
- Refresh marketplace packages from [stark-skills@8bfa0d1](https://github.com/21StarkCom/stark-skills/commit/8bfa0d1049012d0e3f8ecd70e317bea07598577f). All seven bundles patch-bumped: the shared `vendor/stark-skills/` snapshot changed, and `check-bumps` charges it to every bundle that vendors it (0.28.1). Beyond the refresh:
  - `self_healer_lib.ts`'s header gate ladder no longer describes the order the code had BEFORE the `refresh_token` refusal moved behind the effective-mode downgrade, and no longer claims an authentication pattern "never spends a guard command" — in suggest mode it now does.
  - Gru's `verifyBlocker` no longer names `reserve` as the repair for a `stopped` task, in either its message or its JSDoc. `readyReason` refuses every phase except `pending`, so prescribing it handed the operator a command that throws.
  - `copilot_land --lead ""` no longer echoes a blank agent into the `--dry-run` plan.

## [0.29.1] - 2026-09-16

### Changed
- Refresh marketplace packages from [stark-skills@560092a](https://github.com/21StarkCom/stark-skills/commit/560092adc41221dba3c345362730bed9f53e43da). `stark-ops` 0.16.0 → 0.16.1. Beyond the routine refresh this carries one POLICY change that reaches every Claude and Codex install on `/plugin update`:
  - **Merging a reviewed PR no longer needs the operator's approval**, in both the Gru and Minion skills and their Codex overrides. The previous wording — "publishing, live infrastructure, destructive teardown and authentication retain their direct operator gates" — was read as gating any merge that fires an automated release, which held green reviewed work waiting on an approval the rules never required. The review gate is now stated as the only gate before a merge. DIRECT publish, infrastructure, auth and destructive actions stay gated: a hand-cut release, `terraform apply`, dropping live data, deleting secrets. A peer relaying operator approval still cannot supply it.

## [0.29.0] - 2026-09-16

### Changed
- Renamed the `team-minion-agent` skill to `minion` in `stark-ops` membership, following the stark-skills rename (STARK-4987, upstream `stark-skills#967`, merged as [`0b392a0`](https://github.com/21StarkCom/stark-skills/commit/0b392a0369f3066be538bbb58ea10de4f62f317d)). This completes the pair 0.28.0 left deliberately asymmetric — `gru` next to `team-minion-agent`. `stark sync`'s `importSkills` is fail-closed on an unknown member (`os.Stat` on `<from>/skill/<name>/SKILL.md`, hard error on ENOENT), so the two repos had to land **in that order — `stark-skills#967` first, this second**. Measured in the other order: `generate stark-ops: skill "minion": not found under <from>/skill` → `error: sync failed`, exit 1, which under `marketplace-sync.yml`'s `set -euo pipefail` blocks every other pending upstream change and not just this skill's. Nothing in bifrost CI catches it — the cross-repo `sync --check` is not one of `ci.yml`'s five jobs. `stark-ops` 0.14.0 → 0.16.0 and root `VERSION` 0.28.1 → 0.29.0 (remove + add are each a minor under `publish.sh`'s policy). Installed plugins keep serving `/team-minion-agent` until `/plugin update`; after it, only `/minion` resolves. No alias, shim, or fallback string — the same accepted consequence as the leader rename.
- Refresh marketplace packages from [stark-skills@0b392a0](https://github.com/21StarkCom/stark-skills/commit/0b392a0369f3066be538bbb58ea10de4f62f317d). The sync is cumulative over `2a57ec6..0b392a0`, so beyond the rename it also ships STARK-4985's `tools/` fixes:
  - `copilot_land.ts` (and its Codex mirror) no longer presents the buried `/stark-copilot` as its live calling command; the header and `--help` now name `/stark-build` Phase 1. That text vendors into every bundle on both runtimes, so installed plugins were teaching agents a dead command.
  - `copilot_land land` validates `--body`, documented required and never checked — omitting it opened a REAL PR with an empty description that no re-run undoes.
  - `self_healer`'s authentication refusal is gated on the EFFECTIVE mode, so a `refresh_token` pattern returns `suggested` again in suggest mode instead of pinning `healer_canary`'s promotion history at zero; `healer_canary` now refuses to promote such a pattern explicitly.
  - Gru's `verifyBlocker` names `integrate` for a task in phase `review` on both paths, and `complete()` clears `stoppedFrom` when it settles a frozen integration.
- Patch-bumped the other six bundles — `stark-analyze` 0.5.47, `stark-constitution` 0.2.57, `stark-design` 0.1.15, `stark-implement` 0.4.51, `stark-plan` 0.4.26, `stark-write` 0.5.35. The shared `vendor/stark-skills/` snapshot vendors into EVERY bundle's `dist/*/tools/`, so all seven dist trees carry changed bytes. **This is the first publish where the gate derived those bumps instead of a human.** STARK-4986 landed one commit earlier (`8439b11`), and `publish.sh`'s auto-bump loop caught all six on round 1: `content changed in: stark-analyze stark-constitution stark-design stark-implement stark-plan stark-write`. The set and every resulting version match, to the byte, the hand analysis done against the old gate — which had printed `OK: no un-bumped source changes` over the same six.

### Fixed
- `publish.sh`'s coverage gate no longer ignores skills outside the `stark-` prefix. Both halves of it were prefix-scoped — it iterated `$STARK_SKILLS/skill/stark-*/` and built `claimed` from a `grep -E '^\s*-\s+stark-'` — so `gru`, `simple-gate` and now `minion` were never checked at all. Dropping any of them from a `bundle.yaml` printed `coverage gate clean` while `stark sync` silently stopped pulling the skill and it vanished from the marketplace with no error, which is the exact papercut the gate was added to stop. It now walks every `skill/*/` carrying a `SKILL.md` (so non-skill dirs like `evals/` stay excluded) and reads membership from each `bundle.yaml`'s `skills:` block with awk rather than grepping `- stark-` lines, since an unprefixed name would otherwise collide with the `tags:` and `runtimes:` list items. Also removed the stale `EXCLUDED_SKILLS=(stark-voice)`: stark-voice IS published, as a member of `catalog/stark-write/bundle.yaml`, so the entry was dead config ready to mask a real orphan the day it left that bundle. Verified by running the rewritten gate against the real catalog and a real stark-skills checkout — 27 claimed including `gru`, `minion` and `simple-gate`, zero orphans. bifrost CI never runs `publish.sh`, so no gate would have caught this (STARK-4987).

## [0.28.1] - 2026-09-16

### Added
- Document the `main` required-status-checks contract (STARK-4989): new `docs/operations/branch-protection.md` names the five `ci.yml` contexts, carries the operator-only ruleset APPLY command, and records the draft-skip-guard trap; `SECURITY.md` §5 now states the measured gap between documented and live protection, and CLAUDE.md / AGENTS.md point at the contract.

### Changed
<!-- idun:pr-merge pr=245 runId=245 -->
- Removed the duplicate `[Unreleased]` CHANGELOG bullet for the already-released v0.28.0 rename; the `[0.28.0]` entry is the sole record.

### Fixed
- `check-bumps` now digests the shared `vendor/stark-skills/` snapshot per bundle (`index.json` gains a `sharedAssets` row per bundle, mirroring `pluginAssets`), so a stark-skills change to a top-level tool fails the gate naming every bundle instead of reporting `OK: no un-bumped source changes`. `stark build` vendors that one snapshot into EVERY `dist/claude/<bundle>/`, so previously a single shared-asset edit shipped seven changed dist trees under six unchanged versions — two different byte trees claiming one version, and `/plugin update` a silent no-op for anyone already on it. Measured live on PR #244; a code review caught it, the gate did not. Violation lines keep the `  - <bundle>/…` shape `docs/scripts/publish.sh` parses to auto patch-bump, pinned by a test that runs the real script's real parser over real gate output. Indexes published before this field carry no rows and simply skip the gate for one publish (STARK-4986).
- Closed the same hole for `vendor/runtime-overrides/codex/<bundle>` (`index.json` gains `codexAssets`). That overlay ships inside the committed `dist/codex-plugins/<bundle>/` package and was covered by neither the artifact digests nor the shared/plugin rows, so an overlay edit shipped changed bytes to Codex installs under an unchanged bundle version — the same defect the shared snapshot had, found by the review of this change. Six bundles, 173 files, were ungated. The generating rule is now written down: every vendored tree `stark build` ships needs a digest row the day it starts shipping (STARK-4986).

## [0.28.0] - 2026-09-16

### Changed
- Renamed the `team-leader-agent` skill to `gru` in `stark-ops` membership, following the stark-skills rename (STARK-4968). `stark sync` is fail-closed on an unknown member, so this had to land or every `marketplace-sync` run would die at the import step — not just this skill's. `stark-ops` 0.12.4 → 0.14.0 and root `VERSION` 0.27.7 → 0.28.0 (remove + add are each a minor under `publish.sh`'s policy). Installed plugins keep serving `/team-leader-agent` until `/plugin update`; after it, only `/gru` resolves. `team-minion-agent` is unchanged, so the pair is deliberately asymmetric.
- Refresh marketplace packages from [stark-skills@2a57ec6](https://github.com/21StarkCom/stark-skills/commit/2a57ec6). The sync is cumulative over `a835cff..2a57ec6`, so beyond the rename it also ships:
  - `gru resume --limits-file <path>` — an INCOMING leader may replace operating limits that a leadership transfer left stale (`packet` copies `limits` verbatim, so an entry naming the previous leader or holding a finished phase outlives its author). Operator-authored only; a sitting leader is refused, the replacement is revalidated like `init`, both the old and new arrays are recorded on the `resumed` event, and the flag is rejected on every other verb rather than silently ignored.
  - `gru verify` / `complete` / `verifyCompletion` now share one `verificationReady` predicate. An inherited merge grant is settleable only before a replacement attaches, or while this task's own integration is live or frozen — never during an unsettled reconnect or while an attached replacement holds the task. `verify` also names the command that actually repairs the refusal instead of always suggesting `integrate`.
  - `copilot_land land --lead NAME` is documented as inert: accepted for caller compatibility, echoed only by `--dry-run`, and selecting nothing.
  - `self_healer` refuses the `refresh_token` action up front (`status: "skipped"`, `reason: "operator_action_required"`) before any guard command, verify command, session budget, or circuit-breaker accounting. The vestigial `ExecutionOutcome.success` field is gone; `verify_passed` is the sole outcome signal and `max_per_session` now counts attempts.
- Patch-bumped the other six bundles — `stark-analyze` 0.5.46, `stark-constitution` 0.2.56, `stark-design` 0.1.14, `stark-implement` 0.4.50, `stark-plan` 0.4.25, `stark-write` 0.5.34. The shared `vendor/stark-skills/` snapshot feeds every bundle's vendored `tools/`, so all seven dist trees changed, not just `stark-ops`'. `check-bumps` digests artifact sources plus `vendor/plugins/<bundle>` and never the shared snapshot, so it reports clean here — the six would otherwise have shipped changed content under an unchanged version, and `/plugin update` would have been a no-op for anyone already on them.

## [0.27.7] - 2026-09-15

### Changed
- Refresh marketplace packages from [stark-skills@a835cff](https://github.com/21StarkCom/stark-skills/commit/a835cff28412423198d7c957f7246a557bccd122).

## [0.27.6] - 2026-09-15

### Changed
- Refresh marketplace packages from [stark-skills@b4d4f2c](https://github.com/21StarkCom/stark-skills/commit/b4d4f2c0ab389b28a87943386f5addb05cee391c).

## [0.27.5] - 2026-09-15

### Changed
- Refresh marketplace packages from [stark-skills@a89f3c2](https://github.com/21StarkCom/stark-skills/commit/a89f3c2773a5f8d0e038dfaa600d4b01912978a5).
- Notes restored retrospectively. PR #240 merged without a posted pre-merge review; latest Gru acceptance remains pending.

## [0.27.4] - 2026-09-15

### Fixed
- Republish the audited native Codex packages with a fresh cache version after the 0.27.3 automation merged before its required review. The full retrospective findings are recorded on #238; this follow-up completes review before merge.
- Record accurate 0.27.3 release notes, including the distinction between runtime fixes and skill instructions. Live Gru acceptance remains in progress (STARK-4919).

## [0.27.3] - 2026-09-15

### Fixed
- Publish stark-skills v0.11.1: scope native Gru discovery to the recorded provider, preserve ownership on same-session resume, and prevent stale records from hiding a live previous leader.
- Instruct native Codex leaders and Minions to end waiting turns so Hermod can deliver queued reports. Instruct Minions and Gru to validate reviewer-applied fixes and merge only the reviewed head.
- Refresh all seven Claude bundles and all six native Codex packages. Live acceptance remains in progress; these changes address the first observed attachment blocker (STARK-4919, #238).

### Not covered
- Review audit: automation merged #238 before its required code review. The retrospective review is recorded on #238. 0.27.4 is the reviewed follow-up.

## [0.27.2] — 2026-09-15

### Added
- Rework `team-leader-agent` and `team-minion-agent` into Gru's leader and Minion skills, and package Gru's durable coordination tools (`gru.ts`), operating instructions, and research for Claude Code and native Codex (STARK-4919, #237).

### Changed
- Review posting uses the existing operator GitHub login. Model attribution remains in review text; retired review App authentication and key references are removed from both runtimes.
- Require Node ≥ 24 for native TypeScript and SQLite tooling; `stark doctor` now enforces the supported runtime.

### Removed
- Retired `stark-housekeeping` from `stark-ops` so source synchronization succeeds; `stark-ops` minor-bumped for the membership change.

### Fixed
- Package reviewed fixes for PR-head fetching, disposable verification checkout cleanup, and late worker attachment during cancellation.
- Normalize equivalent worker paths during retirement and preserve credential filtering in Codex-dispatched Gemini environments.

### Not covered
- Gru's live Codex leader/Minions evaluation remains incomplete pending Hermod STARK-4911. This release does not claim live native parity.

## [0.26.1] - 2026-09-05

### Changed
<!-- stark-gh:pr-merge pr=228 runId=228 -->
- Updated docs (AGENTS.md, CLAUDE.md, README.md, native-install-loop.md) to retire stark-gh examples and clarify no bundle is plugin-backed or gemini-targeted today.

## [0.26.0] - 2026-09-03

### Added
<!-- stark-gh:pr-merge pr=227 runId=227 -->
- Publish `stark-memory` skill in the `stark-ops` bundle (0.10.4 → 0.11.0) for auditing and tidying Claude Code auto-memory files.

## [0.25.0] - 2026-09-02

### Removed
- Retired `stark-gh-user` from `stark-ops`; the human-only GitHub PAT swap now belongs to `idun user` / `idun user gh` (STARK-2215). `stark-ops` and root `VERSION` minor-bumped for the membership change.

## [0.23.0] - 2026-08-31

### Removed
- Unpublish the `stark-brain` bundle (the Atlas `brain` MCP server), reversing its earlier addition. Its only consumer was this plugin; the Atlas engine keeps vault reach over its CLI. Root `VERSION` minor-bumped for the membership change.

## [0.20.2] - 2026-08-29

### Added
<!-- stark-gh:pr-merge pr=207 runId=044dacbb-5bef-42dd-8e7d-16e9e1c14290 -->
- Add the beta `stark-design` bundle with reusable design-token architecture, theming, accessibility, distribution, and versioning guidance.

## [0.20.0] - 2026-08-28

### Removed
<!-- stark-gh:pr-merge pr=205 runId=abe5b9b1-1c62-43bc-85af-205fd049fd75 -->
- Retired `stark-cc-user` from `stark-ops`; Claude Code account switching now belongs to Idun CC.

## [0.19.3] - 2026-08-27

### Fixed
<!-- stark-gh:pr-merge pr=202 runId=49d6b13d-c855-4c7b-ad66-1579d33260b7 -->
- Scope entropy exemptions to lockfile content while retaining credential detection and full-strength scanning for commit and PR prose.

## [0.19.1] - 2026-08-24

### Changed
<!-- stark-gh:pr-merge pr=198 runId=12ade727-0eb7-46d7-b653-09bafa778a6a -->
- Removed retired private-directory references from documentation and secret-file lint rules.

## [0.19.0] - 2026-08-24

### Fixed
<!-- stark-gh:pr-merge pr=197 runId=c5d7811a-fcfa-4dfe-b61b-dd6ff2336977 -->
- Unblocked native marketplace publication and packaged `stark-brain` as an Atlas MCP integration without restoring the retired `remember` skill.

## [0.18.9] - 2026-08-24

### Added
<!-- stark-gh:pr-merge pr=196 runId=c1422f87-9818-4484-94b7-36bd3219bffb -->
- Publish native Codex skills for `stark-bury`, `stark-handoff`, and `simple-gate`.

## [0.15.2] — 2026-08-05

### Fixed
- Isolated native Codex runtime assets and mutable state from Claude: packaged
  assets resolve through `STARK_ASSET_ROOT`, while sessions, reviews, healer
  state, alerts, and housekeeping use `STARK_STATE_ROOT` under `~/.stark`.
- Rewrote known native skill references to Codex `$skill-name` invocation syntax
  in generated skill and plugin metadata without changing canonical Claude
  descriptions or generated Claude artifacts.
- Made Codex housekeeping operate only on Codex-owned state, preserve existing
  monthly archives, and safely archive repository filenames that resemble
  command-line options.

## [0.15.1] — 2026-08-05

### Fixed
- Restored the canonical Claude skill and command sources after the 0.15.0
  cross-runtime rewrite. Codex compatibility now lives in source-owned runtime
  overlays, and regression coverage proves those overlays cannot change
  `dist/claude/`, the Claude marketplace, bundle digests, or `index.json`.
- Added a native Codex repository marketplace with all eight 21 Stark plugins
  and all 30 skills. The three `stark-gh` commands are native skills, so
  `$cleanup` and `$pr-merge` are no longer lost to the legacy 4 KB command
  migration limit.
- Native Codex skills now resolve packaged assets from their loaded plugin
  location and fail closed when that location is unavailable, avoiding stale
  standalone-install fallbacks.
- Codex `$cleanup --dry-run` no longer fetches or prunes refs, merged branches
  with unique local commits require explicit `--force`, and GitHub workflow
  state defaults to the runtime-neutral `~/.stark/code-review` tree.

## [0.15.0] — 2026-08-05

### Added
- **Native Codex skill metadata.** `codex@3` emits
  `.agents/skills/<name>/agents/openai.yaml` with a normalized display name,
  25–64 character short description, and
  `policy.allow_implicit_invocation: false` for every explicit-only skill and
  command.
- **Install-level Codex contract coverage.** A dynamic test derives every
  committed Codex artifact from the index, installs every production bundle,
  and verifies exact inventory, frontmatter, metadata policy, support files,
  placeholder removal, and local-reference closure.
- `stark-voice` joins `stark-write`; all 27 canonical skills and the three
  `stark-gh` commands are now covered by the native Codex audit.

### Changed
- Codex no longer fabricates a model mapping for Claude model hints. Unsupported
  per-skill `model` metadata is dropped, while `disable-model-invocation` is
  derived into native Codex policy. Canonical skill `argument-hint` values are
  preserved as body-level usage prose.
- Per-skill support content now uses the standard `references/`, `scripts/`, and
  `assets/` directories. Shared persona data is vendored for installed persona
  and session flows; private `.remember` state is excluded from snapshots.
- Codex MCP configuration now installs to `.codex/config.toml`; stdio secret
  names render as sorted `env_vars` forwarding rather than literal
  `${ENV_KEY}` values. HTTP MCP entries reject ambiguous canonical `env`
  credentials instead of emitting stdio-only fields; native bearer/header
  credential shapes must be modeled explicitly before they can be rendered.
- The stark-skills source was audited for cross-runtime invocation, asset
  resolution, shell-state isolation, read-only defaults, explicit external
  side effects, runner sandboxing, and secret-safe GitHub identity switching.
  Terraform/Terragrunt provider dispatch, scanner execution, `.tfvars`
  inclusion, and posting now have separate consent gates.

### Removed
- The curated `stark-gh` MCP fragment that referenced the nonexistent
  `gh-mcp-server.js`. The bundle intentionally ships its three native commands;
  no broken MCP server is advertised.

### Fixed
- GitHub Actions cost probes no longer require Python, round billing per job,
  and account for Linux, Windows, and macOS multipliers.
- Jury, persona, session, handover, release, review, build, documentation, and
  GitHub command skills now resolve installed assets and support files in both
  source and native Codex layouts without `$ARGUMENTS` or persistent-shell
  assumptions.

## [0.14.0] — 2026-08-05

### Fixed — Codex installs were shipping dangling asset references
- **All 29 artifacts were broken on Codex.** `stark build` vendors the stark-skills snapshot (`tools/`, `standards/`, `prompts/`, `scripts/`, `config.json`) into every `dist/claude/<bundle>/`, but `stark install --runtime codex` wrote `SKILL.md` files and nothing else. Every one of them referenced assets that were never installed — 19 via `${CLAUDE_PLUGIN_ROOT}` (unset on Codex) and 26 via `../../standards/help.md`-style relative paths. Skills installed and were discoverable; anything that shelled a tool or followed a standard died.
- **`stark install --runtime codex` now vendors the same assets**, per bundle: `.agents/stark/<bundle>/{tools,standards,prompts,scripts,config.json}`, with each skill's own `references/` kept next to it at `.agents/skills/<name>/references/`. The assets root is per bundle, not shared — `stark-gh`'s `config.json` would otherwise clobber the shared snapshot's.
- **Codex target `codex@1` → `codex@2`**: rendered bodies are retargeted onto that tree — `${CLAUDE_PLUGIN_ROOT…}` → `${STARK_PLUGIN_ROOT:-$HOME/.agents/stark/<bundle>}`, `${CLAUDE_PLUGIN_ROOT}/skills/<name>/…` → the `.agents/skills/` root, and any leading `../` run before `{tools,standards,prompts,scripts}/` → `../../stark/<bundle>/…`.

### Fixed — review findings on the codex@2 vendoring (same PR)
- **Vendored tools resolved their assets to the wrong root.** A retargeted body ran `node …/tools/x.ts`, but the tool's own `assetRoot()` (`STARK_ASSET_ROOT` > `CLAUDE_PLUGIN_ROOT` > `~/.claude/code-review`) read `config.json`/`prompts`/`standards`/sibling-tools from the Claude-only `~/.claude/code-review` — a path a Codex install never creates. Tool invocations now carry an inline `STARK_ASSET_ROOT="${STARK_PLUGIN_ROOT:-…}"` export (inherited by the whole process tree), so the tools are actually self-contained.
- **The live gate now runs a tool** (`asset_root_lib` resolution under the installed tree), not just `os.Stat` of paths named in `SKILL.md` — the previous check was false-green against the resolution bug above.
- **Project-local install** (`--dest` ≠ `$HOME`) now **warns** and prints the `STARK_PLUGIN_ROOT`/`STARK_ASSET_ROOT` exports to set, instead of silently dangling on the baked `$HOME` fallback.
- **A stale unmanaged file under `.agents/stark/<bundle>/` no longer aborts the whole install** — the installer-owned asset step is exempt from the unmanaged-collision preflight and overwrites (still journaled + removable).
- **`--assets-source`/`--plugin-assets` validate:** an explicit non-existent path is a hard error (was a silent asset-less install), and an explicit empty value disables vendoring (was overridden back to the default).
- **An mcp-only install no longer over-vendors** the bundle's ~150-file asset tree — vendoring runs only for asset-consuming artifacts (skill/command/prompt/agent).
- **Executable vendored assets are consented:** `tools/*.ts` + `scripts/*.sh` set `Consent.Required` and list under `Consent.AssetExec` (§9.3) even when the bundle ships no mcp/agent.
- **Retarget coverage:** command/prompt single-`../` refs, per-skill `${CLAUDE_PLUGIN_ROOT}/skills/` refs, and `${CLAUDE_PLUGIN_ROOT}`/tool refs in vendored prose markdown are now all handled.

### Added
- **`installplan.AssetProvider`** — optional adapter interface for bundle-level files that belong to no artifact. Its step is prepended (artifacts win on collision) and kept out of the artifact `ClosureRefs`; only bundles that install an asset-consuming artifact get one. It participates in the §9.3 consent gate when it carries executable code.
- `stark install --assets-source` / `--plugin-assets`, defaulting to `<repo>/vendor/stark-skills` and `<repo>/vendor/plugins` off `--catalog`'s parent.

### Not covered
- `stark install --runtime claude` still vendors nothing — its distribution path is the committed `dist/claude/` plugin tree, which already carries the assets.
- Gemini remains `stark-gh`-only (3 commands). The other 26 skills declare `[claude, codex]`; rendering them as `GEMINI.md` sentinel blocks would put ~307 KB permanently in context, so that is deliberately deferred.

## [0.8.0] — 2026-07-26

### Removed — the demolition release
- **11 skills deleted** with the stark-skills loop-machinery demolition (autopsy 2026-07-25; stark-skills #802/#803/#804, ~35k LOC): **stark-analyze** drops `stark-write-spec`, `stark-review-spec`, `stark-review-plan`, `stark-review-spec-improvement`, `stark-red-team-spec`, `stark-red-team-plan`, `stark-red-team-fold` (`0.4.2 → 0.5.0`); **stark-plan** drops `stark-spec-to-plan`, `stark-plan-to-tasks` (`0.2.2 → 0.3.0`, now carries `stark-author` alone); **stark-implement** drops `stark-phase-execute`, `stark-forge` (`0.3.2 → 0.4.0`, carries `stark-build` + `stark-copilot`).
- The two-stage pipeline is the replacement: `/stark-author` (human-gated spec+plan) → `/stark-build` (check-gated implementation). No LLM-reviews-LLM loops anywhere.

### Changed
- **stark-ops** `0.2.8 → 0.2.9` (PATCH — `stark-gh-user` prose repointed at `stark_review.ts`).
- Root `VERSION` `0.7.0 → 0.8.0` (MINOR — bundle membership changed).

## [0.7.0] — 2026-07-26

### Added
- **`stark-fresh-eyes`** skill in the **stark-analyze** bundle — one-shot zero-context review of a prompt/brief/spec/doc: a single read-only subagent re-verifies every checkable claim by a DIFFERENT method (recursive recounts, recompute from raw sources, path resolution, `--help` on cited commands) and reports defects only; the author dispositions findings once — never a round 2. Pure protocol skill, zero TS.

### Changed
- **stark-analyze** MINOR bump (membership changed); root `VERSION` `0.6.0 → 0.7.0`.

## [0.6.0] — 2026-07-25

### Added
- **`stark-author`** skill in the **stark-plan** bundle (`0.1.11 → 0.2.0`) — **Stage 1 of the two-stage rebuild**: human-gated spec+plan authoring in ONE session (tier check → time-boxed recon → structured interview → one self-contained spec+plan doc + plain-English `.human.md` sidecar → one zero-context advisory pass → 8-item human gate → `accepted-base` pin → draft PR). No LLM-reviews-LLM loop anywhere. For new work it replaces the write-spec → review-spec → red-team-spec → spec-to-plan → review-plan chain.
- **`stark-build`** skill in the **stark-implement** bundle (`0.2.0 → 0.3.0`) — **Stage 2**: autonomous implementation from an accepted stark-author spec. One fresh headless session per task, gated by checks the agent cannot edit (PreToolUse path-deny + Stop-hook gate with 7-block abort-with-deviation), commit per green task, held-out e2e gate, ONE cross-vendor advisory review whose findings die at the human. Zero new TS — protocol skill + two POSIX hook scripts.

### Changed
- **stark-plan** `0.1.11 → 0.2.0`, **stark-implement** `0.2.0 → 0.3.0` (MINOR — bundle membership changed).
- Root `VERSION` `0.5.0 → 0.6.0` (MINOR — bundle membership changed).

## [0.5.0] — 2026-07-25

### Added
- **`stark-forge`** skill in the **stark-implement** bundle (`0.1.12 → 0.2.0`) — the pipeline **conductor**. Chains the six pipeline stages (8 with `--red-team`) in-session over a crash-resumable, merge-at-artifact-boundaries state machine (`tools/forge_state{,_lib}.ts`); resolves chain/merge-points/commands and base-sync routing itself, so the skill is glue. Bundle now carries the full autonomous-execution trio: `stark-copilot` + `stark-phase-execute` + `stark-forge`.

### Changed
- **stark-implement** `0.1.12 → 0.2.0` (MINOR — bundle membership changed) — also re-renders `stark-copilot` (now lands an impl PR via `tools/copilot_land.ts` — create-or-adopt branch, push never `--force`, draft-by-default) and picks up the repo-wide `claude-opus-4-8 → claude-opus-5[1m]` default.
- Root `VERSION` `0.4.0 → 0.5.0` (MINOR — bundle membership changed).

## [0.4.0] — 2026-07-18

### Added
- **`stark-write-spec`** skill in the **stark-analyze** bundle (`0.2.0 → 0.3.0`) — contract-bounded spec authoring, pipeline stage 0 (before `/stark-review-spec`). A bounded lead/wing loop drafts and verifies a nine-section spec against a host-owned closed-enum contract; `done` is recomputed host-side. Bundle now spans spec-kit's specify + analyze phases.

### Changed
- **stark-ops** `0.2.1 → 0.2.2` — absorbs pre-existing `stark-housekeeping` source drift surfaced by a full re-sync.
- Root `VERSION` `0.3.0 → 0.4.0` (MINOR — bundle membership changed).

_Note: `0.2.x`–`0.3.0` shipped as script-based publishes after GitHub Actions were disabled for $0 spend; git tags + signed releases remain paused at v0.1.6. `/plugin` consumers read `main` directly._

## [0.1.6] — 2026-06-07

### Fixed
- Gitignore the `sign-manifest.yml` scratch files
  (`build-manifest.json{,.sig,.pem}`, `build-manifest.sha256`,
  `release-notes.md`). With the `dist/claude` collision fixed in
  v0.1.5, these untracked artifacts were the last thing keeping
  goreleaser's clean-tree check unhappy. v0.1.5 itself shipped a
  signed manifest but no binaries; v0.1.6 is the first release where
  every assertion in the plan ships without workarounds.

## [0.1.5] — 2026-06-07

### Fixed
- Root cause for the v0.1.1–v0.1.3 "git dirty state" identified and
  fixed: `goreleaser release --clean` was wiping its default `./dist`
  directory, which collides with the repo's committed `dist/claude`
  tree. `.goreleaser.yaml` now sets `dist: .goreleaser-dist`, so the
  two never touch. `--skip=validate` removed from `sign-manifest.yml`;
  the validate gate now passes legitimately.
- Diagnostic step in `sign-manifest.yml` removed (served its purpose —
  see v0.1.4 run 27098850309 in workflow history for the captured
  state that exposed the cause).

## [0.1.4] — 2026-06-07

First release covering all items in the prod-ready follow-up plan (2026-06-07),
since archived to STARK-2563 and removed from the repo.

### Added
- `server/`: baseline security headers (HSTS, CSP, Permissions-Policy,
  X-Frame-Options, tightened Referrer-Policy) on every response. Tests
  in `server/main_test.go` assert headers land on healthz, asset, data,
  SPA fallback, 405, and HEAD responses.
- New `stark allowlist` subcommand that prints the canonical Markdown
  view of `commandAllowlist` + `agentToolAllowlist`. `--check <path>`
  drift-gates a committed copy.
- `docs/allowlist.md`: generated from the two `engine/internal/validate`
  allowlists; CI fails closed if it drifts from the source.
- `docs/operations/rollback.md`: runbook covering Cloud Run revision
  rollback, bundle yank policy (content-locked + advisory), and
  signed-release revocation (cosign has no native revoke).
- Diagnostic step in `sign-manifest.yml` capturing git state after
  `stark build` to investigate the Linux-only "19 files deleted" mystery
  that forces `goreleaser --skip=validate` today (workaround unchanged).

### Changed
- CI gates web with `npm typecheck`, `npm run lint`, and `npm test`
  before `npm run build` (only `build` was gated before).
- CI gates engine + server with `gofmt -l` (blocking).
- All three workflows opt into Node 24 for JS actions
  (`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`) ahead of the Sep 2026
  forced cutover.

### Docs
- v0.1.0, v0.1.1, v0.1.2 GitHub Releases annotated as superseded —
  they were part of the bootstrap sequence; the signed-manifest +
  binary loop only closed cleanly at v0.1.3.

## [0.1.3] — 2026-06-07

### Fixed
- Pass `--skip=validate` to goreleaser inside `sign-manifest.yml`.
  `git checkout -- .` (tried in 0.1.2) did not undo `stark build`'s
  remove-then-write effects on Linux, so the clean-tree check kept
  firing. The binary build itself reads `engine/cmd/stark` from the
  tagged ref — not `dist/claude` — so skipping the validate step is safe
  and the release artifact is unaffected.

## [0.1.2] — 2026-06-07

### Fixed
- Restore working tree (`git checkout -- .`) before invoking goreleaser
  inside `sign-manifest.yml`. The previous run's `stark build` re-rendered
  `dist/claude` in place which tripped goreleaser's clean-tree check even
  when the rebuild was byte-identical. Binaries build from the tagged
  source, so the checkout is safe and unblocks the goreleaser stage.
  (Insufficient on Linux runners — superseded by 0.1.3.)

## [0.1.1] — 2026-06-07

### Fixed
- `stark` CLI binaries are now attached to signed releases. v0.1.0 shipped
  with the signed manifest but no binaries because the tag was pushed by
  `GITHUB_TOKEN`, which doesn't trigger downstream `on: push: tags`
  workflows. Folded goreleaser into `sign-manifest.yml` so every signed
  release atomically ships manifest + binaries. (v0.1.1 still missed the
  binaries due to a separate clean-tree bug fixed in v0.1.2.)

## [0.1.0] — 2026-06-07

First tagged release. Spec slices 1–8 complete (catalog → engine → web → security → web-deploy → governance).

### Added
- Canonical `catalog/` source-of-truth with 6 spec-kit-aligned bundles (`stark-constitution`, `stark-plan`, `stark-analyze`, `stark-implement`, `stark-gh`, `stark-ops`).
- Go engine (`engine/cmd/stark`) with `validate`, `build`, `check-bumps`, `lint`, `install`, `import`, `verify-manifest`, `doctor`, `info`, `search`, `version`.
- Per-runtime adapters for Claude Code, Codex, Gemini under `engine/internal/adapter/`.
- Web registry (`web/`) — strict-TS Vite SPA over signed `index.json` + `bundles/*.json`.
- IAP-gated Cloud Run static origin at `marketplace.21stark.com` (`server/`, `web-deploy.yml`).
- Native Claude Code marketplace via repo-root `.claude-plugin/marketplace.json`.
- CI gates: schema validate, drift `build --check`, version-bump immutability, gitleaks (fail-closed); body lint (advisory).
- Cosign-keyless signed build manifest via GitHub OIDC → Fulcio + Rekor.
- Top-level docs: `CLAUDE.md`, `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `docs/SECURITY.md`, `docs/native-install-loop.md`, `docs/web-hosting.md`.

[Unreleased]: https://github.com/21StarkCom/bifrost/compare/v0.1.6...HEAD
[0.1.6]: https://github.com/21StarkCom/bifrost/releases/tag/v0.1.6
[0.1.5]: https://github.com/21StarkCom/bifrost/releases/tag/v0.1.5
[0.1.4]: https://github.com/21StarkCom/bifrost/releases/tag/v0.1.4
[0.1.3]: https://github.com/21StarkCom/bifrost/releases/tag/v0.1.3
[0.1.2]: https://github.com/21StarkCom/bifrost/releases/tag/v0.1.2
[0.1.1]: https://github.com/21StarkCom/bifrost/releases/tag/v0.1.1
[0.1.0]: https://github.com/21StarkCom/bifrost/releases/tag/v0.1.0
