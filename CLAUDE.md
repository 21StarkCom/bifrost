# CLAUDE.md — bifrost

Add only rules, traps and pointers here. Put reasons, history and catalogs in `docs/` or the ticket.

`21StarkCom/bifrost` holds the stark skills under `skill/`, the TypeScript tools they call under `tools/`, the mods under `mods/`, and the marketplace manifest that serves them as plugins.

`AGENTS.md` is the short Codex/Cursor entry point: Codex loads at most 32 KiB of project instructions, so detail goes here. This file wins on conflict. Keep the two in agreement, in the same PR. Both hold only current structure, commands and rules: no incident narratives, history or ticket records.

## How the repo works

- **A skill ships when its PR merges.** `skill/<name>/SKILL.md` is the artifact: there is no build step, catalog, registry or signing.
- This is the operator's call.
- These deletes cannot be undone, so each needs a GO.
- **The repo is its own marketplace.** `.claude-plugin/marketplace.json` at the root lists seven skill plugins, each with `"source": "./"` and a `skills:` list of `./skill/<name>` paths. The lists partition the skills. `tools/repo_contracts.test.ts` pins the entries and the partition; `claude plugin validate --strict .` gates the file.
- **Never rename `skill/` to `skills/`.** A `skills:` list restricts what a plugin loads only while there is no `skills/` folder for Claude Code to discover; with one, every skill can load into every plugin, with no error.
- **A hook that serves a skill** is an inline `hooks` object on its one plugin entry, run as `node "${CLAUDE_PLUGIN_ROOT}/tools/<tool>.ts"`. Today that is stark-ops' PostToolUse `tools/fact_routing_hook.ts` and PreToolUse `tools/rules_gate_hook.ts`. Gate it with `if`. An `Edit(...)` gate does not match a Write, so give each tool its own handler. A path or array `hooks` value does not load from a marketplace entry.
- **Never add an auto-discovered component at the root:** `hooks/`, `skills/`, `commands/`, `agents/`, `output-styles/`, `themes/`, `workflows/`, `monitors/`, `.mcp.json`, `.lsp.json`, `settings.json` or `.claude-plugin/plugin.json`. Every skill plugin shares `"source": "./"`, so all seven would load it. `tools/repo_contracts.test.ts` pins this.
- **A mod** is a Claude Code plugin of function hooks in `mods/<name>/`, with its own `.claude-plugin/plugin.json` and `hooks/`, and its own entry: `"source": "./mods/<name>"`, no `skills:`, no inline `hooks`. `MOD_SOURCES` in `tools/repo_contracts.test.ts` names each one, and any other non-`./` entry fails. A mod edit bumps its entry's `version` and its `plugin.json`'s together. Check it with `claude plugin validate mods/<name>` and `claude plugin test mods/<name>`.
- **Read a mod's `README.md` before you change the mod.** It holds the mod's behavior. `mods/stark-progress/README.md` also holds the `~/.cache/stark-progress/` state contract that the worker skills write.
- **Bump the version to ship a change.** Installs are keyed by version under `~/.claude/plugins/cache/bifrost/<plugin>/<version>/`, so an edit under an unchanged version never reaches the machine. When you touch a skill, a hook's tool or anything that tool imports, bump each plugin that owns it, in the same PR.
- **Test against a real install** by bump → merge → `/plugin update`. Anything that resolves through this checkout (a direct `node tools/…` run, the `~/.claude/code-review` links) is live on save.
- **Claude Code is the only install target; the skills are runtime-neutral.** Codex runs the same `skill/` and `tools/` trees. Never write a Codex-specific tree; fix the canonical file. In `standards/`, write "the repo's agent instructions file", not `CLAUDE.md`; say that `/agnes` is `$agnes` on Codex; and where a permission matters, name both models (Claude's bypass mode or allowlist entry, Codex's sandbox and approval policy).
- **bifrost and idun share no code.** Skills call idun's, njord's and valkyrie's CLIs. Refuse a design that imports, vendors or generates code from one repo in the other.

### Asset and state paths

- Resolve shipped assets with `assetRoot()` and mutable state with `stateRoot()`, both in `tools/asset_root_lib.ts`. Skills use `${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}`.
- **Never hardcode `~/.claude/code-review/{tools,prompts,scripts,standards}`** in a skill or tool.
- `tools/asset_links.ts` (`--check` / `--install`) provisions the five `~/.claude/code-review` links from `MANAGED_LINKS` in `tools/asset_links_lib.ts`. Retire a link by moving its row to `RETIRED_LINKS`, never by deleting the row.
- Machine assets (settings, machine hooks, the `.envrc` GCP scope block) belong to idavoll (`21StarkCom/idavoll`). `--install-schedule` installs the two launchd jobs: `tools/ask_guard_metric.ts` and `tools/rules_audit.ts` (the agent-doc sweep).
- `.worktreeinclude` copies gitignored files into Claude- and Codex-managed worktrees. A plain `git worktree add` does not read it, so a helper that creates a worktree copies the named files itself. idavoll's `gcp_scope.ts` writes its row. Never add a credential file or a broad glob to it.

## Layout

- `tools/` — TypeScript, Node 24+, `node:` builtins only at runtime, and only sibling `.ts` imports: tests run the tools from a copy of the tree, so a JSON, npm or `../` import fails there.
- `global/` — the default `config.json` and the dispatcher rubrics.
- `standards/` — shared docs: `help.md` (every skill), `worker-spine.md`, `stand-down.md` and `launch.md` (Gru, Minion and Agnes; `launch.md` is the `--new-tab` launcher block), `preflight.md`, `templates/` and `workflows/`. Change a shared worker rule there, never in one skill.
- `docs/operations/` — `branch-protection.md` and `source-entrypoint-help-audit.md`. `docs/specs/` — this repo's specs, each with its plan and a `.human.md` brief.
- `.github/workflows/` — `ci.yml` and `secret-scan.yml`, both `permissions: contents: read`. Give no workflow here a write permission or an App credential.
- `.stark-gh.json` — njord config: a PR title carries a `STARK-n` scope, except a `--no-ticket` PR, whose title carries none.

## Shipping

- **PRs open as drafts** (`njord pr-open`; skills pass `--draft`). A merge path un-drafts first (`gh pr ready`), which fires CI, then waits for green. Merge once green: no soak, canary or rollout.
- **The admin's token can push to `main`.** Classic protection binds everyone but the admin, so the root rule, not the gate, keeps an agent off `main`.
- **Every PR action uses `gh` as `aryeh-stark`**, review posting included. Review text names the model.
- **No skill or hook runs an identity swap:** `njord fallback on` or `export GH_TOKEN=$(njord user --swap)`. While the fallback is on, `preflight.ts`'s `check_github_user` refuses: that is not a broken login. After a swapped command, run `unset GH_TOKEN GITHUB_TOKEN STARK_GH_USER`, or later PR activity authors as the relief account.
- **Post review findings with `tools/findings_review_post.ts`:** inline where anchored, in the body otherwise. Keep every finding at its severity; fix it or reply on its thread. Never resolve another reviewer's thread.
- **Language:** TypeScript for tooling. POSIX shell only in `tools/check-rest-only.sh`, `stark-build`'s two hook scripts and `stark-gha-cost`'s two `gh` wrappers. Never add Python.
- **Keep it lean:** reuse a tool before you write one; leave no one-off script, dead code or stale doc.

### What `main` gates on

Read `docs/operations/branch-protection.md` before you touch CI or branch controls. The traps:

- Ruleset **23544063** requires four contexts from `ci.yml`: `test`, `typecheck`, `secret scan (tree)`, `actionlint`. Its one bypass actor is the repository admin, so red *can* be merged; never write that it cannot.
- Classic protection on `main` adds a required PR, `required_conversation_resolution` and `required_linear_history`, with `enforce_admins` off. Read both `repos/O/R/rules/branches/main` and `repos/O/R/branches/main/protection`: neither alone is complete.
- `tools/workflow_shape.test.ts` pins `ci.yml`'s shape. A required context is a check-run name, so a job rename orphans it: PUT the ruleset in the same window; a PUT replaces the rule wholesale.
- Never guard a required job with a draft check: GitHub counts a skipped required check as passing.
- The `typecheck` step runs `npm run typecheck`, never `npx tsc`: with no TTY, `npx` downloads a missing package instead of failing.
- Never combine `gh api --slurp` with `--jq` or `--template`; the same test bans it in the whole repo.
- `secret-scan / secret-scan` is not required. The blocking secret gate is `ci.yml`'s `secret scan (tree)`.

### `secret-scan.yml` is not this repo's to edit

- Terraform in `21StarkCom/21stark` (`repos/secret_scan.tf`) owns it. Its apply commits a new render straight to `main` on the admin's exemptions, so turning `enforce_admins` on, or dropping the ruleset's admin bypass, makes that apply fail here.
- Change its template in 21stark, never this file. A hand edit here stalls every `njord fleet apply` in 21stark until a hand `terraform apply` reverts it.
- `tools/repo_contracts.test.ts` pins its shape. A deliberate template change edits that test first.

## Conventions every skill and tool follow

- **`--help` is side-effect-free.** Every skill opens with a `## Help` block that points at `standards/help.md`. Every tool entrypoint exits on `help`, `--help` or `-h` before it does work, and refuses an unknown argument or a missing option value. Use `tools/cli_args_lib.ts`.
- **When you add, move or delete an entrypoint, edit both tables in `docs/operations/source-entrypoint-help-audit.md`** in the same PR. `tools/source_help.test.ts` checks them.
- **One run-as-main guard:** `tools/main_module_lib.ts::isMainModule(import.meta.url)`. No other tool source may mention `process.argv[1]`.
- **`tools/skill_smoke_test.test.ts`** checks each skill's frontmatter, `name:`, help link, in-repo links and `--help` runs. A cross-repo reference needs an entry in its `CROSS_REPO_PREFIXES`. Keep `agnes`, `gru`, `minion`, `stark-ticket`, `goldfinger`, `stark-agent-docs` and `c4-design` model-invocable.
- **Docs:** `/stark-init-docs` scaffolds `docs/adr/`, `docs/specs/` and `docs/retros/` into a target repo; `tools/doc_convention.test.ts` guards it. Never create a `docs/plans/`.
- **Config is JSON; prompts are Markdown.** `tools/stark_config_lib.ts` reads each section from the global `config.json` only. The org → repo `.code-review/config.json` walk feeds preflight's `agents` and nothing else, so a per-repo override of another section is ignored.

## Agents and auth

- **Every dispatch env goes through the credential-scrubbed allowlist** (`tools/agent_env_lib.ts::AGENT_ENV_ALLOWLIST`, `tools/runtime_env_lib.ts`). Keep GitHub, Anthropic and OpenAI credentials and DB connection strings out of any subprocess that reads a prompt. Keep `USER` in: the claude CLI needs it to find its Keychain identity.
- **Claude** runs in `subscription` mode only (`tools/claude_auth_lib.ts`); never inject `ANTHROPIC_API_KEY`.
- **Gemini** auth resolves in `tools/gemini_auth_lib.ts`. Never hardcode the Vertex project or location: `tools/vertex_config_lib.ts` resolves them at runtime. A `-latest` model alias resolves only on the API-key path.
- **Subprocess bounds:** every `gh` call on the posting path goes through `tools/bounded_spawn_lib.ts::spawnBounded`, and agent dispatch uses the same group killer. `tools/check-rest-only.sh` pins the posting path to REST-only `gh`.

## Tools

Each tool's `--help` and file header give its use. The traps:

- `findings_review_post.ts` puts a finding on a generated path in the review body. Keep the config entry `generated_paths.repos["21StarkCom/bifrost"] = {"paths": ["__none__/**"]}`: without it, a default demotes findings on `marketplace.json`.
- `fact_routing_hook.ts` (stark-ops' PostToolUse hook) flags an auto-memory write whose fact may belong in the vault-ecosystem corpus, and asks the session to move it or keep it. It names no agent file, writes no file, and prints nothing when no fact matches.
- `ask_guard_metric.ts` measures the root rules' "Act, don't ask". `tools/ask_guard_metric.test.ts` holds the `needs-you` mod's tags to the metric's.
- `rules_audit.ts` audits one repo's instruction files against `LOAD_MODEL` in `tools/rules_load_lib.ts`. It walks the disk, not `git ls-files`, since Claude Code loads gitignored instruction files too.
- When you change a loader cap in `tools/memory_tidy_lib.ts` or `tools/rules_load_lib.ts`, change `skill/stark-agent-docs/references/load-facts.md` too; `tools/agent_docs_facts.test.ts` pins them.

## Skills

Read `skill/<name>/SKILL.md` before you change or run a skill. By plugin, as in the manifest:

- **stark-plan**
  - `stark-author` — to write a spec and its plan with the operator.
  - `stark-ticket` — before you write, file or rewrite a ticket.
- **stark-implement**
  - `stark-build` — to build an accepted spec, one headless session per task.
- **stark-analyze**
  - `stark-refactor-plan` — to plan a refactor without a code change.
  - `stark-terraform-review` — to review Terraform or OpenTofu.
  - `stark-terragrunt-review` — to review Terragrunt.
  - `stark-logging` — to add, change or review logging.
  - `stark-fresh-eyes` — for one zero-context check of a doc before it ships.
- **stark-ops**
  - `stark-session` — to start or end a session.
  - `stark-handover` — to pause work, or resume it, across sessions.
  - `stark-release` — to cut a release.
  - `stark-gha-cost` — to cut GitHub Actions and GHAS cost.
  - `stark-bury` — to retire code into the Náströnd graveyard.
  - `stark-memory` — to audit and tidy auto-memory.
  - `gru` — to drive an epic or a ticket list with Minions.
  - `minion` — to work one ticket for a leader.
  - `agnes` — to work one ticket alone, unattended.
  - `lucius` — to open a Lucius brainstorm in its own tab.
  - `goldfinger` — to drive a native app with the goldfinger CLI.
- **stark-constitution**
  - `stark-init-docs` — to scaffold a repo's dev docs.
  - `stark-adr` — to record or supersede an ADR.
  - `stark-persona` — to pick a session persona.
  - `stark-rules-optimizer` — to review a repo's agent files or the memory notes clause by clause.
  - `stark-agent-docs` — before you write anything another agent reads.
- **stark-write**
  - `stark-voice` — to write a message in the author's voice.
  - `stark-story-edit` — to give a long post a story.
  - `stark-blog-sharpen` — to edit a long post hard.
  - `stark-story-judge` — for a cold reader's verdict on a post.
  - `stark-jury` — to run a post skill on three models.
- **stark-design**
  - `stark-design-tokens` — to build or govern design tokens.
  - `c4-design` — to change a product's C4 model with floorplan.

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
