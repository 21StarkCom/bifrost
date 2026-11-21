---
name: stark-session
description: >-
  Session start (context, git state, briefing) and end (tests, merge, push). Use for session start/end, catch me up.
argument-hint: "[start|end]"
disable-model-invocation: true
model: opus
revision: 27e35f5d4b6b1e245c6bdd1adf11d8f1ff0233e6
revision_date: 2026-05-18T09:14:41Z
---

## Help

If `$ARGUMENTS` requests help (a standalone `--help`, `-h`, or `help` token),
follow [standard help](../../standards/help.md): print this skill's purpose,
usage, and arguments, then stop — do not run preflight or any phase.

## Preflight

Run [standard preflight](../../standards/preflight.md) with `--workflow stark-session`.

# stark-session

Session lifecycle management: **start** (context load + briefing) and **end** (test + merge + commit + push).

A single TS CLI gathers every fact you need into one JSON blob; you render the briefing/summary directly. No ANSI, no box-drawing — when a collector fails, its slot is `null` and the failure is logged into `errors[]`.

## Arguments

- `/stark-session` or `/stark-session start` — starts a session (default)
- `/stark-session end` — ends a session

**Raw input:** `$ARGUMENTS`

## Constants

```bash
TOOLS="${STARK_REVIEW_TOOLS:-${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools}"
# A function, not a string var: zsh does NOT word-split `$VAR`, so a
# multi-word command stuffed in a variable is run as one bogus command name.
# Define this in the SAME Bash call that uses it (shells don't persist across calls).
session() { node --no-warnings "$TOOLS/stark_session.ts" "$@"; }
```

## Config

The end-mode keys are in the `session` section of the global `config.json`. A repo's `.code-review/config.json` overrides none of them. You read them yourself:

| Key | Default | Notes |
|-----|---------|-------|
| `doc_paths` | `["docs/", "CLAUDE.md"]` | Paths to stage on end |
| `devlog_path` | `null` | Devlog directory |

`session.health_checks` is consumed by the TS CLI directly — you don't run these yourself.

---

## Start Mode

### Phase 0 — Record start HEAD

```bash
SESSION_ID="${CLAUDE_SESSION_ID:-$(node --no-warnings "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools/session_id.ts")}"
START_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
STARTED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
```

### Phase 1 — Gather context (silent)

Read these, and do not display them:
- `CLAUDE.md` from current directory and each parent up to `~`
- Memory files: `~/.claude/projects/*/memory/` matching current project path

(Config + project board context are handled by the CLI in Phase 2.)

### Phase 2 — Collect session state

```bash
STATE_JSON=$(session start \
  --session-id "$SESSION_ID" \
  --start-head "$START_HEAD" \
  --started-at "$STARTED_AT" 2>/dev/null || echo '{}')
```

`STATE_JSON` is the structured briefing. Schema:

```json
{
  "session": { "session_id", "started_at", "branch", "repo",
               "tasks_completed", "last_checkpoint", "name", "start_head" } | null,
  "git": { "branch", "ahead", "behind", "uncommitted", "stashes",
           "recent_commits": [{ "sha", "message", "age" }] } | null,
  "prs": { "mine": [{ "number", "title", "head", "review_decision", "url" }],
           "current_branch": { "number", "title", "state", "review_decision",
                               "checks": { "pass", "fail", "pending" } } | null } | null,
  "board": { "in_flight", "blocked", "needs_attention" } | null,
  "alerts": { "unacknowledged": [{ "level", "message", "context" }] } | null,
  "health": [{ "name", "passed", "detail", "duration" }],
  "healer": { "categories": [{ "name", "count" }],
              "canary": { "circuits_open", "near_promotion" } } | null,
  "skills": { "available": [...], "suggestions": [{ "name", "reason" }] },
  "persona": { "name", "source", "catchphrase", ... } | null,
  "errors": [{ "source", "message" }]
}
```

### Phase 3 — Persist start HEAD

```bash
node --no-warnings \
  "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools/session_state.ts" set \
  --field start_head --value "$START_HEAD" 2>/dev/null || true
```

### Phase 4 — Render briefing

Render `STATE_JSON` as a concise briefing for the operator. Layout guidance:

1. **Header line:** `Session {session.session_id[:8]} · {session.branch} · {session.repo}`
2. **Persona line** (if `persona`): `Persona: {name} ({source}) — "{catchphrase}"`
3. **Alerts** (if `alerts.unacknowledged` is not empty): put them above every other section, each as `[{level}] {message}` with its context below it.
4. **Git**: branch, ahead/behind, uncommitted count, stashes, last 5 commits.
5. **PRs**: open PRs (`mine`), then the current branch PR with check rollup if present.
6. **Board**: `in_flight`, `needs_attention`, `blocked` (omit empty buckets).
7. **Health**: render each result on one line — pass/fail/timeout, name, duration, short detail.
8. **Healer**: top categories from `healer.categories`; flag any `circuits_open` and `near_promotion`.
9. **Skills**: skill `suggestions` (cap 2). The available skills list is for your awareness; do not print it for the operator.
10. **Errors** (if non-empty): brief one-liner at the bottom — *"Couldn't read: X, Y"*.

Omit entire sections that are `null` or empty. Prefer brief, scannable formatting over walls of text.

### Phase 5 — Task list

Build a prioritized task list from the briefing data in this order, including only categories that have items:

1. **Open PRs needing action** — review comments, failing checks, requested changes
2. **Uncommitted changes** — dirty tree, staged files, stashes
3. **Failing health checks**
4. **Board items in flight** assigned to Claude
5. **Alerts** still unacknowledged

End on one line: `Needs you (Yours: scope): start the list from the top, or another focus? I recommend <first item>.`

When the operator picks the list, work it in order with no stop between tasks. Resolve merge conflicts, review findings and failing tests yourself. If every bucket is empty, end on `Needs you (Yours: scope): what do we work on?`

---

## End Mode

### Phase 0 — Persona cleanup

```bash
if [ -f "$HOME/.stark-persona/active.json" ]; then
  node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools/stark_persona.ts" session-end 2>/dev/null || true
fi
```
Show the 20% fun-fact callout, if there is one, after the summary.

### Phase 1 — Tests

Run the repo's build and test commands, as its agent instructions file names them.

On failure, fix it in this session when you can. Otherwise, skip Phase 2's merge and report the failure.

### Phase 2 — Merge open PRs

```bash
gh auth status   # skip with warning if fails
gh pr list --head "$(git branch --show-current)" --json number,title,state
```

Carry each open PR of this branch through the spine: the review its change needs, a fix or an answer for each finding, then `ghx pr-merge`. When a merge fails, report why and go on. Use the existing `gh` login as `aryeh-stark`.

### Phase 3 — Commit docs

Never commit on `main`, or on a branch whose PR Phase 2 merged. In either case, first run `git fetch origin`, then
`git switch -c docs/session-<YYYY-MM-DD> origin/<default branch>`: the uncommitted doc changes move with you.

Stage paths from `session.doc_paths`. If `session.devlog_path` is set, write a one-line summary of the session to `<devlog_path>/YYYY-MM-DD.md`, and stage it. Write the commit summary yourself.

Skip the commit if `git diff --cached --stat` is empty. Otherwise:

```bash
git commit -m "docs: session update — <summary>"
```

### Phase 3b — Session checkpoint

```bash
node --no-warnings \
  "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools/context_compactor.ts" --json 2>/dev/null || true
node --no-warnings \
  "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools/session_state.ts" --json 2>/dev/null || true
```

Both are best-effort. Note the checkpoint path in the summary.

### Phase 4 — Project field updates

If `.github/project-config.json` exists: pull issue numbers from this session's commits. For commits referencing an issue that also modified `docs/`, set Documentation State to `Drafted` (only if currently `Not Started`). Do not override `Reviewed` or `Complete`. Log warnings — never block session end.

### Phase 5 — Push

Never push `main`: on `main`, Phase 3 commits on a new branch. Push the branch when it has commits that `origin` lacks: `git push -u origin <branch>` when it has no upstream, else `git push`. When the branch has no open PR, open one with `ghx pr-open --no-ticket`. `ghx pr-open` stages every change in the tree, so run it only when `git status --porcelain` prints nothing; otherwise report the open changes and open no PR. On failure, report it and go on.

### Phase 5.5 — Derive session name

In priority order, derive a slug (lowercase, hyphens, max 50 chars) from:

1. PRs merged in this session
2. Issues closed in this session
3. Branch name
4. Most common commit prefix
5. `session-$SESSION_ID`

You compute this — no CLI call needed; you have all the inputs from accumulated phase results.

### Phase 6 — Collect end state + render summary

```bash
END_JSON=$(session end \
  --session-id "$SESSION_ID" \
  --start-head "$START_HEAD" \
  --started-at "$STARTED_AT" \
  --name "$SESSION_NAME" 2>/dev/null || echo '{}')
```

Schema:

```json
{
  "session": { "session_id", "branch", "repo", "started_at",
               "name", "start_head", "ended_at" },
  "diff": { "added", "removed", "file_count",
            "key_files": [{ "path", "added", "removed", "status" }],
            "approximate" } | null,
  "branch": { "ahead", "behind", "upstream", "has_pr" },
  "errors": [{ "source", "message" }]
}
```

Render the end summary:

1. **Header**: `Session {name} · {duration} · {branch}`
2. **Receipt** (from your in-memory accumulator through phases 1–5.5): Tests, Build, PRs merged, Docs committed, Push and the PR it opened — each as pass/fail with a detail and duration.
3. **Diff**: `{added}+ / {removed}- across {file_count} files` + the key files list. Warn if `diff.approximate` is true (start HEAD wasn't recorded).
4. **Branch**: ahead/behind vs upstream, PR link if `has_pr`.
5. **Errors** (if non-empty): brief one-liner.
6. **Persist session name**:

```bash
node --no-warnings \
  "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools/session_state.ts" set \
  --field name --value "$SESSION_NAME" 2>/dev/null || true
```

---

## Failure Modes

| Failure | Recovery |
|---------|----------|
| `STATE_JSON` empty / `{}` | CLI crashed: run `session start …` again without `2>/dev/null` to read the error, then use `git status` and `gh pr list` |
| Specific slot is `null` | Note in `errors[]`; omit that section from briefing |
| `gh` auth fails | `prs` slot null, skip PR sections |
| Not a git repo | `git` and `prs` slots null |
| Test/build fails | Fix it, or skip the merge and report it |
| PR merge fails | Report why, and go on |
| Push fails | Report it, and go on |
| Tree not clean at Phase 5 | Report the open changes; open no PR |
| Project config missing | `board` slot null silently |
| Config missing | Health checks empty, defaults applied for end-mode keys |

> **Trap:** one Bash call in a parallel batch that exits non-zero cancels the whole batch. Add `|| true` to this skill's shell commands; the TS CLI needs none.
