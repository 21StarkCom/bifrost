# The fix round — dispatch and verify

Use this page with Phase 4b steps 3 and 4 of `SKILL.md`.

## Dispatch

Use this section for step 3. The session uses the Phase 2
harness, so the spec and every hook-protected existing test stay protected.
Its Stop check is the **e2e command**, because fixes cross task boundaries.

```bash
T=$STATE/tasks/fix; mkdir -p "$T"; printf '0' > "$T/blocks"
# $T/check.sh = the spec's ## Verification command(s), verbatim
# $T/settings.json = Phase 2's, with Stop -> stop-gate.sh $T/check.sh ...
claude -p --model "<--model | claude-opus-5>" --settings "$T/settings.json" \
  --max-turns "<--max-turns | 30>" --dangerously-skip-permissions \
  "$(cat "$T/prompt.md")" </dev/null > "$T/session.log" 2>&1
```

`$T/prompt.md`: the spec, the selected findings verbatim, and — *"Fix
these findings and nothing else. The spec is immutable and the gated
tests are hook-protected. Do not refactor, do not harden, do not touch a
file no finding names. A finding you judge WRONG is not fixed — append
`- [finding-rejected] id=<n> <one-line reason>` to PROGRESS.md and move
on; rejecting on evidence is a success, faking a fix is not. Finish with
exactly one commit: `fix(<slug>): advisory round`."*

## Verify

Use this section for step 4. Verify the round yourself, deterministically; the
reviewer is not consulted again.

- Re-run every task's `check.sh` plus the e2e command, under Phase 2 §Verify 1's
  rules.
- A check that was green before the round and is red after → `git revert` the
  fix commit, log `class=fix-regression`, and the PR stays draft.
- All green → keep the fix commit.
- Tamper and scope checks run as in Phase 2 §Verify.
