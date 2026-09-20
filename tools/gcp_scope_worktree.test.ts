// CI wrapper for the gcp_scope CLI end-to-end harness.
//
// The real assertions live in tools/gcp_scope_worktree.test.sh, which drives
// `gcp_scope.ts install` + `check` against a throwaway fixture repo: both
// `.envrc` and `.worktreeinclude` written from one invocation, hand-written
// lines preserved, a second run byte-identical, and the static checker reaching
// its success line under a disposable $HOME with direnv and gcloud hidden from
// $PATH.
//
// Without this wrapper the harness ran nowhere. `npm test` is
// `./check-rest-only.sh && node --test *.test.ts` — non-recursive and .ts-only —
// so a `.test.sh` with no `.ts` driver is a gate nobody executes, which is worse
// than no gate: the file advertises coverage the suite does not have. The three
// statusline harnesses and cmux-autoname are wired the same way.
//
// Deliberately NOT guarded by existsSync: if the script is moved or deleted,
// bash exits 127 and this fails loudly, rather than passing over a vanished
// subject.

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

test("gcp scope CLI: install writes both files, preserves, re-runs identically, and checks clean", () => {
  const script = path.join(import.meta.dirname, "gcp_scope_worktree.test.sh");
  const r = spawnSync("bash", [script], { encoding: "utf8", input: "", timeout: 120_000 });
  assert.equal(
    r.status,
    0,
    `gcp_scope_worktree.test.sh failed (exit ${r.status}, signal ${r.signal}):\n${r.stdout}\n${r.stderr}`,
  );
  assert.match(r.stdout, /^PASS gcp scope:/m);
});
