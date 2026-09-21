// Shared plumbing for the repo-contract gates (`repo_contracts.test.ts`,
// `workflow_shape.test.ts`). Both read governance files out of the tree and both
// have to blank prose that spells a banned construction out, and both had
// hand-rolled copies that had already DIVERGED: one blanker handled `//` and the
// other did not, so the same comment was prose in one gate and a hit in the
// other. This is the one copy.
//
// `node:` builtins only. ci.yml's `test` job runs no `npm ci` — every import in
// the suite is a builtin, and an import outside `node:` turns the required check
// red on a clean tree.
//
// Out of `tools/check-rest-only.sh`'s scope, exactly as the two `*.test.ts`
// files this code came from are: that guard names the PR-posting path plus the
// `agent_*.ts` ports and excludes `*.test.ts`, so nothing moved out from under
// it. Keep it that way — a module named `agent_*.ts` would silently join that
// guard's scan.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The repo root, resolved from `import.meta.url` and never from cwd. `npm test`
 * runs with `working-directory: tools` under CI but the repo root when someone
 * runs `node --test tools/<x>.test.ts` by hand; a cwd-relative path resolves in
 * exactly one of those two.
 */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Reads a repo file, normalizing CRLF. A missing file is an assertion FAILURE
 * naming what the gate was for — never a skip, and never a silent empty string.
 * A gate that reports green over a deleted file is the same false green as a
 * required job that reports `skipped`.
 *
 * `why` is what the reader needs in order to decide between "move this test" and
 * "put the file back".
 */
export function readRepoFile(rel: string, why: string): string {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
  } catch (err) {
    return assert.fail(`${rel} is unreadable (${(err as Error).message}). ${why}`);
  }
}

/**
 * Every comment marker a whole-line comment can start with across the file types
 * these gates read: `#` (YAML, TOML, shell), `//` and `/*`/` *` (TypeScript).
 * This is the STRICT set and the default — a `#`-only blanker left the scans
 * blind to `//`, which is the comment marker of the `.ts` half of the tree, so a
 * tool's header prose spelling a banned construction out read as a real hit and
 * reddened a required check over a line nobody can fix by editing code.
 */
export const DEFAULT_COMMENT_MARKERS = ["#", "//", "*", "/*"] as const;

/**
 * Blanks whole-line comments, preserving line COUNT and blank-line positions so
 * indentation parsing is unaffected and reported line numbers still line up with
 * the file. Prose that spells a banned construction out is then neither a hit
 * nor a way to satisfy a scan.
 *
 * Only WHOLE-line comments go. Stripping mid-line would truncate any line
 * holding a URL or a trailing `# v4` and could drop the very token being pinned
 * — a false NEGATIVE, the one outcome a gate may not have.
 *
 * `markers` narrows the set for a caller whose file type gives one of the
 * defaults another meaning: YAML reads a leading `*` as an alias, not a comment.
 */
export function blankWholeLineComments(
  text: string,
  markers: readonly string[] = DEFAULT_COMMENT_MARKERS,
): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      return markers.some((marker) => trimmed.startsWith(marker)) ? "" : line;
    })
    .join("\n");
}
