---
name: stark-bury
runtimes:
  - claude
  - codex
description: >-
  Use when retiring 21Stark code into the Náströnd graveyard: burying a
  subsystem of a living repo or retiring a whole repo ("bury X", "retire the
  <feature>", "tombstone", "exhume"). Runs the footprint check, interment PR,
  deletion PR, and an optional sealed dump and table drop.
argument-hint: "[corpse — the subsystem or repo to bury]"
disable-model-invocation: true
model: opus[1m]
---

## Help

If `$ARGUMENTS` holds a standalone `--help`, `-h` or `help` token, follow
[standard help](../../standards/help.md), then stop.

# stark-bury — the Náströnd burial ritual

The graveyard is **`21StarkCom/nastrond`**, local at `~/Code/21Stark/nastrond/`.
Its README is the constitution; `TOMBSTONE.template.md` is the death
certificate; `INDEX.md` is the registry of the dead. Read all three before the
first shovel of dirt.

**The laws (non-negotiable):**

1. **Bury before delete.** The nastrond interment PR merges before any code
   leaves the living repo.
2. **The dead stay dead.** Never import from nastrond. Exhumation is a
   deliberate copy back into a living repo.
3. **The living repo stays green.** The deletion PR passes build + vet + lint +
   tests before merge.
4. **Irreversible steps need the operator's GO.** Dropping live tables and
   deleting live secrets are writes you cannot undo. Make a sealed dump before
   a drop.
5. **Never commit** a raw `.bundle`, an unencrypted sensitive dump, or an age
   private identity. The private identity lives only in the Mímir vault.

## Phase 0 — preflight

- If the corpse still runs live (cron on, tokens active), turn it off first,
  and disable its tokens at the vendor. A token write in Mímir is a secret
  write: it needs the operator's GO. Disabling is not burying, but nothing is
  buried while it still runs.
- Open one ticket for the burial with `/stark-ticket`, because it spans two
  PRs. Each PR title is `type(STARK-<n>): subject`.

## Phase 1 — verify the footprint

Verify each file's ownership by imports, never by name, whoever gave the list:
a matching filename can belong to a different living subsystem.

For every candidate file:

- **Classify by imports and symbols, not filenames:** what it imports, and
  who imports it.
- A candidate that living code imports is not part of the corpse. Leave it,
  and say so in the tombstone.
- Sweep for the corpse's hidden limbs in shared files: the binary's `main.go`
  wiring, config structs + env loads, job/rule registries, **metrics
  registrations** (the classic miss), alert rules (all copies), deploy/startup
  env, provisioning scripts, docs, per-package CLAUDE.md files, CHANGELOG.
- Dispatch a read-only subagent for the import/entanglement map when the
  corpse is more than a few files; verify its claims against the code.

## Phase 2 — interment (nastrond PR #1)

1. Dig `graves/<repo>/<corpse>/{code,data,backups}/` — the `<repo>/` plot on
   its first corpse, a fresh `<corpse>/` grave (kebab-case slug) every burial.
   A repo can die many deaths; graves are never shared or reused.
2. Copy the dedicated source **verbatim** into `code/`, preserving original
   paths so the snapshot reads coherently. Include tests, the feature's own
   docs (runbooks/specs/plans), and the schema DDL that defined its tables —
   carved into a self-contained `.sql` when the source migration is a shared
   baseline that must not be edited.
3. Write `TOMBSTONE.md` from the template. `cause_of_death` says why it was
   killed, and "What it was" says why it existed. Record footprint
   corrections.
4. Append one row to `INDEX.md`.
5. PR via `ghx pr-open` → merge. The grave is filled.

## Phase 3 — deletion (living-repo PR #2)

1. `git rm` the verified dedicated files (code + tests + feature docs).
2. Unwire the shared files found in Phase 1. Remove the corpse's metrics,
   alerts, env defaults, config fields, registry entries, CLAUDE.md sections.
3. **Split by what each artifact follows.** Code docs follow the code: delete
   them here. Schema docs, `layers.yml` entries and migration history follow
   the schema: they leave only with a drop migration, never before.
4. Checks: build, vet, lint and the affected tests pass, then PR → merge. Add
   a CHANGELOG bullet when the repo keeps one.

## Phase 4 — the data (optional, gated)

- Rows worth remembering: `pg_dump` the corpse's tables, **age-seal** anything
  sensitive (`age -R ~/Code/21Stark/nastrond/.age-recipients -o
  graves/<repo>/<corpse>/data/<name>-YYYY-MM-DD.sql.age <dump>.sql`), commit only the
  `.age` file, shred the plaintext. Conversation transcripts and personal data
  are sensitive.
- Dropping the live tables is a separate, operator-gated decision: sealed dump
  first, then a forward DROP migration in the living repo (FK dependency
  order), taking the schema-docs + `layers.yml` entries with it.
- Before relying on the seal, verify the grave is openable: the private
  identity must be in Mímir and must decrypt the sealed artifact.

## Full retirement (whole repo dies)

`git bundle create /tmp/<repo>.bundle --all` in the dead repo → age-seal it to
`graves/<repo>/<repo>/backups/<repo>.bundle.age` (a full retirement is the plot's last grave, slugged after the repo itself) → delete the plaintext bundle →
tombstone + INDEX row → archive the GitHub repo. A full history holds every
secret ever committed: never commit the bundle raw.

## Exhume

Reverse deliberately: copy `code/` back, re-wire using the deletion PR's diff
as the map, replay the interred DDL or decrypt the sealed dump
(`age -d -i <mimir-identity> …sql.age | psql`), un-park credentials, re-enable.
