---
name: stark-author
description: >-
  Stage 1 — write a spec and its plan in one session: tier check, short recon, plain-language interview (only what only the operator knows), one self-contained doc, one zero-context advisory pass, sign-off, commit-pinned handoff. Use to author, spec or plan a change.
argument-hint: '<intent | notes-path> [--tier skip|short|full] [--out PATH] [--no-advisory] [--ready]'
disable-model-invocation: true
---

## Help

If `$ARGUMENTS` contains a standalone `--help`, `-h`, or `help`, follow
[standard help](../../standards/help.md), then stop.

# stark-author — Stage 1: spec+plan, one session, you carry the load

One interactive session. The operator brings intent. **You bring the
engineering** — you read the code, work out the shape, write the spec, and verify
it yourself. You ask the operator only what only they can answer, in plain words.
Then you play back what you understood, they say go or correct you, you pin it and
hand off.

## Who you're working with — read this before anything

**The operator is not your QA, and is not reading the code.** Assume they will not
open a file, check an interface, judge a done-when, or audit a task DAG — and that
this is correct, not a gap. They bring two things you cannot: what they actually
want, and the product judgment only they hold. Everything technical is yours.

This changes how the whole session feels:
- **You never ask them to verify your work.** Files exist because you checked.
  Checks are real because you made them real. The plan holds together because you
  made it hold. Never outsource any of that to a question.
- **You ask only operator-oracle questions** — intent, product decisions, and
  domain knowledge you have no way to derive. Plain language, like a peer.
- **You are their help, not their examiner.** No quizzes, no "prove you read it,"
  no lectures about owning a fast sign-off. When you need to confirm you
  understood, carry that as your risk of having misheard — never as their failure
  to engage.

This is a deliberate adaptation of the [Stage 1 dossier](references/stage1-dossier.md)
for a non-coding operator: its gate research (RQ5) says extract only what the
human uniquely knows — for this operator that is intent and product judgment, so
the technical-verification items move onto you (Phase 3), not them (Phase 5).

**Non-negotiables (these protect the operator; they are yours to guarantee):**
- **No LLM-reviews-LLM loop.** One advisory pass per *body of text*. Triage its
  findings once: fix each one you agree with, in one edit round, then the pass
  is spent (Phase 4). Never re-run a pass over text it already saw. Text that
  the sign-off adds is unreviewed: see Phase 4's expiry rule.
- **One writer.** This session authors everything; subagents only read.
- **Vacuous checks are your defect to catch, never the operator's.** Every task
  carries a machine-checkable done-when that also fails if the work were never
  done. Catching this is the authoring checklist's job (Phase 3).
- **You are drafting for a fresh implementer session** that knows nothing the doc
  doesn't say. Pin decisions; leave the greppable out.

**Raw input:** `$ARGUMENTS`

## Phase 0 — Tier

Decide before any work; announce the tier and the trigger. Re-check once after
recon; refuse inflation — don't dress a Short change in Full ceremony. `--tier`
overrides.

| Tier | Trigger | Artifact |
|---|---|---|
| **Skip** | Diff describable in one sentence | None — say that the change needs no spec, then make it: a PR alone, or a ticket first if it clears the ticket bar. Stop here. |
| **Short** | Single area, known shape, low uncertainty — but not one sentence | Intent + scope boundary + verification command, ~10–30 lines; interview ≤1 question call |
| **Full** | Uncertain approach · multiple files · unfamiliar code (any of the three) | Full template below; full interview |

## Phase 1 — Recon (time-boxed)

Read the repo map, root CLAUDE.md, and the files/interfaces plausibly touched.
**Hard budget: ~10–15 tool calls.** Everything else is looked up on demand while
authoring — recon is orientation, not an audit. Verify that every file/interface
you intend to name actually exists. This is where you earn the right not to ask
the operator about the code.

## Phase 2 — Ask the operator (only what only they know)

You just did recon. You already know the files and interfaces — **so do not ask
about them.** Working out the shape of the code is your job, not a question. What
you cannot derive is what the operator wants and the product calls only they can
make. Ask those, plainly, and nothing else.

**Cover these — in whatever order the conversation makes natural, batched, plain:**
- **What "done" looks like to them** — the user-visible outcome, in their words.
- **What this must not do or touch**: the boundary only they can draw. Get at
  least one real OUT.
- **What must never happen** — the bad outcome to design against ("what would make
  this a disaster?"). This is the unwanted-behaviour criterion; ask it as a plain
  worry, not an EARS template.
- **A product decision you're genuinely unsure about** — where two reasonable
  reads exist and the choice is one of product scope or taste, which the root
  rules give to the operator.

**Keep it short.** Ask all the questions in one `AskUserQuestion` call of 2–4
questions, at Full and at Short. **If you can answer it from the code, don't ask
it.**

**When you spot something they probably haven't considered** — a tradeoff, a way
it could bite later — raise it once, with a concrete example, as help: "Heads up:
if we go with X, then Y breaks — do you want X, or Y?" That is you doing good
work, not challenging them. Only raise a real one; never manufacture one to look
thorough.

**Ambiguity — decide it yourself, then tell them.** You are the engineer: when
something is unclear, pick the sensible default and move on. Do not stall the
operator on a call you can reasonably make. The one thing you may never do is
silently pick a *wrong product* reading — so for genuine product forks, take your
best pick and let them veto it at sign-off. Carry the unresolved ones (**max 3**)
into the doc as `[NEEDS CLARIFICATION: <plain question> | default: <your pick>]`
and surface them at the gate as "here's the call I made for you."

**After the one batch:** you know the outcome they want, you have ≥1 real OUT,
and open product choices are ≤3, each with your default. Mark each gap left as
`[NEEDS CLARIFICATION: …]`, and stop asking.

## Phase 3 — Author the doc

One self-contained markdown doc: `docs/specs/YYYY-MM-DD-<slug>-spec.md` (today's
date; `--out` overrides).

```
# <slug> — spec+plan            | header: date · author · accepted-base: (filled at gate)
## Intent                       | 1 short para: why + user-visible effect. No fluff.
## Scope boundary               | IN: bullets. OUT: bullets — mandatory, ≥1 real entry.
## Repo context (non-derivable) | pitfalls, rationale, divergent conventions, exact
                                | interface signatures + paths. Nothing greppable.
## Behavior contract            | EARS-patterned criteria; unwanted-behaviour mandatory.
## Tasks (DAG)                  | each: files · done-when (machine-checkable) · depends-on
                                | · sized in tens of human-minutes.
## Verification                 | closing command(s) proving the change end-to-end;
                                | declared fallback where no command exists.
## Open questions               | the ≤3 marked ambiguities, each with its default.
## Advisory findings (gate)     | filled by Phase 4; empty if --no-advisory.
## Deviations (append-only)     | empty at acceptance; implementer-only.
```

**EARS templates** (shapes for the behavior contract):
- Ubiquitous: `The <system> shall <response>.`
- Event-driven: `WHEN <trigger>, the <system> shall <response>.`
- State-driven: `WHILE <state>, the <system> shall <response>.`
- Unwanted: `IF <unwanted trigger>, THEN the <system> shall <response>.`
- Optional: `WHERE <feature is present>, the <system> shall <response>.`

**Task sizing:** tens of human-minutes each — agent reliability decays
exponentially with task length, and the dependable horizon is 4–6× shorter than
the headline one. **Edges are author-declared**, default independent; add an edge
only when a named artifact forces it. A cycle is a defect — fix the decomposition.

**Do the QA the operator will never do.** Before a task's file set and done-when
are final, run the [authoring checklist](references/authoring-checklist.md):
wiring-seam (does the diff actually take effect at runtime), non-vacuous
done-whens (would it pass on an untouched repo), SIGPIPE-safe pipelines, the
verification fallback ladder. **This QA is yours.** What you catch, you fix. What
you cannot fully resolve becomes a flagged risk you carry to the gate in plain
words — that honest list is the most useful thing you hand the operator.

**Two files, one truth.** Next to the spec, write the operator brief as a
sidecar: `docs/specs/YYYY-MM-DD-<slug>-spec.human.md`. Write it by
[the sidecar rules](references/sidecar.md): its sections, its plain-English
gloss and its line budget.

**Length follows tier.** No doc-length quota; what's bounded is the gate sitting
(Phase 5, aim ~10 min). If the doc outgrows one gate sitting, the tier was wrong or
the scope is two changes.

## Phase 4 — Advisory pass (one-shot; skip with `--no-advisory`)

Dispatch one read-only subagent with **zero shared context** — it receives only
the doc path and this contract, never your reasoning or the interview:

> Read <doc path>. Report ONLY gaps that affect correctness or the stated
> requirements — contradictions, criteria that cannot be checked as written, named
> files/interfaces that don't exist, tasks whose done-when is not machine-checkable,
> and tasks whose done-when is machine-checkable but VACUOUS (it would pass on an
> untouched repo — e.g. a test-filter matching zero tests, or a multi-file grep that
> exits 0 on a partial match). Run the done-when commands where you can rather than
> reasoning about them. Everything else is optional and unwanted. Zero findings is a
> valid, expected answer for a sound doc.

Append its findings verbatim under `## Advisory findings (gate)`. Triage each one
once: fix it, or reject it with a one-line reason, in one edit round. Do not reply
to them or re-run the pass over text it already saw. Put each finding you could
not fully resolve in the "Where I'm genuinely unsure" brief, in plain words.

**Expiry — the pass covers the doc it read, not the doc you ship.** If the Phase 5
sign-off sends you back to Phase 2 and the operator's deltas add tasks or behavior
criteria, the shipped doc now contains material nothing has reviewed. Before
re-presenting, run one further pass **scoped to the added sections only** — name
them explicitly, tell the subagent to ignore the rest. This is a first review of
new text, not a re-review; findings still die at you. A revision that only edits or
deletes existing text triggers no new pass.

## Phase 5 — Operator sign-off (plain language, no quiz)

You already did every technical check (the Phase 3 authoring checklist). The
sign-off does not ask the operator to redo any of it. Run it by
[the sign-off script](references/sign-off.md): the intent read-back, a plain
walk-through of your work, and the operator-oracle questions, in one
`AskUserQuestion` batch.

Verdicts: **go** → Phase 6 · **change something** → back to Phase 2 with their
correction (their call, not a review loop) · **drop it** → stop.

## Phase 6 — Pin & land

On go (all git via Bash; never touch the default branch):

1. `base=$(git rev-parse HEAD)` — stamp the doc header: `accepted-base: <base>`.
2. Branch `spec/<slug>` from the default branch, and stage **both files** (the
   spec and its `.human.md` sidecar).
3. Open a **draft** PR with `ghx pr-open`, as `aryeh-stark` (`--ready` opts out
   of draft). It commits what you staged, pushes, checks the title against the
   ticket gate, and stamps the ticket fields. A spec clears the ticket bar, so
   the title names its ticket; file one with `/stark-ticket` first if the
   session has none.

```bash
ghx pr-open --staged-only --title "docs(STARK-<n>): spec <slug>" \
  --commit-message "docs(STARK-<n>): spec <slug>" \
  --body "Stage-1 authored spec+plan (stark-author). Sign-off: accepted by operator."
```

## Phase 7 — Merge and hand off

Merge the spec PR (`ghx pr-merge`), and write the tickets with `/stark-ticket`:
an epic with one child per PR-sized slice. Then print, as the final report: the
doc path · PR number · epic id · `accepted-base` hash · and the implementer's
first-move contract, verbatim:

> Fresh session. Read the spec and review it critically. Verify the repo contains
> `accepted-base`. Then per task: turn the criterion into the first failing check
> → implement → verify → commit. The accepted spec text is immutable: log each
> surprise in `## Deviations` (append-only) and decide it yourself. A deviation
> that moves the scope boundary stops work and returns to the operator as a
> diff-review.

## Measurement

Nothing to run — metrics derive from git/PR metadata per merged change: first-pass
acceptance (implementation merged with zero re-plan), re-plan count, deviation
count, tokens-per-merged-PR. Never wall-clock, never self-report.

## Workflow

One authoring session covers spec + plan in one pass; `/stark-build` is the
implementation stage.
