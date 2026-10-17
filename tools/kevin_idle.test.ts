import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { hermodEnv, idleSeconds, isDue, lastActivityMs, peerState, pollMs, run } from "./kevin_idle.ts";

const peers = (...rows: object[]) => JSON.stringify({ peers: rows });
const running = (pid: number) => pid === 1;

test("Kevin's row is found by sessionName, and a row whose pid is dead is gone", () => {
  const kevin = { id: "claude:k", sessionName: "KEVIN-bifrost-1", pid: 1 };
  const other = { id: "claude:o", sessionName: "KEVIN-other-1", pid: 1 };
  assert.deepEqual(peerState(peers(other, kevin), "KEVIN-bifrost-1", running), { state: "live", id: "claude:k", pid: 1, busy: false });
  assert.deepEqual(peerState(peers(other, { ...kevin, pid: 2 }), "KEVIN-bifrost-1", running), { state: "gone" });
  assert.deepEqual(peerState(peers(other), "KEVIN-bifrost-1", running), { state: "gone" });
});

test("a Codex row with no sessionName is found by name, and hermod's busy activity is carried", () => {
  const codex = { id: "codex:t", name: "KEVIN-bifrost-1", pid: 1, activity: "busy" };
  assert.deepEqual(peerState(peers(codex), "KEVIN-bifrost-1", running), { state: "live", id: "codex:t", pid: 1, busy: true });
  assert.equal(peerState(peers({ ...codex, activity: "idle" }), "KEVIN-bifrost-1", running).busy, false);
});

test("hermod runs without the caller stamps that would make the waker Kevin himself", () => {
  const env = hermodEnv({ PATH: "/bin", HOME: "/h", CMUX_SURFACE_ID: "s", CODEX_THREAD_ID: "t" });
  assert.deepEqual(env, { PATH: "/bin", HOME: "/h" });
});

test("output hermod did not shape as peers is unknown, never gone", () => {
  assert.deepEqual(peerState("not json", "KEVIN-bifrost-1", running), { state: "unknown" });
  assert.deepEqual(peerState("{}", "KEVIN-bifrost-1", running), { state: "unknown" });
});

test("last activity is kevin-last's epoch seconds, never earlier than the waker's start", () => {
  assert.equal(lastActivityMs("2000\n", 1_000_000), 2_000_000);
  assert.equal(lastActivityMs("500", 1_000_000), 1_000_000);
  assert.equal(lastActivityMs(undefined, 1_000_000), 1_000_000);
  assert.equal(lastActivityMs("garbage", 1_000_000), 1_000_000);
});

test("due once a whole idle period passed since the later of activity and the last wake", () => {
  assert.equal(isDue(7_199, 0, null, 7_200), false);
  assert.equal(isDue(7_200, 0, null, 7_200), true);
  assert.equal(isDue(10_000, 0, 7_200, 7_200), false);
  assert.equal(isDue(14_400, 0, 7_200, 7_200), true);
});

test("the threshold is kevin.idle_seconds when it is a whole number of seconds, else two hours", () => {
  assert.equal(idleSeconds(600), 600);
  for (const bad of [undefined, 0, -5, 1.5, "600", null]) assert.equal(idleSeconds(bad), 7200);
});

test("polls a twenty-fourth of the threshold, between 5 s and 5 min", () => {
  assert.equal(pollMs(7_200_000), 300_000);
  assert.equal(pollMs(86_400_000), 300_000);
  assert.equal(pollMs(60_000), 5_000);
  assert.equal(pollMs(1_200_000), 50_000);
});

test("a waker whose git dir is removed exits at its next poll while hermod fails, logging the first failure only", async () => {
  const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), "kevin-idle-"));
  const stderr = "error: The current working directory was deleted, so that command didn't work.";
  const lines: string[] = [];
  let calls = 0;
  let sleeps = 0;
  try {
    await run("KEVIN-bifrost-1", gitDir, 7_200_000, {
      hermod: async () => {
        calls++;
        return { status: 1, stdout: "", stderr: `${stderr}\n`, signal: null };
      },
      sleep: async () => {
        if (++sleeps === 2) fs.rmSync(gitDir, { recursive: true, force: true });
        if (sleeps > 3) throw new Error("still polling after its git dir was removed");
      },
      log: line => lines.push(line),
    });
  } finally {
    fs.rmSync(gitDir, { recursive: true, force: true });
  }
  assert.equal(calls, 2);
  assert.deepEqual(lines.filter(l => l.includes(stderr)), [`first hermod failure, exit 1: ${stderr}`]);
  assert.equal(lines.at(-1), `${gitDir} is gone; exiting`);
});

test("a git dir replaced at the same path is gone, and a hermod failure after a recovery is logged again", async () => {
  const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), "kevin-idle-"));
  const lines: string[] = [];
  const answers = [1, 0, 1];
  let sleeps = 0;
  try {
    await run("KEVIN-bifrost-1", gitDir, 7_200_000, {
      hermod: async () => {
        const status = answers.shift() ?? 1;
        return { status, stdout: status === 0 ? "not json" : "", stderr: status === 0 ? "" : `failure ${sleeps}\n`, signal: null };
      },
      sleep: async () => {
        if (++sleeps === 3) {
          // The new dir is made while the old one still holds its inode, so
          // no filesystem can hand the same number back.
          fs.renameSync(gitDir, `${gitDir}.old`);
          fs.mkdirSync(gitDir);
          fs.rmSync(`${gitDir}.old`, { recursive: true, force: true });
        }
        if (sleeps > 4) throw new Error("still polling after its git dir was replaced");
      },
      log: line => lines.push(line),
    });
  } finally {
    fs.rmSync(gitDir, { recursive: true, force: true });
  }
  assert.deepEqual(lines.filter(l => l.startsWith("first hermod failure")), ["first hermod failure, exit 1: failure 0", "first hermod failure, exit 1: failure 2"]);
  assert.equal(lines.at(-1), `${gitDir} is gone; exiting`);
});

test("an empty --git-dir is refused, never read as the cwd", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "kevin-idle-"));
  const tool = fileURLToPath(new URL("./kevin_idle.ts", import.meta.url));
  try {
    assert.throws(
      () => execFileSync(process.execPath, [tool, "--detach", "--name", "KEVIN-test-1", "--git-dir", ""], { cwd: d, stdio: "pipe" }),
      (err: { status?: number }) => err.status === 2,
    );
    assert.deepEqual(fs.readdirSync(d), []);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

/** A live process's cwd: Linux's `/proc`, else `lsof` (macOS). */
function processCwd(pid: number): string {
  if (fs.existsSync(`/proc/${pid}/cwd`)) return fs.readlinkSync(`/proc/${pid}/cwd`);
  const out = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
  return /^n(.*)$/m.exec(out)?.[1] ?? "";
}

test("a detached waker and its hermod run from $HOME, not the caller's cwd, with a relative --git-dir resolved first", async () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kevin-idle-")));
  for (const dir of ["bin", "wt", "git", "home"]) fs.mkdirSync(path.join(d, dir));
  // A fake hermod that records the cwd it runs in, then fails; its first run
  // also says the waker is past its start.
  fs.writeFileSync(path.join(d, "bin", "hermod"), `#!/bin/sh\npwd -P > "${d}/cwd.tmp" && mv "${d}/cwd.tmp" "${d}/cwd"\nexit 1\n`, { mode: 0o755 });
  const tool = fileURLToPath(new URL("./kevin_idle.ts", import.meta.url));
  const out = execFileSync(process.execPath, [tool, "--detach", "--name", "KEVIN-test-1", "--git-dir", "../git"], {
    cwd: path.join(d, "wt"),
    env: { ...process.env, PATH: `${path.join(d, "bin")}:${process.env.PATH}`, HOME: path.join(d, "home") },
    encoding: "utf8",
  });
  const pid = Number(/started, pid (\d+)/.exec(out)?.[1]);
  assert.ok(pid > 0, out);
  try {
    for (let i = 0; i < 200 && !fs.existsSync(path.join(d, "cwd")); i++) await new Promise(r => setTimeout(r, 50));
    assert.equal(fs.readFileSync(path.join(d, "cwd"), "utf8").trim(), path.join(d, "home"));
    assert.equal(processCwd(pid), path.join(d, "home"));
  } finally {
    try {
      process.kill(pid);
    } catch {}
    fs.rmSync(d, { recursive: true, force: true });
  }
});
