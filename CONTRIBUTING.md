# Contributing

This repo distributes code that runs inside developer agents (and, for `mcp/` entries, on developer machines). Every change goes through a fail-closed CI gate and CODEOWNERS review. Read [`docs/SECURITY.md`](docs/SECURITY.md) before touching schemas, adapters, allowlists, or `mcp/`.

## Prerequisites

- Go 1.24 (pinned via `engine/go.mod`)
- Repo access to `21StarkCom/bifrost`

## The standard loop

```bash
# 1. Edit catalog/<bundle>/...  (source of truth)
# 2. Validate + regenerate + drift-check + test
cd engine
go run ./cmd/stark validate ../catalog          # schema + cross-refs (fail-closed)
go run ./cmd/stark build ../catalog             # regenerate Claude/Codex plugin trees + manifests + registry
go run ./cmd/stark build --check ../catalog     # drift gate (must be clean)
go run ./cmd/stark check-bumps ../catalog       # version-bump immutability
go test ./... -count=1
go vet ./...

# 3. Commit BOTH the catalog change AND the regenerated dist/index/bundles.
```

`go run ./cmd/stark lint ../catalog` runs the body suspicious-pattern scan. It's non-blocking but worth reading before opening a PR.

CI (`.github/workflows/ci.yml`) runs the same steps plus `gitleaks`. Anything blocking locally will block in CI.

## Adding or changing an artifact

1. Edit the right place under `catalog/<bundle>/`:
   - `skills/*.md` — agent skills (instruction text).
   - `commands/*.md` — slash commands.
   - `agents/*.md` — agent definitions.
   - `prompts/*.md` — prompts.
   - `mcp/*.{json,toml}` — MCP server configs (highest-trust — see "MCP & allowlists" below).
2. If the artifact's body or metadata changed, **bump its `version` in the frontmatter**. `stark check-bumps` enforces immutability of `(name, version)` content.
3. Update the bundle's `bundle.yaml` if you added/removed an artifact.
4. Regenerate (`stark build`) and commit both native package trees, both marketplace manifests, `index.json`, and `bundles/<bundle>.json` together with your catalog change. One PR, one coherent diff.

## Adding a new bundle

1. Create `catalog/<new-bundle>/bundle.yaml` matching `schema/bundle.schema.json`.
2. Add artifacts (at minimum one).
3. `stark validate` then `stark build`.
4. Regenerate both `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`; do not register either manifest by hand.
5. Commit catalog + regenerated outputs + manifest entry.

## MCP & allowlists

`mcp/` entries spawn commands on developer machines. They are the highest-trust surface in the repo.

- `command` values must be present in `engine/internal/validate/allowlist.go`.
- `agent.tools` entries must be present in `engine/internal/validate/toolsallow.go`.
- To widen either list: PR touching **only** the allowlist file with a one-paragraph justification (what the binary/tool does, why it is needed, who maintains it). `CODEOWNERS` assigns `@aryeh-stark` as the reviewer; it is not an enforced merge gate today (`docs/SECURITY.md` §3).
- Prefer pinned, well-known binaries (`node`, `uvx`) and first-party `stark-*-mcp` servers over ad-hoc tools.

## Adapters & schemas

- Per-runtime adapters live under `engine/internal/adapter/{claude,codex,gemini}` with golden tests. If you change adapter output, expect goldens to update and `stark build --check` to drift — regenerate and commit.
- Schemas in `schema/` are versioned. Breaking changes need a `schemaVersion` bump and a migration note in the PR description; the engine fails closed on skew.

## PR checklist

- [ ] `stark validate` clean
- [ ] `stark build --check` clean (regenerated outputs committed)
- [ ] `stark check-bumps` clean (versions bumped where content changed)
- [ ] `go test ./...` and `go vet ./...` pass
- [ ] If `mcp/` or allowlist changed: justification in PR body, second reviewer assigned
- [ ] If schema changed: migration note + `schemaVersion` bump
- [ ] No hand edits to `dist/`, `index.json`, or `bundles/*.json`
- [ ] No secrets — `gitleaks` will block, but check yourself first

## Branch protection & merging

`main` is protected: linear history, no force-push, no admin bypass, and the required CI contexts in the `Required CI on main` ruleset. Approval counts are **0** and code-owner review is **off** on this one-operator repo — the gate on high-trust paths (artifact bodies, `mcp/`, schema, signing) is the mandatory `/code-review xhigh --fix` round, not an approval count; see [`docs/SECURITY.md`](docs/SECURITY.md) §3 and §5. Squash-merge. Merging triggers `sign-manifest.yml`, which signs the build manifest via GitHub OIDC → sigstore/cosign keyless (Fulcio + Rekor). See [`docs/SECURITY.md`](docs/SECURITY.md) §1.

## Reporting security issues

Don't open a public issue. Email engineering@21stark.com or contact `@aryeh-stark` directly.
