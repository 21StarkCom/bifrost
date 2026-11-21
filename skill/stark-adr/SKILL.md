---
name: stark-adr
description: >-
  Record and manage Architecture Decision Records (ADRs) under a repo's
  docs/adr/. Use for: new ADR, log/record a decision, "create an ADR",
  supersede an ADR, list ADRs, "why did we decide X". Wraps `brain adr` —
  MADR-lite, auto-numbered, repo-relative.
argument-hint: "[new \"<title>\" | list | supersede <n> \"<title>\"] [--status Proposed|Accepted] [--dir .]"
disable-model-invocation: true
---

## Help

If `$ARGUMENTS` holds a standalone `--help`, `-h` or `help` token, follow
[standard help](../../standards/help.md), then stop.

# stark-adr

Manage Architecture Decision Records the way the doc convention defines them:
`docs/adr/NNNN-kebab-title.md`, **MADR-lite** (Status / Context / Decision /
Alternatives / Consequences), one decision per file, numbered monotonically,
immutable — supersede, don't edit. See `docs/CONVENTIONS.md` in `21StarkCom/atlas`.

This skill is a thin wrapper over the `brain adr` command group, so the CLI and
the skill share one tested engine.

**Raw input:** `$ARGUMENTS`

## Prerequisite

`brain` must be on PATH. It is the **TypeScript Atlas engine** (`21StarkCom/atlas`,
`atlas/apps/cli`).

```bash
brain adr list   # verify brain is on PATH and the adr group is available
```

If `brain` is missing, install it: `brew install 21StarkCom/tap/brain`. The
formula is for macOS on Apple silicon only; elsewhere, build `atlas/apps/cli`
and put its `brain` on PATH. Do not hand-roll the ADR file: one engine writes
each ADR.

## Operations

`brain adr` is **repo-relative and vault-independent**: it operates on `--dir`
(default the current directory) `docs/adr/`, and creates `docs/adr/` if absent —
so it works in, and bootstraps, any repository.

### new — scaffold a decision

```bash
brain adr new "<title>" [--status Proposed|Accepted] [--dir .]
```

Auto-numbers (next `NNNN`), slugs the title, renders the MADR-lite template, and
prints the new path. Default status is `Proposed`. After scaffolding, **open the
file and fill in Context / Decision / Alternatives / Consequences** — the command
writes the skeleton, you write the decision. Flip to `Accepted` once decided.

### list — see the decision log

```bash
brain adr list [--dir .]      # number, status, title  (add --json for machine output)
```

### supersede — replace a decision

```bash
brain adr supersede <number> "<new title>" [--dir .]
```

Flips ADR `<number>`'s status to `Superseded by [NNNN](…)` and scaffolds the
successor (status `Accepted`) with a `Supersedes [<number>](…)` back-pointer.
Then fill in the new ADR's body. Never edit an accepted ADR in place — supersede.

## When to write one

Per the convention's tiers, write an ADR only for a non-obvious or
hard-to-reverse decision with real trade-offs (an architectural choice, a tech
selection, a cross-cutting policy), not for routine work. Trivial → the PR
alone; feature → a spec, which carries the plan; architectural → an ADR and a
spec.

## Notes

- All output goes to the repo's `docs/adr/`; nothing touches a vault or the MCP
  surface.
- `--json` is available on `new` / `list` / `supersede` for scripting.
- To bootstrap the whole docs structure (not just `docs/adr/`), use
  `/stark-init-docs` first; this skill manages the ADRs within it.
