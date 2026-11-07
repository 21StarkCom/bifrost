# The review method

How to review one agent file clause by clause. The
[playbook](../../stark-agent-docs/references/playbook.md) is the standard, and
the [glossary](../../stark-agent-docs/references/glossary.md) holds its terms.
Read both first. Where this file and the playbook differ, the playbook wins.

## Split the file into clauses

- A clause is one bullet, one table row, or one paragraph. A sub-bullet is a
  clause of its own.
- A heading is no clause. A code block belongs to the clause before it.
- A SKILL.md frontmatter `description:` is one clause, a RULE with the
  budget of a skill `description:`. Other frontmatter is no clause.
- Count each clause. A clause with no YELLOW or RED flag counts as GREEN.

## Type and flag each clause

Do these steps for each clause:

1. Give it the type of the playbook row it fits. A clause that fits two rows
   takes the row with the worse flag.
2. Flag it by that row. A line is 100 chars of text, whatever the wrap: a
   TRAP over 200 chars is over two lines.
3. Read it against each file above it in the order of precedence. A clause
   that contradicts a higher clause is RED, whatever its type, with the type
   `CONFLICT`. A nested AGENTS.md that overrides its root inside its own folder
   is Codex's precedence, not a conflict. A package CLAUDE.md and a rule have
   one level, so the CLAUDE.md of a package folder above is a sibling: a copy
   of its clause is a YELLOW DUPLICATE.
4. Check each glossary term in it: operator, GO, gate, kept gate, spine,
   worker, ticket bar, live proof. A term used in a meaning from its "Do not
   use it for" column is a vague RULE, YELLOW.
5. Check each tool, file, flag or command it names, by
   [the next section](#check-what-a-clause-names).

A triage clause from `triage.json` is a clause you flag again: read it, keep
its flag when the playbook row holds, and change it when it does not. A gate
phrase in a kept gate, or in a step that needs a person's own grant, is GREEN.

## Check what a clause names

A clause that names a tool, file, flag or command that is gone is RED: a stale
TRAP, or a dead POINTER. Check the name before you flag it:

- **A path:** `ls` it from the repo root and from the file's folder. A tag, an
  example, a runtime artifact or a file of another repo is no dead path.
- **A command or flag:** run the binary's help (`<bin> <cmd> -h`, or
  `go run ./cmd/<bin> <cmd> -h` in the repo), and compare. Run help only,
  never a verb that acts.
- **An env var or symbol:** grep the repo and the dependency that defines it.
  For Go, `go list -m -f '{{.Dir}}' <module>` finds the module source. For
  Node, read `node_modules/<pkg>`. Flag only a name that no source defines.

## The load audit

Each `findings[]` and `candidates[]` item of `audit.json` is a candidate at its
`file:line`. Check it, then type it, or drop it:

| Item | Type and flag |
|---|---|
| `staleness` finding; `path`, `bare-file` or `identifier` candidate | Check the name as the section above says. A gone name is a TRAP or POINTER, RED. Drop the rest. |
| `load-scope` finding | `LOAD`: RED when its `severity` is `high`, YELLOW for the rest. |
| `size-budget` finding | The triage `SIZE` clause takes its place. A Codex cut (its summary names the 32 KiB cap) is `LOAD`, RED. |
| `duplicate`, `narrative` or `gate` candidate | Read it as a triage clause of type DUPLICATE, HISTORY or GATE. |
| `frontmatter` candidate | `LOAD`, YELLOW. The redline is a live check of the rule's scope. |

## Write the entry

Start each file with its header and its summary line, in exactly this form:

```
## Agent-doc review: tyr/gcp/run/CLAUDE.md
Size 7.9k / 10k · loads on demand · GREEN 25 · YELLOW 14 · RED 3
```

Then write one entry for each YELLOW and RED clause:

```
### RED 1 · CONFLICT · tyr/CLAUDE.md:38
Clause: "Ship straight to `main`."
Playbook: a clause that contradicts root is RED. Root :98 "Never commit or push to a default branch directly".
Redline: delete the clause.
Fallback: none (Tier 1).
```

- **The header** is the flag and its number, the type, and `path:line`.
  - The type is the playbook's clause type (`MEMORY NOTE` included), `SIZE`
    for a size budget, `LOAD` for a load audit item, or `CONFLICT`.
  - The path is the repo name and the path in the repo: `tyr/CLAUDE.md`. A
    memory path starts at `~/.claude/projects/`. Write the full path in each
    header, never a bare `:n`.
  - The line is the first line of the clause, or a range (`130-272`) for a
    long clause.
- **Clause:** the clause in double quotes. For a clause over two lines, write
  a short description and its size: "a list of 14 packages, 12k chars".
- **Playbook:** the playbook rule in its own words, and the evidence: the
  higher clause as `path:line "quote"`, the glossary row, or the `ls` or help
  output.
- **Redline:** the exact new text, or "delete the clause". A redline keeps
  each fact that is still true, or names where the fact goes.
- **Fallback:** the second position, such as "move to `docs/<path>` behind
  one pointer". Write "none (Tier 1)" for a RED with no second position.

The standard redline of each type:

| Type | Redline |
|---|---|
| RULE | Split two rules into two clauses. Make a vague rule checkable. Drop the capitals. |
| TRAP | Put the fact and the safe action first, in two lines at most. Delete a stale trap. |
| POINTER | Point at the path that exists, or delete the pointer. |
| GATE | Rewrite it so that the agent takes the step. |
| SCOPE | Delete the added work. |
| GROWTH | Delete the clause. |
| HISTORY | Keep the rule, and delete the story, the ticket id or the date. |
| REFERENCE | Keep a one-line pointer, and move the catalog to `docs/`. |
| DUPLICATE | Keep one copy, in the narrowest file that each reader loads. Delete the others. |
| SIZE | Name the clauses to move out first: the REFERENCE and HISTORY clauses. |
| MEMORY NOTE | Rewrite the note to agree with the instruction file, or delete it. Write "never" or "always" only in the operator's words. |
| CONFLICT | Delete the clause, or rewrite it to agree with the higher clause. |
| LOAD | Narrow or anchor the glob, fix the import, or name the live check. |

The load words of a file's summary line come from `audit.json`: `always` is
"loads at start-up", `on-demand` is "loads on demand", and `never` is "never
loads". A `MEMORY.md` loads at start-up. A memory note and a SKILL.md body
load on demand.

## The brief

Give each subagent that reviews a batch this brief, with each path filled in
as an absolute path:

> Review these agent files clause by clause. Do not edit a file, and run no
> command that writes: `ls`, `grep` and help commands are fine. Files:
> {the batch}.
>
> First read these whole: the playbook {path}, the glossary {path}, the
> review method {path of this file}, the files above the batch in the order
> of precedence {paths}, and the siblings of each file {paths}. Each file
> loads {at start-up, on demand or never}: {the list}.
>
> The triage clauses of these files are in {triage.json}, keyed by `path`.
> The load audit items are in {audit.json}, keyed by `file`. Follow the
> review method.
>
> Return, for each file: its `## Agent-doc review: {path}` header, its
> summary line in the form of the method, and one entry for each YELLOW and
> RED clause, RED first, in the entry form of the method.
