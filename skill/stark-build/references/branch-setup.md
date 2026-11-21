# Branch setup — the checks after `prepare-branch`

Use this page with Phase 1 step 1 of `SKILL.md`.

**`--require-base` is mandatory.** Without it, `prepare-branch` adopts a
leftover `origin/build/<slug>` and resets HEAD onto that older tree, with
`ok: true`.

**Check the exit code first, then assert.** A refusal leaves HEAD at the base:
a bare `merge-base --is-ancestor` then passes, and step 2 fails with
`src refspec build/<slug> does not match any`. Run both checks:

```bash
node ... "$TOOLS/copilot_land.ts" prepare-branch ... --require-base <accepted-base> \
  || { echo "HARD STOP: prepare-branch refused — read its message." >&2; exit 1; }
git -C "<wt>" rev-parse --abbrev-ref HEAD | grep -qx "build/<slug>" \
  || { echo "HARD STOP: worktree is not on build/<slug> (detached or wrong branch)." >&2; exit 1; }
git -C "<wt>" merge-base --is-ancestor <accepted-base> HEAD \
  || { echo "HARD STOP: HEAD does not contain accepted-base <sha>." >&2; exit 1; }
```

**Do not delete the remote branch to clear a stale one:** that closes its open
PR and its review threads. Re-pin the spec, land on `build/<slug>-2`, or delete
the branch only when no PR on it holds findings.
