# AGENTS.md — bifrost

Add only rules, traps and pointers here. Put reasons, history and catalogs in `docs/` or the ticket.

`21StarkCom/bifrost` contains runtime-neutral skills, their TypeScript tools, mods, and a Claude Code marketplace that serves them as plugins.

This is the Codex/Cursor entry point. **Read [CLAUDE.md](CLAUDE.md) before changing the repo**; it is the detailed reference and wins on conflict. Keep both files consistent and limited to current structure, commands, and rules: no incident narratives, history, or ticket records. Codex loads at most 32 KiB of project instructions, so keep this file a short index and put detail in `CLAUDE.md`.

## Repository map

| Path | Purpose |
|---|---|
| `skill/` | Canonical `skill/<name>/SKILL.md` files and their supporting references. |
| `tools/` | TypeScript CLIs, libraries, and tests; its own `package.json`. |
| `global/` | Default JSON configuration, configuration reference, and dispatcher prompts. |
| `standards/` | Shared worker protocols, document templates, and workflow guidance. |
| `mods/` | Claude Code mods, one folder each; each mod's `README.md` holds its behavior. |
| `docs/operations/` | Branch protection and the source entrypoint help audit. |
| `docs/specs/` | This repo's own specs, each with its plan and a plain-English `.human.md` brief. |
| `.claude-plugin/marketplace.json` | Hand-maintained marketplace manifest. |
| `.github/workflows/` | CI and the fleet secret-scan caller. |

## Development and shipping

- Shipping follows the root spine (`~/Code/CLAUDE.md`, "How we ship"), which Codex loads as `~/.codex/AGENTS.md`.
- Open PRs as drafts with `njord pr-open`. The merge command marks a draft ready, waits for green checks, and squash-merges. Merge once green; no rollout ceremony. For target repos, [skip-draft-guard.md](standards/workflows/skip-draft-guard.md) keeps CI off drafts; never apply it to a required check.
- Use `gh` as `aryeh-stark` for PR actions. Review text identifies the model. No skill or hook runs an identity swap (`njord fallback on`, `njord user --swap`).
- Publish every review's findings with `tools/findings_review_post.ts`: inline where anchored, in the body otherwise. Preserve every finding and its severity. Fix findings or explain their disposition on the thread; never resolve another reviewer's thread yourself.
- Use TypeScript for tooling, Node 24+, `node:` builtins at runtime, and sibling `.ts` imports. POSIX shell is limited to the existing skill hooks, `gh` wrappers, and `tools/check-rest-only.sh`. No new Python.
- Reuse existing tools. Keep code and docs lean; remove dead code and stale references.

## Skills and plugins

- Edit the canonical `skill/` and `tools/` trees; never write a Codex-specific copy. Claude Code is the only install target, and Codex runs the same trees. Keep shared instructions runtime-neutral. A Claude skill invocation such as `/agnes` is `$agnes` on Codex.
- The manifest stays at the repo root. Every skill plugin uses `"source": "./"` and an explicit `skills` list; the seven lists partition the skills. Keep the directory named `skill/` so discovery follows those lists.
- A hook that serves a skill ships as an inline `hooks` object on its one plugin entry, running `node "${CLAUDE_PLUGIN_ROOT}/tools/<tool>.ts"` (today: stark-ops' PostToolUse fact-routing hook alone). An edit to that tool or its imports bumps the owning plugin's version, like a skill edit. Never add a root `hooks/`, `skills/`, `commands/`, `agents/`, `output-styles/`, `themes/`, `workflows/`, `monitors/`, `.mcp.json`, `.lsp.json`, `settings.json` or `.claude-plugin/plugin.json`; all seven skill plugins would load it.
- The one entry not sourced from `./` is a mod: a Claude Code plugin of function hooks under `mods/<name>/` with its own entry (`"source": "./mods/<name>"`, no skills, no inline hooks). Read the mod's `README.md` before you change it; `mods/stark-progress/README.md` holds the `~/.cache/stark-progress/` state contract the worker skills write. `tools/repo_contracts.test.ts` (`MOD_SOURCES`) refuses any other non-`./` entry or `mods/` folder, and a mod's `plugin.json` version that differs from its entry's; bump both together.
- When changing a skill, bump every owning plugin's manifest version **in the same PR**. Installed plugins use versioned caches: bump → merge → `/plugin update`. Direct checkout invocations read edits immediately.
- Resolve shipped assets through `tools/asset_root_lib.ts` (`assetRoot()`); keep mutable state under `stateRoot()`. Skills use `${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}`. Do not hardcode asset subdirectories under the home fallback.
- `tools/asset_links.ts` owns the five code-review asset links declared in `tools/asset_links_lib.ts`. Machine settings, machine hooks, and generated GCP scope belong to the idavoll repo (`21StarkCom/idavoll`); only plugin-shipped hooks live here. The one machine asset a tool here installs is the launchd job of `tools/ask_guard_metric.ts --install-schedule`. Leave idavoll's `.envrc` block and `.worktreeinclude` entry to that provisioner; never add credential files or broad globs to `.worktreeinclude`. Claude- and Codex-managed worktrees copy its entries; a plain `git worktree add` does not, so a helper that creates one copies the named files itself.
- bifrost and idun share no code: skills call idun's, njord's and valkyrie's CLIs, but neither repo imports, vendors or generates code from the other, so refuse a design that would link them.
- Read a skill's own `SKILL.md` for its arguments and workflow. [CLAUDE.md](CLAUDE.md#skills) maps plugins to skills. Shared worker rules for Gru, Minion and Agnes live in [worker-spine.md](standards/worker-spine.md), [stand-down.md](standards/stand-down.md) and [launch.md](standards/launch.md) (the `--new-tab` launcher block); change shared rules there, never in one skill.

## Tool and documentation contracts

- Help is side-effect-free. Skills follow [standards/help.md](standards/help.md); tools use `tools/cli_args_lib.ts` and reject unsupported arguments or missing values without swallowing safety flags. When adding, moving, or removing an entrypoint, update both inventory tables in [the help audit](docs/operations/source-entrypoint-help-audit.md).
- Use `tools/main_module_lib.ts::isMainModule(import.meta.url)` for run-as-main detection.
- Config is JSON; prompts are Markdown. Config sections are read from the global `global/config.json` only; the org → repo `.code-review/config.json` walk (`discoverConfig`) feeds preflight's `agents` and nothing else, so a per-repo override of any other section is ignored.
- Keep dispatch credentials filtered through the shared environment helpers. Resolve Vertex project and location at runtime; never hardcode them. Use the shared bounded subprocess helpers for GitHub calls and agent dispatch.
- Preserve `generated_paths.repos["21StarkCom/bifrost"].paths = ["__none__/**"]` in configuration and defaults: every file here is hand-maintained, including the marketplace manifest.
- The fact-routing hook flags an auto-memory write whose fact may belong in the vault-ecosystem corpus. It names no agent file, writes no file, and prints nothing when no fact matches.
- Specs include their implementation plan under `docs/specs/`; never create `docs/plans/`. The document scaffold for target repos is defined by `/stark-init-docs`; this repo's standing operational docs are under `docs/operations/`, its own specs under `docs/specs/`.

## CI and verification

Read [branch-protection.md](docs/operations/branch-protection.md) before changing CI or branch controls.

- Required contexts: **`test`**, **`typecheck`**, **`secret scan (tree)`**, **`actionlint`**. The ruleset permits repository-admin bypass; the agent workflow still requires green checks.
- Classic protection also requires a pull request, conversation resolution, and linear history. `enforce_admins` is off, so the admin can push to `main` directly; only the root rule keeps an agent off it. Audit both `rules/branches/main` and `branches/main/protection`; neither alone is complete.
- Keep required jobs unconditional, without draft guards or `continue-on-error`. Required contexts match check names; coordinate any rename with the ruleset. `tools/workflow_shape.test.ts` pins CI structure. The `typecheck` step runs `npm run typecheck`, never `npx tsc`.
- The blocking secret job scans the whole tree and PR commit range and proves both custom gitleaks rules fire. `secret-scan / secret-scan` is additional and is not required.
- `.github/workflows/secret-scan.yml` is owned by Terraform in `21StarkCom/21stark`, whose apply commits the new render straight to `main` on the admin's exemptions here (turn `enforce_admins` back on or drop the ruleset's admin bypass and that apply fails). Change its template there, never this file: a hand edit stalls every `njord fleet apply` there until a hand `terraform apply` reverts it.

Run from the repo root:

```sh
(cd tools && npm test && npm run typecheck)
claude plugin validate --strict .
node tools/asset_links.ts --check
git diff --check "$(git merge-base origin/main HEAD)"
```

Use focused checks while editing; required PR CI must pass before merge.
