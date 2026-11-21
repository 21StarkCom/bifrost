# Check runs — the traps of a long check

Use this page with Phase 2 §Verify 1 of `SKILL.md`. Phase 3 and Phase 4b run
their checks by the same rules.

## Close stdin

Both `claude -p` and `codex exec` read stdin *in addition to* the prompt
argument. Under a backgrounded or orchestrated shell, stdin is an open pipe that
never delivers EOF, so an open stdin blocks them. A hung reviewer looks the same
as a thorough one.

- `codex exec` blocks silently and forever, and prints only
  `Reading additional input from stdin...`.
- `claude -p` fails fast, but into the redirect file where nobody looks:
  `Warning: no stdin data received in 3s`, then `Execution error`.

The runner's own check runs (Phase 2 §Verify 1, the Phase 3 e2e command, the
Phase 4b sweep) also run under that never-EOF stdin. So a check that reads stdin
returns in <1s under the Stop hook and blocks forever under the runner: the same
command, two verdicts. That is the most likely cause of the "wrapper does not
return" flake below, so close stdin before you use the fallback.

## Keep the `bash` prefix

`check.sh` is written without a shebang and is never `chmod +x` (only
`$STATE/hooks/` is). Run it directly and it returns `permission denied` (126) on
every task: a false red that looks like a real one.

## Background a long check

When the orchestrating shell hits a wall-clock limit, it stops waiting but does
not kill the child process tree. Each retry then competes with every earlier
`go test` (or equivalent) for build caches: a slowdown that grows, looks like
outside contention, and causes misdiagnosis. Run long checks as background
tasks, and stop them with the harness's own task-stop, never with a foreground
timeout.

## No `timeout(1)` on macOS

macOS has no `timeout(1)`, and `gtimeout` needs `brew install coreutils`. A
sweep written as `timeout 120 bash check.sh` reports every check red in 0s:
`timeout: command not found` exits 127, a false red that looks like a real one.
Never use a bare `timeout`. Prefer the language's own bound (`go test -timeout`):
it kills the work it started and orphans nothing.

## A wrapper that signals only the child leaks the tree

`gtimeout` without `--kill-after` or process-group handling leaks the tree, and
so does `perl -e 'alarm N; exec @ARGV'`: `alarm` sends SIGALRM to the exec'd
shell only, so the compile and run children of `go test` survive and cause the
same contention. For a hard bound outside the language, run the check in its own
process group (`set -m`), kill that group (`kill -- -"$PGID"`), and verify that
nothing survived before you retry.

## Never kill by pattern

`pkill -f "go test"` matches command-line text, not ownership. It can kill the
runner's own check in flight (a misread `rc=143`), or the tasks of another
`stark-build` run whose prompt text holds `go test`. Stop only the PIDs and
process groups you recorded.

To see what this run started, list it with the command text visible:
`pgrep -lf "$STATE"` or `ps -eo pid,command | grep -F "$STATE"`. List by pattern;
never feed that list to a kill. Never use `pgrep -af` on macOS: there `-a` adds
each match's ancestors and prints bare PIDs, so its list holds the orchestrating
session itself.

## The wrapper flake fallback

If `bash "$T/check.sh"` does not return, the runner may run the check's own
content verbatim: the whole file, with its `set -euo pipefail; cd <wt>`
envelope, not only the done-when line from the spec.

- Without `cd <wt>`, the command runs against the main checkout and greens a
  task whose worktree code is absent or broken.
- Without `pipefail`, a piped done-when exits with the last stage's status and
  greens a failing suite.

Both are the vacuous green this skill exists to prevent. Re-run to confirm
(Phase 3's ≤3× flaky discipline applies). Record in PROGRESS.md that the wrapper
did not return, that you ran the content directly, and both outcomes. Never
paraphrase or adapt the command.

The root cause is undiagnosed: do not invent one. The rule "completion is a
runnable check, never a model verdict" holds because the command and its
envelope stay the same, and the runner still runs it.
