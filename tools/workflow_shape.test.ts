// Shape gate on `.github/workflows/ci.yml`, plus the fleet-wide `gh api --slurp`
// pin. Both halves are re-homes of Go tests that were deleted with the engine —
// and the engine's test binary was itself a required context, so every guarantee
// below died inside the very job it was guarding.
//
// What `engine/cmd/stark/security_doc_test.go` held: ci.yml's job set, and the
// rule that no job backing a required check may be guarded. What
// `engine/cmd/stark/sync_pr_watchdog_test.go` held: the `--slurp` pin
// (TestWorkflowsNeverCombineSlurpWithJq), the only gate of its kind in the fleet.
//
// Why the shape half matters more than it looks: GitHub counts a `skipped` check
// as SATISFYING a required one and renders it identically to a pass, and only a
// new commit clears it. So `if: github.event.pull_request.draft == false` on
// `test` turns the whole TypeScript suite off while the merge box stays green —
// that is how stark-skills#877 merged with its suite never having executed. The
// same holds for `continue-on-error:`, which makes the CHECK report success
// whether or not the step passed (the flag `typecheck` carried in stark-skills
// while it was advisory), and for a `paths:` filter, which reports `skipped` on
// every PR that misses the filter.
//
// node built-ins only, like the rest of the suite. There is no YAML parser in
// the dependency set and `test` runs with no `npm ci` precisely because every
// import in the suite is a `node:` builtin — adding a parser for five shape
// assertions would change that job's whole shape. So the parsing below is
// indentation-based and deliberately narrow: it reads keys at known depths and
// asserts on their presence, never on values it would have to interpret.
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// `REPO_ROOT` (resolved from `import.meta.url`, never from cwd), the
// fail-loudly-on-ENOENT reader and the comment blanker are shared with
// `repo_contracts.test.ts` — one copy, because the two hand-rolled blankers had
// already diverged over whether `//` starts a comment.
import { REPO_ROOT, blankWholeLineComments, readRepoFile } from "./repo_files_lib.ts";

const CI_REL = ".github/workflows/ci.yml";

// The repository's default branch — the ref `main`'s ruleset targets
// (`~DEFAULT_BRANCH`) and the only branch a PR here merges into. Written as a
// literal because the `test` job runs with no git metadata to ask and no network:
// a derived value would have to come from `git symbolic-ref`, which a shallow
// runner checkout does not answer for the remote.
const DEFAULT_BRANCH = "main";

// The four jobs, and the check-run context each one reports under.
//
// A context string is the job's `name:` when it has one and the bare job id when
// it does not — it is never the YAML key alone. `test` and `typecheck` therefore
// carry NO job-level `name:` on purpose: that leaves their contexts as the bare
// ids, which are the strings stark-skills' ruleset already required and the
// strings this repo's ruleset requires now. Adding a `name:` renames the context
// and orphans the requirement, and an orphaned required context has no
// statusCheckRollup entry at all — so the merge box waits forever on "Expected —
// waiting for status" AND `gh pr checks --required`, the command most likely to
// be run to diagnose it, silently omits it. Change either side here and you must
// PUT the ruleset in the same window.
const EXPECTED_CONTEXTS: Record<string, string> = {
  secrets: "secret scan (tree)",
  actionlint: "actionlint",
  test: "test",
  typecheck: "typecheck",
};

function readCi(): string {
  // Loudly on ENOENT, never a skip. A gate that passes because its target
  // vanished is the same false green as a gate whose job reports `skipped`.
  return readRepoFile(
    CI_REL,
    "This test pins the four required check contexts; if the workflow moved, move this test " +
      "and PUT the ruleset in the same change rather than letting the gate pass over nothing.",
  );
}

// Comment lines are blanked rather than dropped, so indentation parsing is
// unaffected and reported positions still line up with the file. Blanking is the
// point of the exercise: ci.yml's own comments spell out `if:`,
// `continue-on-error: true` and `paths:` while explaining why none of them may
// be used, so prose must neither trip these assertions nor satisfy them. Only
// whole-line comments go — a trailing `# v4` on a `uses:` line is left alone,
// and every assertion below keys off a line's KEY, which a trailing comment
// cannot forge.
//
// `#` ALONE, not the shared default set: YAML reads a leading `*` as an ALIAS,
// so blanking it would delete a real node from a gate that reads keys by
// indentation — a false negative on a required check. The `.ts`-aware markers
// belong to the `--slurp` scan below, which reads `.ts` as well as `.yml`.
const YAML_COMMENT_MARKERS = ["#"];

function codeLines(yaml: string): string[] {
  return blankWholeLineComments(yaml, YAML_COMMENT_MARKERS).split("\n");
}

// -1 for a blank line, which belongs to whatever block surrounds it.
function indentOf(line: string): number {
  if (line.trim() === "") return -1;
  return line.length - line.trimStart().length;
}

// The lines strictly more indented than `lines[headerIdx]`, i.e. that key's body.
function blockBody(lines: string[], headerIdx: number): string[] {
  const base = indentOf(lines[headerIdx]);
  const out: string[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const ind = indentOf(lines[i]);
    if (ind === -1) {
      out.push(lines[i]);
      continue;
    }
    if (ind <= base) break;
    out.push(lines[i]);
  }
  return out;
}

function topLevelBlock(lines: string[], key: string): string[] {
  const idx = lines.findIndex((l) => indentOf(l) === 0 && new RegExp(`^${key}:`).test(l));
  assert.notEqual(idx, -1, `${CI_REL}: no top-level \`${key}:\` key — the workflow was restructured`);
  return blockBody(lines, idx);
}

interface Job {
  id: string;
  /** Job-level keys only: the mapping at exactly four spaces of indent. */
  keys: Map<string, string>;
  /** Every line of the job, at any depth — steps included. */
  body: string[];
}

function parseJobs(lines: string[]): Job[] {
  const jobsBody = topLevelBlock(lines, "jobs");
  const jobs: Job[] = [];
  for (let i = 0; i < jobsBody.length; i++) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(jobsBody[i]);
    if (!header) continue;
    const body = blockBody(jobsBody, i);
    const keys = new Map<string, string>();
    for (const line of body) {
      const kv = /^ {4}([A-Za-z0-9_-]+):(.*)$/.exec(line);
      if (kv) keys.set(kv[1], kv[2].trim());
    }
    jobs.push({ id: header[1], keys, body });
  }
  // Fail closed: a parser that matched nothing would make every assertion below
  // vacuously true, which is the failure mode this whole file exists to flag.
  assert.ok(jobs.length > 0, `${CI_REL}: parsed zero jobs — the indentation parser stopped matching the workflow`);
  return jobs;
}

test("ci.yml declares exactly the four jobs backing the required contexts", () => {
  const jobs = parseJobs(codeLines(readCi()));
  assert.deepEqual(
    jobs.map((j) => j.id).sort(),
    Object.keys(EXPECTED_CONTEXTS).sort(),
    "ci.yml's job set moved. Every job here backs a required status check, so adding or " +
      "removing one without PUTting the `Required CI on main` ruleset either orphans a " +
      "context (merges hang forever) or drops a gate with no signal at all.",
  );
});

test("each job reports under the required context string, and test/typecheck stay unnamed", () => {
  for (const job of parseJobs(codeLines(readCi()))) {
    const expected = EXPECTED_CONTEXTS[job.id];
    const declaredName = job.keys.get("name");
    const context = declaredName ?? job.id;
    assert.equal(
      context,
      expected,
      `job \`${job.id}\` reports as the check context "${context}", but the ruleset requires ` +
        `"${expected}". The context IS the job's \`name:\` (or its id when it has none), so this ` +
        `rename orphans the requirement until the ruleset is PUT in the same change.`,
    );
    if (job.id === "test" || job.id === "typecheck") {
      assert.equal(
        declaredName,
        undefined,
        `job \`${job.id}\` gained a job-level \`name:\`. It must stay unnamed so its reported ` +
          `context remains the bare id \`${job.id}\`, which is the string the ruleset requires.`,
      );
    }
  }
});

test("no job backing a required check is guarded, throttled or made advisory", () => {
  for (const job of parseJobs(codeLines(readCi()))) {
    for (const banned of ["if", "continue-on-error", "paths", "paths-ignore"]) {
      assert.ok(
        !job.keys.has(banned),
        `job \`${job.id}\` carries a job-level \`${banned}:\`. A job that does not run reports ` +
          `\`skipped\`, GitHub counts \`skipped\` as SATISFYING a required check and renders it ` +
          `identically to a pass, and only a new commit clears it — a re-run replays the skip. ` +
          `That is how stark-skills#877 merged with its suite never having executed.`,
      );
    }
    // `continue-on-error` is banned at EVERY depth, not just job level: on a step
    // it makes the job — and therefore the reported check — succeed whether or not
    // the step did, with the errors visible only in the step log. `typecheck`
    // carried exactly that in stark-skills while the check was advisory, which is
    // why it could not simply be added to a ruleset. A step-level `if:` is left
    // alone: `secrets` legitimately guards its PR-range scan with
    // `if: github.event_name == 'pull_request'`, and that step skipping does not
    // skip the job.
    for (const line of job.body) {
      assert.ok(
        !/^\s*-?\s*continue-on-error\s*:/.test(line),
        `job \`${job.id}\` has a \`continue-on-error:\` step:\n  ${line.trim()}\n` +
          `The check then reports SUCCESS whether or not the step passed, so requiring it in a ` +
          `ruleset gates nothing.`,
      );
    }
  }
});

test("ci.yml fires on every pull request, unfiltered", () => {
  const onBlock = topLevelBlock(codeLines(readCi()), "on");
  assert.ok(
    onBlock.some((l) => /^ {2}pull_request:/.test(l)),
    `${CI_REL}: no \`pull_request:\` trigger. Without it none of the four required contexts is ` +
      `ever reported and every merge waits forever.`,
  );
  for (const line of onBlock) {
    assert.ok(
      !/^\s*paths(-ignore)?\s*:/.test(line),
      `${CI_REL}: \`on:\` carries a path filter:\n  ${line.trim()}\n` +
        `A filtered trigger reports \`skipped\` on every PR that misses the filter, which GitHub ` +
        `counts as a pass — the required gate silently stops running on exactly the changes it ` +
        `was not expecting.`,
    );
  }
});

test("both triggers reach the default branch, and no `types:` narrows the PR trigger", () => {
  const onBlock = topLevelBlock(codeLines(readCi()), "on");

  for (const trigger of ["pull_request", "push"]) {
    const at = onBlock.findIndex((l) => new RegExp(`^ {2}${trigger}:`).test(l));
    assert.notEqual(
      at,
      -1,
      `${CI_REL}: no \`${trigger}:\` trigger. Every one of the four required contexts is reported by a ` +
        `run of THIS workflow; a trigger that is gone is a context that never reports.`,
    );
    const body = blockBody(onBlock, at);

    // `branches-ignore` is the inverted spelling and is banned outright: it can
    // exclude the default branch while still *containing* the word `main`, so a
    // positive-match assertion below would read it as satisfied.
    const ignore = body.find((l) => /^\s*branches-ignore\s*:/.test(l));
    assert.equal(
      ignore,
      undefined,
      `${CI_REL}: \`on.${trigger}\` uses \`branches-ignore\`. Use the positive \`branches:\` form — an ` +
        `exclusion list is one entry away from silently excluding \`${DEFAULT_BRANCH}\` itself, and this ` +
        `gate cannot tell an allow-list from a deny-list by reading the branch name.`,
    );

    // `branches:` accepts both the flow form (`branches: [main]`) and a block
    // sequence, so the key's own line plus its body are searched together rather
    // than just the one line.
    const branchesAt = body.findIndex((l) => /^\s*branches\s*:/.test(l));
    assert.notEqual(
      branchesAt,
      -1,
      `${CI_REL}: \`on.${trigger}\` carries no \`branches:\` filter. Unfiltered is not a failure of this ` +
        `assertion's intent, but it is a change from the shape the ruleset was written against — state ` +
        `the branch explicitly, or move this test in the same change.`,
    );
    const branches = [body[branchesAt], ...blockBody(body, branchesAt)].join("\n");
    assert.ok(
      new RegExp(`(^|[^A-Za-z0-9_/-])${DEFAULT_BRANCH}([^A-Za-z0-9_/-]|$)`).test(branches),
      `${CI_REL}: \`on.${trigger}.branches\` does not name \`${DEFAULT_BRANCH}\`:\n  ` +
        `${branches.trim().replace(/\n\s*/g, " ")}\n` +
        `A branch filter that misses the default branch means no run of this workflow ever exists for the ` +
        `head sha, so all four required contexts stay permanently UNREPORTED — the merge box waits forever ` +
        `on "Expected — waiting for status", and \`gh pr checks --required\` cannot show you why because an ` +
        `unreported context has no statusCheckRollup entry at all.`,
    );

    if (trigger === "pull_request") {
      // GitHub's default `pull_request` activity types are opened/synchronize/
      // reopened. Declaring `types:` REPLACES that default wholesale rather than
      // adding to it, so `types: [ready_for_review]` — the reflex when someone
      // wants CI to skip drafts — stops the workflow firing on the pushes that
      // actually change the code, and the head sha carries no run at all. That is
      // strictly worse than the `if:` draft guard banned above: a skipped job at
      // least reports (as a pass, wrongly); an absent run reports nothing and
      // blocks the merge forever.
      const types = body.find((l) => /^\s*types\s*:/.test(l));
      assert.equal(
        types,
        undefined,
        `${CI_REL}: \`on.pull_request\` declares \`${types?.trim()}\`. Declaring \`types:\` replaces ` +
          `GitHub's default set (opened/synchronize/reopened) instead of extending it, so the workflow ` +
          `stops firing on the events it is required for and the head sha ends up with no run — a required ` +
          `context that never reports.`,
      );
    }
  }
});

test("ci runs are scoped per PR and never cancelled", () => {
  const block = topLevelBlock(codeLines(readCi()), "concurrency");
  const line = block.find((l) => /^\s*cancel-in-progress\s*:/.test(l));
  assert.ok(line !== undefined, `${CI_REL}: \`concurrency\` has no \`cancel-in-progress\` key`);
  const value = line.slice(line.indexOf(":") + 1).split("#")[0].trim();
  assert.equal(
    value,
    "false",
    `${CI_REL}: \`concurrency.cancel-in-progress\` is \`${value}\`. GitHub counts a CANCELLED ` +
      `required check as FAILING, and \`main\` has already carried commits cancelled by ` +
      `back-to-back merges sharing one concurrency group. A cancelled required check is a ` +
      `blocked merge that only a new commit clears.`,
  );
  assert.ok(
    block.some((l) => /^\s*group\s*:/.test(l) && l.includes("pull_request.number")),
    `${CI_REL}: the concurrency group no longer keys on the PR number, so two PRs share a group ` +
      `and one starves the other even with cancellation off.`,
  );
});

// ── The `gh api --slurp` pin ────────────────────────────────────────────────
//
// `gh api` REFUSES `--slurp` alongside `--jq` or `--template`: "the `--slurp`
// option is not supported with `--jq` or `--template`". Not a runner quirk —
// reproduced on gh 2.101.0, for the shorthands `-q` and `-t` as well.
//
// This killed sync-pr-watchdog's first live run (35523084147, 2026-09-20): it
// printed gh's usage text and exited 1 before reaching any verdict, and it was
// merged green because nothing that ran before it could see the flaw. The line is
// valid shell and valid YAML, so actionlint and shellcheck pass it, and the review
// round that introduced the flag verified it against a STUBBED `gh`, which accepts
// every flag the real binary rejects.
//
// The pin is on the command line itself across every file that can carry one,
// because the mistake is a copy of a working invocation's flag without its shape
// — slurp into a variable, then pipe to jq — and the next copy will be somewhere
// else.
//
// This is NOT a literal port of the Go original, deliberately. That predicate was
// `strings.Contains(line, "gh api")` over `.yml`/`.yaml`/`.sh` only. Mutation-
// tested against the three live call sites in this tree, it catches ONE: both
// `tools/findings_review_post.ts` and `tools/copilot_land.ts` spawn gh with an
// argv array (`run("gh", ["api", …])`, `gh(["api", …])`) where that substring
// never appears, and `.ts` was out of scope entirely. A faithful port would report
// green over exactly the two files that now matter most, since `tools/` has
// stopped being a read-only vendored mirror and is the place the next bad copy
// gets written.

/**
 * Every spelling `gh api` refuses next to `--slurp`. The refusal names two
 * options and each has a shorthand, so the same fatal command line has FOUR
 * forms — all measured on gh 2.101.0, all rejected identically. A gate that knew
 * only `--jq` would pass three of them.
 */
const REFUSED_WITH_SLURP = ["--jq", "-q", "--template", "-t"];

/**
 * Directories that can carry a `gh` invocation, and the extensions that can hold
 * one. This covers EVERY top-level dir holding a scannable file, not a shortlist
 * of the ones that happen to call `gh` today: `standards/` ships three `.yml`
 * workflow/site templates that are copied verbatim into other repos, so a fatal
 * invocation written there would be exactly as broken and exactly as unreported.
 *
 * `config/` stays a scope although it now holds no scannable file — its six
 * `.sh` files (the statusline scripts and their harnesses) moved to the
 * stark-workspace repo, leaving only `wif-identities.json`. That is the standing
 * `scripts/` and `global/` already have: the directory is live, a script written
 * there next is scanned with no edit here, and an empty scope costs nothing.
 * Dropping it would be safe only because the completeness test below reddens on
 * a scannable file outside every scope; keeping it does not lean on that. If
 * `config/` itself is ever deleted, the existence check reddens and the entry
 * goes then, deliberately.
 */
const SCAN_SCOPES = [
  ".github/workflows",
  "tools",
  "skill",
  "scripts",
  "global",
  "standards",
  "config",
];
const SCAN_EXTENSIONS = new Set([".sh", ".ts", ".yml", ".yaml"]);

/**
 * Never descended into. `tools/node_modules` appears the moment anyone runs the
 * `typecheck` job's `npm ci` locally, and `@types/node` + `typescript` alone add
 * 217 `.d.ts` files — `path.extname("index.d.ts")` is `".ts"`, so every one of
 * them would enter the scan. Vendored third-party code is not this gate's to
 * police, and a hit there is unfixable where it is reported.
 */
const SCAN_SKIP_DIRS = new Set(["node_modules", ".git"]);

/**
 * The one exemption: this file, whose self-test below carries the fatal command
 * lines as fixtures. Written self-referentially from `import.meta.url` so it can
 * never name the wrong file, and deliberately narrow — every other `*.test.ts`
 * stays in scope, including the `gh` stubs in `copilot_land.test.ts`. A future
 * test that needs a real violation as a fixture belongs on this list with its
 * reason, not behind a blanket `*.test.ts` skip.
 */
const SCAN_EXEMPT = new Set([fileURLToPath(import.meta.url)]);

function collectScannableFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SCAN_SKIP_DIRS.has(entry.name)) walk(abs);
      } else if (SCAN_EXTENSIONS.has(path.extname(entry.name)) && !SCAN_EXEMPT.has(abs)) files.push(abs);
    }
  };
  for (const scope of SCAN_SCOPES) {
    const abs = path.join(REPO_ROOT, scope);
    // A moved directory must redden rather than go quiet. `scripts/`, `global/`
    // and `config/` legitimately hold no scannable file today, so emptiness is
    // fine; absence is not.
    assert.ok(
      fs.existsSync(abs),
      `scan scope ${scope}/ is gone. Point this list at wherever it moved — a scope that ` +
        `silently drops out of the scan is coverage lost with no signal.`,
    );
    walk(abs);
  }
  return files;
}

/**
 * Whether one of `names` appears as its OWN argument in the `gh api` invocation
 * on this line. Token-wise, not substring: `-t` and `-q` are two characters and
 * would otherwise fire on any path, URL or jq program that happens to spell them.
 *
 * The scan starts at `gh api`, so a flag belonging to a command piped BEFORE it
 * is not read as gh's. A command piped AFTER it still is — that errs toward a
 * false positive, which for a gate is the safe direction, and truncating at the
 * first `|` would instead lose `--slurp` written after a `--jq '.a | .b'`
 * program.
 */
function ghApiHasFlag(line: string, names: string[]): boolean {
  const start = line.indexOf("gh api");
  if (start < 0) return false;
  for (const token of line.slice(start).split(/\s+/)) {
    for (const name of names) {
      if (token === name || token.startsWith(`${name}=`)) return true;
    }
  }
  return false;
}

/** The shell form: a joined command line carrying `gh api`, `--slurp` and a refused flag. */
function shellFormHits(text: string): string[] {
  const hits: string[] = [];
  // Whole-line comments go first, in BOTH syntaxes — the same blanking
  // `argvFormHits` uses. A `#` skip alone left the shell form blind to `//`,
  // which is the comment marker of the `.ts` half of the scan scope: a line like
  // `// gh api repos/o/r --slurp --jq '.x'` in any tool's header is prose, and
  // reporting it would redden the required `test` check over a comment nobody
  // can fix by editing code. Blanking (not dropping) keeps `\`-continuation
  // folding below aligned with the physical lines.
  const code = blankWholeLineComments(text);
  // One invocation may span continuation lines — the broken call had `--slurp`
  // and `--jq` on different physical lines — so fold them before looking. CRLF is
  // normalized by the caller, or a file checked out with CRLF endings leaves
  // `\`+`\r\n` unjoined and splits the pair back apart.
  for (const line of code.replace(/\\\n/g, " ").split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    if (!ghApiHasFlag(line, ["--slurp"])) continue;
    if (!ghApiHasFlag(line, REFUSED_WITH_SLURP)) continue;
    hits.push(line.trim());
  }
  return hits;
}

/**
 * The contents of every balanced `[...]` pair, at every nesting depth.
 *
 * A regex over `\[[^[\]]*\]` would see only the INNERMOST pair, so an argv array
 * holding any nested bracket — `${parts[0]}` in a template literal is the
 * realistic one — would never be matched as a whole and the call would go
 * unreported. Emitting every depth means the enclosing array is always one of the
 * groups. A stray unbalanced `[` inside a string literal can mispair and yield an
 * over-wide group, which costs a false POSITIVE; that is the direction a gate is
 * allowed to err in, and it is loud rather than silent.
 */
function bracketGroups(text: string): string[] {
  const groups: string[] = [];
  const open: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "[") open.push(i);
    else if (text[i] === "]" && open.length > 0) groups.push(text.slice((open.pop() as number) + 1, i));
  }
  return groups;
}

/**
 * The argv form: a bracketed argument list holding `api`, `--slurp` and a refused
 * flag as separate string literals. Matching the bracket group rather than the
 * line is what makes a multi-line array legible to the scan, the way folding
 * continuations does for the shell form.
 */
function argvFormHits(text: string): string[] {
  const hits: string[] = [];
  for (const group of bracketGroups(blankWholeLineComments(text))) {
    const tokens = [...group.matchAll(/"([^"\\]*)"|'([^'\\]*)'|`([^`\\$]*)`/g)].map(
      (m) => m[1] ?? m[2] ?? m[3],
    );
    if (!tokens.includes("api") || !tokens.includes("--slurp")) continue;
    if (!REFUSED_WITH_SLURP.some((flag) => tokens.includes(flag))) continue;
    hits.push(group.replace(/\s+/g, " ").trim());
  }
  return hits;
}

/**
 * Every scannable file in the tree, reached WITHOUT `SCAN_SCOPES` — the walk the
 * completeness check below compares that hand-written list against. Same skip
 * set as the scoped walk, plus `.worktrees/` (a linked worktree is a second
 * checkout of this repo and its copies are not this run's to police) and
 * `.git`-adjacent dot-dirs holding session scratch rather than source.
 */
function collectEveryScannableFile(): string[] {
  const skip = new Set([...SCAN_SKIP_DIRS, ".worktrees", ".claude", ".remember"]);
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) files.push(abs);
    }
  };
  walk(REPO_ROOT);
  return files;
}

test("`SCAN_SCOPES` still names every directory that holds a scannable file", () => {
  // `SCAN_SCOPES` is hand-written and its own comment claims to be EVERY
  // top-level dir holding a scannable file — a claim nothing checked, so a new
  // top-level directory (or a `gh` call parked in `docs/`) leaves the gate
  // reporting clean over a file it never opened. The entry deleted for
  // `runtime-overrides/` was removed by hand for exactly that reason; this is
  // what makes the next such edit visible. Fix a failure by ADDING the scope,
  // never by narrowing this walk.
  const scoped = new Set(collectScannableFiles());
  const missed = collectEveryScannableFile()
    .filter((abs) => !scoped.has(abs) && !SCAN_EXEMPT.has(abs))
    .map((abs) => path.relative(REPO_ROOT, abs))
    .sort();
  assert.deepEqual(
    missed,
    [],
    `these scannable files are outside every entry of SCAN_SCOPES, so the \`gh api --slurp\` gate ` +
      `never reads them:\n  ${missed.join("\n  ")}\nAdd the directory to SCAN_SCOPES.`,
  );
});

test("no `gh api` call combines --slurp with --jq/--template, in either the shell or argv form", () => {
  const files = collectScannableFiles();
  // A gate that scanned nothing passes for the wrong reason.
  assert.ok(files.length > 0, "scanned no files — this gate would pass vacuously");

  const failures: string[] = [];
  for (const abs of files) {
    const text = fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
    const rel = path.relative(REPO_ROOT, abs);
    for (const hit of shellFormHits(text)) failures.push(`${rel}: ${hit}`);
    for (const hit of argvFormHits(text)) failures.push(`${rel}: [${hit}]`);
  }
  assert.deepEqual(
    failures,
    [],
    `\`gh api\` refuses --slurp alongside ${REFUSED_WITH_SLURP.join("/")} and exits 1 printing its ` +
      `usage text. Slurp into a variable and pipe to jq instead.\n  ` +
      failures.join("\n  ") +
      `\n(One scanned file is not this repo's to fix: \`.github/workflows/secret-scan.yml\` is a ` +
      `byte-identical copy of a Terraform render owned by 21stark. It is still scanned — losing the ` +
      `coverage silently would be worse — but a hit there is fixed in that template, never here.)`,
  );
});

// Self-test on the detector. The scan reports clean over the tree today, so
// nothing else here proves it can report anything else: a broken predicate and an
// honestly clean tree are indistinguishable from the outside, which is exactly
// the failure the Go original's `.ts` blind spot was. These are the real call
// shapes in `tools/`, mutated to carry the fatal pair.
test("the --slurp detector catches every live call shape when mutated", () => {
  const mustCatch: Record<string, string> = {
    "workflow run: step": `        run: gh api repos/o/r/pulls --paginate --slurp --jq '.[].number'`,
    "backslash continuation": `          gh api repos/o/r/pulls --paginate --slurp \\\n            --jq '.[].number'`,
    "shorthand -q": `          gh api repos/o/r --slurp -q '.x'`,
    "shorthand -t": `          gh api repos/o/r --slurp -t '{{.x}}'`,
    "--jq=value form": `          gh api repos/o/r --slurp --jq='.x'`,
    // findings_review_post.ts:812 — run("gh", [...])
    "argv via run()": `run("gh", ["api", \`repos/\${r}/pulls/\${p}/files\`, "--paginate", "--slurp", "--jq", ".x"]),`,
    // copilot_land.ts:528 — gh([...], cwd)
    "argv via gh()": `const out = gh(["api", \`repos/\${r}/pulls?state=open\`, "--paginate", "--slurp", "--jq", "."], cwd);`,
    // preflight_lib.ts:132 — runCmd([...]) puts "gh" inside the array too.
    "argv with gh in the array": `const { ok } = runCmd(["gh", "api", "user", "--slurp", "-q", ".login"], 10_000);`,
    "argv spanning lines": `const r = gh([\n  "api",\n  "repos/o/r",\n  "--slurp",\n  "--jq", ".x",\n]);`,
    // A nested bracket inside the array — the shape an innermost-only regex
    // would read as the group `0` and never see the enclosing call.
    "argv with a nested index": `gh(["api", \`repos/\${parts[0]}/pulls\`, "--slurp", "--jq", ".x"]);`,
  };
  for (const [label, source] of Object.entries(mustCatch)) {
    const hits = [...shellFormHits(source), ...argvFormHits(source)];
    assert.ok(hits.length > 0, `detector missed the ${label} form: ${source}`);
  }

  const mustIgnore: Record<string, string> = {
    "prose in a // comment": `// never combine ["api", "--slurp", "--jq"] in one call`,
    "prose in a # comment": `  # gh api ... --slurp --jq is refused outright`,
    // The SHELL form spelled out in a `//` comment — the half a `#`-only skip
    // missed. `.ts` is in the scan scope and `//` is its comment marker, so this
    // is the realistic false positive, not a hypothetical one.
    "shell form in a // comment": `  // gh api repos/o/r --slurp --jq '.x' is refused`,
    "shell form in a /* block comment": `   * gh api repos/o/r --slurp --template '{{.x}}'`,
    "--slurp alone (findings_review_post.ts today)": `run("gh", ["api", "x", "--paginate", "--slurp"]),`,
    "--jq alone (findings_review_post.ts today)": `run("gh", ["api", "x", "--jq", ".head.sha"]),`,
    "--slurp piped to a separate jq": `          gh api repos/o/r --slurp | jq -r '.[].number'`,
  };
  for (const [label, source] of Object.entries(mustIgnore)) {
    const hits = [...shellFormHits(source), ...argvFormHits(source)];
    assert.deepEqual(hits, [], `detector false-positived on ${label}: ${source}`);
  }
});
