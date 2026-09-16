# Repository Guidelines

## Project Structure & Module Organization

The **stark-skills** repo is the source of truth. Here, `catalog/<bundle>/bundle.yaml` (metadata + `skills:`/`commands:` membership) and `catalog/<bundle>/mcp/` are **curated**; `catalog/<bundle>/{skills,commands}`, `vendor/stark-skills/`, and `vendor/runtime-overrides/codex/` are **generated** by `go run ./cmd/stark sync --from <stark-skills> ../catalog` (do not hand-edit). Generated artifacts also include `index.json`, `bundles/*.json`, `dist/claude/**`, `dist/codex-plugins/**`, `.claude-plugin/**`, and `.agents/plugins/marketplace.json`; regenerate via `stark build` instead of hand-editing. `dist/codex/` and `dist/gemini/` are ignored standalone install outputs. `schema/` holds public JSON schemas. `engine/` is the main Go module: CLI code is in `engine/cmd/stark`, packages in `engine/internal`. `server/` is the static-origin Go module. `web/` is the TypeScript Vite SPA; code is in `web/src`, fixtures in `web/src/__fixtures__`.

## Build, Test, and Development Commands

- Vendored skill tools require Node ≥ 24 for plain TypeScript and SQLite. `stark doctor` enforces this floor.
- `cd engine && go test ./... -count=1 && go vet ./...`: engine test/vet.
- `cd engine && go run ./cmd/stark sync --from ../../stark-skills ../catalog`: regenerate catalog skills/commands + vendor snapshot from stark-skills (`--check` = drift gate).
- `cd engine && go run ./cmd/stark validate ../catalog`: catalog validation.
- `cd engine && go run ./cmd/stark build --check ../catalog`: drift check.
- `cd engine && go run ./cmd/stark build --fix ../catalog`: regenerate artifacts.
- `cd engine && go run ./cmd/stark check-bumps ../catalog`: version immutability.
- `cd engine && go run ./cmd/stark install stark-ops/stark-session --runtime codex --dest /tmp/stark-codex --plan --index ../index.json --bundles ../bundles --catalog ../catalog`: preview Codex output.
- `cd server && go test ./... -count=1 && go vet ./...`: server test/vet.
- `cd web && npm ci && npm run dev`: install dependencies and start Vite.
- `cd web && npm test && npm run lint && npm run build`: Vitest, ESLint, build.

## Coding Style & Naming Conventions

Use `gofmt` and `go vet`; Go package names stay lowercase. TypeScript is strict and ESLint forbids `any`; prefer `web/src/types` models. React components use `PascalCase`, utilities use `camelCase`, and catalog IDs use kebab-case. Keep generated files deterministic and LF-only.

## Testing Guidelines

Go tests use `_test.go` files beside packages. Web tests use Vitest with `.test.ts` or `.test.tsx`. For catalog/schema edits, run validation, build drift, and bump checks. For Codex adapter changes, update `engine/internal/adapter/codex/testdata/*.golden` only with `go test ./internal/adapter/codex -update`, then rerun normal tests.

## Codex Agent Notes

Skill behavior comes from stark-skills. Keep runtime-specific changes upstream and regenerate both plugin formats. A shared-asset change re-vendors into EVERY bundle, so every bundle must bump — `check-bumps` now enforces that (it digests the shared `vendor/stark-skills/` snapshot per bundle and fails naming each one; `docs/scripts/publish.sh` patch-bumps them for you). Until STARK-4986 this paragraph said "remember to compare every dist tree"; it was written down, it was read, and the trap still worked (PR #244 nearly shipped six bundles of changed bytes under unchanged versions).

Prefer editing `catalog/`, `engine/`, `server/`, or `web/src/` over generated outputs. Standalone Codex installs render to `.agents/skills/<name>/SKILL.md`; native marketplace packages render separately to `dist/codex-plugins/<bundle>/skills/<name>/SKILL.md`, with invocation policy in `agents/openai.yaml`. Commands, prompts, and agents become skills. Per-skill `references/`, `scripts/`, and `assets/` are vendored beside them. MCP fragments merge into `.codex/config.toml` for standalone installs; native plugin MCP requires plugin-root `.mcp.json`. Secret environment variables use Codex's `env_vars = ["ENV_KEY"]` forwarding contract rather than literal `${ENV_KEY}` values. Never commit local install outputs such as `.codex/`, `.stark/`, or arbitrary `.agents/` content; the generated `.agents/plugins/marketplace.json` is the sole exception.

## Commit, PR, and Security Guidelines

Recent commits use scope or slice prefixes: `Slice 8: Security hardening...` and `web-deploy: ...`. PRs should describe changes, list validation commands, link issues, include web screenshots, and call out generated artifacts. Do not commit secrets; CI scans the tree and PR history with gitleaks.

`.github/workflows/ci.yml` is the only `pull_request` workflow; its five jobs — `engine (validate + drift + tests)`, `secret scan (catalog)`, `web build`, `server (static origin)`, `actionlint` — are the required status contexts on `main`. A context string is the job's `name:`, so renaming a job orphans the requirement; update the ruleset in the same change. Never add a draft skip guard (`if: github.event.pull_request.draft == false`) or a `paths:` filter to `ci.yml` — a guarded job reports `skipped`, which GitHub counts as satisfying a required check. Enforcement lives in a repository ruleset, not classic branch protection; read both `gh api repos/21StarkCom/bifrost/branches/main/protection` and `gh api repos/21StarkCom/bifrost/rulesets`. Contract and operator-only APPLY commands: `docs/operations/branch-protection.md`. Changing branch protection or rulesets is an operator gate — never run those mutations from an agent, skill, hook, or CI.
