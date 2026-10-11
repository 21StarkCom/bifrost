#!/usr/bin/env -S node --experimental-strip-types
/**
 * kevin_idle — Kevin's idle waker where the kevin-idle mod cannot run (Codex,
 * or a Claude without the mod). It polls `kevin-last` in his worktree's git
 * dir (or, before his first report, the waker's start) and, once that is
 * `kevin.idle_seconds` old (the stark config), sends him `kevin idle check` by
 * hermod; he runs his own check and decides. It wakes him at most once per
 * idle period, and exits once hermod answers with no live row whose
 * `sessionName` is his name.
 *
 *   node tools/kevin_idle.ts --name KEVIN-<repo>-<n> --git-dir <path> [--detach]
 *
 * `--detach` starts the waker in its own session, prints its pid and returns;
 * a waker already live for that git dir (its `kevin-idle.pid`) is left alone.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnBounded } from "./bounded_spawn_lib.ts";
import { precheckCli } from "./cli_args_lib.ts";
import { isMainModule } from "./main_module_lib.ts";
import { DEFAULT_KEVIN, getKevinConfig } from "./stark_config_lib.ts";

export const WAKE_TEXT = "kevin idle check";
const HERMOD_TIMEOUT_MS = 60_000;
const KEVIN_NAME = /^KEVIN-[A-Za-z0-9_-]+-\d+$/;

const USAGE = `usage: kevin_idle.ts --name KEVIN-<repo>-<n> --git-dir <path> [--detach]

Wakes an idle Kevin with "${WAKE_TEXT}" by hermod once his worktree's
kevin-last (or the waker's start) is kevin.idle_seconds old, from the stark
config (default ${DEFAULT_KEVIN.idle_seconds}), and prints that threshold first.
Exits once hermod lists no live Kevin of that name. --detach starts it in the
background and prints its pid.`;

export type PeerState = "live" | "gone" | "unknown";

/** Kevin's live row by name, from `hermod msg peers --all --json`; a row whose pid is not running is gone. */
export function peerState(
  stdout: string,
  name: string,
  isRunning: (pid: number) => boolean,
): { state: PeerState; id?: string } {
  let peers: unknown;
  try {
    peers = (JSON.parse(stdout) as { peers?: unknown }).peers;
  } catch {
    return { state: "unknown" };
  }
  if (!Array.isArray(peers)) return { state: "unknown" };
  for (const p of peers as Array<Record<string, unknown>>) {
    if (p?.sessionName !== name || typeof p.id !== "string" || typeof p.pid !== "number") continue;
    if (isRunning(p.pid)) return { state: "live", id: p.id };
  }
  return { state: "gone" };
}

/** Kevin's last activity in ms: `kevin-last`'s epoch seconds, else the waker's start. */
export function lastActivityMs(stamp: string | undefined, startedMs: number): number {
  const seconds = Number.parseInt(stamp?.trim() ?? "", 10);
  return Number.isFinite(seconds) && seconds > 0 ? Math.max(seconds * 1000, startedMs) : startedMs;
}

/** Due once the later of his last activity and the last wake is a whole idle period old. */
export function isDue(nowMs: number, lastMs: number, lastWakeMs: number | null, idleMs: number): boolean {
  return nowMs - Math.max(lastMs, lastWakeMs ?? 0) >= idleMs;
}

/** `kevin.idle_seconds` when it is a whole number of seconds, at least 1; else the default. */
export function idleSeconds(raw: unknown): number {
  return Number.isInteger(raw) && (raw as number) >= 1 ? (raw as number) : DEFAULT_KEVIN.idle_seconds;
}

/** A twenty-fourth of the threshold, between 5 s and 5 min: 300 s for two hours. */
export function pollMs(idleMs: number): number {
  return Math.min(300_000, Math.max(5_000, Math.round(idleMs / 24)));
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

const log = (line: string) => process.stdout.write(`${new Date().toISOString()} kevin_idle: ${line}\n`);

async function run(name: string, gitDir: string, idleMs: number): Promise<void> {
  const pidFile = path.join(gitDir, "kevin-idle.pid");
  fs.writeFileSync(pidFile, `${process.pid}\n`);
  const startedMs = Date.now();
  let lastWakeMs: number | null = null;
  log(`watching ${name}, idle after ${idleMs / 1000}s`);
  try {
    for (;;) {
      const peers = await spawnBounded("hermod", ["msg", "peers", "--all", "--json"], { timeoutMs: HERMOD_TIMEOUT_MS });
      const peer = peers.status === 0 ? peerState(peers.stdout, name, isRunning) : { state: "unknown" as const };
      if (peer.state === "gone") {
        log(`${name} has no live row; exiting`);
        return;
      }
      const lastMs = lastActivityMs(readText(path.join(gitDir, "kevin-last")), startedMs);
      if (peer.state === "live" && isDue(Date.now(), lastMs, lastWakeMs, idleMs)) {
        // A wake that may not have landed still counts: a second copy a poll
        // later is a second turn, and the next period resends anyway.
        lastWakeMs = Date.now();
        // A note, not a request: a request's delivery tells him to reply, and the wake wants none.
        const sent = await spawnBounded("hermod", ["msg", "send", "--to", peer.id!, "--kind", "note", "--json", "--", WAKE_TEXT], { timeoutMs: HERMOD_TIMEOUT_MS });
        log(`woke ${peer.id} (hermod exit ${sent.status ?? sent.signal})`);
      }
      await new Promise(r => setTimeout(r, pollMs(idleMs)));
    }
  } finally {
    if (readText(pidFile)?.trim() === String(process.pid)) fs.rmSync(pidFile, { force: true });
  }
}

function detach(argv: string[], gitDir: string): void {
  const held = Number.parseInt(readText(path.join(gitDir, "kevin-idle.pid")) ?? "", 10);
  if (Number.isInteger(held) && held > 0 && isRunning(held)) {
    process.stdout.write(`kevin_idle: already running, pid ${held}\n`);
    return;
  }
  const out = fs.openSync(path.join(gitDir, "kevin-idle.log"), "a");
  const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), ...argv.filter(a => a !== "--detach")], {
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  process.stdout.write(`kevin_idle: started, pid ${child.pid}\n`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { flags } = precheckCli(argv, { values: ["--name", "--git-dir"], switches: ["--detach"] }, USAGE);
  const name = flags.get("name");
  const gitDir = flags.get("git-dir");
  if (typeof name !== "string" || !KEVIN_NAME.test(name) || typeof gitDir !== "string") {
    process.stderr.write(`--name KEVIN-<repo>-<n> and --git-dir are required\n${USAGE}\n`);
    process.exit(2);
  }
  if (!fs.statSync(gitDir, { throwIfNoEntry: false })?.isDirectory()) {
    process.stderr.write(`--git-dir ${gitDir} is not a directory\n`);
    process.exit(2);
  }
  const idle = idleSeconds(getKevinConfig().idle_seconds);
  process.stdout.write(`kevin_idle: idle after ${idle}s (kevin.idle_seconds)\n`);
  if (flags.has("detach")) return detach(argv, gitDir);
  await run(name, gitDir, idle * 1000);
}

if (isMainModule(import.meta.url)) await main();
