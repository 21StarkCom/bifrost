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

// Resolved from `import.meta.url`, never from cwd. `tools/package.json`'s test
// script is `./check-rest-only.sh && node --test *.test.ts` and ci.yml runs it
// with `working-directory: tools`, so cwd here is `tools/` under CI but the repo
// root when someone runs `node --test tools/workflow_shape.test.ts` by hand. A
// cwd-relative path would resolve in exactly one of those two.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CI_REL = ".github/workflows/ci.yml";

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
  const abs = path.join(REPO_ROOT, CI_REL);
  let body: string;
  try {
    body = fs.readFileSync(abs, "utf8");
  } catch (err) {
    // Loudly, never a skip. A gate that passes because its target vanished is
    // the same false green as a gate whose job reports `skipped`.
    return assert.fail(
      `${CI_REL} is unreadable (${(err as Error).message}). This test pins the four ` +
        `required check contexts; if the workflow moved, move this test and PUT the ruleset ` +
        `in the same change rather than letting the gate pass over nothing.`,
    );
  }
  return body.replace(/\r\n/g, "\n");
}

// Comment lines are blanked rather than dropped, so indentation parsing is
// unaffected and reported positions still line up with the file. Blanking is the
// point of the exercise: ci.yml's own comments spell out `if:`,
// `continue-on-error: true` and `paths:` while explaining why none of them may
// be used, so prose must neither trip these assertions nor satisfy them. Only
// whole-line comments go — a trailing `# v4` on a `uses:` line is left alone,
// and every assertion below keys off a line's KEY, which a trailing comment
// cannot forge.
function codeLines(yaml: string): string[] {
  return yaml.split("\n").map((line) => (line.trimStart().startsWith("#") ? "" : line));
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

/** Directories that can carry a `gh` invocation, and the extensions that can hold one. */
const SCAN_SCOPES = [".github/workflows", "tools", "skill", "scripts", "global", "runtime-overrides"];
const SCAN_EXTENSIONS = new Set([".sh", ".ts", ".yml", ".yaml"]);

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
      if (entry.isDirectory()) walk(abs);
      else if (SCAN_EXTENSIONS.has(path.extname(entry.name)) && !SCAN_EXEMPT.has(abs)) files.push(abs);
    }
  };
  for (const scope of SCAN_SCOPES) {
    const abs = path.join(REPO_ROOT, scope);
    // A moved directory must redden rather than go quiet. `scripts/` and
    // `global/` legitimately hold no scannable file today, so emptiness is fine;
    // absence is not.
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

/**
 * Blanks whole-line comments in either syntax, so a comment that spells the
 * banned combination out — this file's own header does — is neither a hit nor a
 * way to satisfy the scan. Only whole-line comments: stripping `//` mid-line
 * would truncate any line holding a URL and could drop a flag that follows it,
 * which is a false NEGATIVE and the one outcome a gate may not have.
 */
function blankWholeLineComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const t = line.trimStart();
      return t.startsWith("#") || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") ? "" : line;
    })
    .join("\n");
}

/** The shell form: a joined command line carrying `gh api`, `--slurp` and a refused flag. */
function shellFormHits(text: string): string[] {
  const hits: string[] = [];
  // One invocation may span continuation lines — the broken call had `--slurp`
  // and `--jq` on different physical lines — so fold them before looking. CRLF is
  // normalized by the caller, or a file checked out with CRLF endings leaves
  // `\`+`\r\n` unjoined and splits the pair back apart.
  for (const line of text.replace(/\\\n/g, " ").split("\n")) {
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
    "--slurp alone (findings_review_post.ts today)": `run("gh", ["api", "x", "--paginate", "--slurp"]),`,
    "--jq alone (findings_review_post.ts today)": `run("gh", ["api", "x", "--jq", ".head.sha"]),`,
    "--slurp piped to a separate jq": `          gh api repos/o/r --slurp | jq -r '.[].number'`,
  };
  for (const [label, source] of Object.entries(mustIgnore)) {
    const hits = [...shellFormHits(source), ...argvFormHits(source)];
    assert.deepEqual(hits, [], `detector false-positived on ${label}: ${source}`);
  }
});
