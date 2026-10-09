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
- A CLAUDE.md below the launch directory loads later, once Claude reads or
  writes a file in its directory.
- `@path` imports load at start-up with the file that imports them (up to four
  hops). They organise a file; they save no context.
- An import in a project file counts as external when its target sits outside
  the launch directory. An interactive session asks once to approve it; a
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
  cut and every deeper file is dropped, so the most specific instructions are
  the first lost. Codex has no imports.
- `~/.codex/config.toml` can change both, and so can a `.codex/config.toml`
  inside a repo Codex trusts (measured): `project_doc_fallback_filenames`
  lets Codex read CLAUDE.md where a directory has no AGENTS.md, and
  `project_doc_max_bytes` moves the cap. Read both configs before you rely on
  either; without them Codex uses the defaults.
- Codex reads none of Claude's other homes: `.claude/rules`,
  `~/.claude/CLAUDE.md`, CLAUDE.local.md, auto-memory. Its personal file is
  `~/.codex/AGENTS.md`, and its only path scope is an AGENTS.md in that
  directory, read when Codex starts at or below it.
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
- A git hook guards only a clone that installed it, and `--no-verify` skips
  it. `.git/hooks` is not versioned: commit the hook and set `core.hooksPath`,
  or use the repo's hook manager. Only the remote's protection holds against
  the model itself.

## Skills

- A model-invocable skill's description sits in every session's context.
  Write the conditions for using it ("Use when …"), not a summary of its
  steps: agents follow a summary instead of reading the body.
- `disable-model-invocation: true` costs no context; only a typed `/name`
  reaches the skill. On Codex the same skill is `$name`.

## Auto-memory

- Only the first 200 lines or 25,000 characters of MEMORY.md load at start-up,
  and recall shows a topic file's first 200 lines or 4,096 bytes.
  `tools/memory_tidy.ts`, behind the operator's `/stark-memory`, measures
  both; its caps were read from the Claude Code binary, where the docs say
  25 KB and give no topic-file cap. The harness's own memory instructions
  define the format.

## Check what loaded

One headless run logs each CLAUDE.md and rule Claude loads, and why:

```sh
log=$(mktemp); cfg=$(mktemp)
printf '{"hooks":{"InstructionsLoaded":[{"hooks":[{"type":"command","command":"(cat; echo) >> %s"}]}]}}' "$log" > "$cfg"
claude -p "Read <a file the rule covers>, then stop." --model haiku --max-turns 2 --settings "$cfg" </dev/null
jq -r '[.load_reason, .file_path, .trigger_file_path // ""] | @tsv' "$log"
rm -f "$log" "$cfg"
```

`session_start` is a start-up load, `include` an import, `nested_traversal` a
subdirectory's CLAUDE.md and `path_glob_match` a scoped rule, each with the
file that triggered it, and `compact` a reload after compaction. In an
interactive session `/context` lists the same files.

An AGENTS.md that Claude reads directly fires no event, so it is missing from
this log even when it loaded. An interactive session prints
`no CLAUDE.md found; AGENTS.md loaded: <path>` instead.

On Codex, `codex debug prompt-input </dev/null | jq -r '.[].content[]?.text'`
prints the input the model sees, AGENTS.md chain included, without a model
call: grep it for a line you wrote.
