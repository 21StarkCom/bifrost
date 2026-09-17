# Changelog

All notable changes to `stark-marketplace`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html). Bumping `VERSION` on `main` triggers a tag + signed release.

## [Unreleased]

### Fixed
- **A skill citing a sibling skill's support file no longer fails the Codex native contract (STARK-5065).** `skillSupportRefRe` in `engine/cmd/stark/codex_compliance_test.go` was unanchored, so in `../gru/references/operations.md#deterministic-re-brief-check` it matched only the `references/operations.md` tail — the `../gru/` prefix dropped, the scan stopping at `#` because neither character is in its class. Line 196 then resolved that fragment against the CITING skill's directory and reported `dangling skill-local support reference` for a path nobody wrote. Skills of one bundle install side by side under `skills/`, so the citation was correct: at the blocked sync head `3dc9afeb`, `skills/gru/references/operations.md` (38291 bytes) sits beside `skills/minion/SKILL.md`. The reference is now matched as written and resolved from the skill directory, and a dangling one that leaves the skill is reported as `cross-skill` rather than `skill-local`. The `../` run is REQUIRED before the sibling segment: making that head optional traded one false report for another, reading `$SKILL_DIR/scripts/gha-cost-breakdown.sh` as `SKILL_DIR/scripts/…` and failing a script `stark-gha-cost` actually ships (measured). Extraction is now a `skillSupportRefs` helper with its own table test plus a resolution test over a real two-skill tree; the fix is mutation-checked three ways (original regex, over-wide head, missing punctuation trim). **Impact:** `marketplace-sync` had a valid operator attestation on bifrost#260's exact head and four of five checks green, un-drafted the PR, then aborted on this test — stark-skills#989 (STARK-5046) merged to `main` but never published, leaving every install on the old `/minion`.

### Changed
<!-- idun:pr-merge pr=246 runId=246 -->
- Documented bifrost `main`'s required-status-checks contract (currently none) and the operator commands to apply it, in `docs/operations/branch-protection.md`.
<!-- idun:pr-merge pr=245 runId=245 -->
- Removed the duplicate `[Unreleased]` CHANGELOG bullet for the already-released v0.28.0 rename; the `[0.28.0]` entry is the sole record.
<!-- stark-gh:pr-merge pr=228 runId=228 -->
- Updated docs (AGENTS.md, CLAUDE.md, README.md, native-install-loop.md) to retire stark-gh examples and clarify no bundle is plugin-backed or gemini-targeted today.

### Removed
- Retired `stark-gh-user` from `stark-ops`; the human-only GitHub PAT swap now belongs to `idun user` / `idun user gh` (STARK-2215). `stark-ops` and root `VERSION` minor-bumped for the membership change.
- Unpublish the `stark-brain` bundle (the Atlas `brain` MCP server), reversing its still-unreleased addition. Its only consumer was this plugin; the Atlas engine keeps vault reach over its CLI. Root `VERSION` minor-bumped for the membership change.

### Fixed
<!-- stark-gh:pr-merge pr=202 runId=49d6b13d-c855-4c7b-ad66-1579d33260b7 -->
- Scope entropy exemptions to lockfile content while retaining credential detection and full-strength scanning for commit and PR prose.
<!-- stark-gh:pr-merge pr=197 runId=c5d7811a-fcfa-4dfe-b61b-dd6ff2336977 -->
- Unblocked native marketplace publication and packaged `stark-brain` as an Atlas MCP integration without restoring the retired `remember` skill.

### Added
- Document the `main` required-status-checks contract (STARK-4989): new `docs/operations/branch-protection.md` names the five `ci.yml` contexts, carries the operator-only ruleset APPLY command, and records the draft-skip-guard trap; `SECURITY.md` §5 now states the measured gap between documented and live protection, and CLAUDE.md / AGENTS.md point at the contract.
<!-- stark-gh:pr-merge pr=227 runId=227 -->
- Publish `stark-memory` skill in the `stark-ops` bundle (0.10.4 → 0.11.0) for auditing and tidying Claude Code auto-memory files.
<!-- stark-gh:pr-merge pr=207 runId=044dacbb-5bef-42dd-8e7d-16e9e1c14290 -->
- Add the beta `stark-design` bundle with reusable design-token architecture, theming, accessibility, distribution, and versioning guidance.
<!-- stark-gh:pr-merge pr=205 runId=abe5b9b1-1c62-43bc-85af-205fd049fd75 -->
- Retired `stark-cc-user` from `stark-ops`; Claude Code account switching now belongs to Idun CC.
<!-- stark-gh:pr-merge pr=198 runId=12ade727-0eb7-46d7-b653-09bafa778a6a -->
- Removed retired private-directory references from documentation and secret-file lint rules.
<!-- stark-gh:pr-merge pr=196 runId=c1422f87-9818-4484-94b7-36bd3219bffb -->
- Publish native Codex skills for `stark-bury`, `stark-handoff`, and `simple-gate`.

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

[Unreleased]: https://github.com/21-Stark-AI/stark-marketplace/compare/v0.1.6...HEAD
[0.1.6]: https://github.com/21-Stark-AI/stark-marketplace/releases/tag/v0.1.6
[0.1.5]: https://github.com/21-Stark-AI/stark-marketplace/releases/tag/v0.1.5
[0.1.4]: https://github.com/21-Stark-AI/stark-marketplace/releases/tag/v0.1.4
[0.1.3]: https://github.com/21-Stark-AI/stark-marketplace/releases/tag/v0.1.3
[0.1.2]: https://github.com/21-Stark-AI/stark-marketplace/releases/tag/v0.1.2
[0.1.1]: https://github.com/21-Stark-AI/stark-marketplace/releases/tag/v0.1.1
[0.1.0]: https://github.com/21-Stark-AI/stark-marketplace/releases/tag/v0.1.0
