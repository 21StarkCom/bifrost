# stark-marketplace spec — red-team findings & resolutions

> Historical note, 2026-06-23: current hosting is public at
> `https://marketplace.21stark.com` in `ev-infra-group` without IAP.
> This file preserves the original red-team context.
>
> Update, 2026-09-20 (STARK-7972): the web registry (SPA + static origin) was
> removed; `docs/web-hosting.md` no longer exists and the `marketplace.21stark.com`
> origin is being torn down (STARK-7974). Claude Code installs from
> `.claude-plugin/marketplace.json` + `dist/claude/` on GitHub; `index.json` /
> `bundles/*.json` remain the source of truth, read directly from disk by
> `stark install/search/info`.

**Date:** 2026-06-06 · Four parallel adversarial reviews (security/abuse, architecture,
operability, correctness+runtime-accuracy) against the v1 spec. Resolutions folded into
the v2 spec (`2026-06-06-stark-marketplace-design.md`).

## Critical

| # | Finding | Resolution |
|---|---------|------------|
| C1 | **Self-computed digests = integrity theater** — same build computes + verifies; no trust root outside the repo. | Reframed digests as *consistency/anti-drift*, not provenance. Trust anchor = protected `main` + commit SHA; `stark install` pins/records commit SHA. CI-signed build manifest (OIDC→sigstore) as the provenance path. (§11, §7.5) |
| C2 | **MCP `command`/`args` = install-time RCE** — only absolute-path denylist; misses `$PATH` binaries, `node -e`, `bash -c`, `npx`. | Positive *command allowlist* (basenames), forbid inline-eval arg patterns, mandatory install consent for `mcp`/`agent` classes, extra CODEOWNERS on `**/mcp/**`. (§7.4, §9.3) |
| C3 (ops) | **MCP merge into shared `config.toml`/`settings.json`** unspecified — whole-file clobber, comment loss, races. | Surgical key-scoped merge, comment-preserving TOML, atomic temp+rename, advisory lock, collision→refuse w/o `--force`, manifest records key path. (§9.2) |
| C4 (ops) | **Shared `AGENTS.md`/`GEMINI.md` append corruption** across multi-bundle installs. | Sentinel-delimited managed blocks (`<!-- stark:begin … -->`), parse-replace-by-sentinel, deterministic sort, refuse to clobber unsentineled user content. (§9.2, §6.3) |
| C5 (accuracy) | **Codex has native Skills now** (`.agents/skills/<name>/SKILL.md`); custom prompts deprecated. v1 matrix inverted. | Matrix corrected: skill→Codex = **native**; agent→Codex emulated via Skill (no subagent primitive); prompts marked deprecated. (§6) |

## High

| # | Finding | Resolution |
|---|---------|------------|
| H1 | Adapter conflates author-divergence with emulation scaffolding. | Emulation shape is **adapter-owned**; `overrides.<runtime>` = author intent only. (§4.3, §6.1) |
| H2 | Body-replacement escape hatch becomes the norm. | Body replacement = lint error unless `# diverged: <reason>`; CI prints divergence budget %. (§4.3) |
| H3 | Arrays-replace-wholesale foot-gun on `tags`/`requires`/`mcp.args`. | Keep wholesale (determinism); add validation warning on prefix-mismatch; document loudly. (§4.3) |
| H4 | Bundle = version = install = plugin breaks mixed-support bundles. | Decouple install granularity: bundle-install on runtime R = subset targeting R, skip+report; `<bundle/artifact>` accepted. (§5.2, §9.1) |
| H5 | Determinism unspecified for YAML/JSON/map key order. | Serialization contract: all maps sorted by key, ordered encoders; golden test reorders source keys. (§7.6, §13) |
| H6 | Bodies = prompt-injection vector; no content trust model; agent `tools` uncapped. | Documented trust model; high-trust content review + 2nd reviewer; suspicious-pattern lint; `tools` allowlist + surfaced in index. (§7.4) |
| H7 | Secret heuristic weak; `env` string values allowed; args/url unscanned. | `secretRef` structurally required (env values must be objects, no string form); scan args/url; gitleaks in CI. (§4.4, §7.4) |
| H8 | Partial-install failure has no rollback; manifest flush timing. | Stage to temp, pre-validate digests, atomic rename, write-ahead journal, `--remove`/`--repair` tolerant. (§9.4) |
| H9 | Drift gate on committed `dist/` = merge-conflict + DX trap + bypass risk. | Commit **only** `dist/claude/` + lean `index.json`; `dist/codex|gemini` not committed (built on install); `.gitattributes` linguist-generated; CODEOWNERS + required non-bypassable check. (§5.1, §7.7, §14) |
| H10 | Determinism fragile to env (CRLF, locale, Go/lib version). | Normalize LF, `/` separators, sort walks; pin Go toolchain + libs; `.gitattributes eol=lf`. (§7.6) |
| H11 | Immutability digest false-positives; adapter-bump direction wrong. | Version-bump gate hashes *normalized canonical source* (display metadata excluded); install/provenance digest = *generated output incl adapterVersion*. (§11) |
| H12 (accuracy) | Codex prompt invocation is `/prompts:<name>` and deprecated. | Documented; map command→skill on Codex; prompts parity-only + deprecated note. (§6) |
| H13 (accuracy) | Per-field mapping undefined when target lacks the field (`model`, `argument-hint`, `disable-model-invocation`). | Per-field capability fallback table: carry / map / drop-with-warning / error. (§6.2) |
| H14 (accuracy) | `name` unique per (bundle,type) but multiple types share one output path per runtime → collision. | `name` unique per **bundle across types sharing an output namespace**; validation enforces. (§5.2) |
| H15 (accuracy) | Multi-artifact-same-type → one shared file, no aggregation rule. | Cross-artifact aggregation contract: sentinel sections, stable sort, idempotent. (§6.3) |

## Medium / Low (folded in)

- IAP gates SPA but not index/CLI fetch → all data surfaces behind SSO/private-repo auth; CLI uses authenticated GitHub API. (§10, §9.5)
- `requires` semver ranges over-engineered for single-version monorepo → presence + DAG only; advisory min. (§4.1, §7.3)
- `index.json` won't scale; `schemaVersion` hard break → lean index + per-bundle detail files; additive compat, N-1 support; consumers ignore unknown fields. (§7.5, §10)
- `adapterVersion` bump rollout → per-runtime adapter target versions, surfaced in index, re-install warning, own PR type. (§7.7)
- SPA/index cache mismatch → atomic content-hashed publish, graceful degrade. (§10)
- No failure signal (telemetry deferred) → local observability: install summary, run log, `stark doctor`, emulated-fidelity header. (§9.6, §6.1)
- `stark` bootstrap/self-update unspecified → release binaries, `stark version`/`self-update`, schemaVersion range assert. (§9.7, §16)
- CLI error/exit-code contract absent → exit-code table + `--json`. (§9.8)
- Bundle metadata inheritance unspecified → enumerated inheritable fields + precedence. (§5.2)
- `runtimes` default conflict → artifact defaults to bundle's `runtimes` (single source). (§4.1, §5.2)
- Conditional-fence grammar underspecified + no negative form → strict regex, `!`/except form, error taxonomy. (§4.2)
- `new`/`import` blur authoring vs distribution → clarified as local scaffolding only. (§9, §12)
- MCP `sse` transport deprecated/uneven → dropped; `stdio | http` only. (§4.4)
- marketplace.json: plugin entry uses `author` (not `owner`); root uses `owner`; `source` may be object. (§6, §8)
- Claude skill frontmatter: `argument-hint` is a *command* field; `model` only with `context: fork`. (§6)
- Claude subagent extras (`skills`, `effort`, `background`, `permissionMode`) → added to canonical agent superset. (§6)
- Gemini command TOML = `prompt`+`description` only; args via `{{args}}`. (§6)
- Gemini Extensions evaluated as a possibly-better skill/agent emulation target than `GEMINI.md` blocks. (§15)
