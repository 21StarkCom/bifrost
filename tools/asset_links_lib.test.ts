// Tests for `tools/asset_links_lib.ts` + `tools/asset_links.ts` — the provisioner
// for the `~/.claude` symlink farm that points a machine at this checkout.
//
// EVERY test drives a SYNTHETIC `$HOME` in a temp dir and, where the classification
// matters, a synthetic repo too. Nothing here reads or writes the operator's real
// `~/.claude`: this tool's whole job is rewriting symlinks in that directory, so a
// test that used the real one would be a test that can break the machine it runs on.
// The two exceptions are read-only and deliberate — the real repo tree is walked to
// prove every declared target exists, and the CLI spawn tests point a temp `$HOME` at
// the real checkout (writes land in the temp dir, reads in the repo).
//
// `node:` builtins only, like the rest of the suite: ci.yml's `test` job runs no
// `npm ci`, so any other import turns a required check red on a clean tree.

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MANAGED_LINKS,
  RETIRED_LINKS,
  checkLink,
  checkLinks,
  checkRetired,
  defaultRepoRoot,
  installLink,
  installLinks,
  linkPathFor,
  linkedWorktreeMainCheckout,
  renderReport,
  reportToJson,
  requireManagedLink,
  targetPathFor,
} from "./asset_links_lib.ts";
import { installStatusline, statuslineShPath } from "./statusline_setup_lib.ts";

const REPO_ROOT = defaultRepoRoot();
const CLI = path.join(REPO_ROOT, "tools", "asset_links.ts");

const temps: string[] = [];
function tmp(tag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `asset-links-${tag}-`));
  temps.push(dir);
  return dir;
}
process.on("exit", () => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A synthetic repo carrying every declared target, each the same KIND (file or
 * directory) it is in the real tree — so a fixture cannot drift into testing a
 * shape the repo does not have. The real tree is read for the kind only; the
 * "every target exists" test below is what keeps that read from throwing.
 */
function synthRepo(): string {
  const root = tmp("repo");
  for (const row of MANAGED_LINKS) {
    const abs = path.join(root, row.target);
    if (fs.statSync(path.join(REPO_ROOT, row.target)).isDirectory()) {
      fs.mkdirSync(abs, { recursive: true });
      fs.writeFileSync(path.join(abs, "marker"), row.target);
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, row.target);
    }
  }
  return root;
}

function synthHome(): string {
  return tmp("home");
}

/** The row this suite reaches for when one concrete link will do. */
const TOOLS_ROW = requireManagedLink(".claude/code-review/tools");

// ---------------------------------------------------------------------------
// The table itself
// ---------------------------------------------------------------------------

test("MANAGED_LINKS is a well-formed table of home-relative links into the repo", () => {
  assert.ok(MANAGED_LINKS.length > 0, "an empty table would make every gate below pass vacuously");
  assert.equal(MANAGED_LINKS.length, 9, "nine links are managed; adding or dropping one is a real decision");

  const links = MANAGED_LINKS.map((r) => r.link);
  assert.deepEqual([...new Set(links)].sort(), [...links].sort(), "two rows claim the same link path");

  for (const row of MANAGED_LINKS) {
    assert.ok(!path.isAbsolute(row.link), `${row.link} must be relative to $HOME`);
    assert.ok(!path.isAbsolute(row.target), `${row.target} must be relative to the repo root`);
    assert.ok(row.link.startsWith(".claude/"), `${row.link} escapes ~/.claude — this tool owns nothing else`);
    assert.ok(!row.link.split("/").includes(".."), `${row.link} must not traverse upward`);
    assert.ok(!row.target.split("/").includes(".."), `${row.target} must not traverse upward`);
    assert.ok(row.why.length > 10, `${row.link} has no usable "why" — the report has nothing to tell an operator`);
  }
});

// THE reason this tool belongs in bifrost rather than in idun. idun does not
// ship this tree, so its ASSET_SYMLINKS table could never check its own targets;
// a renamed target there surfaced only when a skill failed at runtime. Here it
// is a required check on every PR.
test("every managed target exists in THIS repo — the static check idun could not do", () => {
  for (const row of MANAGED_LINKS) {
    const abs = targetPathFor(row, REPO_ROOT);
    assert.ok(
      fs.existsSync(abs),
      `MANAGED_LINKS names ${row.target}, which is not in this repo. Either the target was renamed ` +
        `(fix the row) or deleted (retire the row) — a machine linked at a missing path fails only at ` +
        `runtime, inside whatever skill needed it: ${row.why}`,
    );
  }
});

test("requireManagedLink fails loudly rather than returning undefined", () => {
  assert.equal(requireManagedLink(TOOLS_ROW.link).target, "tools");
  assert.throws(() => requireManagedLink(".claude/not-a-managed-path"), /no managed link named/);
});

// ---------------------------------------------------------------------------
// The retired asset — it must not come back
// ---------------------------------------------------------------------------

test("the retired orchestrator.md link is modelled, never managed, and never provisioned", () => {
  const retired = RETIRED_LINKS.find((r) => r.link === ".claude/code-review/orchestrator.md");
  assert.ok(retired, "the retired row is the record of the decision — deleting it invites the row back");
  assert.ok(
    !fs.existsSync(path.join(REPO_ROOT, retired.formerTarget)),
    `${retired.formerTarget} is back in the repo. If it is live again, that is a real decision: move the ` +
      `row from RETIRED_LINKS to MANAGED_LINKS deliberately rather than leaving the tables contradicting the tree.`,
  );

  const managed = new Set(MANAGED_LINKS.map((r) => r.link));
  for (const row of RETIRED_LINKS) {
    assert.ok(!managed.has(row.link), `${row.link} is in BOTH tables — retirement means never provisioned`);
  }

  // The behavioural half: a clean install creates none of them.
  const home = synthHome();
  const repoRoot = synthRepo();
  const report = installLinks({ home, repoRoot });
  for (const row of RETIRED_LINKS) {
    assert.ok(
      !fs.existsSync(linkPathFor(row, home)) && !isLink(linkPathFor(row, home)),
      `install created the retired link ${row.link}`,
    );
  }
  assert.ok(report.ok);
});

test("a retired link that still exists on a machine is reported, not silently repaired", () => {
  const home = synthHome();
  const repoRoot = synthRepo();
  const row = RETIRED_LINKS[0]!;
  const linkPath = linkPathFor(row, home);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync("/nowhere/stark-skills/global/orchestrator.md", linkPath);

  const report = installLinks({ home, repoRoot });
  assert.equal(report.ok, false, "a stale retired link is a finding — otherwise nobody ever learns it is there");
  const state = report.retired.find((r) => r.row.link === row.link)!;
  assert.equal(state.present, true);
  assert.match(state.detail, /rm /, "the report must hand the operator the exact removal command");
  // Report-only: removing it would be this tool touching a ~/.claude/code-review
  // entry it does not manage.
  assert.ok(isLink(linkPath), "the retired link was deleted — this tool removes nothing it does not manage");
});

test("a retired path that is a DIRECTORY is reported without throwing and with the right rm", () => {
  const home = synthHome();
  const row = RETIRED_LINKS[0]!;
  const linkPath = linkPathFor(row, home);
  fs.mkdirSync(linkPath, { recursive: true });

  const state = checkRetired(row, { home });
  assert.equal(state.present, true);
  assert.equal(state.actual, undefined, "a directory has no readlink target to report");
  assert.match(state.detail, /rm -r /, "`rm` alone fails on a directory — the report must not hand over a dead command");
});

// ---------------------------------------------------------------------------
// The repo root these links are aimed at
// ---------------------------------------------------------------------------

// `defaultRepoRoot()` is "whatever tree this file was loaded from", and ~/.claude
// holds exactly ONE of each link — so an --install from a worktree repoints the
// whole machine at a tree that exists to be deleted. Agents work in worktrees by
// default, which makes this the likely accident, not the exotic one.
test("a linked git worktree is recognised, and a main checkout / submodule is not", () => {
  const main = tmp("main-checkout");
  fs.mkdirSync(path.join(main, ".git"), { recursive: true });
  assert.equal(linkedWorktreeMainCheckout(main), null, "a main checkout must not be refused");

  const wt = tmp("worktree");
  fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "feature")}\n`);
  assert.equal(linkedWorktreeMainCheckout(wt), main);

  const sub = tmp("submodule");
  fs.writeFileSync(path.join(sub, ".git"), `gitdir: ${path.join(main, ".git", "modules", "vendored")}\n`);
  assert.equal(linkedWorktreeMainCheckout(sub), null, "a submodule is not a worktree");

  assert.equal(linkedWorktreeMainCheckout(tmp("no-git")), null, "no .git at all is not a worktree");

  // The real checkout this suite runs in is the main one, so the CLI is usable.
  assert.equal(linkedWorktreeMainCheckout(REPO_ROOT), null);
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function isLink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

test("checkLink classifies absent, ok, dangling, misdirected, occupied-file and occupied-dir", () => {
  const home = synthHome();
  const repoRoot = synthRepo();
  const linkPath = linkPathFor(TOOLS_ROW, home);
  const targetPath = targetPathFor(TOOLS_ROW, repoRoot);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });

  assert.equal(checkLink(TOOLS_ROW, { home, repoRoot }).status, "absent");

  fs.symlinkSync(targetPath, linkPath);
  assert.equal(checkLink(TOOLS_ROW, { home, repoRoot }).status, "ok");

  fs.unlinkSync(linkPath);
  fs.symlinkSync(path.join(repoRoot, "gone"), linkPath);
  const dangling = checkLink(TOOLS_ROW, { home, repoRoot });
  assert.equal(dangling.status, "dangling");
  assert.equal(dangling.actual, path.join(repoRoot, "gone"));

  const elsewhere = tmp("elsewhere");
  fs.unlinkSync(linkPath);
  fs.symlinkSync(elsewhere, linkPath);
  const misdirected = checkLink(TOOLS_ROW, { home, repoRoot });
  assert.equal(misdirected.status, "misdirected");
  assert.equal(misdirected.actual, elsewhere);

  fs.unlinkSync(linkPath);
  fs.writeFileSync(linkPath, "hand-written");
  assert.equal(checkLink(TOOLS_ROW, { home, repoRoot }).status, "occupied");

  fs.unlinkSync(linkPath);
  fs.mkdirSync(linkPath);
  assert.equal(checkLink(TOOLS_ROW, { home, repoRoot }).status, "occupied");
});

test("checkLink reports target-missing rather than pretending the link can be fixed", () => {
  const home = synthHome();
  const repoRoot = synthRepo();
  fs.rmSync(targetPathFor(TOOLS_ROW, repoRoot), { recursive: true });
  const state = checkLink(TOOLS_ROW, { home, repoRoot });
  assert.equal(state.status, "target-missing");
  assert.match(state.detail, /not in the repo/);
});

test("a path whose PARENT is a regular file is unreadable, not guessed at", () => {
  const home = synthHome();
  const repoRoot = synthRepo();
  // `~/.claude/code-review` as a FILE makes lstat of every child ENOTDIR.
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "code-review"), "not a directory");

  const state = checkLink(TOOLS_ROW, { home, repoRoot });
  assert.equal(state.status, "unreadable");
  const action = installLink(TOOLS_ROW, { home, repoRoot });
  assert.equal(action.outcome, "refused");
  assert.equal(
    fs.readFileSync(path.join(home, ".claude", "code-review"), "utf8"),
    "not a directory",
    "install overwrote the blocking file",
  );
});

// ---------------------------------------------------------------------------
// Install: provisioning, healing, idempotency
// ---------------------------------------------------------------------------

test("install provisions every link on a clean home, and check then passes", () => {
  const home = synthHome();
  const repoRoot = synthRepo();

  assert.equal(checkLinks({ home, repoRoot }).ok, false, "a clean home cannot already be provisioned");

  const first = installLinks({ home, repoRoot });
  assert.equal(first.ok, true, renderReport(first));
  assert.deepEqual(
    [...new Set(first.actions.map((a) => a.outcome))],
    ["linked"],
    "every row on a clean home should be a fresh link",
  );
  for (const row of MANAGED_LINKS) {
    const linkPath = linkPathFor(row, home);
    assert.ok(isLink(linkPath), `${row.link} is not a symlink`);
    assert.equal(fs.realpathSync(linkPath), fs.realpathSync(targetPathFor(row, repoRoot)));
  }
});

test("install is idempotent — the second run is a pure no-op", () => {
  const home = synthHome();
  const repoRoot = synthRepo();
  installLinks({ home, repoRoot });

  const before = MANAGED_LINKS.map((row) => fs.lstatSync(linkPathFor(row, home)).ino);
  const second = installLinks({ home, repoRoot });

  assert.equal(second.ok, true);
  assert.deepEqual([...new Set(second.actions.map((a) => a.outcome))], ["ok"]);
  const after = MANAGED_LINKS.map((row) => fs.lstatSync(linkPathFor(row, home)).ino);
  assert.deepEqual(after, before, "a no-op run replaced links anyway — churn on every invocation");
});

test("a link already pointing at the right target is a no-op on the FIRST run", () => {
  const home = synthHome();
  const repoRoot = synthRepo();
  const linkPath = linkPathFor(TOOLS_ROW, home);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(targetPathFor(TOOLS_ROW, repoRoot), linkPath);
  const ino = fs.lstatSync(linkPath).ino;

  const action = installLink(TOOLS_ROW, { home, repoRoot });
  assert.equal(action.outcome, "ok");
  assert.equal(fs.lstatSync(linkPath).ino, ino);
});

test("install heals a link pointing at the wrong checkout, and one that dangles", () => {
  const home = synthHome();
  const repoRoot = synthRepo();
  const stale = tmp("stale");
  fs.mkdirSync(path.join(stale, "tools"), { recursive: true });

  const toolsLink = linkPathFor(TOOLS_ROW, home);
  fs.mkdirSync(path.dirname(toolsLink), { recursive: true });
  fs.symlinkSync(path.join(stale, "tools"), toolsLink);

  const standardsRow = requireManagedLink(".claude/code-review/standards");
  const standardsLink = linkPathFor(standardsRow, home);
  fs.symlinkSync(path.join(stale, "standards"), standardsLink);

  const report = installLinks({ home, repoRoot });
  assert.equal(report.ok, true, renderReport(report));
  assert.equal(report.actions.find((a) => a.row.link === TOOLS_ROW.link)!.before, "misdirected");
  assert.equal(report.actions.find((a) => a.row.link === standardsRow.link)!.before, "dangling");
  assert.equal(fs.realpathSync(toolsLink), fs.realpathSync(targetPathFor(TOOLS_ROW, repoRoot)));
  assert.equal(fs.realpathSync(standardsLink), fs.realpathSync(targetPathFor(standardsRow, repoRoot)));
});

// ---------------------------------------------------------------------------
// The three rules that cost something to get wrong
// ---------------------------------------------------------------------------

test("RULE: real content is never clobbered — a file and a directory both survive install", () => {
  const home = synthHome();
  const repoRoot = synthRepo();
  const fileRow = requireManagedLink(".claude/code-review/config.json");
  const dirRow = TOOLS_ROW;

  const filePath = linkPathFor(fileRow, home);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '{"hand":"written"}');
  const dirPath = linkPathFor(dirRow, home);
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(path.join(dirPath, "mine.ts"), "operator content");

  const report = installLinks({ home, repoRoot });
  assert.equal(report.ok, false, "occupied paths are a finding, not a silent skip");
  for (const row of [fileRow, dirRow]) {
    assert.equal(report.actions.find((a) => a.row.link === row.link)!.outcome, "refused");
  }
  assert.equal(fs.readFileSync(filePath, "utf8"), '{"hand":"written"}');
  assert.equal(fs.readFileSync(path.join(dirPath, "mine.ts"), "utf8"), "operator content");
  assert.ok(!isLink(filePath) && !isLink(dirPath), "a real path was replaced by a link");
});

test("RULE: a link whose corrected target is missing is reported, never deleted", () => {
  const home = synthHome();
  const repoRoot = synthRepo();
  const linkPath = linkPathFor(TOOLS_ROW, home);
  const stale = tmp("stale");
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(stale, linkPath);
  fs.rmSync(targetPathFor(TOOLS_ROW, repoRoot), { recursive: true });

  const action = installLink(TOOLS_ROW, { home, repoRoot });
  assert.equal(action.outcome, "refused");
  assert.equal(action.before, "target-missing");
  assert.ok(isLink(linkPath), "the stale link was deleted — its target was the only record of where it pointed");
  assert.equal(fs.readlinkSync(linkPath), stale);
});

// A repoint that dies between `unlink` and `symlink` leaves the path ABSENT, and
// `settings.json` runs `bash ~/.claude/statusline-command.sh` — so the failure
// mode is a dead statusline on every session until someone reruns this by hand.
// The fault seam makes that window observable: throw where the crash would land
// and assert the OLD link is still there and still points where it did.
test("RULE: a repoint is atomic — a crash mid-write leaves the old link intact", () => {
  const home = synthHome();
  const repoRoot = synthRepo();
  const stale = tmp("stale");
  const linkPath = linkPathFor(TOOLS_ROW, home);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(stale, linkPath);

  let tmpSeen = "";
  const action = installLink(TOOLS_ROW, {
    home,
    repoRoot,
    onBeforeRename: (tmpPath) => {
      tmpSeen = tmpPath;
      // The link must be intact at the ONE instant a naive implementation has
      // already removed it.
      assert.ok(isLink(linkPath), "the link was removed before the replacement was published");
      assert.equal(fs.readlinkSync(linkPath), stale);
      throw new Error("simulated crash");
    },
  });

  assert.equal(action.outcome, "refused");
  assert.match(action.detail, /simulated crash/);
  assert.ok(isLink(linkPath), "the link is gone after a failed repoint");
  assert.equal(fs.readlinkSync(linkPath), stale, "the link survived but stopped pointing anywhere useful");
  assert.ok(tmpSeen !== "" && !fs.existsSync(tmpSeen) && !isLink(tmpSeen), `temp ${tmpSeen} was left behind`);
  assert.equal(path.dirname(tmpSeen), path.dirname(linkPath), "the temp must share a filesystem with the link");
});

// ---------------------------------------------------------------------------
// stateRoot()'s mutable siblings
// ---------------------------------------------------------------------------

test("stateRoot()'s audit/, history/ and locks/ are untouched and the dir is never replaced", () => {
  const home = synthHome();
  const repoRoot = synthRepo();
  const stateDir = path.join(home, ".claude", "code-review");
  fs.mkdirSync(stateDir, { recursive: true });
  const stateInode = fs.lstatSync(stateDir).ino;
  for (const [dir, file] of [["audit", "a.jsonl"], ["history", "h.json"], ["locks", "l.lock"]]) {
    fs.mkdirSync(path.join(stateDir, dir), { recursive: true });
    fs.writeFileSync(path.join(stateDir, dir, file), `state:${dir}`);
  }

  const report = installLinks({ home, repoRoot });
  assert.equal(report.ok, true, renderReport(report));

  assert.equal(fs.lstatSync(stateDir).ino, stateInode, "~/.claude/code-review was replaced, not populated");
  for (const [dir, file] of [["audit", "a.jsonl"], ["history", "h.json"], ["locks", "l.lock"]]) {
    assert.ok(fs.statSync(path.join(stateDir, dir)).isDirectory(), `${dir}/ stopped being a directory`);
    assert.equal(fs.readFileSync(path.join(stateDir, dir, file), "utf8"), `state:${dir}`);
  }

  // Nothing appeared beyond the state dirs and the declared leaf names — no temp
  // files, no bookkeeping of its own.
  const managedLeaves = MANAGED_LINKS.filter((r) => path.dirname(r.link) === ".claude/code-review").map((r) =>
    path.basename(r.link),
  );
  assert.deepEqual(
    fs.readdirSync(stateDir).sort(),
    ["audit", "history", "locks", ...managedLeaves].sort(),
  );
});

// ---------------------------------------------------------------------------
// The statusline fold — one table, one implementation
// ---------------------------------------------------------------------------

test("statusline_setup reads its path from the managed table, not a second copy", () => {
  const row = requireManagedLink(".claude/statusline-command.sh");
  assert.equal(row.target, "config/statusline-command.sh");
  assert.equal(statuslineShPath(), targetPathFor(row, REPO_ROOT));
  assert.ok(fs.existsSync(statuslineShPath()));
});

test("installStatusline delegates the symlink half and keeps its settings.json wiring", () => {
  const home = synthHome();
  const prev = process.env.HOME;
  process.env.HOME = home;
  try {
    const first = installStatusline();
    assert.ok(first.some((a) => a.startsWith("Linked")), first.join(" | "));
    assert.ok(first.includes("Patched settings.json"));

    const linkPath = linkPathFor(requireManagedLink(".claude/statusline-command.sh"), home);
    assert.ok(isLink(linkPath), "the statusline link was not created through the shared helper");
    assert.equal(fs.realpathSync(linkPath), fs.realpathSync(statuslineShPath()));

    const settings = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
    assert.equal(settings.statusLine.command, `bash ${linkPath}`, "settings must point at the LINK, not the checkout");

    assert.deepEqual(installStatusline(), ["Script symlink OK", "settings.json OK"]);
  } finally {
    if (prev === undefined) delete process.env.HOME;
    else process.env.HOME = prev;
  }
});

test("installStatusline refuses a hand-placed real script instead of deleting it", () => {
  const home = synthHome();
  const prev = process.env.HOME;
  process.env.HOME = home;
  try {
    const linkPath = path.join(home, ".claude", "statusline-command.sh");
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.writeFileSync(linkPath, "#!/bin/sh\necho mine\n");
    const actions = installStatusline();
    assert.ok(actions.some((a) => a.startsWith("REFUSED:")), actions.join(" | "));
    assert.equal(fs.readFileSync(linkPath, "utf8"), "#!/bin/sh\necho mine\n");
    // The settings wiring still lands HERE, deliberately: the path holds a real
    // script, so `bash <path>` runs. What must not happen is the next test's case.
    assert.ok(actions.includes("Patched settings.json"), actions.join(" | "));
  } finally {
    if (prev === undefined) delete process.env.HOME;
    else process.env.HOME = prev;
  }
});

// `settings.json`'s `statusLine.command` is `bash <link>`. Wiring it at a path
// that holds NOTHING is a dead statusline on every session, and "Patched
// settings.json" in the output reads like success — which is how a refusal that
// the delegate newly made possible would get buried.
test("installStatusline does not wire settings.json at a script it could not install", (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("root ignores the mode bits this test uses to force a write failure");
    return;
  }
  const home = synthHome();
  const prev = process.env.HOME;
  process.env.HOME = home;
  const claudeDir = path.join(home, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.chmodSync(claudeDir, 0o555);
  try {
    const actions = installStatusline();
    assert.ok(actions.some((a) => a.startsWith("REFUSED:")), actions.join(" | "));
    assert.ok(
      actions.some((a) => a.startsWith("Skipped settings.json")),
      `settings.json was wired at a path holding nothing: ${actions.join(" | ")}`,
    );
    assert.ok(!actions.includes("Patched settings.json"), actions.join(" | "));
  } finally {
    fs.chmodSync(claudeDir, 0o755);
    if (prev === undefined) delete process.env.HOME;
    else process.env.HOME = prev;
  }
});

test("statusline_setup --install exits non-zero when the link was refused", (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("root ignores the mode bits this test uses to force a write failure");
    return;
  }
  const home = synthHome();
  const claudeDir = path.join(home, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.chmodSync(claudeDir, 0o555);
  try {
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, "tools", "statusline_setup.ts"), "--install"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, NO_COLOR: "1" },
    });
    // Before the delegation this path could only succeed or throw, so exit 0 meant
    // "installed". It must not now also mean "reported a dead statusline".
    assert.equal(r.status, 1, `${r.stdout ?? ""}${r.stderr ?? ""}`);
    assert.match(r.stdout ?? "", /REFUSED:/);
  } finally {
    fs.chmodSync(claudeDir, 0o755);
  }
});

// ---------------------------------------------------------------------------
// Rendering + the CLI
// ---------------------------------------------------------------------------

test("renderReport names the failing row and what breaks without it", () => {
  const home = synthHome();
  const repoRoot = synthRepo();
  const text = renderReport(checkLinks({ home, repoRoot }));
  assert.match(text, /PROBLEMS/);
  assert.match(text, /\.claude\/code-review\/tools/);
  assert.match(text, /needed for:/);
  assert.match(renderReport(installLinks({ home, repoRoot })), /OK: every managed link resolves/);
});

test("renderReport keeps its columns aligned when a retired row is present", () => {
  const home = synthHome();
  const repoRoot = synthRepo();
  const row = RETIRED_LINKS[0]!;
  const linkPath = linkPathFor(row, home);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync("/nowhere/orchestrator.md", linkPath);

  // The retired link is the LONGEST name in either table, so a width taken from
  // the managed rows alone leaves the one row asking for action as the one row
  // whose status column is out of line.
  const rows = renderReport(installLinks({ home, repoRoot }))
    .split("\n")
    .filter((l) => l.startsWith("  .claude/"));
  assert.ok(rows.length >= MANAGED_LINKS.length + 1, rows.join("\n"));
  const columns = new Set(
    rows.map((l) => {
      const m = /^ {2}\S+ +(\S+)/.exec(l);
      assert.ok(m, `unparseable row: ${l}`);
      return m[0].length - m[1]!.length;
    }),
  );
  assert.equal(columns.size, 1, `status column is ragged:\n${rows.join("\n")}`);
});

test("reportToJson carries status, outcome and the retired rows", () => {
  const home = synthHome();
  const repoRoot = synthRepo();
  const json = reportToJson(installLinks({ home, repoRoot })) as {
    ok: boolean;
    links: { link: string; status: string; outcome: string }[];
    retired: { link: string; present: boolean }[];
  };
  assert.equal(json.ok, true);
  assert.equal(json.links.length, MANAGED_LINKS.length);
  assert.equal(json.links[0]!.status, "ok");
  assert.equal(json.links[0]!.outcome, "linked");
  assert.equal(json.retired.length, RETIRED_LINKS.length);
  assert.equal(json.retired[0]!.present, false);
});

/** Runs the real CLI against a temp `$HOME` and the real checkout. */
function runCli(home: string, args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, NO_COLOR: "1" },
  });
  return { ...r, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

test("the CLI gates on --check and heals with --install", () => {
  const home = synthHome();

  const before = runCli(home, ["--check"]);
  assert.equal(before.status, 1, "a clean home must FAIL --check — that is what makes it usable as a gate");
  assert.match(before.output, /PROBLEMS/);

  const install = runCli(home, ["--install"]);
  assert.equal(install.status, 0, install.output);

  const after = runCli(home, ["--check", "--json"]);
  assert.equal(after.status, 0, after.output);
  const json = JSON.parse(after.stdout) as { ok: boolean; home: string; links: { status: string }[] };
  assert.equal(json.ok, true);
  assert.equal(json.home, home);
  assert.ok(json.links.every((l) => l.status === "ok"));

  // Every write landed in the temp home, pointing at the real checkout.
  for (const row of MANAGED_LINKS) {
    assert.equal(fs.realpathSync(linkPathFor(row, home)), fs.realpathSync(targetPathFor(row, REPO_ROOT)));
  }
});

test("the CLI refuses a missing, doubled or unknown mode rather than doing something", () => {
  const home = synthHome();
  for (const [args, pattern] of [
    [[], /one of --check or --install is required/],
    [["--check", "--install"], /mutually exclusive/],
    [["--nonsense"], /unknown argument/],
    [["--check=yes"], /takes no value/],
  ] as [string[], RegExp][]) {
    const r = runCli(home, args);
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.output}`);
    assert.match(r.output, pattern);
  }
  assert.deepEqual(fs.readdirSync(home), [], "a usage error must not write to $HOME");

  const help = runCli(home, ["--help"]);
  assert.equal(help.status, 0, help.output);
  assert.match(help.stdout, /Usage: asset_links/);
  assert.deepEqual(fs.readdirSync(home), []);
});
