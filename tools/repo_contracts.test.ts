// Repo-level contract gates: the four governance files nothing else in this tree
// reads, and the one file every install resolves through.
//
// Three of these four re-home Go tests that were deleted with the engine
// (STARK-8249). The engine's test binary was itself a required context, so each
// contract below lost its only guard inside the very job that was enforcing it:
//
//   - `engine/cmd/stark/gitleaks_config_test.go`      → `.gitleaks.toml` (§2)
//   - `engine/cmd/stark/secret_scan_caller_test.go`   → the fleet caller (§3)
//   - `engine/cmd/stark/security_doc_test.go`         → banned phrases (§4)
//
// The fourth (§1) is not a re-home: `.claude-plugin/marketplace.json` has never
// had automated coverage in any repo, in either era. It is the file `/plugin
// marketplace add 21StarkCom/bifrost` parses and every `/plugin install` resolves
// through, and until this file nothing parsed it — a typo in one `skills:` path
// shipped a plugin whose skill simply does not exist, with every gate green.
//
// node built-ins only, like the rest of the suite: ci.yml's `test` job runs no
// `npm ci`, so an import outside `node:` turns the required check red on a clean
// tree. That is why §1 hand-checks the parsed JSON instead of reaching for a
// schema validator, and why §2/§3 read TOML and YAML line-wise rather than
// parsing them — every assertion keys off a line's KEY at a known depth and never
// interprets a value it would need a real parser to understand.
//
// Nothing here is allowed to pass because its subject vanished. Every read goes
// through `readRepoFile`, which fails the test loudly on ENOENT; there is no
// `existsSync` guard and no `t.skip` anywhere in this file, because a gate that
// reports green over a deleted file is the exact false green this repo keeps
// re-learning.
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// `REPO_ROOT` (resolved from `import.meta.url`, never from cwd), the
// fail-loudly-on-ENOENT reader and the comment blanker are shared with
// `workflow_shape.test.ts`, which needs all three for the same reasons. They
// lived here AND there until STARK-8249's cleanup, and the two blankers had
// already diverged over `//`.
//
// `.gitleaks.toml` needs the blanking in both directions: its header argues at
// length for having no `[allowlist].paths`, and writes the phrase out to do so.
//
// §3 deliberately does NOT route `secret-scan.yml` through the blanker, even
// though its header spells out `name:`, `paths:` and `if:` while explaining why
// none may be used. Every regex there anchors a YAML key to the start of an
// indented line (`/^\s+if:/m`), and a comment line's first non-space character
// is `#`, so it can never produce a match. Leaving that file read verbatim keeps
// the byte the assertions see identical to the byte 21stark's drift check
// compares.
import { REPO_ROOT, blankWholeLineComments, readRepoFile } from "./repo_files_lib.ts";

// ────────────────────────────────────────────────────────────────────────────
// §1  `.claude-plugin/marketplace.json` — the install manifest
// ────────────────────────────────────────────────────────────────────────────
//
// Since STARK-8249 this repo IS the source tree it serves: every plugin's
// `source` is `"./"` and every `skills:` entry is a path into `skill/` in this
// same checkout. There is no build step, no generated `dist/`, and no `stark
// validate` left to catch a bad path — so the manifest and the tree can only
// disagree silently. The four properties below are what "they agree" means:
//
//   resolves  — every claimed skill dir exists and holds a SKILL.md, so no plugin
//               ships a dangling entry;
//   total     — the union of the seven `skills:` lists is EVERY skill on disk, so
//               a new skill dir cannot land unclaimed (the failure `agnes` shipped
//               with at v0.31.2, STARK-6249, when the old repo's coverage gate ran
//               on only one of the two publish paths);
//   disjoint  — no skill is claimed by two plugins, which would install its body
//               twice under two names;
//   self-hosted — every `source` stays `"./"`, the one value that means "this
//               checkout"; anything else silently points installs at another tree.

const MARKETPLACE_REL = ".claude-plugin/marketplace.json";
const SKILL_ROOT_REL = "skill";
const EXPECTED_PLUGIN_COUNT = 7;

interface Plugin {
  name: string;
  source: string;
  skills: string[];
}

/** Parses the manifest into the three fields these gates care about, failing loudly on any shape surprise. */
function readMarketplace(): Plugin[] {
  const raw = readRepoFile(
    MARKETPLACE_REL,
    "It is the manifest Claude Code reads on `/plugin marketplace add 21StarkCom/bifrost`; " +
      "without it the repo installs nothing at all.",
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return assert.fail(
      `${MARKETPLACE_REL} is not valid JSON (${(err as Error).message}). Claude Code parses this ` +
        `file before it does anything else, so a stray comma takes the whole marketplace down.`,
    );
  }
  const plugins = (parsed as { plugins?: unknown }).plugins;
  assert.ok(Array.isArray(plugins), `${MARKETPLACE_REL}: \`plugins\` is missing or not an array`);

  return plugins.map((entry, i) => {
    const p = entry as { name?: unknown; source?: unknown; skills?: unknown };
    assert.equal(typeof p.name, "string", `${MARKETPLACE_REL}: plugins[${i}] has no string \`name\``);
    assert.equal(
      typeof p.source,
      "string",
      `${MARKETPLACE_REL}: plugin \`${String(p.name)}\` has no string \`source\``,
    );
    assert.ok(
      Array.isArray(p.skills),
      `${MARKETPLACE_REL}: plugin \`${String(p.name)}\` has no \`skills\` array. Every bundle here is a ` +
        `set of skills; one with none installs an empty plugin.`,
    );
    for (const s of p.skills as unknown[]) {
      assert.equal(
        typeof s,
        "string",
        `${MARKETPLACE_REL}: plugin \`${String(p.name)}\` lists a non-string skill entry`,
      );
    }
    return { name: p.name as string, source: p.source as string, skills: p.skills as string[] };
  });
}

/** Every `skill/<name>/` directory on disk, whether or not the manifest claims it. */
function skillDirsOnDisk(): string[] {
  const abs = path.join(REPO_ROOT, SKILL_ROOT_REL);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch (err) {
    return assert.fail(
      `${SKILL_ROOT_REL}/ is unreadable (${(err as Error).message}). It holds every skill body this ` +
        `repo serves; if it moved, move this test in the same change rather than letting the ` +
        `manifest gate pass over nothing.`,
    );
  }
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  // Fail closed: an empty scan would make the union comparison below trivially
  // satisfiable by an empty manifest.
  assert.ok(dirs.length > 0, `${SKILL_ROOT_REL}/ holds no directories — this gate would pass vacuously`);
  return dirs;
}

test("marketplace.json declares exactly the seven bundles, each served from this checkout", () => {
  const plugins = readMarketplace();
  assert.equal(
    plugins.length,
    EXPECTED_PLUGIN_COUNT,
    `${MARKETPLACE_REL} lists ${plugins.length} plugins, expected ${EXPECTED_PLUGIN_COUNT}: ` +
      `${plugins.map((p) => p.name).join(", ")}. Adding or dropping a bundle is a real decision; ` +
      `update this count in the same change so it is never an accident.`,
  );
  const names = plugins.map((p) => p.name);
  assert.deepEqual(
    [...new Set(names)].sort(),
    [...names].sort(),
    `${MARKETPLACE_REL}: two plugins share a name — installs would collide on it`,
  );
  for (const p of plugins) {
    assert.equal(
      p.source,
      "./",
      `${MARKETPLACE_REL}: plugin \`${p.name}\` has source "${p.source}". Since STARK-8249 this repo ` +
        `serves itself: "./" is what makes the manifest resolve skills out of THIS checkout. Any other ` +
        `value points installs at a tree no gate here reads.`,
    );
  }
});

test("every skill a bundle claims exists on disk with a SKILL.md", () => {
  for (const plugin of readMarketplace()) {
    for (const entry of plugin.skills) {
      assert.match(
        entry,
        new RegExp(`^\\./${SKILL_ROOT_REL}/[^/]+$`),
        `${MARKETPLACE_REL}: plugin \`${plugin.name}\` claims "${entry}", which is not a ` +
          `\`./${SKILL_ROOT_REL}/<name>\` path. Claude Code resolves it relative to the manifest, so ` +
          `any other shape resolves outside the served tree.`,
      );
      const rel = entry.slice(2); // drop the leading "./"
      const skillMd = path.join(REPO_ROOT, rel, "SKILL.md");
      assert.ok(
        fs.existsSync(skillMd),
        `${MARKETPLACE_REL}: plugin \`${plugin.name}\` claims "${entry}", but ${rel}/SKILL.md does not ` +
          `exist. The install succeeds and the skill is simply absent — there is no build step left to ` +
          `catch this.`,
      );
    }
  }
});

test("the seven skills: lists partition the skill/ tree — no unclaimed skill, no skill claimed twice", () => {
  const plugins = readMarketplace();

  // DISJOINT. Compared as a multiset against its own set, so the message can name
  // the offender rather than just reporting a size mismatch.
  const claimedInOrder = plugins.flatMap((p) => p.skills);
  const seen = new Map<string, string[]>();
  for (const p of plugins) {
    for (const s of p.skills) seen.set(s, [...(seen.get(s) ?? []), p.name]);
  }
  const shared = [...seen.entries()].filter(([, owners]) => owners.length > 1);
  assert.deepEqual(
    shared,
    [],
    `${MARKETPLACE_REL}: ${shared.map(([s, o]) => `${s} is claimed by ${o.join(" and ")}`).join("; ")}. ` +
      `A skill in two bundles installs its body twice under two plugin names, and the second copy wins ` +
      `wherever the runtime resolves by skill name.`,
  );

  // TOTAL. Both sides are bare directory names so the message reads as a set diff.
  const claimed = [...new Set(claimedInOrder.map((s) => path.basename(s)))].sort();
  const onDisk = skillDirsOnDisk();

  // A skill dir with no SKILL.md would otherwise drop out of BOTH sides of the
  // comparison below and leave this gate reporting clean over a skill that no
  // longer has a body.
  for (const dir of onDisk) {
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, SKILL_ROOT_REL, dir, "SKILL.md")),
      `${SKILL_ROOT_REL}/${dir}/ has no SKILL.md. Either it lost its body, or it is not a skill and does ` +
        `not belong under ${SKILL_ROOT_REL}/ — a bodiless dir here silently satisfies both halves of the ` +
        `membership check.`,
    );
  }

  const unclaimed = onDisk.filter((d) => !claimed.includes(d));
  const ghosts = claimed.filter((d) => !onDisk.includes(d));
  assert.deepEqual(
    { unclaimed, ghosts },
    { unclaimed: [], ghosts: [] },
    `${MARKETPLACE_REL} and ${SKILL_ROOT_REL}/ disagree.\n` +
      `  unclaimed (on disk, in no bundle — ships to nobody): ${unclaimed.join(", ") || "none"}\n` +
      `  ghosts (claimed, not on disk): ${ghosts.join(", ") || "none"}\n` +
      `An unclaimed skill is the v0.31.2 \`agnes\` failure (STARK-6249): the skill exists, the standards ` +
      `reference it, and no install ever receives it. Add it to a bundle's \`skills:\` list.`,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// §2  `.gitleaks.toml` — the config BOTH secret scanners read
// ────────────────────────────────────────────────────────────────────────────
//
// Two scanners read this one file. `ci.yml`'s `secret scan (tree)` job — a
// REQUIRED context on `main` — runs it over the whole working tree.
// `.github/workflows/secret-scan.yml`, the fleet's reusable caller, runs it over
// the incoming commits AND feeds itself a bare `GOCSPX-` probe first: it refuses
// to trust a clean scan until it has watched rule id `google-oauth-client-secret`
// fire. So removing or renaming that rule turns a check RED on a repo with no
// secrets in it — failing in another repo's workflow, about a probe, while this
// repo's own full-tree scan stays green and nothing here says why.
//
// This is the STATIC half of the deleted `TestGitleaksConfigContract`: the Go
// test also shelled to a pinned gitleaks binary and asserted the rule actually
// FIRES. `node --test` has no gitleaks (the `test` job installs nothing), so a
// commented-out rule, a drifted regex or an entropy floor raised past the probe
// would satisfy every assertion below.
//
// That dynamic half lives in `ci.yml`'s own `secrets` job — the
// `gitleaks — self-test (both repo rules must fire)` step, which writes a probe
// outside the checkout and asserts BOTH rule ids out of gitleaks' JSON report.
// It is there rather than only in the fleet caller because the fleet caller
// `secret-scan / secret-scan` is not a REQUIRED context here and never will be:
// STARK-7967 withdrew that requirement from every repo in the org on 2026-09-20
// (`local.secret_scan_enforced` is `toset([])`), and STARK-7635, which owned the
// enrol-or-not decision for the two hand-PR'd repos, was cancelled the same day.
// A proof that can only advise is not a gate. The fleet caller also probes only
// `google-oauth-client-secret`, its own self-test input, so it never covers
// `stark-inline-credential` at all — see `docs/operations/branch-protection.md`
// §1, the one place to change any of this.
//
// So: treat the assertions below as the STATIC half — they prove the ids are
// still spelled in the file, nothing more — and re-measure with the real binary
// before touching a rule's body:
//   gitleaks dir <tmp> --config .gitleaks.toml --exit-code 0 --report-format json --report-path /tmp/r.json

const GITLEAKS_REL = ".gitleaks.toml";
const FLEET_SELFTEST_RULE_ID = "google-oauth-client-secret";
const INLINE_CREDENTIAL_RULE_ID = "stark-inline-credential";

// `#` ALONE, not the shared `.ts`-aware default set, for the same reason
// `workflow_shape.test.ts` narrows to it: TOML gives `//`, `*` and `/*` no
// comment meaning, and a value line that happens to start with one of them — a
// glob or a regex continuation inside a `'''…'''` literal — would be BLANKED,
// which is a false negative on a gate that scans for `paths =` and rule `id =`.
// The default set exists for the `.ts` half of the tree, not for this file.
const TOML_COMMENT_MARKERS = ["#"];

function readGitleaksConfig(): string[] {
  return blankWholeLineComments(
    readRepoFile(
      GITLEAKS_REL,
      "Both secret scanners load it by path and gitleaks exits non-zero on a config it cannot read, so " +
        "losing it reddens the required `secret scan (tree)` context on every PR.",
    ),
    TOML_COMMENT_MARKERS,
  ).split("\n");
}

test(".gitleaks.toml extends the default ruleset rather than replacing it", () => {
  const lines = readGitleaksConfig();
  const at = lines.findIndex((l) => /^\[extend\]\s*$/.test(l));
  assert.notEqual(
    at,
    -1,
    `${GITLEAKS_REL}: no \`[extend]\` table. Without it gitleaks runs ONLY the two rules defined here — ` +
      `every stock token/key detector silently stops running while the scan still reports clean.`,
  );
  // The table's body: everything up to the next table header at column zero
  // (`[extend]`, `[[rules]]`, `[allowlist]` are all `^\[`). Asserting on the body
  // rather than the whole file is what stops a `useDefault = true` belonging to
  // some other table from satisfying this.
  const next = lines.findIndex((l, i) => i > at && /^\[/.test(l));
  const body = lines.slice(at + 1, next === -1 ? lines.length : next);
  assert.ok(
    body.some((l) => /^\s*useDefault\s*=\s*true\s*$/.test(l)),
    `${GITLEAKS_REL}: \`[extend]\` does not set \`useDefault = true\`. The stock ruleset is where every ` +
      `AWS/GitHub/Slack/private-key detector lives; the two rules in this file are additions to it, not a ` +
      `replacement for it.`,
  );
});

test(".gitleaks.toml carries the rule the fleet scan's self-test asserts fires", () => {
  const lines = readGitleaksConfig();
  assert.ok(
    lines.some((l) => new RegExp(`^\\s*id\\s*=\\s*"${FLEET_SELFTEST_RULE_ID}"\\s*$`).test(l)),
    `${GITLEAKS_REL}: rule id "${FLEET_SELFTEST_RULE_ID}" is gone (renamed, deleted or commented out). ` +
      `21StarkCom/.github's reusable secret scan feeds a bare GOCSPX- probe through THIS config and ` +
      `refuses to trust a clean scan unless that exact id appears in the report, so the check goes RED ` +
      `on a repo with no secrets in it. Carrying the rule is also what lets bifrost run the fleet's ` +
      `default caller with no \`selftest_rule_id\` override — see §3.`,
  );
  assert.ok(
    lines.some((l) => new RegExp(`^\\s*id\\s*=\\s*"${INLINE_CREDENTIAL_RULE_ID}"\\s*$`).test(l)),
    `${GITLEAKS_REL}: rule id "${INLINE_CREDENTIAL_RULE_ID}" is gone. It is the repo-wide rule that fails ` +
      `CI on \`token/password/secret/api_key = <literal>\` anywhere in the tree — skill bodies, tools, ` +
      `standards and tests alike. The stock ruleset does not cover that shape.`,
  );
});

test(".gitleaks.toml exempts values, never paths", () => {
  const lines = readGitleaksConfig();
  const hits = lines
    .map((l, i) => ({ line: l, no: i + 1 }))
    .filter(({ line }) => /^\s*paths\s*=/.test(line));
  assert.deepEqual(
    hits.map((h) => `${GITLEAKS_REL}:${h.no}: ${h.line.trim()}`),
    [],
    `${GITLEAKS_REL} gained an allowlist \`paths\` array. This config deliberately has none: every ` +
      `exemption in it is scoped to a VALUE (an anchored regex naming the one fixture string it excuses), ` +
      `so a real credential pasted into an exempted file still fires. A \`paths\` entry blesses a whole ` +
      `subtree instead — \`tools/\` alone is 78 test files — and the day one of them holds a live token ` +
      `the required scan reports clean. The cost of the value-scoped form is that a NEW fake-credential ` +
      `fixture reddens CI until it is listed; that is the conscious trade, not a papercut to route around.`,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// §3  `.github/workflows/secret-scan.yml` — the fleet caller
// ────────────────────────────────────────────────────────────────────────────
//
// THIS FILE IS NOT THIS REPO'S TO DESIGN, AND NOT A BYTE OF IT MAY BE EDITED HERE.
// It is a hand-maintained copy of what 21StarkCom/21stark renders from
// `repos/secret_scan.tf`; Terraform writes those exact bytes into the other 63
// repos with `github_repository_file` and skips bifrost, because `main` here
// carries `enforce_admins = true` and the provider's direct commit is rejected
// even for an admin token. So the bytes arrive here by PR instead, and they must
// stay byte-identical to the render: 21stark's
// `check "bifrost_runs_the_current_secret_scan_caller"` reads this file over the
// API on every plan and warns when it drifts, which is the only signal that a
// fleet pin bump has not reached bifrost. Its own header says "a hand edit is
// reverted by the next apply" — on THIS repo nothing reverts it, which is worse,
// not better. Change the template in 21stark and copy the new render.
//
// These assertions are therefore a tripwire on a well-meaning tidy-up, not a
// design. Every failure below is one where the working tree is clean, the file
// looks fine, and a check run goes red — or quietly stops being the context
// anything names.

const SECRET_SCAN_REL = ".github/workflows/secret-scan.yml";
const FLEET_REUSABLE_WORKFLOW = "21StarkCom/.github/.github/workflows/secret-scan.yml";

function readSecretScanCaller(): string {
  return readRepoFile(
    SECRET_SCAN_REL,
    "It is a hand-maintained byte-identical copy of 21stark's Terraform render; deleting it here makes " +
      "this repo silently drop out of the fleet's secret scan while 21stark's drift check still reports " +
      "on it. Restore it from the render, never rewrite it.",
  );
}

test("the secret-scan caller pins the fleet's reusable workflow to a full commit SHA", () => {
  const body = readSecretScanCaller();
  // The trailing `(?:#.*)?` is not decoration: the fleet's other pins are written
  // `uses: actions/checkout@<sha> # v4`, so the day a pin bump adopts that house
  // style here a `$`-anchored pattern matches nothing and this test fails claiming
  // the file calls no reusable workflow at all — a false accusation about the
  // wrong thing.
  const uses = /^\s+uses:\s*(\S+)\s*(?:#.*)?$/m.exec(body);
  assert.ok(
    uses !== null,
    `${SECRET_SCAN_REL}: no \`uses:\` line. This file's entire job is to call the fleet's reusable ` +
      `workflow; without it the job does nothing and reports success.`,
  );
  const [workflow, ref] = [uses[1].slice(0, uses[1].indexOf("@")), uses[1].slice(uses[1].indexOf("@") + 1)];
  assert.ok(uses[1].includes("@"), `${SECRET_SCAN_REL}: \`uses: ${uses[1]}\` carries no ref at all`);
  assert.equal(
    workflow,
    FLEET_REUSABLE_WORKFLOW,
    `${SECRET_SCAN_REL} calls "${workflow}". The fleet's scan logic lives in ${FLEET_REUSABLE_WORKFLOW} so ` +
      `a gitleaks bump is one PR for 64 repos; calling anything else forks this repo off that channel.`,
  );
  assert.match(
    ref,
    /^[0-9a-f]{40}$/,
    `${SECRET_SCAN_REL} is pinned to "${ref}" — it must be a full 40-hex commit SHA, never a tag or a ` +
      `branch. This caller hands the runner a workflow that installs a binary as root and runs it over ` +
      `the tree, on a PUBLIC repo: a mutable ref inside a check meant to become REQUIRED is a fleet-wide ` +
      `remote-code-execution surface with no audit trail. Bumping the pin is a reviewable PR on 21stark.`,
  );
});

test("the secret-scan caller reports under the fleet context `secret-scan / secret-scan`", () => {
  const body = readSecretScanCaller();
  // A reusable workflow's check run is named "<caller job> / <called job>". The
  // called half is `secret-scan` at the pinned SHA, so the caller's job id must be
  // `secret-scan` AND must carry no `name:` of its own — a job's `name:` replaces
  // the left half just as surely as renaming the id does.
  assert.ok(
    body.includes("\njobs:\n  secret-scan:\n"),
    `${SECRET_SCAN_REL}: the single job must be keyed \`secret-scan\` — it is the left half of the ` +
      `\`secret-scan / secret-scan\` context 21stark's rulesets used to require fleet-wide. No repo in the ` +
      `org requires it today (STARK-7967 withdrew it on 2026-09-20 and STARK-7635 was cancelled with it), ` +
      `but a context that silently renames itself is what makes restoring that control later look like a ` +
      `broken gate — and the name is part of the byte-identity 21stark's drift check compares.`,
  );
  const at = body.indexOf("\njobs:\n");
  assert.notEqual(at, -1, `${SECRET_SCAN_REL}: no top-level \`jobs:\` block — there is no calling job to name`);
  // Anchored at FOUR spaces, one level under `  secret-scan:`, so a `with:` input
  // called `name` (six spaces) is not misread as a job rename. The top-level
  // `name: secret-scan` is the workflow name and is not part of the context.
  assert.ok(
    !/^ {4}name:/m.test(body.slice(at)),
    `${SECRET_SCAN_REL}: the calling job gained a \`name:\`. That renames the left half of the check ` +
      `context, which is the string a ruleset requires — and an orphaned required context blocks every ` +
      `merge on "Expected — waiting for status".`,
  );
});

test("the secret-scan caller keeps all three fleet triggers and no skip guard", () => {
  const body = readSecretScanCaller();
  for (const banned of [/^\s+paths(-ignore)?:/m, /^\s+if:/m]) {
    const hit = banned.exec(body);
    assert.equal(
      hit,
      null,
      `${SECRET_SCAN_REL} gained \`${hit?.[0].trim()}\`. A guarded or filtered job reports \`skipped\`, ` +
        `GitHub counts \`skipped\` as SATISFYING a required check and renders it identically to a pass, and ` +
        `only a new commit clears it. It also breaks the byte-identity 21stark's drift check relies on.`,
    );
  }
  // Each trigger is pinned with the reason it is there, because the reason is
  // what a tidy-up has to argue with. `merge_group` needs it most: bifrost has no
  // merge queue, so here that trigger never fires and reads as dead code — and
  // deleting it breaks the byte-identity while every gate in this repo stays green.
  const triggers: Array<[string, string]> = [
    ["pull_request", "the PR run is the scan that happens BEFORE a secret reaches main"],
    ["push", "the push-to-main run is what produces a check run ON the default branch, the precondition for ever requiring this context"],
    ["merge_group", "it never fires here (bifrost has no merge queue), but it is part of the fleet render this file must stay byte-identical to"],
  ];
  for (const [key, why] of triggers) {
    assert.ok(
      body.includes(`\n  ${key}:\n`),
      `${SECRET_SCAN_REL} lost its \`${key}\` trigger; ${why}.`,
    );
  }
});

test("the caller passes no selftest_rule_id override while .gitleaks.toml carries the rule", () => {
  const body = readSecretScanCaller();
  // Anchored to a YAML key, not a substring: the render carries explanatory
  // comments above its inputs, and a comment that names one is not an override.
  const overrides = /^\s+selftest_rule_id:/m.test(body);
  const carriesRule = readGitleaksConfig().some((l) =>
    new RegExp(`^\\s*id\\s*=\\s*"${FLEET_SELFTEST_RULE_ID}"\\s*$`).test(l),
  );
  assert.ok(
    carriesRule || overrides,
    `${GITLEAKS_REL} no longer defines the "${FLEET_SELFTEST_RULE_ID}" rule and ${SECRET_SCAN_REL} passes ` +
      `no \`selftest_rule_id\` override: the fleet scan's self-test will fail the check on a clean tree. ` +
      `The two ways to be correct are "carry the rule" and "pass an id the config does carry" ` +
      `(the route \`tyr\` and \`apple-developer\` took).`,
  );
  assert.ok(
    !(carriesRule && overrides),
    `${SECRET_SCAN_REL} overrides \`selftest_rule_id\` while ${GITLEAKS_REL} still carries the ` +
      `"${FLEET_SELFTEST_RULE_ID}" rule. Drop the override: an input here is a per-repo divergence from ` +
      `the fleet render this file must stay byte-identical to.`,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// §4  Governance docs must not claim the gate cannot be bypassed
// ────────────────────────────────────────────────────────────────────────────
//
// Measured against the live API on 2026-09-20 and again on 2026-09-19:
// `main`'s four required contexts live in repository ruleset 23544063 "Required
// CI on main", whose `bypass_actors` is exactly
// `[{actor_id: 5, actor_type: RepositoryRole, bypass_mode: "always"}]` —
// repository admin, which on a one-human repo is the only human. So the operator
// CAN merge red, and the difference between "CI decides" and "CI advises the one
// person who can override it" is the whole point of writing any of this down.
//
// Three docs asserted the opposite in three different spellings before
// STARK-8166 stripped the claim. All of them are cheap to write again from
// memory — which is why this is a string gate and not a comment.
//
// The exemption is the original's: a phrase wrapped in double quotes or a
// markdown code span is being MENTIONED, not asserted, so a correction can still
// be written ABOUT the phrase (both CLAUDE.md and AGENTS.md carry
// `Never write "no bypass" here`, and must keep being able to).

const GOVERNANCE_DOCS = ["docs/operations/branch-protection.md", "README.md", "CLAUDE.md", "AGENTS.md"];
const BANNED_BYPASS_CLAIMS = ["no admin bypass", "no bypass", "non-bypassable", "nonbypassable"];

/** Whether `body[at .. at+len)` is wrapped in `"` or a markdown code span. */
function isMentionedNotAsserted(body: string, at: number, len: number): boolean {
  if (at === 0 || at + len >= body.length) return false;
  const before = body[at - 1];
  const after = body[at + len];
  return (before === '"' && after === '"') || (before === "`" && after === "`");
}

/** 1-indexed line number of a character offset, for a message a reader can act on. */
function lineOf(body: string, at: number): number {
  return body.slice(0, at).split("\n").length;
}

test("no governance doc claims an admin cannot bypass the required checks", () => {
  const violations: string[] = [];
  for (const doc of GOVERNANCE_DOCS) {
    const body = readRepoFile(
      doc,
      "It is one of the four docs that describe what `main` actually enforces; a missing one is a " +
        "governance claim nobody can check, not a reason to stop checking.",
    ).toLowerCase();
    for (const phrase of BANNED_BYPASS_CLAIMS) {
      for (let from = 0; ; ) {
        const at = body.indexOf(phrase, from);
        if (at < 0) break;
        from = at + phrase.length;
        if (isMentionedNotAsserted(body, at, phrase.length)) continue;
        violations.push(`${doc}:${lineOf(body, at)}: "${phrase}"`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `A governance doc asserts the required checks cannot be bypassed:\n  ${violations.join("\n  ")}\n` +
      `Ruleset 23544063 grants repository admin \`bypass_mode: "always"\`, so the sole operator can merge ` +
      `past a red required check. Re-measure with \`gh api repos/21StarkCom/bifrost/rulesets\` before ` +
      `reinstating any of these phrases — and note \`branches/main/protection\` alone will not tell you, ` +
      `because it carries no \`required_status_checks\` key at all. To write ABOUT the phrase, quote it: ` +
      `"no bypass" and \`non-bypassable\` are both exempt.`,
  );
});
