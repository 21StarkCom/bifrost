---
name: stark-terraform-review
description: >-
  Multi-model review (claude, codex, gemini) of Terraform and OpenTofu HCL
  (.tf, .tfvars, .tftest.hcl) for security, correctness, state safety, module
  contracts and test gaps. Use to review or audit Terraform code. Review-only.
  Terragrunt goes to stark-terragrunt-review.
argument-hint: "[path] [--agents claude,codex,gemini] [--changed] [--no-tools] [--min-severity ...] [--pr N --repo O/R] [--dry-run] [--json]"
disable-model-invocation: true
model: opus
---

## Help

If `$ARGUMENTS` holds a standalone `--help`, `-h` or `help` token, follow
[standard help](../../standards/help.md), then stop.

# stark-terraform-review

Multi-agent Terraform/OpenTofu reviewer. Keep this skill thin: resolve the
target, then hand off to the TS dispatcher `tools/iac_review.ts`, which runs the
review across **one or more configured LLM agents** (each a headless subagent),
merges + cross-validates the findings, and renders the report. All logic — agent
resolution, file collection, host scanners, dispatch, dedup, PR posting — lives
in the tool. Read its output and surface failures.

## Configuring which LLMs run the review

The reviewers are configurable. Precedence: **`--agents` flag > config
`iac_review.agents` > `["codex"]`**. To run with Gemini **and** Codex:

```bash
# per-invocation
… --agents gemini,codex

# or set it in the global config.json (bifrost global/config.json); a repo .code-review/config.json does not change it
{ "iac_review": { "agents": ["gemini", "codex"] } }
```

Each listed agent reviews independently as its own subagent; findings they agree
on are marked cross-validated.

## Arguments

Raw input: `$ARGUMENTS`

- `path` — file or directory. Default: current repo root / cwd.
- `--agents a,b` — LLMs to run (claude|codex|gemini). Overrides config.
- `--changed` — only HCL changed vs the git merge-base / working tree.
- `--no-tools` — skip host scanners (review by reading only).
- `--min-severity S` — drop findings below S (`critical|high|medium|low`).
- `--pr N --repo O/R` — post the merged findings to PR N (through the operator's gh login, with model attribution).
- `--dry-run` — resolve agents + files, dispatch nothing.
- `--json` — print the receipt JSON instead of the markdown report.

## Run it

```bash
TOOLS="${STARK_REVIEW_TOOLS:-${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools}"
node --no-warnings "$TOOLS/iac_review.ts" \
  --kind terraform "${PATH_ARG:-.}" ${EXTRA_FLAGS}
```

The dispatcher:
1. Resolves the agent list (see above) and reports any skipped (disabled/unknown).
2. Collects the in-scope `.tf`/`.tfvars`/`.tftest.hcl` (capped; `--changed` narrows).
3. Runs whatever read-only scanners are installed (`terraform fmt/validate`, `tflint`, `trivy config`, `checkov`) as evidence — unless `--no-tools`.
4. Dispatches every agent in parallel with the canonical rubric (`global/prompts/iac-review/terraform.md`) + the line-numbered file context.
5. Parses each agent's JSON findings, dedups across agents (cross-validation), applies `--min-severity`.
6. Prints the report (and `--pr` posts it). Exits 2 when a critical or high finding remains, so it can serve as a check.

## What it checks

Review by **failure mode** — identity churn, secret exposure, blast radius,
state safety, module contracts, testing gaps — with a version-aware guard that
suppresses advice the detected TF/OpenTofu version can't use. Full rubric:
`global/prompts/iac-review/terraform.md`.

> Rules adapted from the HashiCorp Terraform Style Guide (MPL-2.0), Anton
> Babenko's terraform-skill (Apache-2.0), and TerraShark.
