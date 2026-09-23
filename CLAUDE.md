# CLAUDE.md — bifrost

`21StarkCom/bifrost` is the stark skills + tools repo: 27 Claude Code skills under `skill/`, the TypeScript tooling they call under `tools/`, and the marketplace manifest that serves them as seven plugins. It is a personal playground with one user, the author. Nothing here is production.

`AGENTS.md` is the concise Codex/Cursor entry point (Codex loads at most 32 KiB of project instructions, so detail goes here, not there); this file is the detailed reference, is what Claude Code reads, and wins on conflict. Keep the two in agreement, in the same PR. Both describe only current structure, commands, and rules: no incident narratives, migration history, or ticket records.

## How the repo works

- **Skills are edited here and take effect here.** There is no build step, no generated catalog, no registry, no signing. `skill/<name>/SKILL.md` is the artifact and ships when the PR merges.
- **The repo is its own marketplace.** `.claude-plugin/marketplace.json` at the root is what `/plugin marketplace add 21StarkCom/bifrost` reads. Every plugin entry has `"source": "./"` (the repo root) plus a `skills:` list of `./skill/<name>` paths. The seven lists are a disjoint partition of the 27 skills, and the `skills:` list *restricts* what a plugin loads — that only holds because there is no `skills/` directory for Claude Code to auto-discover, so **never rename `skill/` to `skills/`**, and re-measure the restriction after a `claude` CLI upgrade: if discovery ever turns out to be additive on top of `skills:`, all 27 skills load into all 7 plugins with no error anywhere. `tools/repo_contracts.test.ts` pins the seven entries and the partition; `claude plugin validate --strict .` gates the file.
- **Bumping an entry's `version` is the only thing that makes an installed plugin re-fetch.** Installs are keyed by version under `~/.claude/plugins/cache/bifrost/<plugin>/<version>/`, so an edited skill under an unchanged version never reaches the machine and no check notices. Touch a skill → bump the `version` of every plugin whose `skills:` list claims it, in the same PR.
- **Testing an edit against a real plugin install** is bump in the same PR → merge → `/plugin update`. Anything that resolves through this checkout (a direct `node tools/…` run, the `~/.claude/code-review` links) is live on save.
- **Claude Code is the only install target; the skills are runtime-neutral.** Codex runs the same `skill/` + `tools/` trees (`/agnes` is `$agnes` on Codex; `hermod ticket --agent codex` launches a Codex worker), and Codex and Gemini are also dispatched as review agents. There is no Codex-specific tree and none should be written — fix the canonical file instead. The shared `standards/` worker docs are read by a worker on either runtime off the same file, so they stay runtime-neutral: say "the repo's agent instructions file", not `CLAUDE.md`; declare that a skill written as `/agnes` is `$agnes` on Codex; and name both permission models (Claude's bypass mode / allowlist entry, Codex's sandbox + approval policy) wherever one matters.

### The plugin-resolution seam

`tools/asset_root_lib.ts::assetRoot()` resolves immutable assets (tools, prompts, config) from `STARK_ASSET_ROOT` > `CLAUDE_PLUGIN_ROOT` > `~/.claude/code-review`. Mutable state uses `stateRoot()`: `STARK_STATE_ROOT` > `~/.claude/code-review`, independently of the plugin root. Skills use `${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}`. **Never hardcode `~/.claude/code-review/{tools,prompts,scripts,standards}` in a skill or tool.**

The five `~/.claude/code-review/{tools,scripts,standards,prompts,config.json}` symlinks into this checkout are provisioned by `tools/asset_links.ts` (`--check` / `--install`) from the `MANAGED_LINKS` table in `tools/asset_links_lib.ts`. That table is the source of truth; retire a link by moving it to `RETIRED_LINKS`, never by deleting the row. Every other machine asset (settings, statusline, output style, hooks, the generated `.envrc` GCP scope block) belongs to the stark-workspace repo. `.worktreeinclude` is tracked here and copies gitignored files into Claude- and Codex-managed worktrees (a plain `git worktree add` does not read it, so a helper that creates one copies the named files itself): stark-workspace's `gcp_scope.ts` writes its `.envrc` row, and never add a credential file or a broad glob to it by hand.

## Layout

- `skill/` — the 27 skills (`skill/*/SKILL.md`, optionally `references/` and `scripts/`). 23 `stark-*` plus `agnes`, `gru`, `minion`, `lucius`. The only shell in the repo besides `tools/check-rest-only.sh` lives here: `stark-build`'s two hook scripts (`references/hooks/`) and `stark-gha-cost`'s two `gh` wrappers (`scripts/`), all in the help audit's entrypoint inventory.
- `tools/` — the tooling: TypeScript, `node:` builtins only at runtime, and every tool imports only sibling `.ts` files (`main_module_lib.test.ts` and `agent_dispatch_lib.test.ts` run the tools from a copy of the tree holding nothing else, so a JSON, npm or `../` import fails there). Has its own `package.json`; `npm test` = `./check-rest-only.sh && node --test *.test.ts`, `npm run typecheck` = `tsc -p .`. Node 24+.
- `global/` — `config.json` (default config), `config-reference.md`, `forge_heuristics.json`, `prompts/{iac-review,refactor-planner}/` (dispatcher rubrics).
- `standards/` — shared protocol docs skills link as `../../standards/*.md` (`help.md`, `worker-spine.md`, `stand-down.md`, `preflight.md`, `dispatch-failure.md`, `stage-completion-line.md`, `index.md`), plus `templates/` and `workflows/`.
- `scripts/` — `healer_patterns.json`.
- `data/persona/roster.md` — the persona roster.
- `docs/operations/` — `branch-protection.md` (what `main` gates on, and the operator-only ruleset commands) and `source-entrypoint-help-audit.md` (the entrypoint inventory `tools/source_help.test.ts` checks against).
- `.github/workflows/` — `ci.yml` and `secret-scan.yml`. Both are `permissions: contents: read`; no workflow in this repo holds a write permission or an App credential.
- `.claude-plugin/marketplace.json` — the manifest. Hand-curated; must stay at the root.
- `.stark-gh.json` — `idun gh` config: PR titles carry a `STARK-n` ticket scope.

## Shipping

- **Every change follows the spine:** alfred ticket → branch → draft PR → `/code-review xhigh --fix` → fix every finding → `idun gh pr-merge` (un-drafts, waits for green, squash-merges) → `alfred task move STARK-<n> done`. Never commit or push to `main`. No soak, canary or rollout ceremony — merge once green.
- **Every PR action uses `gh` as `aryeh-stark`**, review posting included. Review text names the model; authentication never changes with model choice. Two identity swaps exist, both the operator's and neither ever run by a tool, skill or hook: the rate-limit `gh auth switch` to `aryeh-evinced` from `~/Code/CLAUDE.md` (machine-wide, with its own switch-back timer; `preflight.ts`'s `check_github_user` refuses until it flips back, which is not a broken login), and `export GH_TOKEN=$(idun user --swap)` for one rate-limited command, reverted with `unset GH_TOKEN GITHUB_TOKEN STARK_GH_USER` as soon as that command is done or later PR activity authors as the relief account.
- **Review findings go on the PR** — inline where anchored, in the review body otherwise — via `tools/findings_review_post.ts`. Don't drop, downgrade or summarize findings away; fix them or reply on the thread saying why not. Never resolve another reviewer's thread yourself.
- **Verify live.** A flow that touches GCP or GitHub is exercised against the real surface. Show the command and its output.
- **Update the docs in the same change.** Anything that changes behavior, structure, commands, env vars or operations updates this file and `AGENTS.md` alongside.
- **Language:** TypeScript for tooling; POSIX shell only for the hook and `gh`-wrapper scripts named under Layout. Never add Python.
- **Secrets only in mimir.** Nothing credential-shaped in the tree, in `.worktreeinclude`, or in config.

### What `main` gates on

Read `docs/operations/branch-protection.md` before touching CI. The short version:

- Repository ruleset **23544063 "Required CI on main"** requires four check contexts, all from `ci.yml`: `test`, `typecheck`, `secret scan (tree)`, `actionlint`. It has one bypass actor — repository admin, i.e. the operator — so red *can* be merged; never write that it cannot.
- Classic branch protection on `main` adds `enforce_admins`, `required_conversation_resolution` and `required_linear_history`. Neither endpoint alone shows the whole picture: read both `repos/O/R/rules/branches/main` and `repos/O/R/branches/main/protection`.
- `tools/workflow_shape.test.ts` pins `ci.yml`'s shape: exactly those four jobs; `test` and `typecheck` unnamed (their job ids are the required contexts); no job-level `if:`, `paths`, `paths-ignore` or `continue-on-error` at any depth; an unfiltered `pull_request:` trigger; concurrency keyed on the PR number with `cancel-in-progress: false`. A required context is a check-run **name**, so renaming a job orphans its requirement — PUT the ruleset in the same window, and remember a PUT replaces the rule wholesale. Never guard a required job with a draft check: a skipped required check counts as passing. The `typecheck` step runs `npm run typecheck`, never `npx tsc` — with no TTY, `npx` downloads a missing package instead of failing, which would move a required gate onto an unpinned TypeScript, and no test pins the run line.
- The same test bans `gh api --slurp` combined with `--jq`/`--template` across every `.sh`/`.ts`/`.yml`/`.yaml` in the repo.
- `secret-scan / secret-scan` reports on every PR but is **not** required; the blocking secret gate is `ci.yml`'s `secret scan (tree)` job, which scans the whole tree plus the PR's commit range and first proves both `.gitleaks.toml` rules (`google-oauth-client-secret`, `stark-inline-credential`) actually fire. Enrolling the fleet check would be a change in the 21stark repo, not here.

### `secret-scan.yml` is not this repo's to edit

It is a byte-identical copy of a Terraform render from `21StarkCom/21stark` (`repos/secret_scan.tf`), delivered by PR because this repo's `enforce_admins` rejects the provider's direct commit. Change the template there and copy the new render; a hand edit here only makes bifrost diverge from the fleet. `tools/repo_contracts.test.ts` pins its SHA pin, context name, triggers and the absence of a `selftest_rule_id` override.

### Draft PRs

Every PR opens as a draft (`idun gh pr-open`; skills pass `--draft`). Merge paths un-draft first (`gh pr ready`), which fires CI via `ready_for_review`, then wait for green. `idun gh pr-merge` refuses a skipped required check more strictly than GitHub does; `--allow-skipped-checks` opts back in for repos that skip one by design. A target repo keeps CI off drafts with `standards/workflows/skip-draft-guard.md`, never on a required check. Details of `pr-open`/`pr-merge`/`cleanup`/`watch` live in the idun repo.

## Conventions every skill and tool follow

- **`--help` is side-effect-free.** Every skill opens with a `## Help` block pointing at `standards/help.md`: a standalone `--help`/`-h`/`help` token prints purpose + usage + `## Arguments` and stops. Every tool entrypoint exits on `help`/`--help`/`-h` before doing work; unknown arguments and missing option values are refused, never swallowed into a later flag. Shared argv helpers: `tools/cli_args_lib.ts`. `tools/source_help.test.ts` drives every entrypoint and requires the two inventory tables in `docs/operations/source-entrypoint-help-audit.md` to match its lists — adding, moving or deleting an entrypoint means editing that doc in the same PR.
- **One run-as-main guard:** `tools/main_module_lib.ts::isMainModule(import.meta.url)`. It resolves symlinks and percent-encoded paths (`Application Support`) on both sides; `main_module_lib.test.ts` fails the suite if any other tool source mentions `process.argv[1]`.
- **Skill smoke test** (`tools/skill_smoke_test.test.ts`, on every `npm test`): every skill's frontmatter parses, `name:` matches its directory, it references `standards/help.md`, every in-repo `tools/*.ts` and `references/*.md` link resolves, every TS CLI a skill mentions exits cleanly on `--help`, and `agnes`/`gru`/`minion` stay model-invocable. Cross-repo references need an entry in its `CROSS_REPO_PREFIXES` allowlist.
- **Docs layout `/stark-init-docs` scaffolds into target repos:** `docs/adr/NNNN-<topic>.md` (immutable; supersede, don't edit), `docs/specs/YYYY-MM-DD-<topic>-spec.md`, `docs/retros/`. Never a `docs/plans/` — the spec carries the plan. `tools/doc_convention.test.ts` guards the scaffold; this repo itself keeps only `docs/operations/`.
- Config is JSON; prompts are markdown. `tools/stark_config_lib.ts`'s section accessors read the global `config.json` (through `assetConfigPath()`) with deep merge against its `DEFAULT_*` sections; the org → repo `.code-review/config.json` walk exists only in `discoverConfig` (preflight, `agents` only), so a per-repo override of any other section is ignored.
- **Reuse over reinvent; keep it lean.** No one-off scripts, no dead code, no stale docs.

## Agents and auth

Claude, Codex and Gemini are all dispatchable. Every dispatch env goes through a credential-scrubbed allowlist (`tools/agent_env_lib.ts::AGENT_ENV_ALLOWLIST`, `tools/runtime_env_lib.ts`): GitHub, Anthropic and OpenAI credential vars and DB connection strings are kept out of any subprocess that reads a prompt. `USER` stays in — the claude CLI needs it to find its Keychain identity.

- **Claude:** `tools/claude_auth_lib.ts`, one mode, `subscription` — the logged-in account's OAuth creds via `HOME`; no `ANTHROPIC_API_KEY` is ever injected. `tools/agent_claude.ts` supports `--json-schema` (inline JSON object only, ≤120 KiB; read the reply with `extractStructuredOutput(rawStdout)`).
- **Gemini:** `gemini-3.1-pro-preview`; auth resolved by `tools/gemini_auth_lib.ts` — `STARK_GEMINI_AUTH` env > `models.gemini.auth` config > `oauth` (the Google account's Code Assist seat). `vertex` and `api-key` remain. The Vertex project/location come from `tools/vertex_config_lib.ts` at runtime (env > config > `GOOGLE_CLOUD_PROJECT` > `gcloud config`) and are **never hardcoded in source**. `-latest` model aliases resolve only on the API-key path, not Vertex.
- **Codex:** `tools/codex_utils_lib.ts` (JSONL parsing, reasoning-effort config).
- **Subprocess bounds:** `tools/bounded_spawn_lib.ts::spawnBounded` backs every `gh` call on the posting path — detached process group, group SIGKILL on timeout (`STARK_GH_TIMEOUT_MS`, default 120 s; an unusable value is a hard error) and on `maxBuffer`, SIGINT/SIGTERM/SIGHUP forwarded to live groups. `tools/agent_dispatch_lib.ts::run` and `tools/jury_dispatch.ts` use the same `makeGroupKiller` door. `tools/child_termination_lib.ts::explainTermination` names why a child died, cause first. `tools/check-rest-only.sh` pins the posting path's import closure to REST-only `gh`.

## Tools worth knowing

Dispatchers and orchestration:
- `findings_review_post.ts` — posts a `ReportFindings` payload as one anchored `COMMENT` review (`--repo O/R --pr N --findings <path|-> [--agent …] [--dry-run]`); each finding's body is its summary, failure scenario and, when the producer carries one (`rules_audit.ts`), its `fix`, with severity inferred from `verdict`. Anchors are validated against the PR's diff hunks; findings on generated paths (resolved per run: `--generated-paths` > `generated_paths.repos["O/R"]` config > the target's `.gitattributes` `linguist-generated` rows > `generated_paths.default`; `--add-generated-paths` extends, `--no-generated-split` disables) go in the body under their own heading with file and line intact. Transport is `review_post_lib.ts::postReview`: no-drop 422 fallback (demote the anchor, keep the finding), marker-aware retry, run-level idempotency (a marked review already on the PR means a no-op), and an oversize-body degrade that spills the lowest-severity findings into cross-linked follow-up comments rather than truncating anything. Approvals and requested changes stay human. The `generated_paths.repos` entry for this repo (`"21StarkCom/bifrost": {"paths": ["__none__/**"]}`) says "nothing here is generated" and must stay — an absent entry falls through to a default that would demote findings on `marketplace.json`.
- `copilot_land.ts` — `/stark-build`'s create-or-adopt PR landing (`branch-name` / `prepare-branch --require-base <sha>` / `land`). Never force-pushes; `land` also stamps the ticket's `pr_url`/`pr_state` through `ticket_fields_lib.ts`, and a field write never fails the PR verb — it prints one `ticket fields: …` line either way.
- `iac_review.ts` + `iac_review_lib.ts` — multi-agent Terraform/Terragrunt review behind `/stark-terraform-review` and `/stark-terragrunt-review`. Agents: `--agents` > config `iac_review.agents` > `["codex"]`; rubrics in `global/prompts/iac-review/`; read-only.
- `refactor_planner.ts` + `refactor_planner_*.ts` — `/stark-refactor-plan`'s dispatcher (`dry-run` / `run` / `validate`); the `noop` provider runs the pipeline with zero LLM calls.
- `jury.ts` + `jury_dispatch.ts` — `/stark-jury`'s three-model panel (`run` / `list` / `show`).

Session and ops: `stark_session.ts`, `stark_handover.ts` (root `STARK_HANDOVER_ROOT` > `handover.root` > `~/Code/Handovers`), `stark_persona.ts`, `session_state.ts`, `session_id.ts`, `context_compactor.ts`, `memory_tidy.ts` (read-only; `/stark-memory` does the rewriting), `preflight.ts` (`check_github_user` requires `aryeh-stark`), `self_healer.ts` + `healer_canary.ts` (authentication patterns are never auto-applied), `alert_delivery.ts`, `skill_router.ts`, `github_projects.ts`, `release_changelog.ts`, `release_version_bump.ts`, `asset_links.ts`.

Skill meta-tooling: `skill_audit.ts`, `skill_optimize.ts`, `skill_autopilot.ts`, `skill_diet.ts`, `optimize_skill_description.ts` (needs the skill-creator plugin installed).

Instruction-file audit: `rules_audit.ts` (`--repo`, `--json`) over `rules_audit_lib.ts` (the checks) and `rules_load_lib.ts` (the loader emulation: rule frontmatter, the gitignore-style `paths:` matcher, `@import` scanning, Codex's AGENTS.md budget). It walks the disk, not `git ls-files` — Claude Code loads gitignored instruction files too. The emulation is pinned to the `LOAD_MODEL` it was measured against, like the `skills:` restriction above: after a `claude` or `codex` upgrade, re-measure with an `InstructionsLoaded` hook in a headless session and update the fixtures in `rules_load_lib.test.ts`.

## Skills

Plugin → skills, from the manifest:

- **stark-plan** — `/stark-author <intent|notes> [--tier skip|short|full]`: human-gated spec + plan in one session. Writes `docs/specs/YYYY-MM-DD-<slug>-spec.md` (intent, IN/OUT, EARS criteria, task DAG with machine-checkable done-whens, closing verification command) plus a plain-English `.human.md` digest, one advisory subagent pass at most, three-question operator sign-off, `accepted-base` pin, draft PR on `spec/<slug>`. The operator is asked only outcome questions; the agent derives files and interfaces itself. Before finalizing, it scans the wiring seams (registration, generated artifacts pinned by tests, call sites, doc generators) so no task lands as inert code behind a green check.
- **stark-implement** — `/stark-build <spec-path>`: autonomous implementation from an accepted spec. One fresh headless `claude -p` session per task, gated by hooks the agent cannot edit (`references/hooks/protect-paths.sh` write-protects the spec, gated tests and harness; `references/hooks/stop-gate.sh` blocks turn-end while the done-when is red, aborting with a deviation at 7 blocks). Worktree at `accepted-base`, branch `build/<slug>`, draft PR via `copilot_land.ts`, one commit per green task, one resume on crash. The spec's closing verification command is a held-out e2e gate; one cross-vendor advisory review (codex) and exactly one fix round over medium+ findings. Harness rules: every subprocess closes stdin (`</dev/null`), long gates run backgrounded, kills are scoped to this run's state dir and reach the process group, `protected.list` entries carry no trailing slash, and macOS has no `timeout(1)`.
- **stark-analyze** — `/stark-refactor-plan`, `/stark-terraform-review`, `/stark-terragrunt-review`, `/stark-logging`, `/stark-fresh-eyes <doc> [--focus …]` (one zero-context subagent re-verifies a doc's claims by a different method; dispositioned once, never a round 2).
- **stark-ops** — `/stark-session [start|end]`, `/stark-handover [save|resume|status]`, `/stark-release [patch|minor|major]`, `/stark-gha-cost`, `/stark-bury <corpse>` (the fleet's only destructive skill: bury before delete, the dead stay dead, the living repo stays green, every destructive step needs the operator's go, never commit a raw bundle or an age identity), `/stark-memory` (dry-run by default; `--apply` to write), and the worker family below.
- **stark-constitution** — `/stark-init-docs`, `/stark-adr`, `/stark-persona`, `/stark-rules-optimizer [--repo <path>] [--apply]` (audits one repo's `.claude/rules`, CLAUDE.md and AGENTS.md against how Claude Code and Codex load them — `tools/rules_audit.ts` measures, the skill judges the candidates; read-only by default, `--apply` stops at a reviewed draft PR in the target repo).
- **stark-write** — `/stark-voice`, `/stark-story-edit`, `/stark-blog-sharpen`, `/stark-story-judge`, `/stark-jury`.
- **stark-design** — `/stark-design-tokens`.

### The worker family (Gru, Minion, Agnes) and Lucius

Protocol skills over alfred (the board is the state) and hermod (`hermod ticket` launches, `hermod msg` reports). No tooling of their own here; neither Gru nor a Minion writes a ticket custom field.

- `/gru start <STARK-epic | --tickets STARK-n,…> [--max-workers N] [--agent claude|codex]` — expands the epic, orders by dependencies, launches ≤N Minions, confirms each `done` by reading the merged PR and ticket status, launches the next. Merges run one per repo at a time, except on a repo whose base branch has a GitHub merge queue (read per repo through GraphQL `mergeQueue`), where every Minion runs `idun gh pr-merge` at once. Rerunning `start` resumes from the board. A ticket's repo resolves per launch through `frigg repos get`; a path fallback must be proved with `git -C <path> rev-parse --show-toplevel` before it is passed, because hermod accepts a wrong `--cwd` silently.
- `/minion` — one ticket for Gru, reporting `done`/`blocked`/`follow-up` over hermod.
- `/agnes <STARK-n>` — one ticket, unattended, no Gru: confirms its own merge and close (`gh pr view` + `alfred task show`), comments the evidence on the ticket, then stands down.
- `--new-tab` on all three launches through `hermod ticket … --json` from the repo's **main checkout** (from `git worktree list --porcelain`), on an id that is free in the target repo. Gru's launch id is the epic's, never a ticket it will work. `/minion --new-tab` without `--leader` makes the launcher the leader, so it stays and waits. Needs hermod ≥ v0.20.0 for `--agnes`/`--minion`/`--gru`; older uses `--prompt-file`.
- Both workers run the same two shared docs — `standards/worker-spine.md` (bind → implement → verify live → `idun gh pr-open` → `/code-review xhigh --fix` → `idun gh pr-merge` → close; step 1 titles the cmux tab `MINION (n)`/`AGNES (n)`) and `standards/stand-down.md` (the `hermod poison-pill --json` teardown: only after merge, ticket close, clean tree and an empty `git log origin/<own branch>..HEAD`, only from the worker's own tab, never from a subagent, never on `blocked`). Change a shared rule in the `standards/` doc, never in one skill. The verify-live check is re-run after the fix round and posted as a PR comment, since stand-down destroys the scrollback.
- `/lucius [--new-tab] [<topic> | STARK-n | --resume | --topic <text>]` — launches Lucius, the standalone brainstorming app, in its own tab via `hermod lucius --json` and stops. Never runs him in-session; `--topic` last, single-quoted; needs a hermod carrying the `lucius` verb.

## Commands

```
/plugin marketplace add 21StarkCom/bifrost
/plugin install stark-ops@bifrost        # + stark-plan, stark-implement, stark-analyze, …
/plugin update  stark-ops@bifrost

(cd tools && npm test && npm run typecheck)
node tools/asset_links.ts --check
claude plugin validate --strict .
git diff --check "$(git merge-base origin/main HEAD)"
```
