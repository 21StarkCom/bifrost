# Cold read — one zero-context pass over a ticket draft

An author re-reads intent, not text. One reader with no shared context checks
the draft by a different method than the author's, once — the same one-pass
discipline as `stark-fresh-eyes`: one read per draft, each finding dispositioned
once, never a second round.

## When

- Every ticket, with two exceptions, each recorded in `## Cold read`:
  - `skipped: batch <first ticket>` — three or more tickets filed from one decomposition (a spec's tasks, an epic breakdown, "open tickets for X, Y and Z") get ONE read over the whole batch.
  - `skipped: trivial` — `## Evidence` has no rows AND Scope IN is one documented command (a version bump).
- A ticket is not handed to a worker before its `## Cold read` line exists.

## Dispatch

Give the reader only the draft path, the `(repo, sha)` rows, the installed
versions of any tool the ticket makes claims about, and the contract below —
never your reasoning.

- Claude Code: the Agent tool with `subagent_type: general-purpose`, told to
  write nothing outside a temp dir. Not `Explore`: it reads excerpts rather
  than whole files, and its own description rules out design-doc auditing and
  cross-file consistency checks, which is this whole contract.
- Codex: a subagent from Codex's own multi-agent tool, told the same. A
  nested `codex exec` cannot start inside a sandboxed Codex session (`failed to
  initialize in-process app-server client: Operation not permitted`); from an
  unsandboxed shell, `cd "$(mktemp -d)" && codex exec --skip-git-repo-check -s workspace-write "<prompt>" </dev/null`
  also works. `workspace-write`, not `read-only`: the read-only sandbox refuses
  every write, a temp dir included, so no scratch build or Verification run
  could happen; this one writes only under the temp dir it starts in and the
  system temp dir, never the author's checkout.

History reads are `git -C <repo> show <sha>:<path>` and
`git -C <repo> grep <pattern> <sha> --`; scratch builds go in a temp dir
(`git -C <repo> archive <sha> | tar -x -C <dir>`), never in the author's checkout.

## Contract (send verbatim, with the placeholders filled)

> Read <draft>. You have no other context, on purpose. Repos and pinned shas: <rows>. Installed versions: <versions>.
> Check, by a DIFFERENT method than the draft's own:
> 1. every Evidence row — re-run or re-derive it at the pinned sha;
> 2. every claim about how a tool or library behaves — against its source at the installed version, not its help text;
> 3. every prescription (a code location, signature, export, output shape, text to write) — against the repo's agent instructions file, its ADRs and the nearest precedent in sibling code, and whether text the ticket tells the worker to write will be true where it lands;
> 4. every Verification command — does it exist at the sha (one whose target the ticket creates need not, but must then pass against a planted negative), run, and fail for the defect;
> 5. contradictions between Goal, Scope IN, Scope OUT, Acceptance and Verification, including a done-when that can never pass;
> 6. the laziest change that passes every Acceptance line — does it meet the Goal;
> 7. Files — `git grep` for every name or sentence the change makes false; list the hits the Files list lacks.
> Report defects only, numbered, each with the command and output that shows it or the two quoted lines that contradict each other. "A worker might stumble" is not a finding. Zero findings is a valid answer.

## Disposition

For each finding: fix it, reject it with the reason, or accept it as known
(and say so in the ticket if a worker could trip on it). Apply every fix in one
edit. Do not re-dispatch to confirm the fixes — but run any Verification line a
fix added or changed, as step 5 of the skill ran the rest.
