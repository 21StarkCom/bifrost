#!/usr/bin/env -S node --experimental-strip-types
/**
 * fact-routing PostToolUse hook.
 *
 * Shipped by the stark-ops plugin: its marketplace.json entry declares this hook
 * inline on PostToolUse through ${CLAUDE_PLUGIN_ROOT}, with `if` gates that start
 * it only for a Write or Edit of a `projects/*\/memory/*.md` file, so installing
 * stark-ops wires it and no settings.json entry is needed.
 *
 * Reads the PostToolUse payload on stdin. When the written file is a
 * `<config dir>/projects/<project>/memory/<name>.md` auto-memory (config dir:
 * $CLAUDE_CONFIG_DIR, else ~/.claude) that reads like a fleet fact for the
 * vault-ecosystem corpus, it hands the model a one-line advisory as PostToolUse
 * `additionalContext` on stdout; plain stdout or stderr from a PostToolUse hook
 * never reaches the model. The writing session holds the fact's context, so the
 * advisory asks it to route the fact now or keep it; the hook writes nothing and
 * keeps no record of the flag. It never names an agent file as a target. It is
 * ADVISORY: it never blocks the tool and always exits 0, and it prints nothing
 * when no fact matches.
 *
 * Fleet slugs come from the vault-ecosystem checkout ($ATLAS_ECOSYSTEM_PATH,
 * else ~/Code/Vaults/vault-ecosystem). When that yields none, the hook matches
 * the built-in FALLBACK_SLUGS, and a flag it raises says so.
 */
import fs from "node:fs";
import path from "node:path";
import {
  classifyMemory,
  defaultCorpusPath,
  isAutoMemoryPath,
  resolveFleetSlugs,
  FALLBACK_SLUGS,
} from "./fact_routing_hook_lib.ts";

function readStdin(): string {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main(): void {
  const raw = readStdin();
  if (!raw.trim()) return;

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  const tool = data?.tool_name;
  const fp = data?.tool_input?.file_path;
  if (typeof fp !== "string") return;
  if (!["Write", "Edit", "MultiEdit"].includes(tool)) return;
  if (!isAutoMemoryPath(fp)) return;

  let content: string;
  try {
    content = fs.readFileSync(fp, "utf8");
  } catch {
    return; // file gone / unreadable — nothing to classify
  }

  const corpusPath = defaultCorpusPath();
  const corpusSlugs = resolveFleetSlugs(corpusPath);
  const fellBack = corpusSlugs.length === 0;
  const flag = classifyMemory(content, fp, fellBack ? FALLBACK_SLUGS : corpusSlugs);
  if (!flag) return; // no fact matched: say nothing
  const advisories = [
    `↳ fact-routing: ${path.basename(fp)} looks like it belongs in the vault-ecosystem corpus (${flag.reason}). ` +
      `Move it there now only if it says how fleet repos relate or when to reach one; else keep it here. ` +
      `Nothing records this flag for later.`,
  ];
  // A flag raised on the built-in list says so: a reader that no longer
  // understands the corpus layout must not hide behind that list.
  if (fellBack) {
    advisories.push(
      `↳ fact-routing: no fleet entity found under ${corpusPath} (repos/<slug>/index.md, systems/<slug>/index.md), ` +
        `so this ran on the built-in list of ${FALLBACK_SLUGS.length} slugs: the checkout is missing, or laid out in a way this hook cannot read.`,
    );
  }
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: advisories.join("\n") } }) + "\n",
  );
}

// Argv is not part of the PostToolUse protocol, so anything here is either a
// help request or a mistake. A refusal goes to stderr: this hook's stdout is
// read by Claude Code, so a usage line printed there is protocol noise.
if (process.argv.length > 2) {
  const asked = ["help", "--help", "-h"].includes(process.argv[2]);
  const usage = "usage: fact_routing_hook.ts (no arguments; PostToolUse JSON on stdin)\n";
  if (asked) process.stdout.write(usage);
  else process.stderr.write(`unsupported argument: ${process.argv[2]}\n${usage}`);
  process.exit(asked ? 0 : 2);
}
try {
  main();
} catch {
  /* advisory hook — never block a tool write */
}
process.exit(0);
