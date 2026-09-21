#!/usr/bin/env node
/**
 * asset_links.ts — provision and heal the `~/.claude` symlinks that point this
 * machine's Claude Code config at this checkout.
 *
 * All logic (the table, classification, the atomic repoint, rendering) lives in
 * `asset_links_lib.ts`; this file is argv and I/O only.
 *
 *   asset_links --check     report; exit 1 if anything is wrong (usable as a gate)
 *   asset_links --install   create what is missing, heal what points elsewhere
 *
 * `--check` is the half worth automating: it is the only thing on a machine that
 * notices a link has rotted BEFORE a skill fails at runtime looking for a tool.
 *
 * A mode is REQUIRED. A bare invocation that silently did nothing, or silently
 * wrote to `~/.claude`, are both worse than a usage error.
 */

import { precheckCli, type CliShape } from "./cli_args_lib.ts";
import { isMainModule } from "./main_module_lib.ts";
import { checkLinks, installLinks, renderReport, reportToJson } from "./asset_links_lib.ts";

const USAGE = `Provision and heal the ~/.claude asset links into this checkout.

Usage: asset_links (--check | --install) [--json]

Options:
  --check     Report the state of every managed link; exit 1 if anything is wrong
  --install   Create missing links and atomically repoint wrong ones, then re-check
  --json      Emit the report as JSON instead of text
  --help      Show this help

Never replaces a path that holds a real file or directory, and never deletes a
link whose target is missing from the repo — both are reported instead.
`;

const SHAPE: CliShape = { switches: ["--check", "--install", "--json"] };

function main(argv: string[]): number {
  const parsed = precheckCli(argv, SHAPE, USAGE);
  const check = parsed.flags.get("check") === true;
  const install = parsed.flags.get("install") === true;
  const json = parsed.flags.get("json") === true;

  if (check && install) {
    process.stderr.write(`--check and --install are mutually exclusive\n${USAGE}`);
    return 2;
  }
  if (!check && !install) {
    process.stderr.write(`usage: one of --check or --install is required\n${USAGE}`);
    return 2;
  }

  const report = install ? installLinks() : checkLinks();
  process.stdout.write(
    json ? `${JSON.stringify(reportToJson(report), null, 2)}\n` : `${renderReport(report)}\n`,
  );
  return report.ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
