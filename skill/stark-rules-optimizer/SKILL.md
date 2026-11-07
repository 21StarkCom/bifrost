---
name: stark-rules-optimizer
description: >-
  Review one repo's agent files (CLAUDE.md, AGENTS.md, rules, SKILL.md) or the
  auto-memory notes clause by clause against the agent-doc playbook: flag each
  clause GREEN, YELLOW or RED and write its redline. Read-only by default;
  --apply fixes them. Use to review, audit or trim agent files.
argument-hint: "[--repo <path>] [--files <path,…>] [--memory] [--apply] [--always <rule,…>] [--file-budget <bytes>] [--always-budget <bytes>]"
disable-model-invocation: true
---

## Help

If `$ARGUMENTS` requests help (a standalone `--help`, `-h`, or `help` token),
follow [standard help](../../standards/help.md): print this skill's purpose,
usage, and arguments, then stop — do not run any phase.

# stark-rules-optimizer

Review agent files the way a legal team reviews a contract. The
[playbook](../stark-agent-docs/references/playbook.md) holds the standard
position for each kind of clause. This skill reads each file clause by clause,
gives each clause a GREEN, YELLOW or RED flag, and writes the exact redline for
each YELLOW and RED clause. An agent file is a CLAUDE.md, an AGENTS.md, a
`.claude/rules/*.md`, a SKILL.md, a `MEMORY.md` or a memory note.

Two runs of `tools/rules_audit.ts` measure first, with no model:

- **The triage** (`--playbook`) flags each file by size, gate, growth and
  history phrases, copies and dead pointers.
- **The load audit** (no flag) finds what Claude Code and Codex load, and
  when: load scope, globs, sizes and dead references.

The review starts from both outputs and judges what code cannot.

## Arguments

| Arg | Default | Description |
|-----|---------|-------------|
| `--repo <path>` | cwd | The target repo (any path inside it). One repo per run. |
| `--files <path,…>` | every agent file | Review only these agent files of the target. |
| `--memory` | off | Review the auto-memory notes in each `~/.claude/projects/*/memory/`, not a repo. It takes no `--repo`. |
| `--apply` | off | Fix the findings. For a repo: on a branch, through a reviewed **draft** PR in that repo. With `--memory`: in place, after a backup. Never merges, never commits to `main`. |
| `--always <rule,…>` | read from the repo | For the load audit: the rules the repo means to load at each start-up, when its CLAUDE.md or AGENTS.md does not say so in words the tool can read ("always-loaded `x.md`"). |
| `--file-budget <bytes>` | 16384 | The load audit's advisory budget for each file. |
| `--always-budget <bytes>` | 32768 | The load audit's advisory budget for all files that load at start-up. |

**Raw input:** `$ARGUMENTS`

## Constants

Shell state does not persist between blocks. Define these in each block that
uses them. macOS has no `timeout(1)`: never wrap the tool in one.

```bash
TOOLS="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools"
audit() { node --no-warnings "$TOOLS/rules_audit.ts" "$@"; }
```

---

## Phase 1: Measure

For a repo, put the `--repo` value (default `.`) in place of `<repo>`:

```bash
TOOLS="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools"
audit() { node --no-warnings "$TOOLS/rules_audit.ts" "$@"; }
REPO=$(git -C "<repo>" rev-parse --show-toplevel)
OUT="${STARK_STATE_ROOT:-$HOME/.claude/code-review}/history/rules-audit/$(basename "$REPO")/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
audit --playbook --repo "$REPO" --json > "$OUT/triage.json"; echo "triage exit $?"
audit --repo "$REPO" --json > "$OUT/audit.json"   # pass --always and the budgets through
```

For `--memory`, run the triage alone:

```bash
TOOLS="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools"
audit() { node --no-warnings "$TOOLS/rules_audit.ts" "$@"; }
OUT="${STARK_STATE_ROOT:-$HOME/.claude/code-review}/history/rules-audit/memory/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
audit --playbook --memory --json > "$OUT/triage.json"; echo "triage exit $?"
```

- Triage exit 0 or 3 is a result: exit 3 means a file is RED. Exit 2 is a
  usage error (not a repo, a bad budget, an `--always` name that is no rule).
  Fix the argument. Do not work around it.
- With `--files`, the triage still runs on the whole target, so copies and the
  start-up load set stay exact. Review only the named files.
- `triage.json` has `files[]`: each file's `path`, `kind`, `chars`, `budget`,
  `flag` and `clauses[]` (`flag`, `type`, `line`, `text`, `detail`).
- `audit.json` has `loadModel`, `files[]` (each file's `claude` load:
  `always`, `on-demand` or `never`; its Codex load; its `paths:` globs with
  match counts), `findings[]` and `candidates[]`.

**Check the load model.** The load audit emulates the loaders in its
`loadModel`. When `claude --version` prints another Claude Code version, say so
at the top of the report: glob and frontmatter behaviour may have moved.

## Phase 2: Read the standard

Read these files whole before the first clause:

1. The [playbook](../stark-agent-docs/references/playbook.md), the
   [glossary](../stark-agent-docs/references/glossary.md) and
   [the review method](references/review.md).
2. The files above the target in the playbook's order of precedence:
   `~/Code/CLAUDE.md`; `~/Code/21Stark/CLAUDE.md` for a repo under it; the
   repo's root CLAUDE.md and AGENTS.md; and the CLAUDE.md of each folder above
   a package file.
3. For each file, its siblings in the same load set:
   - A file whose `claude` load is `always`: the other files that load at
     start-up.
   - A package CLAUDE.md: each rule whose `paths:` globs match its folder.
   - A rule: the files it shares globs with.
   - A SKILL.md: the `references/` files it links.
   - A memory note: the `MEMORY.md` of its folder and the notes it links.
4. For a memory note, the repo of its folder is the target repo of step 2.
   Claude Code names the folder after the session's path, with each `/` and
   `.` written as `-`. Find the repo with `ls -d` on the candidate paths under
   `~/Code`.

## Phase 3: Review

Review each agent file of the run clause by clause, by
[the review method](references/review.md).

- **Batches.** A run of 8 files or fewer, under 100k chars in all, needs no
  subagent. Otherwise, split the files by folder into batches under 100k
  chars, so a file and its siblings share a batch. Give each batch to one
  read-only subagent (the Agent tool on Claude), with
  [the brief](references/review.md#the-brief). Run at most 8 at once. When
  the runtime has no subagents, review the batches in turn.
- **The tools' output is input.** Each triage clause becomes an entry, unless
  the review reads the clause and changes its flag: a gate phrase in a kept
  gate is GREEN. Check each `findings[]` and `candidates[]` item of
  `audit.json` by [the method](references/review.md#the-load-audit).
- **Verify each RED** before you report it. Read the clause and the evidence
  it cites again: the higher clause at its `path:line`, the `ls` of a dead
  path, or the help output of a gone flag. A RED that does not hold takes its
  true flag. The report counts these changes.

## Phase 4: Report

Print the report, and write the same text to `$OUT/review.md`:

```
# Agent-doc review: {repo name, or memory}   load model {loadModel}{, claude now X.Y.Z if different}
{n} files · GREEN {g} · YELLOW {y} · RED {r} · {c} REDs changed in verification

## Agent-doc review: {path}
Size {chars} / {budget} · {loads at start-up | loads on demand | never loads} · GREEN {n} · YELLOW {n} · RED {n}

### RED 1 · {TYPE} · {path}:{line}
Clause: "{the clause}"
Playbook: {the playbook rule, and its evidence}.
Redline: {the exact new text, or "delete the clause"}.
Fallback: {the second position, or "none (Tier 1)"}.

### YELLOW 1 · {TYPE} · {path}:{line}
…
```

- The second line counts files by their flag after the review.
- A file section lists its RED entries, then its YELLOW entries, each set
  numbered from 1. Each YELLOW entry has a `Playbook:` line, as each RED
  entry has.
- A file with no YELLOW or RED clause gets no section.
- The start-up files come first, then the rest by path.
- [The method](references/review.md#write-the-entry) defines `{TYPE}`, the
  load words and each line of an entry.

**Without `--apply`, stop here.** Nothing in the target repo or in a memory
folder changed.

## Phase 5: Apply to a repo (only with `--apply`)

`--apply` edits on a branch of the target repo and opens a draft PR. The
target repo's own agent instructions file governs each step below. Where it
and this list disagree, it wins.

1. **Choose the fix set** by the playbook's tiers: each RED (Tier 1), each
   YELLOW in a file that loads at start-up (Tier 2), and each other YELLOW in
   a file that the PR edits for one of those (Tier 3).
   - Apply each redline. When a redline drops a fact that is still true, apply
     its fallback: move the text to `docs/<path>` behind one pointer.
   - Write each new glob from the code the rule is about, never from its
     title. Never invent a fact to replace a dead reference.
   - Put a redline you cannot check in the PR body as a proposal.
2. **No ticket.** Agent-file fixes are doc and config edits below the root
   ticket bar (`~/Code/CLAUDE.md`), so they ship as a PR alone. Only a fix
   set that clears the bar (it records a decision, or spans more than one PR)
   gets one first: `alfred task new --on-repo <name> --desc-file <file>
   "<title>"`, then carry its id through steps 3, 6 and 8 instead.
3. **Branch in a worktree** off the target's default branch, from its main
   checkout (the first `worktree` line of `git -C <repo> worktree list
   --porcelain`):
   `git -C <main> fetch origin` then
   `git -C <main> worktree add --no-track -b <branch> <main>/.claude/worktrees/<branch> origin/<default>`,
   with a `<branch>` that names no ticket (e.g. `docs/agent-doc-review`):
   `--no-ticket` refuses a branch that carries a ticket key.
   (`--no-track`: a branch that tracks the default branch can push onto it.)
4. **Edit** in that worktree. Keep the repo's mirror policies in the same
   change (both AGENTS.md and CLAUDE.md).
5. **Verify live**: run the triage and the load audit again on the worktree
   (`audit --playbook --repo <worktree> --json` and
   `audit --repo <worktree> --json`). Each fixed clause must be gone, no new
   RED may appear, and each new glob must show a non-zero `matches` on the
   files it was written for.
6. **Draft PR** from the worktree with `njord pr-open --no-ticket` (a draft by
   default) and a plain title, e.g. `docs: apply the agent-doc review`. Put the
   report's first two lines and the proposals in the body.
7. **Review by what the PR changes**, per the root rules' tiers: a PR of
   agent instruction files and rules only is prose and takes none. One that
   also changes a script, config or code takes that tier (for code,
   `/code-review xhigh --fix <full PR URL>`: the full URL, or it reviews the
   wrong repo's diff), then fix or answer every finding, push with
   `njord pr-open`, and re-run step 5.
8. **Stop at the draft PR**, and print its URL. `--apply` never merges and
   never commits to `main`.

## Phase 5: Apply to memory (only with `--memory --apply`)

A memory note is in no repo, so the fix is in place, with no PR.

1. **Back up** each memory folder before the first edit. A copy that fails
   stops the run before any edit.

   ```bash
   for d in ~/.claude/projects/*/memory; do f=$(basename "$(dirname "$d")"); mkdir -p "$OUT/backup/$f" && cp -Rp "$d/." "$OUT/backup/$f/" || { echo "backup failed: $d"; break; }; done
   ```

2. **Fix each RED note** by its redline: rewrite the note, or delete it and
   its line in `MEMORY.md`. Leave each YELLOW note as it is. stark-ops' fact
   routing hook can ask about each write: a fix only narrows or deletes a
   note, so keep the note where it is.
3. **Verify live**: run `audit --playbook --memory --json` again. Each fixed
   RED must be gone, no new RED may appear, and each `MEMORY.md` link must
   still name a file.
4. **Print** each changed note, and the restore line of its folder:
   `cp -Rp "$OUT/backup/<folder>/." ~/.claude/projects/<folder>/memory/`.

## Failure modes

| Failure | Recovery |
|---------|----------|
| `not inside a git repository` (exit 2) | Point `--repo` at a checkout. |
| `--always names no rule` (exit 2) | Pass rule file names that exist under `.claude/rules/`. |
| A `frontmatter` candidate (YAML the tool does not model) | Confirm the rule's scope in a live session: `/context`, or an `InstructionsLoaded` hook that logs `load_reason`. |
| `claude --version` differs from `loadModel` | Report it. Treat the glob and frontmatter findings as open until a live check. |
| A subagent returns no entry for a file | Review that file in the main session. |
| The memory backup fails | Stop before any edit. Report the folder. |
| The worktree branch already exists (`--apply`) | Someone is on it. Stop and say so; never `--force`. |
