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
import {
  checkLinks,
  defaultRepoRoot,
  installLinks,
  linkedWorktreeMainCheckout,
  renderReport,
  reportToJson,
} from "./asset_links_lib.ts";

const USAGE = `Provision and heal the ~/.claude asset links into this checkout.

Usage: asset_links (--check | --install) [--json]

Options:
  --check     Report the state of every managed link; exit 1 if anything is wrong
  --install   Create missing links and atomically repoint wrong ones, then re-check
  --json      Emit the report as JSON instead of text
  --help      Show this help

Never replaces a path that holds a real file or directory, and never deletes a
link whose target is missing from the repo — both are reported instead. These
links are global, so --install refuses to run from a linked git worktree.
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

  // These links are GLOBAL — `~/.claude` holds exactly one of each — and the
  // repo root is wherever this file was loaded from. Installing from a linked
  // worktree therefore repoints the whole machine at a tree that exists to be
  // deleted; `git worktree remove` then leaves all nine dangling with nothing
  // on the machine that knows where they should have pointed.
  const worktreeMain = linkedWorktreeMainCheckout(defaultRepoRoot());
  if (worktreeMain !== null) {
    if (install) {
      process.stderr.write(
        `refusing to --install from a linked git worktree (${defaultRepoRoot()}).\n` +
          `~/.claude has one copy of each of these links, so this would point the whole ` +
          `machine at a tree meant to be thrown away. Run it from the main checkout: ${worktreeMain}\n`,
      );
      return 2;
    }
    process.stderr.write(
      `note: reporting against a linked git worktree (${defaultRepoRoot()}); ` +
        `the machine's links are expected to point at ${worktreeMain}\n`,
    );
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
