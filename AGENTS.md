# AGENTS.md — bifrost

`21StarkCom/bifrost` contains 26 runtime-neutral skills, their TypeScript tools, and a Claude Code marketplace serving seven plugins. This is a personal repository with one user.

This is the Codex/Cursor entry point. **Read [CLAUDE.md](CLAUDE.md) before changing the repo**; it is the detailed reference and wins on conflict. Keep both files consistent and limited to current structure, commands, and rules. Do not add incident narratives, migration history, or ticket records. Codex loads at most 32 KiB of project instructions, so keep this file a short index: put detail in `CLAUDE.md`.

## Repository map

| Path | Purpose |
|---|---|
| `skill/` | Canonical `skill/<name>/SKILL.md` files and their supporting references. |
| `tools/` | TypeScript CLIs, libraries, and tests; its own `package.json`. |
| `global/` | Default JSON configuration, configuration reference, and dispatcher prompts. |
| `standards/` | Shared worker protocols, document templates, and workflow guidance. |
| `scripts/` | `healer_patterns.json`. |
| `data/persona/` | Persona roster. |
| `docs/operations/` | Branch protection and the source entrypoint help audit. |
| `.claude-plugin/marketplace.json` | Hand-maintained marketplace manifest. |
| `.github/workflows/` | CI and the fleet secret-scan caller. |

## Development and shipping

- Open or bind an **alfred ticket before editing**. Record the goal, scope, acceptance criteria, affected files, and verification there.
- Every change follows **ticket → branch → draft PR → `/code-review xhigh --fix` → address every finding → `idun gh pr-merge` → close the ticket**. Never commit or push directly to `main`. Close the ticket yourself immediately after the squash merge.
- Open PRs with `idun gh pr-open`. The merge command marks a draft ready, waits for green checks, and squash-merges. Merge once green; no rollout ceremony. For target repos, [skip-draft-guard.md](standards/workflows/skip-draft-guard.md) keeps CI off drafts; never apply it to a required check.
- Use `gh` as `aryeh-stark` for PR actions. Review text identifies the model. `idun user` is human-invoked only; follow the operator's account-rotation rules for rate limits.
- Publish every review's findings with `tools/findings_review_post.ts`: inline where anchored, in the body otherwise. Preserve every finding and its severity. Fix findings or explain their disposition on the thread; never resolve another reviewer's thread yourself.
- Verify the actual surface affected by the change and show the command and output. Exercise GCP and GitHub live when involved. Independently confirm claims that work passed, merged, or closed.
- Update relevant docs, including this file and `CLAUDE.md`, in the same change as behavior, structure, commands, or operational rules.
- Use TypeScript for tooling, Node 24+, `node:` builtins at runtime, and sibling `.ts` imports. POSIX shell is limited to the existing skill hooks, `gh` wrappers, and `tools/check-rest-only.sh`. No Python.
- Reuse existing tools. Keep code and docs lean; remove dead code and stale references. Store secrets only in mimir.

## Skills and plugins

- Edit the canonical `skill/` and `tools/` trees; never write a Codex-specific copy. Claude Code is the only install target, Codex runs the same trees, and Codex and Gemini are also dispatched as review agents. Keep shared instructions runtime-neutral. A Claude skill invocation such as `/agnes` is `$agnes` on Codex.
- The manifest stays at the repo root. Every plugin uses `"source": "./"` and an explicit `skills` list; the seven lists partition the 26 skills. Keep the directory named `skill/` so discovery follows those lists. Recheck discovery after a Claude CLI upgrade.
- When changing a skill, bump every owning plugin's manifest version **in the same PR**. Installed plugins use versioned caches: bump → merge → `/plugin update`. Direct checkout invocations read edits immediately.
- Resolve shipped assets through `tools/asset_root_lib.ts` (`assetRoot()`); keep mutable state under `stateRoot()`. Skills use `${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}`. Do not hardcode asset subdirectories under the home fallback.
- `tools/asset_links.ts` owns the five code-review asset links declared in `tools/asset_links_lib.ts`. Machine settings, hooks, and generated GCP scope belong to stark-workspace. Leave stark-workspace's `.envrc` block and `.worktreeinclude` entry to that provisioner; never add credential files or broad globs to `.worktreeinclude`. Claude- and Codex-managed worktrees copy its entries; a plain `git worktree add` does not, so a helper that creates one copies the named files itself.
- Read a skill's own `SKILL.md` for its arguments and workflow. [CLAUDE.md](CLAUDE.md#skills) maps plugins to skills. Shared worker rules live in [worker-spine.md](standards/worker-spine.md) and [stand-down.md](standards/stand-down.md); change shared rules there.

## Tool and documentation contracts

- Help is side-effect-free. Skills follow [standards/help.md](standards/help.md); tools use `tools/cli_args_lib.ts` and reject unsupported arguments or missing values without swallowing safety flags. When adding, moving, or removing an entrypoint, update both inventory tables in [the help audit](docs/operations/source-entrypoint-help-audit.md).
- Use `tools/main_module_lib.ts::isMainModule(import.meta.url)` for run-as-main detection.
- Config is JSON; prompts are Markdown. Config sections are read from the global `global/config.json` only; the org → repo `.code-review/config.json` walk (`discoverConfig`) feeds preflight's `agents` and nothing else, so a per-repo override of any other section is ignored.
- Keep dispatch credentials filtered through the shared environment helpers. Resolve Vertex project and location at runtime; never hardcode them. Use the shared bounded subprocess helpers for GitHub calls and agent dispatch.
- Preserve `generated_paths.repos["21StarkCom/bifrost"].paths = ["__none__/**"]` in configuration and defaults: every file here is hand-maintained, including the marketplace manifest. See `CLAUDE.md` for review transport contracts.
- Specs include their implementation plan under `docs/specs/`; never create `docs/plans/`. The document scaffold for target repos is defined by `/stark-init-docs`; this repo's standing operational docs are under `docs/operations/`.

## CI and verification

Read [branch-protection.md](docs/operations/branch-protection.md) before changing CI or branch controls.

- Required contexts: **`test`**, **`typecheck`**, **`secret scan (tree)`**, **`actionlint`**. The ruleset permits repository-admin bypass; the agent workflow still requires green checks.
- Classic protection also requires a pull request, conversation resolution, and linear history, and `enforce_admins` applies those to the admin too. Audit both `rules/branches/main` and `branches/main/protection`; neither alone is complete.
- Keep required jobs unconditional, without draft guards or `continue-on-error`. Required contexts match check names; coordinate any rename with the ruleset. `tools/workflow_shape.test.ts` pins CI structure.
- The blocking secret job scans the whole tree and PR commit range and proves both custom gitleaks rules fire. `secret-scan / secret-scan` is additional and is not required.
- `.github/workflows/secret-scan.yml` is a byte-identical Terraform render owned by `21StarkCom/21stark`. Change its template there and bring the render here by PR; fleet-check enrollment also belongs there.

Run from the repo root:

```sh
(cd tools && npm test && npm run typecheck)
claude plugin validate --strict .
node tools/asset_links.ts --check
git diff --check "$(git merge-base origin/main HEAD)"
```

Use focused checks while editing; required PR CI must pass before merge. Skill smoke tests verify skill metadata, links, help behavior, and worker invocability. Repository contract tests verify the marketplace partition and governance docs.
