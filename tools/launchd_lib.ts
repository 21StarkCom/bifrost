/**
 * launchd_lib — the weekly launchd job that a tool loads with
 * `--install-schedule` and removes with `--uninstall-schedule`: the plist, the
 * PATH the job runs with, and the `launchctl` calls. `ask_guard_metric.ts` and
 * `rules_audit.ts` use it.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface WeeklyPlist {
  label: string;
  /** The tool the job runs with `node`. */
  tool: string;
  args: readonly string[];
  /** launchd's `Weekday`: 1 is Monday, 4 is Thursday. */
  weekday: number;
  hour: number;
  /** The file that takes the job's stdout and stderr. */
  log: string;
  envPath: string;
}

export interface WeeklyJob extends Omit<WeeklyPlist, "tool" | "envPath"> {
  /** The tool's file name under `~/.claude/code-review/tools`. */
  toolName: string;
  /** The tool's own path, for a machine without that link. */
  fallback: string;
  /** Commands whose folders the job's PATH puts first. */
  bins: readonly string[];
  /** When the job runs, for the install's output: "Mondays 09:00 local". */
  when: string;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The plist of a job that runs `node <tool> <args…>` each week at `hour`:00 local. */
export function weeklyPlist(p: WeeklyPlist): string {
  const args = ["/usr/bin/env", "node", p.tool, ...p.args].map((a) => `    <string>${xml(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(p.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(p.envPath)}</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>${p.weekday}</integer><key>Hour</key><integer>${p.hour}</integer><key>Minute</key><integer>0</integer></dict>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(p.log)}</string>
  <key>StandardErrorPath</key><string>${xml(p.log)}</string>
</dict>
</plist>
`;
}

export function plistPath(label: string): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

/** The tool path the job runs: the `~/.claude/code-review/tools` link into the
 * checkout when it is there, since a plugin cache path changes with each version. */
function stableToolPath(name: string, fallback: string): string {
  const linked = path.join(os.homedir(), ".claude", "code-review", "tools", name);
  return fs.existsSync(linked) ? linked : fallback;
}

/** The first `PATH` folder that holds an executable `bin`, as the installer's shell sees it. */
function binDir(bin: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue;
    try {
      fs.accessSync(path.join(dir, bin), fs.constants.X_OK);
      return dir;
    } catch {
      /* next */
    }
  }
  return undefined;
}

function launchctl(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("launchctl", args, { encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

function domain(): string {
  return `gui/${process.getuid?.() ?? os.userInfo().uid}`;
}

/** Write the job's plist and load it, in place of a job of the same label. */
export function installWeeklyJob(job: WeeklyJob): number {
  if (process.platform !== "darwin") {
    process.stderr.write("--install-schedule needs macOS launchd\n");
    return 1;
  }
  fs.mkdirSync(path.dirname(job.log), { recursive: true });
  const file = plistPath(job.label);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // launchd starts with a bare PATH: keep the folders that hold this install's
  // commands (a version manager's shims, say), then the system ones.
  const found = job.bins.map((bin) => binDir(bin)).filter((d): d is string => d !== undefined);
  const envPath = [...new Set([...found, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])].join(":");
  fs.writeFileSync(file, weeklyPlist({ ...job, tool: stableToolPath(job.toolName, job.fallback), envPath }));
  launchctl(["bootout", `${domain()}/${job.label}`]);
  const boot = launchctl(["bootstrap", domain(), file]);
  if (!boot.ok) {
    process.stderr.write(`launchctl bootstrap ${domain()} ${file} failed: ${boot.out}\n`);
    return 1;
  }
  process.stdout.write(`installed ${file}\nloaded ${domain()}/${job.label}: ${job.when}, output to ${job.log}\n`);
  return 0;
}

/** Unload the job and remove its plist. */
export function uninstallJob(label: string): number {
  const out = launchctl(["bootout", `${domain()}/${label}`]);
  fs.rmSync(plistPath(label), { force: true });
  process.stdout.write(`${out.ok ? "unloaded" : "not loaded:"} ${domain()}/${label}\nremoved ${plistPath(label)}\n`);
  return 0;
}
