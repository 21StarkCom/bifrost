---
name: stark-rules-optimizer
description: >-
  Audit one repo's agent instruction files (.claude/rules, CLAUDE.md, AGENTS.md) against how Claude Code and Codex actually load them, and report what to cut, scope, fix or merge: rules that load every session, dead or over-broad paths: globs, size budgets, dead references, duplication, contradictions, ticket-history bloat. Read-only by default; --apply fixes through the repo's own PR spine. Use for rules audit, optimize CLAUDE.md, trim agent rules, rules load every session.
argument-hint: "[--repo <path>] [--apply] [--always <rule,…>] [--file-budget <bytes>] [--always-budget <bytes>]"
disable-model-invocation: true
---

## Help

If `$ARGUMENTS` requests help (a standalone `--help`, `-h`, or `help` token),
follow [standard help](../../standards/help.md): print this skill's purpose,
usage, and arguments, then stop — do not run any phase.

# stark-rules-optimizer

A repo's instruction files decide what every agent session starts with, and
nothing measures them. A rule with no `paths:` header loads into every Claude
Code session; a glob that matches nothing never loads its rule; an AGENTS.md
chain past 32 KiB is silently cut by Codex; a file that names a deleted path
sends the agent looking for it. This skill measures all of that for one repo,
then judges what code cannot, and reports each defect with `file:line`,
evidence and a proposed fix.

The deterministic half is `tools/rules_audit.ts` (load scope, globs, sizes,
dead links, imports and paths). The judgement half — identifiers, commands and
flags, duplication, contradictions, the repo's own policies, narrative bloat —
is yours, in Phase 2, and it starts from the tool's `candidates[]`.

## Arguments

| Arg | Default | Description |
|-----|---------|-------------|
| `--repo <path>` | cwd | The target repo (any path inside it). One repo per run. |
| `--apply` | off | After the report, fix the findings on a branch of the target repo and carry them to a reviewed **draft** PR through that repo's spine. Never merges, never commits to `main`. |
| `--always <rule,…>` | read from the repo | Rules the repo means to load every session, when its CLAUDE.md / AGENTS.md does not say so in words the tool can read ("always-loaded `x.md`"). |
| `--file-budget <bytes>` | 16384 | Advisory per-file budget (injected bytes). |
| `--always-budget <bytes>` | 32768 | Advisory total for everything loaded at session start. |

**Raw input:** `$ARGUMENTS`

## Constants

Shell state does not persist between blocks; define these in every block that
uses them. macOS has no `timeout(1)` — never wrap the tool in one.

```bash
TOOLS="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools"
audit() { node --no-warnings "$TOOLS/rules_audit.ts" "$@"; }
```

---

## Phase 1: Measure

Put the `--repo` value (default `.`) in place of `<repo>`:

```bash
TOOLS="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools"
audit() { node --no-warnings "$TOOLS/rules_audit.ts" "$@"; }
REPO=$(git -C "<repo>" rev-parse --show-toplevel)
OUT="${STARK_STATE_ROOT:-$HOME/.claude/code-review}/history/rules-audit/$(basename "$REPO")/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
audit --repo "$REPO" --json > "$OUT/audit.json"   # pass --always / budgets through
audit --repo "$REPO"                               # the readable summary
```

Exit 2 is a usage error (not a repo, a bad budget, an `--always` name that is
no rule); fix the argument, don't work around it.

`audit.json` holds `loadModel`, `budgets`, `declaredAlways`, `files[]` (each
instruction file's injected size, Claude load — `always` / `on-demand` /
`never` — whether Codex reads it, its `paths:` globs with match counts, and
whether git ignores it), `totals`, `findings[]` and `candidates[]`.

`findings[]` is already `ReportFindings`-shaped (`file`, `line`, `category`,
`severity`, `short_summary`, `summary`, `failure_scenario`, `fix`, `verdict`).
They are measured, not guessed; carry them into the report verbatim. A
`PLAUSIBLE` verdict marks one that depends on runtime state the tree does not
show (Claude's AGENTS.md mode, an empty override, the size-warning threshold).

**Check the load model.** The tool emulates the loaders it was measured
against (`loadModel`). If `claude --version` reports a different Claude Code
version, say so at the top of the report: glob and frontmatter behaviour may
have moved.

## Phase 2: Judge

Work the candidates and the checks code cannot run. Every finding you add
carries `file:line`, the evidence (the command you ran and what it printed, or
the line you compared against) and a proposed fix. **Verify before you
promote**: a candidate you did not check is dropped, with a one-line reason in
the summary — never promoted on suspicion.

1. **Staleness beyond paths.**
   - `identifier` candidates (env vars, symbols absent from the repo's own
     files): grep the dependency that should define them — for Go,
     `go list -m -f '{{.Dir}}' <module>` finds the module source; for Node,
     `node_modules/<pkg>`. Promote only what no source defines.
   - Commands, flags and exit codes a rule states: where the repo declares a
     binary as its catalog (frigg: "the binary is the catalog"), run that
     binary's help for each command named — `<bin> <cmd> -h`, or
     `go run ./cmd/<bin> <cmd> -h` from the repo — and compare. Help only;
     never run a verb that acts.
   - `path` and `bare-file` candidates: decide whether the reference names
     another repo, a runtime artifact, an example, or something dead.
   - A file dense with checkable claims can get one zero-context pass under
     [stark-fresh-eyes' contract](../stark-fresh-eyes/SKILL.md): one
     read-only subagent, a different method, findings dispositioned once.
2. **Duplication and contradiction.** `duplicate` candidates list places that
   load into the same session. Keep one statement, in the narrowest file every
   reader of it loads, and propose deleting the rest. For contradictions, read
   the co-loading pairs — root CLAUDE.md against each rule, each rule against
   the rules it shares globs with, CLAUDE.md against AGENTS.md — and report
   statements that cannot both hold. A nested AGENTS.md overriding its root
   inside its own subtree is Codex's precedence working, not a conflict.
3. **The repo's own policies.** Read the root CLAUDE.md and AGENTS.md for
   rules about instruction files ("verb and flag lists live only in `-h`";
   "AGENTS.md and CLAUDE.md must agree"; "no incident narratives or ticket
   history"). Check every instruction file against each and cite the policy's
   `file:line` as evidence. Where the repo declares the two files mirrors,
   report where they diverge rather than where they repeat each other.
4. **Narrative bloat.** `narrative` candidates are paragraphs dense with ticket
   ids, dates and live-verify words. Promote one when the repo bans such
   content or the file loads every session; the fix condenses it to the rule
   that remains true today and leaves the history to the ticket or PR.

Promoted findings use `category` `staleness`, `duplication`, `contradiction`,
`policy` or `narrative-bloat`; `verdict` `CONFIRMED` when a command or a
quoted line proves it, `PLAUSIBLE` when it is judgement; `severity` `high` for
a contradiction or anything in an always-loaded file that misleads, `medium`
otherwise, `low` for cosmetic.

## Phase 3: Report

Write `$OUT/findings.json`: `{ "level": "rules-audit", "repo", "loadModel",
"findings": [...] }` — the tool's findings verbatim plus the ones you promoted,
most severe first. It is `ReportFindings`-shaped, so
`tools/findings_review_post.ts --findings "$OUT/findings.json"` can post it on
a PR. Then print:

```
/stark-rules-optimizer — {repo}   load model {loadModel}{, claude now X.Y.Z if different}

Always loaded: {bytes} (~{tokens} tokens) of {budget}; declared always-loaded: {rules or none}
Findings: {n} (high {h}, medium {m}, low {l}) — {k} from the tool, {p} promoted in review
Candidates: {n} checked, {p} promoted, {d} dropped ({reasons, grouped})

{severity} {category} {file}:{line} — {short_summary}
    evidence: …
    fix: …

Report: {OUT}/findings.json
```

**Without `--apply`, stop here.** Nothing in the target repo was touched.

## Phase 4: Apply (only with `--apply`)

`--apply` is the operator's go to edit on a branch and open a draft PR — not
to merge. The target repo's own agent instructions file governs everything
below; where it and this list disagree, it wins.

1. **Choose the fix set.** Apply the mechanical fixes: add or narrow a quoted
   `paths:` list, rename a foreign key to `paths`, anchor or delete a dead
   glob, fix an import's punctuation, delete or repoint a dead reference,
   remove a duplicate. Write every new glob from the code the rule is about
   (the packages it names), never from its title. Content rewrites — splitting
   a large rule, condensing narrative — are applied only when the new text
   drops no fact that is still true; otherwise they go in the PR body as
   proposals. Never invent a fact to replace a dead reference.
2. **Ticket first**, in the target repo's list:
   `alfred task new --repo <name> --desc-file <file> "<title>"` with the goal,
   the findings being fixed (`file:line`), acceptance, files and verification.
3. **Branch in a worktree** off the target's default branch, from its main
   checkout (the first `worktree` line of `git -C <repo> worktree list
   --porcelain`):
   `git -C <main> fetch origin` then
   `git -C <main> worktree add -b <branch> <main>/.claude/worktrees/<STARK-n> origin/<default>`.
4. **Edit** in that worktree. Honour the repo's mirror policies in the same
   change (both AGENTS.md and CLAUDE.md).
5. **Verify live**: re-run `audit --repo <worktree> --json`. Every fixed
   finding must be gone, no new one may appear, and every new glob must show a
   non-zero `matches` on the files it was written for.
6. **Draft PR** from the worktree with `idun gh pr-open` (a draft by
   default), title per the target's convention, e.g.
   `docs(STARK-n): scope unscoped agent rules`.
7. **Review**: `/code-review xhigh --fix <full PR URL>` — the full URL, or
   it reviews the wrong repo's diff — then fix or answer every finding, push
   with `idun gh pr-open`, and re-run step 5.
8. **Stop at the reviewed draft PR.** Print the PR URL, the ticket, and the
   two lines the operator runs to finish: `idun gh pr-merge <PR>` and
   `alfred task move STARK-n done`. Never merge; never commit to `main`.

## Failure modes

| Failure | Recovery |
|---------|----------|
| `not inside a git repository` (exit 2) | Point `--repo` at a checkout. |
| `--always names no rule` (exit 2) | Pass rule file names that exist under `.claude/rules/`. |
| A `frontmatter` candidate (YAML the tool does not model) | Confirm the rule's scope in a live session: `/context`, or an `InstructionsLoaded` hook logging `load_reason`. |
| `claude --version` differs from `loadModel` | Report it; treat glob and frontmatter findings as needing a live re-check. |
| The worktree branch already exists (`--apply`) | Someone is on it. Stop and say so; never `--force`. |
