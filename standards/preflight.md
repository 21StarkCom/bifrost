# Skill Preflight Protocol

Standard environment validation that every skill runs before doing real work.
Skills point at this doc instead of inlining the pattern.

## Invocation

```bash
TOOLS="${STARK_REVIEW_TOOLS:-${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools}"
node "$TOOLS/preflight.ts" --workflow <skill-slug> --json
```

The skill provides its own `<skill-slug>` (e.g. `stark-terraform-review`, `stark-refactor-plan`).

## Result handling

Parse the JSON `overall` field:

| `overall` | Action |
|-----------|--------|
| `ready` | Continue silently. |
| `degraded` | Print a one-line warning naming the failing checks, then continue. |
| `blocked` | Print the failing checks and stop. Do not proceed. |

## Non-interactive automation

When the skill runs unattended (scheduled jobs, CI), a
`blocked` result MUST also:

1. Append an entry to `~/.claude/code-review/alerts.jsonl`.
2. Exit non-zero so the caller sees the failure.

Interactive skill invocations skip steps 1–2 and just print + stop.

## Constants

`TOOLS` also locates dispatchers such as `iac_review.ts`.
Preflight checks the existing `gh` login as `aryeh-stark`.
Authentication changes require operator action.

**Why `TOOLS` reads `CLAUDE_PLUGIN_ROOT` before `$HOME`.** Every marketplace
entry ships this whole repo (`"source": "./"`), so inside an installed plugin
Claude Code sets `CLAUDE_PLUGIN_ROOT` to a cache holding the very `tools/` these
skills call. Resolving straight to `$HOME/.claude/code-review/tools` reached out
of the plugin into the operator's own symlink tree instead — a tree that exists
on one machine and points at whatever checkout that operator last linked. The
nested form keeps an installed plugin self-contained and leaves the direct,
non-plugin invocation (where `CLAUDE_PLUGIN_ROOT` is unset) on the home tree,
unchanged. This is the shape every skill body already uses; preflight was the
last file in the repo still on the flat one.

`alerts.jsonl` above deliberately does NOT follow the same chain. It is mutable
STATE, and plugin caches are replaced wholesale on update, so state written
under `CLAUDE_PLUGIN_ROOT` would be lost on the next install and would not be
shared across bundles — the same split `assetRoot()` vs `stateRoot()` enforces
in `tools/asset_root_lib.ts`.
