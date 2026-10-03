# Bifröst

Thirty skills and the TypeScript tools they call, served straight from this tree as a seven-plugin Claude Code marketplace. There is no build step: `skill/<name>/SKILL.md` is the artifact, and it ships when its PR merges.

**Status:** a public repo and a one-user personal playground. It is not production, and nothing here promises support to anyone but its author.

It exists so that one operator's way of working (how a ticket is written, a spec gated, a PR reviewed and merged, a session opened and handed over) lives in one place as skills any agent can run. Claude Code is the only install target. The skills are runtime-neutral, except /stark-memory, which tidies Claude Code's own auto-memory: Codex runs the same `skill/` + `tools/` trees (`/agnes` is `$agnes` on Codex), and Codex and Gemini are also dispatched as review agents.

It absorbed the stark-skills repo, which is archived.

## The legend of bifrost: The Burning Bridge

*The Rainbow Road Between Source and Session*

**The name.** Bifröst (Bilröst in Grímnismál) is the burning, three-coloured rainbow bridge that joins Midgard, the world of humans, to Asgard. Heimdall guards it from Himinbjörg, the gods ride over it daily to hold court at the Well of Urðr, and it is fated to shatter at Ragnarök when the sons of Muspell ride across (Gylfaginning). Its skills /gru, /minion and /agnes come from Despicable Me (2010): Gru the supervillain, his yellow Minions, and Agnes, the youngest of the girls he adopts. /kevin comes from Minions (2015): Kevin, the tall Minion who leads Stuart and Bob on the errand nobody planned.

The rainbow bridge is how the gods reach the world, and bifrost is how the operator's craft reaches every agent. One public source tree holds thirty skills and the tools they call, served straight from the tree as a seven-plugin Claude Code marketplace, with no build step. Cross the bridge and you meet a crew out of Despicable Me. `/gru` takes an epic and drives it with one Minion per ticket. `/minion` owns a single ticket through the whole spine. `/agnes`, named for the youngest girl Gru adopts and never one of his Minions, carries a ticket alone with no Gru at all. `/kevin`, a Minion with no ticket, stands in another repo and merges the PRs his leader hands him. Their board is [alfred](https://github.com/21StarkCom/alfred), their horses are [hermod](https://github.com/21StarkCom/hermod)'s tabs, their PRs pass through [idun](https://github.com/21StarkCom/idun), and [frigg](https://github.com/21StarkCom/frigg) tells them where each repo lives. Beyond them wait a spec-to-code pipeline, a jury of Claude, Codex and Gemini, and a review poster that never posts the same review twice. When code must die, `/stark-bury` carries it down to [nastrond](https://github.com/21StarkCom/nastrond). The quest stepped onto the bridge. Gru called a Minion, and Hermod saddled up.

**Supporting cast.** Every crossing passes a sentry: [.github](https://github.com/21StarkCom/.github), the org's public front door and home of this saga, hosts the one reusable gitleaks workflow that more than forty fleet repos pin by SHA, scanning only the commits a change brings.

← [yggdrasil](https://github.com/21StarkCom/yggdrasil) · [The saga](https://github.com/21StarkCom/.github/blob/main/fleet/saga.md) · [hermod](https://github.com/21StarkCom/hermod) →

---

## Quick Start

```bash
# In Claude Code: add the marketplace, then install the plugins you want
/plugin marketplace add 21StarkCom/bifrost
/plugin install stark-ops@bifrost        # + stark-plan, stark-implement, stark-analyze, ...

# Start a work session (context loading, health checks, briefing)
/stark-session start

# Write a spec you gate, then let it be built
/stark-author "my feature"
/stark-build docs/specs/2026-01-01-my-feature-spec.md

# Review the change before it merges
/code-review xhigh --fix

# End the session (tests, merge, push)
/stark-session end
```

Every skill answers `--help` (`/stark-session --help`): it prints its purpose, usage and arguments and runs nothing.

## Install

### From the marketplace

Every entry in `.claude-plugin/marketplace.json` points at `./`, so an installed plugin is this repo's own tree, with its skills restricted to that plugin's `skills:` list. A protocol-only skill needs nothing beside it. A skill that calls a tool resolves it through `${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}`, and Claude Code (measured at 2.1.284) neither sets `CLAUDE_PLUGIN_ROOT` in a skill's shell nor substitutes that fallback form. So those skills find their tools through the checkout links in [From a checkout](#from-a-checkout), and a marketplace install still needs them.

```
/plugin marketplace add 21StarkCom/bifrost
/plugin install stark-analyze@bifrost    # then stark-plan, stark-implement, stark-ops, ...
/plugin update  stark-analyze@bifrost    # re-fetch after an entry's version moves
```

An installed plugin re-fetches only when its entry's `version` changes. Installs are keyed by version under `~/.claude/plugins/cache/`, so an edited skill under an unchanged version never reaches the machine.

### From a checkout

Running a tool straight from a clone needs five links under `~/.claude/code-review` (`tools`, `scripts`, `standards`, `prompts`, `config.json`), each pointing into the checkout. The table that declares them is `MANAGED_LINKS` in `tools/asset_links_lib.ts`.

```bash
node tools/asset_links.ts --check      # report the five links
node tools/asset_links.ts --install    # create or repair them
```

The global config in [Config Hierarchy](#config-hierarchy) is one of those links. From a checkout, a tool also runs directly. For example, this publishes a `/code-review` findings payload on a PR as one anchored review:

```bash
node tools/findings_review_post.ts --repo ORG/REPO --pr 42 --findings findings.json
```

Codex reads the same skills from a clone: idavoll links them in at session start, all but the Claude-only /stark-memory.

## Skills

30 skills in seven plugins. Each skill's `SKILL.md` is its own documentation.

### stark-plan: spec and ticket authoring

| Skill | What it does |
|---|---|
| [`/stark-author`](skill/stark-author/SKILL.md) | A human-gated spec and task DAG in one session: recon, a plain-language interview, one advisory pass, your sign-off, then a draft PR. |
| [`/stark-ticket`](skill/stark-ticket/SKILL.md) | A short checklist for a ticket someone else can pick up: a twin check, alfred's headings, under 300 words, no guessed claims. Loads on its own before `alfred task start`/`task new`. |

### stark-implement: autonomous build

| Skill | What it does |
|---|---|
| [`/stark-build`](skill/stark-build/SKILL.md) | Implements an accepted spec on a draft PR it opens first: one fresh headless session per task, gated by hooks the agent cannot edit, one commit per green task, one cross-vendor advisory review and exactly one fix round. The PR is marked ready only when everything is green and no medium+ finding is left open. |

The pipeline has two stages: you gate the spec at `/stark-author`, and checks gate the code in `/stark-build`. There is no LLM-reviewing-LLM loop between them, by design: the loops that used to sit there burned tokens without converging.

### stark-analyze: reviews and plans

| Skill | What it does |
|---|---|
| [`/stark-refactor-plan`](skill/stark-refactor-plan/SKILL.md) | Inspects a repo and writes `REFACTOR_PLAN.md` + `REFACTOR_BACKLOG.json`, a phased, file-by-file plan. Planning only; never touches source. |
| [`/stark-terraform-review`](skill/stark-terraform-review/SKILL.md) | Multi-agent Terraform / OpenTofu review, cross-validated, with host scanners as evidence. |
| [`/stark-terragrunt-review`](skill/stark-terragrunt-review/SKILL.md) | Multi-agent Terragrunt review: include/dependency/generate/remote_state, mock outputs, DAG cycles, state isolation. |
| [`/stark-logging`](skill/stark-logging/SKILL.md) | Guidance for adding, changing or reviewing application logging: levels, structure, what a useful line carries. |
| [`/stark-fresh-eyes`](skill/stark-fresh-eyes/SKILL.md) | One zero-context subagent re-verifies a doc's claims by a different method and reports defects only. Never a second round. |

### stark-ops: sessions, releases and workers

| Skill | What it does |
|---|---|
| [`/stark-session`](skill/stark-session/SKILL.md) | `start`: context, git state, health checks, a briefing. `end`: tests, merge, push. |
| [`/stark-handover`](skill/stark-handover/SKILL.md) | Saves and resumes a numbered handover chain per task, so a new session needs no recap. |
| [`/stark-release`](skill/stark-release/SKILL.md) | CHANGELOG review → version bump → tag → GitHub Release. |
| [`/stark-gha-cost`](skill/stark-gha-cost/SKILL.md) | Diagnoses and cuts GitHub Actions and Advanced Security billing for an org or enterprise. |
| [`/stark-bury`](skill/stark-bury/SKILL.md) | Retires code into the nastrond graveyard: bury before delete, and every destructive step waits for the operator. |
| [`/stark-memory`](skill/stark-memory/SKILL.md) | Audits and tidies Claude Code auto-memory under its load and recall caps. Dry-run by default; `--apply` writes. |
| [`/gru`](skill/gru/SKILL.md) | Drives an epic or a list of tickets to done, one Minion per ticket, and confirms each `done` from the merged PR and the board. |
| [`/minion`](skill/minion/SKILL.md) | Owns one ticket for Gru through ticket → PR → review → merge → close, and reports through native messaging when available or Hermod fallback. |
| [`/agnes`](skill/agnes/SKILL.md) | Carries one ticket alone and unattended, with no Gru: confirms its own merge and close, then stands down. |
| [`/kevin`](skill/kevin/SKILL.md) | A Minion with no ticket: stands in one repo, takes his leader's instructions (`merge`, `review`, `rebase`, `rerun`, `status`), carries that repo's existing PRs through its own review gate to merge, and stays up until dismissed. `--new-tab` launches him through `idun kevin`. |
| [`/lucius`](skill/lucius/SKILL.md) | Opens a Lucius brainstorm in a tab of its own through `hermod lucius`, then stops. |
| [`/goldfinger`](skill/goldfinger/SKILL.md) | Teaches the `goldfinger` CLI: observe a window's accessibility tree, then click, type, press keys, scroll or set a value in the background; move or resize a window and read or write the clipboard's text; press a menu-bar command or drag under `--foreground`, which brings the app to the front for that action alone; from 0.5.0, hover a target with the mouse pointer and put it back (`hover`); run up to 10 actions in one `batch`, work in a session with its own drawn cursor (`glide` moves it alone, from 0.5.0), and record a session to replay it; and register `goldfinger mcp`, the same client as an MCP server. Chrome page work it sends to Huginn (sleipnir), with the rules for sharing a Chrome window between the two. |

/minion and /agnes run the same two shared docs, so their review gate and merge path cannot drift: [standards/worker-spine.md](standards/worker-spine.md) (bind → implement → verify live → PR → `/code-review xhigh --fix` → merge → close) and [standards/stand-down.md](standards/stand-down.md) (the tab teardown after a `done`). /kevin, who owns no ticket, runs the spine's merge rules and the stand-down on his own terms, both written in those docs.

stark-ops also ships one hook: a PostToolUse `tools/fact_routing_hook.ts` that runs when a Write or Edit touches an auto-memory file and advises the model where the fact belongs. It takes the fleet's repo names from the vault-ecosystem checkout, and says so when it finds none and falls back to its built-in list. It is the safety net behind `/stark-memory`, declared on the stark-ops entry of the manifest, and it installs and updates with that plugin.

### stark-constitution: docs, decisions and rules

| Skill | What it does |
|---|---|
| [`/stark-init-docs`](skill/stark-init-docs/SKILL.md) | Scaffolds a repo's docs layout (`docs/adr/`, `docs/specs/`, `docs/retros/`). Modes: template, backfill, upgrade, clean. |
| [`/stark-adr`](skill/stark-adr/SKILL.md) | Records and supersedes Architecture Decision Records under `docs/adr/`, through `brain adr`. |
| [`/stark-rules-optimizer`](skill/stark-rules-optimizer/SKILL.md) | Audits one repo's `.claude/rules`, CLAUDE.md and AGENTS.md against how Claude Code and Codex load them. Read-only by default; `--apply` stops at a reviewed draft PR. |
| [`/stark-persona`](skill/stark-persona/SKILL.md) | Assigns the session a character voice by weighted random selection. |

### stark-write: long-form writing

| Skill | What it does |
|---|---|
| [`/stark-voice`](skill/stark-voice/SKILL.md) | Drafts a Slack message, reply or short note in the operator's voice. |
| [`/stark-story-edit`](skill/stark-story-edit/SKILL.md) | A full storytelling pass on a long-form post, every fact frozen. |
| [`/stark-blog-sharpen`](skill/stark-blog-sharpen/SKILL.md) | An adversarial cut pass: removes padding and the tells of machine prose. |
| [`/stark-story-judge`](skill/stark-story-judge/SKILL.md) | Cold judges, one per vendor, grade a post on an anchored rubric. Judges only; never edits. |
| [`/stark-jury`](skill/stark-jury/SKILL.md) | Runs one of the four post skills across Claude, Codex and Gemini and reconciles the results. |

### stark-design: design systems

| Skill | What it does |
|---|---|
| [`/stark-design-tokens`](skill/stark-design-tokens/SKILL.md) | Builds, names, themes and governs design tokens: the three-tier model, OKLCH scales, DTCG, Style Dictionary, contrast gates. |

## Architecture

A skill is either protocol-only or a front end to a tool. Most are protocol-only: the SKILL.md carries the whole procedure, and the worker family (/gru, /minion, /agnes, /kevin) and /lucius drive fleet CLIs such as alfred, hermod and idun from it. Some call a single-purpose tool in `tools/` (`memory_tidy.ts`, `rules_audit.ts`, `stark_session.ts`, …). The multi-agent skills call a TypeScript dispatcher, which resolves the enabled agents from config, spawns each as a headless subprocess with a credential-scrubbed env, parses the structured output, and merges the results:

```
/stark-terraform-review ─┐
/stark-terragrunt-review ─┴─→ iac_review.ts       ─→ codex, gemini (parallel, read-only)
/stark-refactor-plan ────────→ refactor_planner.ts ─→ focused subagents
/stark-jury ─────────────────→ jury.ts             ─→ claude, codex, gemini panel
```

`/code-review` findings reach GitHub through `tools/findings_review_post.ts`: one anchored `COMMENT` review, inline where the anchor falls inside a diff hunk and in the body otherwise. A rejected anchor is demoted, never dropped, and a review already on the PR is never posted twice. `iac_review.ts --pr` is the exception: it posts its own report as one body-only `COMMENT` review, with no anchors and no duplicate check, so a rerun posts again.

Everything posts through the operator's existing `gh` login as `aryeh-stark`. Each review names its models in the text.

Immutable assets (tools, prompts, config) resolve through `tools/asset_root_lib.ts` from `STARK_ASSET_ROOT`, else `CLAUDE_PLUGIN_ROOT` when it is set (a plugin hook), else `~/.claude/code-review`. Mutable state (`history/`, `sessions/`, `locks/`, …) lives under `~/.claude/code-review/` (`stateRoot()`), never in the plugin cache, so it survives a plugin update.

## Repo Structure

```
bifrost/
├── skill/                        ← one dir per skill (30 × SKILL.md)
├── tools/                        ← TypeScript dispatchers, agent CLIs, meta-tooling, tests
├── global/                       ← config.json, config-reference.md, prompts/{iac-review,refactor-planner}/
├── standards/                    ← shared worker protocols, doc templates, workflow guidance
├── scripts/                      ← healer_patterns.json
├── data/persona/                 ← the persona roster
├── docs/operations/              ← branch-protection.md (what `main` gates on) and
│                                   source-entrypoint-help-audit.md (the entrypoint inventory
│                                   tools/source_help.test.ts checks)
├── docs/specs/                   ← this repo's own specs (each with its plan) and their .human.md briefs
├── .claude-plugin/               ← marketplace.json: seven entries, source ./ + disjoint skills: lists
└── .github/workflows/            ← ci.yml (test, typecheck, secret scan (tree), actionlint) + secret-scan.yml
```

The seven `skills:` lists partition `skill/` by path, and a `skills:` list **restricts** discovery rather than adding to it. That holds only because there is no `skills/` directory for Claude Code to auto-discover, so `skill/` keeps its name.

## Config Hierarchy

Most specific wins:

```
~/.claude/code-review/config.json            ← global: this repo's global/config.json, through the checkout link
~/Code/.code-review/config.json              ← org override
~/Code/some-repo/.code-review/config.json    ← repo override
```

Repos can override the enabled agents and nothing else: the walk above lives only in `discoverConfig`, which preflight reads for `agents`. Every other section (`iac_review`, `runtime`, `models`, …) is read from the global config alone, so a per-repo override of one is ignored. Dispatcher rubrics live under `global/prompts/<dispatcher>/` and are shared by every agent that runs them.

## Prerequisites

- macOS
- Node.js ≥ 24 (the tools run under plain `node`)
- GitHub CLI authenticated as `aryeh-stark`
- `claude`, plus `codex` and `gemini` for the multi-agent reviews and /stark-jury, and `codex` for /stark-build's advisory review and /stark-story-judge's second judge
- `jq` for /stark-build's path-protection hook and /stark-author's ticket stamp
- `python3` for /stark-gha-cost, and for /stark-refactor-plan's JSON check (which falls back to `jq` or `node`)
- The fleet CLIs, each for the skills that call it:
  - `alfred`: /stark-ticket, /stark-author, /stark-build, /stark-bury, /stark-rules-optimizer, /gru, /minion, /agnes
  - `hermod`: /gru, /minion, /agnes, /kevin, /lucius
  - `idun` v0.94.0 or later, v0.103.0 for /agnes, and one that carries `idun kevin` for /kevin (`idun gru`, `idun minion`, `idun agnes`, `idun kevin` for the worker launches; `idun gh pr-open`, `pr-merge`): /gru, /minion, /agnes, /kevin, /stark-bury, /stark-rules-optimizer
  - `frigg`: /gru, /minion, /agnes, to find a ticket's repo
  - atlas's `brain`: /stark-adr
  - `goldfinger`: /goldfinger (the `21StarkCom/tap/goldfinger` cask, plus one `goldfinger setup` by the operator)
  - `lucius`: /lucius

## Fleet Fit

bifrost is the skills layer of the 21StarkCom fleet. The rest of the fleet, by name and role:

- **alfred**: the ticket board every worker binds to.
- **hermod**: places the agents' tabs, carries their messages and tears them down.
- **idun**: launches the Gru, Minion and Agnes workers, and `idun gh` opens and merges PRs.
- **frigg**: the repo registry.
- **brain** (in atlas): the second-brain engine /stark-adr writes through.
- **goldfinger**: the desktop-automation CLI /goldfinger teaches.
- **lucius**: the brainstorming app /lucius launches.
- **nastrond**: the graveyard /stark-bury writes to.
- **idavoll**: owns machine setup (settings, machine hooks, launchers) and links these skills into Codex.
- **.github**: `.github/workflows/secret-scan.yml` is a render from the fleet's 21stark repo, calling the reusable gitleaks workflow in `.github`.

## Development

Run the gate from the repo root before a PR:

```bash
(cd tools && npm test && npm run typecheck)
claude plugin validate --strict .
git diff --check "$(git merge-base origin/main HEAD)"
```

`main` requires four check contexts from `ci.yml`: `test`, `typecheck`, `secret scan (tree)` and `actionlint`. Read [docs/operations/branch-protection.md](docs/operations/branch-protection.md) before touching CI.

Editing a skill means bumping the `version` of every plugin whose `skills:` list claims it, in the same PR, since that is the only thing that makes an installed plugin re-fetch. [CLAUDE.md](CLAUDE.md) has the detail, including the hook rule and the plugin-resolution seam.

## Manuals

- [`CLAUDE.md`](CLAUDE.md): the detailed reference for Claude Code and agentic contributors. It wins on conflict.
- [`AGENTS.md`](AGENTS.md): the concise entry point for Codex and Cursor; defers to `CLAUDE.md`.
- Each skill documents itself: `skill/<name>/SKILL.md` is the source of truth, and every skill answers `--help`. There is no generated documentation layer.
