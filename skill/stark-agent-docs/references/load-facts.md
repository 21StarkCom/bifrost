# Load facts

How Claude Code and Codex load what you write, as of Claude Code 2.1.293 and
Codex 0.161.0. "Measured" marks a fact a live run showed; the rest come from
the vendors' docs. Loaders change between versions: where a fact here and a
live check disagree, the live check wins. bifrost's loader emulation
(`tools/rules_load_lib.ts`, behind `/stark-rules-optimizer`) holds the
measured model of globs, frontmatter and Codex budgets.

## CLAUDE.md and CLAUDE.local.md

- Every file in scope is concatenated, root first; CLAUDE.local.md follows
  CLAUDE.md in each directory. A nearer file does not override a farther one:
  when two lines conflict, the model picks either. Remove the conflict, or
  state in words which file wins.
- `@path` imports load at start-up with the file that imports them (up to four
  hops). They organise a file; they save no context.
- An import in a CLAUDE.md above the launch directory counts as external: a
  headless `claude -p` started in a subdirectory skipped `@AGENTS.md` from the
  repo root, silently (measured).
- Block-level HTML comments are stripped before Claude sees the file: notes
  for maintainers cost nothing.
- Each file arrives as a user message after the system prompt. Aim under 200
  lines; adherence drops as files grow.

## AGENTS.md and Codex

- Codex reads one file per directory, from the repo root down to the working
  directory (`AGENTS.override.md` before `AGENTS.md`), joined and capped at
  `project_doc_max_bytes`, 32 KiB by default. The file that crosses the cap is
  cut and every deeper file is dropped, so the most specific instructions go
  first. Codex has no imports.
- `~/.codex/config.toml` can change both: `project_doc_fallback_filenames`
  lets Codex read CLAUDE.md where a directory has no AGENTS.md, and
  `project_doc_max_bytes` moves the cap. Read the machine's config before you
  rely on either; a machine without them uses the defaults.
- Claude Code reads AGENTS.md itself only when no CLAUDE.md, .claude/CLAUDE.md
  or CLAUDE.local.md sits at or above the working directory; a personal
  CLAUDE.local.md switches that off.
- One source for both tools: AGENTS.md as a symlink to CLAUDE.md (the fleet's
  usual pairing; Claude edits the real file, and Claude-only notes move to an
  unscoped `.claude/rules` file Codex never reads), or AGENTS.md as the source
  with CLAUDE.md importing it by an `@AGENTS.md` line. The import misses
  sessions started in a subdirectory (above). A repo over Codex's cap keeps a
  short AGENTS.md index and says which file wins, as bifrost does.

## .claude/rules/

- `paths:` is the only key Claude Code reads. `globs:`, `alwaysApply:`,
  `applyTo:` and `description:` are ignored without an error, and so is
  frontmatter that does not parse: the rule then loads in every session.
- Globs follow gitignore rules, case-insensitive, relative to the directory
  that holds `.claude/`; a `./` prefix never matches. Quote each one.
- A scoped rule loads after Claude's first Read, Write or Edit of a matching
  file. The first write of a new matching file happens without it, and the
  model rewrites the file once the rule arrives (measured). A rule that must
  shape new files stays unscoped.
- After `/compact`, a scoped rule returns only when a matching file is touched
  again.
- A rule symlinked from outside the project waits for import approval, and
  then only the unscoped ones load.
- A Cursor `.mdc` file loads neither way: not through a `.claude/rules`
  symlink to it, nor through an `@import` of it (measured). Port the rule into
  its own `.md` file with `paths:`.

## Settings and hooks

- A project's `.claude/settings.json` (permissions, hooks) applies only when
  Claude starts in the directory that holds that `.claude/`. Started in a
  subdirectory, a session ran without the repo root's hooks (measured). A
  guard every session must obey belongs in a git hook or on the remote as
  well.

## Skills

- A model-invocable skill's description sits in every session's context.
  Write the conditions for using it ("Use when …"), not a summary of its
  steps: agents follow a summary instead of reading the body.
- `disable-model-invocation: true` costs no context; only a typed `/name`
  reaches the skill. On Codex the same skill is `$name`.

## Auto-memory

- Only the first 200 lines or 25 KB of MEMORY.md load at start-up, and recall
  shows a topic file's first 4 KB; `/stark-memory` measures both. The
  harness's own memory instructions define the format.

## Check what loaded

One headless run logs every instruction file Claude loads, and why:

```sh
log=$(mktemp); cfg=$(mktemp)
printf '{"hooks":{"InstructionsLoaded":[{"hooks":[{"type":"command","command":"(cat; echo) >> %s"}]}]}}' "$log" > "$cfg"
claude -p "Read <a file the rule covers>, then stop." --model haiku --max-turns 2 --settings "$cfg" </dev/null
jq -r '[.load_reason, .file_path, .trigger_file_path // ""] | @tsv' "$log"
```

`session_start` is a start-up load, `include` an import, and
`path_glob_match` a scoped rule with the file that triggered it. In an
interactive session `/context` lists the same files.

On Codex, `codex debug prompt-input </dev/null` prints the input the model
sees, AGENTS.md chain included, without a model call: grep it for a line you
wrote.
