# Source entrypoint help audit — STARK-8286

First measured against `dbb27c1c6967` (then `origin/main`) on 2026-09-21. The
inventory below has since been **re-derived against the tree that carries the
`runtime-overrides/codex/` deletion and the cmux hook's move out**, so it
describes that tree and no earlier one — the baseline commit is the audit's
origin, not the state it now records. It covers the source tree after the
marketplace engine's retirement, and does not inherit the deleted engine's
STARK-8083 audit.

`runtime-overrides/codex/` is **deleted** — 56 tracked files of source that
nothing rendered — so the tree audited here holds no Codex-specific entrypoint
at all. Its rows are gone from the inventory below; what that does and does not
cost this audit is recorded under the shell table rather than left as an
unexplained shortfall. The lists are not trusted on this prose alone:
`tools/source_help.test.ts` re-derives both inventories from the live tree on
every CI run, so a row that stops matching reddens the required `test` context.

## Contract and defects

Operational help must return before config/credential reads, network requests,
subprocesses or state writes. A precise nonzero usage refusal is acceptable for
unsupported positional forms. A free-standing `help`, `--help` or `-h` is
syntax; a declared option's value is data. `--title help`, `--value help`, file
contents, stdin JSON and child argv are not searched for help words.

Two defects were present in the source:

- Permissive parsers ignored positionals and unknown options. For example,
  `context_compactor.ts help` generated a checkpoint, `fact_routing_fold.ts
  --clear help` could clear the queue, and `stark_persona.ts deactivate help`
  reached the deactivation handler. The release helpers ignored stray tokens;
  the GHA drill treated `help` as a repository and ignored surplus arguments.
- Value consumers could swallow later flags, including safety flags. For
  example, a missing `iac_review.ts --agents` value consumed `--dry-run`.
  Conversely, the whole-argv help check in `findings_review_post.ts` swallowed
  the literal filename in `--findings help`. The `copilot_land.ts land help`
  handoff observation was a **safe refusal**, because its strict parser already
  rejected that positional; its whole-argv flag-help check still needed to
  distinguish option values.

`tools/cli_args_lib.ts` replaces duplicated permissive parsers, validates
declared boolean/value arity and rejects unknown/extra arguments. Strict
existing parsers retain their dispatch and validation seams. `cliValue` refuses
a following flag as a missing value; `hasCliHelp` skips declared values and
stops at `--`. The permissive parsers retain `--value=TEXT` for explicit
leading-dash literals, and `copilot_land.ts` gained the same form: refusing a
leading-dash value in the space form is only safe where `--key=VALUE` still
expresses one, and its `--title`/`--body` carry free text that may legitimately
begin with a dash. Other parsers retain their existing syntax; unsupported
equals forms are refused rather than silently ignored. No CLI gains a child
command interface. The shared tokenizer preserves a `--` tail for callers that
declare positionals; current operational callers reject unsupported tails.

The entrypoints using `precheckCli` answer malformed arguments with their own
usage on stderr and exit 2. `refactor_planner.ts` preserves its returned-error
contract, and `stark_handover.ts` preserves its JSON error on stdout and exit 2.
Other tools retain their existing nonzero refusal codes; the safety contract
requires a precise refusal and no backend effects, not a uniform exit code.
Where a pre-pass sits in front of an existing parser, its declared shape must
stay in step with that parser: a flag added to one and not the other is refused
as unknown before the real parser ever sees it.

## Executable inventory

Every row below is source-owned. `tools/source_help.test.ts` is the executable
route inventory and runs under the existing `tools/*.test.ts` CI gate. It also
checks the source tree for added entrypoints absent from its inventory — the
TypeScript CLIs under `tools/`, and every non-test `.sh` anywhere in the tree,
so neither hand-written list can silently go stale. A third list, for the
executable Codex overrides, went with the tree it indexed.
For each listed route the sweep runs bare help, both flag aliases, flags before
and after help, and malformed options. Recognizable usage or a precise refusal
**and zero recorded backend effects** are required. Exit zero or nonempty
output alone is insufficient: for the shell rows the exit STATUS is asserted
too, because a guard whose `case` subject is wrong still prints "unsupported
argument: …" — wording alone cannot tell a working help from a broken one.

| Source under `tools/` | Routes / selectors |
| --- | --- |
| `alert_delivery.ts` | default/check, JSON |
| `approach_contract.ts` | plan-file, force-confirm, JSON |
| `context_compactor.ts` | default, session-id, JSON |
| `copilot_land.ts` | branch-name, prepare-branch, land |
| `fact_routing_fold.ts` | default, clear |
| `fact_routing_hook.ts` | PostToolUse stdin protocol; argv help exits first |
| `failure_classifier.ts` | stderr-file, JSON |
| `findings_review_post.ts` | findings-file/stdin, dry-run, generated-path options |
| `gcp_scope.ts` | init, install, check, list |
| `github_projects.ts` | find-project, add-issue, get-field-ids, get-items, get-item-fields, set-field, set-fields, find-item, get-issue-node-id, transition-status, is-legal-transition, check-spec-completeness, load-config |
| `healer_canary.ts` | status, check, promote, demote, explain, close-circuit |
| `iac_review.ts` | terraform and terragrunt |
| `jury.ts` | run, list, show |
| `memory_tidy.ts` | default, project/all, dry-run/apply; bare positional help is a safe refusal |
| `optimize_skill_description.ts` | skill-path/eval-set optimizer |
| `preflight.ts` | workflow, skip-check, JSON |
| `refactor_planner.ts` | dry-run, run, validate |
| `release_changelog.ts` | default, repo, JSON |
| `release_version_bump.ts` | version, repo, dry-run, JSON |
| `self_healer.ts` | suggest/auto, pattern-id, stderr-file |
| `session_id.ts` | default resolution |
| `session_state.ts` | default/show, set |
| `skill_audit.ts` | default, validate, JSON |
| `skill_autopilot.ts` | optimizer/snapshot, reuse-proposal |
| `skill_diet.ts` | default, check, JSON |
| `skill_optimize.ts` | plan/api, apply, diff, reuse-proposal |
| `skill_router.ts` | review/implementation/session context |
| `stark_config_lib.ts` | model lookup; also an importable library |
| `stark_handover.ts` | resolve, save, resume, list |
| `stark_persona.ts` | select, deactivate, rate, survey, survey-answer, add, stats, history, print-roster, print-weights, session-end |
| `stark_session.ts` | start, end |
| `statusline_setup.ts` | list, enable, disable, install, reset |
| `validation_gate.ts` | configured validation, repo-root, timeout |

| Shell / other executable | Boundary |
| --- | --- |
| `config/statusline-command.sh` | no argv; JSON stdin; help before rendering/writes |
| `config/statusline-prompt-hook.sh`, `config/statusline-stop-hook.sh` | no argv; JSON stdin; help before timestamps |
| `tools/check-rest-only.sh` | no argv; help before directory change/scanner |
| `skill/stark-gha-cost/scripts/gha-cost-breakdown.sh` | enterprise/org options; help before token check or gh; missing values refused |
| `skill/stark-gha-cost/scripts/gha-repo-actions-drill.sh` | owner/repo, optional date; surplus args/unsupported flags refused before date/credentials/gh |
| `skill/stark-build/references/hooks/protect-paths.sh` | leading help; exact positional arity, then list/task data and stdin protocol |
| `skill/stark-build/references/hooks/stop-gate.sh` | leading help; bounded positional arity before running the check; later task/path words are literal data |

Those seven rows cover all eight non-test `.sh` files in the tree, which is the
whole executable non-TypeScript surface — the shape `source_help.test.ts`
asserts by walking for `.sh` and comparing against its list.

The cmux auto-rename `SessionStart` hook (`config/cmux-autoname.sh`) had a row
here and is no longer in this tree: it **moved** to the stark-workspace repo,
which owns machine setup. Its help guard went with it and is that repo's to
keep covered; this audit no longer probes it. Nothing here invokes the script —
`config/settings.json` names only its installed path, which is data.

The Codex counterparts those rows used to carry are gone with
`runtime-overrides/codex/`, along with the four executable tool replacements it
held (`copilot_land.ts`, `iac_review.ts`, `jury.ts`, `self_healer.ts`) and the
disposable canonical-plus-overlay composition they were probed in. Each of those
was a variant of a canonical entrypoint that still has its own row above, so the
audited surface loses duplicates rather than coverage. The one overlay row with
no canonical twin was
`runtime-overrides/codex/skill/stark-gha-cost/scripts/gha-cost-json.ts`, which
existed **only** under the overlay: it is gone with the tree, not moved
anywhere. It takes no capability with it. Measured at the baseline commit, that
helper's only callers were the overlay's own `gha-cost-breakdown.sh` and
`gha-repo-actions-drill.sh`; the canonical `skill/stark-gha-cost/scripts/` pair
never named it, and both parse in process — the breakdown through an inline
`python3` heredoc, the drill through `gh --jq` — so neither reaches for an
in-repo helper of any kind.

Hook positional filenames named `help` must use an explicit path such as
`./help`; later path/task arguments are data, not subcommands. For no-argument
hooks, unsupported argv exits with a refusal rather than processing stdin.
Their normal zero-argument protocol and stdin fields are unchanged.

### Explicit exclusions

- Imported libraries (including `agent_claude.ts`, `agent_codex.ts`,
  `agent_gemini.ts`, jury dispatch/store/panel/verify and refactor components)
  expose no argv route. Their caller CLIs are covered. `main_module_lib.ts`
  reads argv only to identify the executable, not to dispatch work.
- `*.test.ts`, `*.test.sh` and test fixtures are test programs/data, not
  operator routes. They are exercised by the suite, not treated as help CLIs.
- `scripts/healer_patterns.json`, config JSON, prompts, skill Markdown,
  reference documents, workflows and package scripts are data/declarations.
  The inline hooks in `config/settings.json` receive event context, not a
  user-facing positional grammar. They were inspected, not executed as probes.
- Stdin JSON, free-text fields, protected-list contents and check-script
  contents are protocol/data boundaries. Searching them for help would corrupt
  their contract. No LLM skill or real agent was invoked to test help.
- The retired engine, catalog, vendor and distribution tree are absent and
  excluded by ownership, not counted as a passing audit. No live install,
  credential mutation, release, notification, cloud mutation or teardown is
  an audit probe.

## Reproduction and evidence

Run from the repository root so local PATH selects the installed modern Bash
(the statusline suite uses Bash features absent from macOS `/bin/bash`):

```sh
node --test tools/source_help.test.ts
HELP_AUDIT_OS=1 node --test tools/source_help.test.ts
npm --prefix tools test
npm --prefix tools run typecheck
actionlint
gitleaks dir . --config .gitleaks.toml --redact --exit-code 1
claude plugin validate --strict .
```

The first command is portable and requires only Node builtins. Every child has
a disposable HOME/config/state/cwd, an allowlisted environment without ambient
credentials, fake CLIs and calibrated tripwires. Calibration intentionally
attempts a subprocess, network call, file write and HOME read; each must record
its boundary and exit 91. A missing tripwire is a failed test. These are
instrumentation claims, not OS confinement claims.

The second command additionally uses macOS `sandbox-exec` to deny network,
filesystem writes (except the tripwire log), and executable launches other than
the initial interpreter. A separate calibration without JS instrumentation
requires `EPERM`/`EACCES` for a write, `/usr/bin/true` child and loopback socket.
It must run where creating a child sandbox is permitted. The default CI test
explicitly skips that macOS-only calibration; it never silently claims it ran.
Shell help probes use only builtins and fake PATH; syntax checks run separately,
one `bash -n` per changed shell file.

Literal controls drive actual `copilot_land` dry-run with `--title help` and
`--dry-run` after the value, a findings file literally named `help` containing
invalid JSON, malformed value/safety-flag pairs, and billing stdin containing
`help`. They assert the intended data parse or refusal and zero backend effects.

The PR verification comment records final commands, outputs and head after the
required `/code-review xhigh --fix`. That final evidence supersedes intermediate
runs. All seven plugin source entries receive a patch bump because they share
the changed root tools (including preflight); no plugin install/update is part
of this source audit.
