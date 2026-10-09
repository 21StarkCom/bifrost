---
name: stark-agent-docs
runtimes:
  - claude
  - codex
description: >-
  Use when writing or editing anything another agent will read (a CLAUDE.md,
  AGENTS.md or CLAUDE.local.md, a .claude/rules file, a SKILL.md or a skill's
  description, a doc an instruction file points to), when porting rules from
  Cursor or Copilot, or when deciding where an instruction, guardrail,
  convention or repo fact should live.
argument-hint: "[<file> | <what to write>]"
---

## Help

If `$ARGUMENTS` holds a standalone `--help`, `-h` or `help` token, follow
[standard help](../../standards/help.md), then stop.

## Arguments

- `<file>` or `<what to write>`; neither: the change in front of you.

# stark-agent-docs

An instruction file is advice the model may skip, and everything loaded at
start-up shares one context window. Place each line where it loads, write it
so it changes what the agent does, then check that it loaded.

## 1. Place it

| The line is | Put it in | The agent gets it |
|---|---|---|
| something that must always or never happen | the remote's branch protection or a git hook for every client; a Claude hook or `permissions.deny` covers Claude alone; prose may point at them | enforced, not advised |
| needed in every session in this repo, and not readable from the code | the repo's CLAUDE.md; where Codex also works in the repo, AGENTS.md shares it | at start-up |
| true only for some paths | `.claude/rules/<topic>.md`, scoped with `paths:` | when Claude reads or writes a matching file |
| a procedure of more than a few steps | a skill, or a doc behind a one-line pointer | when invoked, or when the pointer fires |
| an instruction one person writes for their own sessions | `~/.claude/CLAUDE.md`, or a gitignored CLAUDE.local.md | at start-up, for that person |
| what the agent learned in a session: a correction, a confirmed approach, a stated preference | auto-memory, in the harness's own format | its index at start-up |
| how fleet repos relate, or when to reach one | the vault-ecosystem corpus (`repos/<slug>/index.md`) | when looked up |
| a secret | Mímir | never from a file |
| readable from the code, config, `--help` or git history | nowhere | the agent looks it up |

On Codex the only path scope is an AGENTS.md in that directory, and the
personal file is `~/.codex/AGENTS.md`.

Before you write a rule, an import, an AGENTS.md, a symlink, a hook or a skill
description, read that file's section of [load facts](references/load-facts.md):
the loaders differ from what the file names suggest.

## 2. Write it

- One checkable statement per line: "tests run with `--runInBand`", not "be
  careful with tests". Add the reason where it is not obvious; the reason lets
  the agent handle cases the line does not name.
- State the behaviour you want. Keep a prohibition for a hard boundary, and
  pair it with what to do instead.
- Emphasis on one line at most: capitals on many lines make none stand out.
- Point to the file that shows the pattern instead of pasting it, and word each
  pointer with the condition for following it.
- Keep each fact in one file. A copy another tool needs says, in both files,
  that they change together; where two files differ, the one that wins says so.
- Cut what the model does anyway, what the repo already shows, history and
  incident stories (keep the rule they produced), and ticket ids.

## 3. Check it

- **It loads**: one headless run that logs what loaded, and why
  ([recipe](references/load-facts.md#check-what-loaded)).
- **It changes behaviour**: run the task the line is for in a fresh session; a
  line that changes nothing is a candidate to cut.
- **The repo stays sound**: run the read-only measurer below. Its judged pass,
  `/stark-rules-optimizer`, starts only when the operator types it.

```bash
TOOLS="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools"
# load scope, globs, size budgets, dead references
node --no-warnings "$TOOLS/rules_audit.ts" --repo .
```
