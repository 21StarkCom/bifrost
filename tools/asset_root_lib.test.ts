// `tools/asset_root_lib.ts` — the asset-vs-state seam eight tools import
// (`agent_dispatch_lib`, `stark_config_lib`, `skill_router_lib`,
// `context_compactor_lib`, `refactor_planner_lib`, `iac_review_lib`,
// `jury_store`, `self_healer`).
//
// It had no test file of its own. The only assertions in the repo about this
// seam's precedence lived in `tools/codex_state_overlays.test.ts`, against the
// OVERLAY's copy of it (`stateRoot(env)` / `stateRootForHome(home, env)` —
// different signatures, different module), and that file went with
// `runtime-overrides/codex/`. So the canonical module was left with zero
// coverage of the one thing it exists to decide.
//
// What is pinned here is the PRECEDENCE, not the paths: which env var wins, and
// the one asymmetry that is load-bearing — `stateRoot()` must NOT consult
// `CLAUDE_PLUGIN_ROOT`, because a plugin cache is replaced wholesale on update
// and state kept there is lost. A refactor that "tidies" the two resolvers into
// one shared helper breaks exactly that, silently, and every session's history,
// locks and ledgers move into a directory the next `/plugin update` deletes.
//
// node built-ins only, like the rest of the suite: ci.yml's `test` job runs no
// `npm ci`, so an import outside `node:` turns the required check red.
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assetConfigPath,
  assetPromptsDir,
  assetRoot,
  assetRootForHome,
  assetToolsDir,
  stateRoot,
} from "./asset_root_lib.ts";

const KEYS = ["STARK_ASSET_ROOT", "CLAUDE_PLUGIN_ROOT", "STARK_STATE_ROOT"] as const;

/**
 * Run `body` with exactly `env` set for those three keys and nothing else,
 * restoring whatever the process had. The module reads `process.env` at CALL
 * time (not at import), which is what makes this possible at all — and is
 * itself worth pinning: a resolver that cached at import would answer the
 * shell's environment for the life of a long-running tool.
 */
function withEnv(env: Partial<Record<(typeof KEYS)[number], string>>, body: () => void): void {
  const saved = new Map(KEYS.map((k) => [k, process.env[k]] as const));
  try {
    for (const k of KEYS) {
      const v = env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    body();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const HOME_TREE = path.join(os.homedir(), ".claude", "code-review");

test("assetRoot precedence: STARK_ASSET_ROOT > CLAUDE_PLUGIN_ROOT > ~/.claude/code-review", () => {
  withEnv({ STARK_ASSET_ROOT: "/tmp/asset", CLAUDE_PLUGIN_ROOT: "/tmp/plugin" }, () => {
    assert.equal(assetRoot(), "/tmp/asset");
  });
  withEnv({ CLAUDE_PLUGIN_ROOT: "/tmp/plugin" }, () => {
    assert.equal(assetRoot(), "/tmp/plugin");
  });
  withEnv({}, () => {
    assert.equal(assetRoot(), HOME_TREE);
  });
});

test("a blank or whitespace-only override is ignored, never taken as a root", () => {
  // `nonEmpty()` exists for this: an exported-but-empty `CLAUDE_PLUGIN_ROOT`
  // (a shell that always exports the var) would otherwise resolve every asset
  // path to `/tools`, `/config.json` — absolute paths at the filesystem root.
  withEnv({ STARK_ASSET_ROOT: "", CLAUDE_PLUGIN_ROOT: "   " }, () => {
    assert.equal(assetRoot(), HOME_TREE);
  });
  withEnv({ STARK_STATE_ROOT: "  " }, () => {
    assert.equal(stateRoot(), HOME_TREE);
  });
});

test("stateRoot never follows CLAUDE_PLUGIN_ROOT — state must outlive plugin-cache churn", () => {
  withEnv({ CLAUDE_PLUGIN_ROOT: "/tmp/plugin", STARK_ASSET_ROOT: "/tmp/asset" }, () => {
    assert.equal(stateRoot(), HOME_TREE, "state followed the plugin cache, which /plugin update deletes");
    assert.equal(assetRoot(), "/tmp/asset", "the premise failed — assets were not overridden");
  });
  withEnv({ STARK_STATE_ROOT: "/tmp/state", CLAUDE_PLUGIN_ROOT: "/tmp/plugin" }, () => {
    assert.equal(stateRoot(), "/tmp/state");
  });
});

test("assetRootForHome falls back to the passed home, not os.homedir()", () => {
  withEnv({}, () => {
    assert.equal(assetRootForHome("/tmp/fixture-home"), path.join("/tmp/fixture-home", ".claude", "code-review"));
  });
  // The overrides still win — a test that injects `home` must not thereby
  // escape an explicit STARK_ASSET_ROOT.
  withEnv({ CLAUDE_PLUGIN_ROOT: "/tmp/plugin" }, () => {
    assert.equal(assetRootForHome("/tmp/fixture-home"), "/tmp/plugin");
  });
});

test("config/prompts resolve FLAT or under global/, and name a concrete path when neither exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asset-root-layout-"));
  try {
    // Neither layout on disk: the last-resort return is the flat path, so a
    // caller's error message can name something instead of throwing here.
    withEnv({ STARK_ASSET_ROOT: root }, () => {
      assert.equal(assetConfigPath(), path.join(root, "config.json"));
      assert.equal(assetPromptsDir(), path.join(root, "prompts"));
      assert.equal(assetToolsDir(), path.join(root, "tools"));
    });

    // SOURCE layout — a raw checkout, and (since every marketplace entry is
    // `"source": "./"`) an installed plugin cache too.
    fs.mkdirSync(path.join(root, "global", "prompts"), { recursive: true });
    fs.writeFileSync(path.join(root, "global", "config.json"), "{}");
    withEnv({ STARK_ASSET_ROOT: root }, () => {
      assert.equal(assetConfigPath(), path.join(root, "global", "config.json"));
      assert.equal(assetPromptsDir(), path.join(root, "global", "prompts"));
    });

    // FLAT layout — the `~/.claude/code-review` symlink farm, where `global/`
    // is already collapsed. It wins when both are present.
    fs.mkdirSync(path.join(root, "prompts"), { recursive: true });
    fs.writeFileSync(path.join(root, "config.json"), "{}");
    withEnv({ STARK_ASSET_ROOT: root }, () => {
      assert.equal(assetConfigPath(), path.join(root, "config.json"));
      assert.equal(assetPromptsDir(), path.join(root, "prompts"));
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
