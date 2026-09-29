# Dev Docs Management System

A lightweight standard for engineering teams who want their AI code reviews to actually understand the code — and want their docs to stop going stale unnoticed.

This isn't a documentation process. It's a pipeline that connects your design decisions to your code reviews through a spec link on every PR.

---

## What You Get

- A spec link on every PR, so a reviewer, human or AI, can read the intent before the diff
- A PR template that takes 2 seconds to fill out and makes reviews 10x more useful
- Stale doc detection on every PR (warns, never blocks)
- ADRs that explain the "why" behind surprising choices — permanently
- One command to set up the full structure in any repo

---

## The Pipeline

```mermaid
flowchart LR
    A[Brainstorm] --> B[Spec]
    B --> C[AI Spec Review]
    C --> D[Code]
    D --> E[PR]
    E --> F[Code Review\n spec linked]
```

The spec link in the PR description is what closes the loop: it is what a reviewer should read before saying a word about the code. Nothing here fetches it automatically; give it to your reviewer, or point your review prompt at it.

---

## How to Adopt

**New repo — scaffold the structure:**

```
/stark-init-docs --template
```

Creates the directory layout, ADR template, PR template, mkdocs.yml, and staleness config. No content generated. Safe to run on existing repos — idempotent.

**Existing repo — generate docs from history:**

```
/stark-init-docs --backfill
```

Reads git log and merged PRs. Infers ADRs from technology choices, drafts specs from significant PRs, generates guides from CI configs and scripts. Commits everything.

**Existing docs — migrate into the standard layout:**

```
/stark-init-docs --upgrade
```

Scans for docs anywhere in the repo, classifies and moves them into the standard structure using `git mv` to preserve history.

---

## Repo Structure

After running `/stark-init-docs --template`, you get:

```
docs/
  specs/          # YYYY-MM-DD-slug-spec.md — intent + the task DAG that builds it
  retros/         # YYYY-MM-DD-slug-retro.md
  adr/            # NNNN-slug.md (immutable once accepted)
  guides/         # living how-to docs and runbooks
  reference/      # API docs, config reference
  architecture/   # system diagrams, C4 models
mkdocs.yml
.github/pull_request_template.md
.doc-staleness.yml
```

---

## Templates

- [Pull Request Template](templates/pull_request_template.md) — one field: the spec link
- [ADR Template](templates/adr-template.md) — context, decision, alternatives, consequences

---

## What Gets Checked for Staleness

The GitHub Action runs on every PR and warns (never blocks) when living docs haven't been touched in 3+ months.

Checked: `guides/`, `reference/`, `architecture/`
Skipped: `adr/` (immutable), `specs/`, `retros/` (point-in-time artifacts)

Configure the threshold in `.doc-staleness.yml`.

---

## What This Is Not

It doesn't replace Confluence for cross-functional or compliance docs. It doesn't enforce docs via hard CI gates. It doesn't add a review process — it makes the review process you already have much better.
