# The operator brief — the `.human.md` sidecar

Use this page in Phase 3 of `SKILL.md`, when you write the sidecar next to
the spec.

**Two files, one truth.** The sidecar is
`docs/specs/YYYY-MM-DD-<slug>-spec.human.md`. It is not normative: on any
conflict the spec wins, and the sign-off (Phase 5) runs against the spec.
Regenerate it on every spec revision.

**The sidecar is the operator's whole view of your work, in plain English** —
the same material you walk them through at Phase 5, Step A. Not a marketing
summary; not a hedge. Write every row in words a non-coder reads without
stopping — no jargon, no `go test` shorthand left unexplained. Fixed sections:

| Section | Contents (plain language) |
|---|---|
| What this does | 2–3 plain sentences |
| What it will NOT do | every OUT bullet, in plain words |
| What I checked myself, so you don't have to | the code you're naming is really there · the checks you wrote would fail if the work wasn't actually done · the one command that proves it works, and what a passing run looks like |
| Where I'm genuinely unsure | your flagged risks, one plain line each: the weakest check, the thinnest OUT boundary, any unresolved advisory finding, each call you defaulted. Mandatory — "no residual risks" only if the authoring pass was genuinely clean |
| Calls I made for you | each defaulted ambiguity as a plain question + the default you took + one-line why |

**Verbatim wherever it is checkable — but explained.** Copy commands and
interface signatures exactly, in code spans, and give each a plain-English
gloss. `go test ./... -run 'Docs'` becomes "runs the docs tests
(`go test ./... -run 'Docs'`)": exact for you, readable for them.

**Budget: ≤40 lines Full, ≤15 Short.** Every line is brief material or a
flagged risk. Background, architecture narration and restated repo context
live in the spec: cut them here. If the mandatory sections alone blow the
budget, the tier was wrong or the scope is two changes.
