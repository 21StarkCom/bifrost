# Skill Preflight Protocol

Standard environment validation a skill runs before doing real work. A skill
that adopts it points at this doc instead of inlining the pattern; today
`stark-session` is the one skill that links it.

## Invocation

```bash
TOOLS="${STARK_REVIEW_TOOLS:-${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools}"
node "$TOOLS/preflight.ts" --workflow <skill-slug> --json
```

The skill provides its own `<skill-slug>` (e.g. `stark-session`).

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
entry ships this whole repo (`"source": "./"`), so a plugin cache holds the very
`tools/` these skills call, and the nested form is meant to prefer it over the
operator's own symlink tree. It is the shape every skill body uses. Measured at
Claude Code 2.1.284, though, a skill's shell does not have `CLAUDE_PLUGIN_ROOT`
set, and Claude Code substitutes only the bare `${CLAUDE_PLUGIN_ROOT}` token in
a skill body, not this fallback form. So `TOOLS` resolves to
`$HOME/.claude/code-review/tools`, the checkout links `tools/asset_links.ts`
provisions, even inside an installed plugin.

`alerts.jsonl` above deliberately does NOT follow the same chain. It is mutable
STATE, and plugin caches are replaced wholesale on update, so state written
under `CLAUDE_PLUGIN_ROOT` would be lost on the next install and would not be
shared across bundles — the same split `assetRoot()` vs `stateRoot()` enforces
in `tools/asset_root_lib.ts`.
