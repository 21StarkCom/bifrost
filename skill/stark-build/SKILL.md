---
name: stark-build
description: >-
  Stage 2 — build an accepted stark-author spec: one fresh headless session per task, held to checks the agent cannot edit, evidence and a commit per green task, a held-out e2e check, one cross-vendor advisory review, one bounded fix round, a draft PR. Use to build or implement a spec.
argument-hint: '<spec-path> [--dry-run] [--no-advisory] [--no-fix] [--stay-draft] [--max-turns N] [--model ID]'
disable-model-invocation: true
---

## Help

If `$ARGUMENTS` contains a standalone `--help`, `-h`, or `help`, follow
[standard help](../../standards/help.md), then stop.

# stark-build — Stage 2: fresh session per task, checks the agent cannot edit

You are the runner: an interactive session that sets up the harness, then
dispatches one fresh headless `claude -p` session per spec task and verifies
each result deterministically. The implementer never grades itself.

Consumes a `/stark-author` accepted spec.

**Non-negotiables:**
- **Completion is a runnable pass/fail check, never a model verdict.** A "done"
  claim is noise.
- **Checks are read-only to the writer, enforced by hooks, not prompts.**
  Anti-cheat prompting alone fails.
- **Abort is a first-class success.** A logged deviation + stop beats a gamed
  green, always.
- **One task per fresh session.** Spec + PROGRESS.md + git are the only
  cross-session memory.
- **Sequential single writer.** No parallel writers in this skill — the
  serialized-integration exception is future work.
- **One advisory review, cross-vendor, at the end, then at most one fix round
  for medium+ findings.** The fix round is single-pass: the deterministic checks
  verify its output, and the advisory reviewer never runs again. Answer each
  finding below medium, and each finding still open after the round, on its
  thread.

**Close stdin on every dispatch.** Put `</dev/null` before the `>` of each
`claude -p` and `codex exec`: an open stdin hangs `codex exec` forever and fails
`claude -p` into its log. The rule covers every process this skill starts:
- **the hooks:** `stop-gate.sh` runs the check with stdin closed, because a Stop
  hook's stdin is the payload pipe;
- **the runner's own check runs** (Phase 2 §Verify 1, Phase 3, Phase 4b): close
  stdin there too, or a check that reads stdin blocks forever.

`protect-paths.sh` is the one deliberate exception — it *must* read stdin to get
the tool payload.

**Raw input:** `$ARGUMENTS`

## Phase 0 — Preflight

1. Resolve `SPEC` to an absolute path; it must contain `accepted-base: <sha>`
   in the header — refuse an ungated spec (send the operator to
   `/stark-author`). Derive `SLUG` from the spec filename
   (strip `YYYY-MM-DD-` prefix and `-spec.md` suffix).
2. Parse `## Tasks`: per task — id, title, declared file set, done-when
   command, depends-on. Topo-sort by declared edges; ties keep spec order.
3. Refuse a task with no machine-checkable done-when (a Stage-1 defect), or
   with `grep -q` in a pipeline (under `pipefail` it can SIGPIPE a still-writing
   producer, so the check fails on success): stop, and return the spec to
   `/stark-author`. Never write a done-when in Stage 2.
4. Verify `git cat-file -e <accepted-base>` in the target repo; run
   `git status --porcelain` — a dirty tree is a hard stop.
5. `--dry-run`: print tier facts — task order, per-task done-when + file
   set, the protected-paths list, per-task dispatch command — then stop.
   Zero side effects.

## Phase 1 — Run setup (once per spec)

State lives outside the repo:
`STATE=${STARK_STATE_ROOT:-$HOME/.claude/code-review}/history/build/<slug>/<run-id>/`
(`run-id` = UTC timestamp; `mkdir -p "$STATE"/{hooks,tasks,evidence}`).

1. **Worktree at the pin:** `git worktree add <wt> <accepted-base>`, then
   branch `build/<slug>` via the create-or-adopt plumbing (never force):
   ```bash
   TOOLS="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools"
   node --no-warnings "$TOOLS/copilot_land.ts" \
     prepare-branch --branch "build/<slug>" --repo-dir "<wt>" \
     --require-base <accepted-base>
   ```
   `--require-base` is mandatory. Then run the checks in
   [branch setup](references/branch-setup.md): a failed one is a hard stop. That
   page also says when you may delete a stale remote branch.
2. **Draft PR immediately** — seed with
   `git commit --allow-empty -m "build(<slug>): run start (accepted-base <sha>)"`,
   then `copilot_land.ts land --repo <owner/repo> --branch "build/<slug>"
   --title "build: <slug>" --body "<spec path + run id>" --repo-dir "<wt>"`
   (draft by default). Prevents base ambiguity.

   Pass `--ticket STARK-n` when the spec names its ticket: `build/<slug>`
   carries no handle. `copilot_land.ts --help` gives the stamping rules, for an
   adopted PR too.
3. **Harness files:** copy this skill's
   [references/hooks/protect-paths.sh](references/hooks/protect-paths.sh) and
   [references/hooks/stop-gate.sh](references/hooks/stop-gate.sh) into
   `$STATE/hooks/`, `chmod +x`. Write `$STATE/protected.list` — one absolute
   path per line, **no trailing slash on directory entries** (`protect-paths.sh`
   also strips them): the spec + its `.human.md` sidecar, every existing test
   file named by any done-when, `$STATE/hooks`, `$STATE/tasks` (check scripts +
   settings), and the repo's CI config dir.
4. **Materialize `$STATE/PROGRESS.md`** (append-only: per-task status,
   evidence pointers, deviations).

## Phase 2 — Per-task loop (sequential)

For each task `<id>`, in topo order:

**Prepare** (`T=$STATE/tasks/<id>`): write `$T/check.sh` = the task's
done-when command verbatim, running in the worktree (`set -euo pipefail; cd
<wt>; <done-when>`) — a piped `grep -q` here means Phase 0 missed a check that
can fail on success: stop, and never rewrite it silently; `$T/settings.json`:

```json
{"hooks": {
  "PreToolUse": [{"matcher": "Edit|Write|NotebookEdit|Bash",
    "hooks": [{"type": "command", "command": "$STATE/hooks/protect-paths.sh $STATE/protected.list"}]}],
  "Stop": [{"hooks": [{"type": "command",
    "command": "$STATE/hooks/stop-gate.sh $T/check.sh $T/blocks $STATE/PROGRESS.md <id>"}]}]
}}
```

(absolute paths, `printf '0' > $T/blocks`); and `$T/prompt.md` from this
template — fill every `<>`:

> Implement exactly ONE task of an accepted spec. Repo: `<wt>`. Spec (read
> it, treat as immutable): `<SPEC>`. Task: `<id> — <title>`. Declared files:
> `<file set>`. Done-when: `<command>`.
> 1. Orient: read the spec's task, `<$STATE>/PROGRESS.md`, and
>    `git log --oneline -15`; run `<cheapest existing check>` to catch
>    undocumented breakage before you build on it.
> 2. Check first: run the done-when; SHOW its failing output before any
>    implementation. If it cannot fail meaningfully (config/docs/wiring),
>    first write the task's verification per the spec's fallback ladder.
> 3. Implement until the done-when passes. Gated files are hook-protected —
>    add NEW tests freely, never edit existing ones.
> 4. Evidence: run checks via `... 2>&1 | tee -a <$STATE>/evidence/<id>.log`.
>    (`$STATE/tasks/` is write-protected; write evidence to `$STATE/evidence/` instead.)
> 5. Touch only the declared files. If you must touch outside the set,
>    append `- [deviation] task=<id> class=<blocked|spec-defect> ...` to
>    PROGRESS.md; if the SCOPE BOUNDARY moves, log `class=scope-move` and
>    stop immediately.
> 6. Finish with exactly one commit: `build(<slug>): <id> <title>`.
> 7. Abort is success: if blocked, log the deviation and stop. The gate
>    accepts a logged deviation — never fake a green.

**Dispatch** (fresh session; budget per task, not per run):

```bash
claude -p --model "<--model | claude-opus-5>" --settings "$T/settings.json" \
  --max-turns "<--max-turns | 30>" --dangerously-skip-permissions \
  "$(cat "$T/prompt.md")" </dev/null > "$T/session.log" 2>&1
```

**Verify (you, deterministically — never ask the session how it went):**
1. Check: run `bash "$T/check.sh" </dev/null` yourself, as a background task →
   green / red. Keep the `bash` prefix: `check.sh` has no shebang and no exec
   bit. Stop a check with the harness's task-stop, or with `kill -- -"$PGID"` on
   the group you recorded. Never kill by pattern. Read
   [check runs](references/check-runs.md) before a long check.
2. Tamper: `git -C <wt> diff --name-only <pre-sha>..HEAD` (plus dirty files)
   ∩ `protected.list` must be empty — a hit aborts the whole run
   (`class=blocked`, harness-tamper note, straight to Phase 5 report).
3. Scope: same diff vs declared file set → out-of-set paths get a deviation
   line (runner-written if the session didn't).
4. Commit: green + uncommitted → commit `build(<slug>): <id> (runner-committed)`;
   red-abort or crash → commit WIP as `wip(<slug>): <id>`. Every green task
   is durable.
5. Append the task entry to PROGRESS.md: status (`green | deviation | crashed`),
   evidence path, blocks count.
6. Crash/timeout without green or deviation → re-dispatch the same task once
   (it resumes from PROGRESS.md + commits — never from zero); still no
   exit → runner writes `class=blocked` deviation and moves on.
7. A `class=scope-move` deviation → stop the run: push what exists, and report
   to the operator, who owns scope.

## Phase 3 — Closing e2e check (held out)

Run the spec's `## Verification` command(s) yourself in the worktree — the
per-task loop never iterates on them. Flaky discipline: re-run the identical
command ≤3×, log every outcome, never edit it.

The e2e command is the longest-running check: run it under Phase 2 §Verify 1's
rules.

- **Green** → proceed.
- **Red with all tasks green** → the divergence signal (build gamed or spec
  mis-decomposed): append it to PROGRESS.md, say it plainly in the report, and
  continue to Phase 4. The Phase 4b round takes the e2e failure as a finding. A
  fix that moves the scope boundary stops the run, as a `class=scope-move`
  deviation does.

## Phase 4 — Advisory review (one-shot; skip with `--no-advisory`)

Skip-rule (speculative, log when used): diff < ~50 changed lines AND only
in-set files AND e2e green.

One reviewer, different model family, fresh context, read-only — codex:

```bash
git -C <wt> diff <accepted-base>..HEAD > "$STATE/final.diff"
codex exec -s read-only "$(cat "$STATE/advisory-prompt.md")" </dev/null > "$STATE/advisory.out" 2>&1
```

`advisory-prompt.md` = the spec text + the full diff + this contract
verbatim: *"Report defects and spec deviations only — bugs, contradictions
with the spec, unmet done-whens, unsafe changes. Absence of findings is a
valid, expected output for sound work. Do not propose refactors, hardening,
or scope the spec did not ask for. Open every finding with a line of exactly
`SEVERITY: critical|high|medium|low` followed by the file:line it anchors to,
a quoted span of the offending code, and the concrete failure scenario. No
other severity words — the runner filters on this token. Severity is the
consequence if left unfixed: critical = data loss / crash on the normal path
/ security hole; high = wrong output or a broken spec contract; medium = a
real defect on a reachable edge path; low = everything else."*

Write each `SEVERITY:` block of `advisory.out` as one ReportFindings entry
(`file`, `line`, `short_summary`, `summary`, `failure_scenario`) in
`$STATE/report.json`, with its severity word first in `short_summary`: the tool
infers severity from `verdict` only. Before any fix, post them all, every
severity, as one review with `tools/findings_review_post.ts`, as `aryeh-stark`:

```bash
node --no-warnings "$TOOLS/findings_review_post.ts" --repo <owner/repo> --pr <n> \
  --findings "$STATE/report.json" --agent codex
```

It anchors what it can and puts the rest in the body; `--agent codex` names the
review model. Never re-run this pass, whatever Phase 4b does.

## Phase 4b — One fix round, medium+ only (skip with `--no-fix`)

Exactly one pass. Not a loop: there is no round 2 under any outcome. Red checks
after the round go to step 4's revert; then answer each open finding as step 5
says.

1. **Select.** Parse `SEVERITY:` tokens from `$STATE/advisory.out` into
   `$STATE/findings.json`; keep `critical|high|medium`. Leave `low` out of the
   round, and answer each low finding on its thread in step 5. An unparseable
   or severity-less block counts as `medium` — fail toward a look, never toward
   a silent skip. A red e2e with all tasks green (Phase 3) counts as one `high`
   finding. No medium+ → log `fix_round=skipped_no_findings` and go to Phase 5.
2. **Scope guard.** Discard each finding anchored outside the run's diff, or
   asking for scope the spec never asked for. Log each discard with its reason,
   and answer it on its thread in step 5. If that empties the set, treat it as
   no-findings.
3. **Dispatch one fresh headless session** by [the fix round](references/fix-round.md):
   the Phase 2 harness, the e2e command as its Stop check, and the fix prompt.
4. **Verify** the round yourself by [the fix round](references/fix-round.md#verify):
   every check again, and a `git revert` of the fix commit when a green check turns red.
5. **Record.** Append to PROGRESS.md: findings selected, fixed, rejected (with
   reasons), check outcome. Post one follow-up PR comment that lists what was
   fixed, what was rejected and why, and what remains open, and answer each open
   finding on its thread. Open medium+ findings after the round → **PR stays
   draft.**

## Phase 5 — Land

1. Mirror every deviation line into the spec's `## Deviations` (append-only;
   task sessions never could). If the spec file exists in the worktree, commit
   the mirror there on `build/<slug>`; else put it in the PR body.
2. Push (plain, never force). Post the run summary comment on the PR:
   tasks green/deviation counts, per-task check tails, evidence dir path,
   e2e outcome, blocks histogram.
3. e2e green + CI green + advisory posted + no medium+ finding left open
   → flip ready (`gh pr ready <n>`) unless `--stay-draft`. Anything red, or
   any medium+ still open (unfixed, rejected by the fix session, or regressed)
   → stays draft. A rejection by the fix session is a claim: the runner closes
   it with a reply on its thread.
4. Clean up: `git worktree remove <wt>` only when the tree is clean and
   everything is pushed.

## Phase 6 — Report

Merge with `ghx pr-merge` when Phase 5 step 3 flips the PR ready. Then send the
final message, in the operator's read order: PR number · spec digest path
(`.human.md`) · deviations (verbatim) · advisory findings split into
**fixed / rejected-with-reason / still-open** · evidence dir · e2e verdict ·
the diff hot spots worth a human spot-check. Every rejection prints its
reason — that is the line you audit. Never treat a fix round as having closed a
finding.

## Measurement

Per run, from git/PR metadata + `$STATE` only: tasks green first dispatch ·
re-dispatch count · deviation count by class · Stop-block histogram ·
task-green/e2e-red divergence · advisory findings later confirmed by the
human · **fix-round yield** (medium+ selected vs fixed-and-still-green vs
rejected vs regressed). That last one is the kill-switch metric: a round
that mostly rejects or regresses is the loop earning its way back out.
No wall-clock, no self-report, no completion-rate dashboards.
