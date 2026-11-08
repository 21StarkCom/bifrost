# Agent-doc review — spec

2026-11-07 · Aryeh Stark (drafted by Claude) · ticket STARK-17311 · cleanup epic: see "Rollout"

## Intent

Review each agent instruction file the way a legal team reviews a contract.
A playbook holds the standard position for each kind of clause. A review reads
the file clause by clause, gives each clause a GREEN, YELLOW or RED flag, and
writes the exact replacement text. A fast triage runs before each merge, and a full
review runs on request. Each Monday, an odin agent on the devbox reviews what changed
in the fleet. The files stay small, agree with the root rules, and stop growing by
themselves.

## Why

The review of 2026-11-07 read the operator's sessions and agent files:

- 1,831 agent files hold 8.2M chars. About 22% of the chars are dates, ticket
  ids and incident stories.
- About 45 conflicts: one file says "ask the operator", another says "act".
  The model cannot obey both, so it acts differently each time.
- 221 auto-memory feedback notes use "never" 232 times. Claude Code loads each
  `MEMORY.md` under the header "These instructions OVERRIDE … MUST follow", so
  one remark becomes a rule.
- Text that adds work: "reversible fixes found on the way", "file the sub-ticket
  yourself and ask the operator nothing", "Use for any change request".
- The files grow by themselves: a hook asks each memory write to move the fact
  into a repo's CLAUDE.md, and agent-file edits pushed to `main` with no PR.
  More than 900 commits touched agent files in 11 days.
- Nothing checks an agent file today. The root rules class it as "Prose only:
  no review".

## The legal model, mapped

The model is Anthropic's legal plugin (`knowledge-work-plugins/legal`): the
`review-contract` and `triage-nda` skills.

| Contract review | Agent-doc review |
|---|---|
| The contract | One agent file: CLAUDE.md, AGENTS.md, `.claude/rules/*.md`, SKILL.md and its `description:`, a memory note or `MEMORY.md` |
| The master agreement, and the order of precedence | The root rules `~/Code/CLAUDE.md`, and the precedence list below |
| The playbook: standard position, acceptable range, escalation triggers | `playbook.md`: for each clause type, GREEN, YELLOW and RED |
| Defined terms | `glossary.md`: GO, gate, operator, spine, worker, ticket bar, live proof, kept gate. One meaning each |
| NDA triage: a fast pre-screen | Triage: `rules_audit.ts --playbook`, no model, in seconds, before each merge |
| Clause-by-clause review with redlines | The review: `/stark-rules-optimizer` reads each clause against the playbook, and writes the redline |
| Redline with a fallback position | The exact new text, or "move to `docs/<path>`" as the fallback |
| Negotiation tiers | Tier 1: RED, fix before merge. Tier 2: YELLOW in a file that loads at start-up. Tier 3: other YELLOW, fix when the file is next touched |

## Order of precedence

1. The root rules, `~/Code/CLAUDE.md` (idavoll).
2. The workspace map, `~/Code/21Stark/CLAUDE.md`.
3. A repo's root CLAUDE.md or AGENTS.md.
4. A package CLAUDE.md, and a path-scoped `.claude/rules/*.md`.
5. A skill: a procedure, never a policy.
6. A memory note: a hint, never a rule.

A clause that contradicts a clause higher in the list is RED.

## The playbook

A clause is one bullet, one table row, or one paragraph. The review types each
clause, then flags it.

| Clause type | GREEN (keep) | YELLOW (redline) | RED (fix before merge) |
|---|---|---|---|
| RULE | One checkable instruction that the code, config, `--help` and git log do not show | Two rules in one clause; a vague rule ("be careful"); capitals for emphasis | It contradicts a clause higher in the precedence list |
| TRAP | One fact that prevents a wrong action, with the safe action | Over two lines; the story comes before the fact | Stale: it names a tool, file or flag that is gone |
| POINTER | One line: when to read, and the path | — | The path does not exist |
| GATE (gives a step or a choice to the operator) | An item on the root list "These still need a GO", or a step that needs a person's own grant | — | Any other gate |
| SCOPE | The request names the work | "While you are there, also …" | It adds tickets, PRs, specs, ADRs, reviews, sweeps, re-measures or follow-ups that the request does not name |
| GROWTH | — | — | It tells agents to add facts, lessons or files to agent files |
| HISTORY | — | One ticket id or date as the source of a rule | A story, a changelog, "used to", "measured on", "moved here from" |
| REFERENCE | — | A table or catalog under 2k chars in a path-scoped file | A catalog that loads at start-up, or one over 2k chars |
| DUPLICATE | — | A copy of a sibling file | A copy of a clause higher in the list |
| MEMORY NOTE | A hint with **Why:** and **How to apply:** lines | "never" or "always" that are not the operator's words | It contradicts any instruction file |

Size budgets (chars). Over budget is YELLOW; over twice the budget is RED.

| File | Budget |
|---|---|
| A repo's root CLAUDE.md or AGENTS.md | 15k |
| A package CLAUDE.md or a rule file | 10k |
| A SKILL.md core (the rest goes to `references/`) | 15k |
| A skill `description:` | 300 |
| A `MEMORY.md` index (each line 150 or fewer) | 8k |
| All files that load together at start-up in one repo | 40k |

## Components

Reuse first: `tools/rules_audit.ts` already measures load sets and finds gate
phrases, and `/stark-rules-optimizer` already judges its candidates and opens a
draft PR.

1. **`playbook.md` and `glossary.md`** in
   `skill/stark-agent-docs/references/`. The tables above are the first version.
   A change to the playbook is a PR to bifrost.

2. **Triage: `tools/rules_audit.ts --playbook`.** No model.
   - Input: `--repo <path>` (as today), `--fleet` (each repo under `~/Code/21Stark`),
     `--memory` (each `~/.claude/projects/*/memory/`), or `--files <list>`.
   - New checks: size against budget; marker lines (ticket ids, dates, "used to",
     "measured on"); growth phrases; duplicate lines across the fleet and against
     the root rules; dead pointer paths; `MEMORY.md` line length. It keeps its
     `GATE_PHRASES` and its load emulation (`rules_load_lib.ts`).
   - Output: one GREEN, YELLOW or RED line per file, then each RED clause with
     `path:line`. Exit 0 for GREEN or YELLOW, exit 3 for RED.

3. **The gate: a stark-ops PreToolUse hook on `njord pr-merge`.** It runs triage
   on each agent file in the branch's diff against its base. A RED blocks the
   merge and prints the clauses. It ships inline on the stark-ops entry, as
   `fact_routing_hook.ts` does, so bifrost and idun still share no code.

4. **The review: `/stark-rules-optimizer` grows into the full review.**
   - Reads the file, the files above it in the precedence list, and its siblings
     in the same load set.
   - Types and flags each clause by the playbook, and writes the redline for each
     YELLOW and RED. Checks each glossary term for one meaning.
   - `--apply` applies the redlines and opens a draft PR in the target repo, as
     it does today.
   - Output: the summary and issues list below.

5. **The weekly run: an odin agent on the devbox.** Revised on 2026-11-08. The
   first version was a launchd job on the Mac. The operator removed it, and the
   root rules now refuse a new Mac service that the operator did not ask for.
   - `rules_audit.ts --since <run.json>` prints only the change against a saved
     run: each new RED clause, and each RED clause that is gone. `--save
     <run.json>` writes the run to `<run.json>.pending`. `--commit <run.json>`
     moves it to `<run.json>` for the next week, once the run is done with it.
   - `--settings` adds `effortLevel`, `model` and `modelSettings` from
     `~/.claude/settings.json`. With `--since`, it prints each value that changed.
   - `--install-schedule` and `--uninstall-schedule` leave `rules_audit.ts`.
   - odin's fleet tool `agent_doc_triage` runs `rules_audit.ts --playbook --fleet
     --json --since --save` with fixed flags and one fixed state file.
   - odin's playbook `agent-doc-review` judges each new RED clause by
     `playbook.md`. It drops a kept gate or a false flag, with the reason. It
     writes a redline for each real RED.
   - The playbook files one ticket for each repo with a real new RED, or
     comments on that repo's open ticket. It posts the summary to Slack. Then
     it runs `rules_audit.ts --commit` on the state file. A run that stops
     before that point leaves the base as it was.
   - `odinctl schedule add` also writes a systemd user timer on Linux. The devbox
     runs the playbook each Monday at 09:00, on the API key, with a ceiling of
     1,000,000 tokens for each run.
   - The Mac's memory notes and settings are only on the Mac. They get a check
     when the operator asks: `rules_audit.ts --playbook --memory --settings
     --since <run.json>`.

6. **The root rules change.** Agent instruction files leave the "Prose only: no
   review" tier. New tier: "Agent instruction files: triage; a RED blocks the
   merge." The precedence list moves into the root rules.

## Review output

```
## Agent-doc review: tyr/CLAUDE.md
Size 20.7k / 15k · loads at start-up · GREEN 41 · YELLOW 6 · RED 2

### RED 1 · CONFLICT · tyr/CLAUDE.md:38
Clause: "Ship straight to `main`."
Playbook: a clause that contradicts root is RED. Root :98 "Never commit or push to a default branch directly".
Redline: delete the clause.
Fallback: none (Tier 1).

### YELLOW 1 · REFERENCE · tyr/CLAUDE.md:130-272
Clause: a list of 14 packages, 12k chars.
Redline: keep ":132 Each package's CLAUDE.md holds the rest" and delete the list.
Fallback: move the list to docs/packages.md behind one pointer.
```

## Rollout

1. Now, in parallel with this spec: the cleanup epic (33 tickets, one for each
   repo or slice). Gru drives it with the first version of the standard. The
   fact routing hook loses its CLAUDE.md target in that epic.
2. After approval: merge this spec, and file an epic with one ticket for each
   component: (1) playbook and glossary; (2) triage in `rules_audit.ts`; (3) the
   gate hook; (4) the review in `/stark-rules-optimizer`; (5) the root rules
   change; (6) the weekly sweep.
3. The first sweep after (6) is the proof: every repo GREEN or YELLOW, and the
   summary arrives.
4. The revised component 5 is its own epic, with one ticket for each slice:
   `rules_audit.ts` in bifrost; the Linux schedule in odin; the tool and the
   playbook in odin; the devbox rollout. The first run on the devbox is the proof.

## Decisions (my recommendation first)

- The gate is a stark-ops hook before `njord pr-merge`, not a CI job in each
  repo and not a call from njord. It covers every Claude agent, and it keeps
  bifrost and idun apart.
- Triage uses no model. It is fast and free, and its RED list is exact. The
  model runs only in the review.
- Memory notes get the same playbook. A run on the Mac reports them when the
  operator asks; a review run with `--memory --apply` fixes them in place after
  a backup, with no PR.
- The weekly run is an odin agent on the devbox, not a job on the Mac. The
  devbox is online 24/7, and it is not the operator's work machine.
- Triage and the diff stay code in bifrost. Only the judgment of each new RED
  clause uses a model, so a week with no change costs almost nothing.
- The weekly run files its tickets itself. A write with no allow rule waits 24
  hours as a held call, and the Slack post names it.
- The budgets above are a start. A file over budget names its reason in its PR.

## Not built: add when it hurts

- A CI job in each repo, for a person or a Codex worker that skips the hook.
- A model in triage.
- A check of the Mac's memory notes and settings on a schedule. The Mac gets no
  new service.
- Trend charts of size and flags.
- Codex parity of `review`.
- A review of the harness's own prompt and of third-party plugin skills.
