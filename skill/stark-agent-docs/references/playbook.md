# Agent-doc playbook

The standard position for each kind of clause in an agent file: a CLAUDE.md,
an AGENTS.md, a `.claude/rules/*.md`, a SKILL.md and its `description:`, a
memory note or a `MEMORY.md`. A review types each clause, gives it a GREEN,
YELLOW or RED flag, and writes the redline. The terms are in the
[glossary](glossary.md). A change to this file is a PR to bifrost.

## Order of precedence

1. The root rules, `~/Code/CLAUDE.md` (idavoll).
2. The workspace map, `~/Code/21Stark/CLAUDE.md`.
3. A repo's root CLAUDE.md or AGENTS.md.
4. A package CLAUDE.md, and a path-scoped `.claude/rules/*.md`.
5. A skill: a procedure, never a policy.
6. A memory note: a hint, never a rule.

A clause that contradicts a clause higher in the list is RED.

## Flags

- **GREEN:** keep the clause as it is.
- **YELLOW:** write a redline: the exact new text, or "move to `docs/<path>`"
  as the fallback.
- **RED:** write a redline, and fix the clause before the merge.

Fix a flag by its tier:

| Tier | Flag | When to fix |
|---|---|---|
| 1 | RED | Before the merge. |
| 2 | YELLOW in a file that loads at start-up | In the PR that the review opens. |
| 3 | Any other YELLOW | When a PR next touches the file. |

## Clause types

A clause is one bullet, one table row, or one paragraph. A "—" means the type
has no clause at that flag.

| Clause type | GREEN (keep) | YELLOW (redline) | RED (fix before merge) |
|---|---|---|---|
| RULE | One checkable instruction that the code, config, `--help` and git log do not show | Two rules in one clause; a vague rule ("be careful"); capitals for emphasis | It contradicts a clause higher in the precedence list |
| TRAP | One fact that prevents a wrong action, with the safe action | Over two lines; the story comes before the fact | Stale: it names a tool, file or flag that is gone |
| POINTER | One line: when to read, and the path | — | The path does not exist |
| GATE (gives a step or a choice to the operator) | A kept gate, or a step that needs a person's own grant | — | Any other gate |
| SCOPE | The request names the work | "While you are there, also …" | It adds tickets, PRs, specs, ADRs, reviews, sweeps, re-measures or follow-ups that the request does not name |
| GROWTH | — | — | It tells agents to add facts, lessons or files to agent files |
| HISTORY | — | One ticket id or date as the source of a rule | A story, a changelog, "used to", "measured on", "moved here from" |
| REFERENCE | — | A table or catalog under 2k chars in a path-scoped file | A catalog that loads at start-up, or one over 2k chars |
| DUPLICATE | — | A copy of a sibling file | A copy of a clause higher in the list |
| MEMORY NOTE | A hint with **Why:** and **How to apply:** lines | "never" or "always" that are not the operator's words | It contradicts any instruction file |

## Size budgets

Sizes are in chars. A file over its budget is YELLOW. A file over twice its
budget is RED.

| File | Budget |
|---|---|
| A repo's root CLAUDE.md or AGENTS.md | 15k |
| A package CLAUDE.md or a rule file | 10k |
| A SKILL.md core (the rest goes to `references/`) | 15k |
| A skill `description:` | 300 |
| A `MEMORY.md` index (each line 150 or fewer) | 8k |
| All files that load together at start-up in one repo | 40k |

## Phrase lists

Triage matches these lists with no model. A match marks the clause as the
type in the list's heading, at the flag in its row. The review reads the
clause and can change the flag: a gate phrase in a kept gate is GREEN.
Triage matches a phrase as whole words, with any case. It skips text in a
code span or in double quotes, because that text cites the phrase.

### Gate phrases (GATE)

The list is `GATE_PHRASES` in `tools/rules_audit_lib.ts`. The two change
together. Where they differ, the code wins.

| Phrase | Flag |
|---|---|
| `needs a GO` | RED |
| `with a GO` | RED |
| `the operator's call` | RED |
| `the operator's word` | RED |
| `not yours` | RED |
| `whoever asks` | RED |
| `did not name` | RED |
| `ask each run` | RED |
| `on the operator's GO` | RED |
| `needs the operator's GO` | RED |
| `with the operator's GO` | RED |
| `the operator's OK` | RED |
| `the operator's to` | RED |
| `go-ahead` | RED |

### Growth phrases (GROWTH)

| Phrase | Flag |
|---|---|
| `add a rule` | RED |
| `update this file` | RED |
| `record the lesson` | RED |
| `lessons learned` | RED |
| `add it to CLAUDE.md` | RED |
| `add it to AGENTS.md` | RED |

### Markers (HISTORY)

A pattern is a JavaScript regular expression. A phrase matches as words.

| Marker | Pattern or phrase | Flag |
|---|---|---|
| A STARK ticket id | `\bSTARK-[0-9]+\b` | YELLOW |
| A Jira EI ticket id | `\bEI-[0-9]+\b` | YELLOW |
| A date | `\b20[0-9]{2}-[0-9]{2}-[0-9]{2}\b` | YELLOW |
| A past habit | `used to` (not "is used to" or "are used to") | RED |
| A measurement story | `measured on` | RED |
| A move record | `moved here from` | RED |

## A redline

Write each YELLOW and RED clause in this form:

```
### RED 1 · CONFLICT · tyr/CLAUDE.md:38
Clause: "Ship straight to `main`."
Playbook: a clause that contradicts root is RED. Root :98 "Never commit or push to a default branch directly".
Redline: delete the clause.
Fallback: none (Tier 1).
```
