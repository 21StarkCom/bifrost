# Positional help safety audit

STARK-8083, under STARK-8000. Source baseline:
`cde181158bbd38a8aff12486985fb6dbbeb6b046` (2026-09-20).
Inventory: tracked executable modes, shebangs, Go mains and source paths.
One owned binary (`engine/cmd/stark`), fourteen authored commands, Cobra's
generated help/completion tree, and four executable shell helpers. No additional
owned tools, examples, service mains or executable entrypoints were found.

## Findings and checked negatives

The baseline column records source inspection, not a production reproduction.
No suspect mutating invocation was run against an operator checkout or backend.
All operational rows now return recognizable route help before their handler.
The matrix includes nonzero refusals; a successful exit or nonempty output alone
is never considered proof of help.

| Route | Baseline bare-word behavior | Safe check after fix |
| --- | --- | --- |
| `build` | Treats help as catalog path; can generate files | `build --fix help --check`: help |
| `sync` | Treats help as destination with --from; without it refuses | `sync --from missing help --check`: help |
| `import` | Ignores positional; can scaffold with required flags; otherwise refuses | `import --from missing help --dry-run`: help |
| `install` | Treats help as bundle; runtime/index may refuse first | `install help --plan`: help |
| `install --repair` | Ignores help and reaches recovery | `install --repair help --plan --yes`: help |
| `install --remove` | Ignores help and reaches removal | `install --remove missing.json help --force`: help |
| `validate` | Reads catalog named help; absent path refuses | `validate help`: help |
| `lint` | Reads catalog named help; absent path refuses | `lint help`: help |
| `check-bumps` | Reads catalog named help; absent path refuses | `check-bumps help`: help |
| `info` | Reads index then looks up reference help | `info help`: help |
| `verify-manifest` | Reads help as manifest; valid file can launch cosign | `verify-manifest help`: help, no cosign |
| `allowlist` | Ignores help; generates/checks allowlist | `allowlist help`: help |
| `doctor` | Ignores help; audits destination and launches node | `doctor help`: help, no node |
| `version` | Ignores help; prints version | `version help`: help |
| `self-update` | Ignores help; reads optional index, prints update instructions (no updater) | `self-update help`: help |
| `search` | Free-text query help, deliberate read-only data | Preserved; flags before/after query parsed |
| root / `help <topic>` | Cobra help dispatch, already safe | Existing rendering/topic tests plus built root help |
| `completion` | Parent already prints help | Built parent help |
| `completion bash`, `zsh`, `fish`, `powershell` | Cobra NoArgs refuses help without generating code | Each now prints route help |
| `__complete`, `__completeNoDesc` | Shell completion protocol, partial arguments are data | Deliberately retain Cobra protocol; no application handlers |
| `docs/scripts/publish.sh` | Bare help safely refused (2); loop did not drop later flags | `--ci help`, `help --ci`: the full header block, printed with bash builtins (no `sed`), before subprocesses |
| `docs/scripts/coverage-gate.sh` | Reads checkout help; ignores subsequent arguments | Bare help now prints usage; unknown trailing flags refuse (2) with the file's documented `ERROR:` prefix |
| `docs/scripts/ci-local.sh` | Ignores all arguments, starts Go/secret/workflow checks | Help returns usage; unknown arguments refuse (2) |
| `docs/scripts/verify-native-install.sh` | Ignores all arguments, starts git/build/temp-file operations | Help returns usage; unknown arguments refuse (2) |

Cobra/pflag interspersed parsing already retained trailing flags: no CLI
flag-dropping defect was found. Tests cover every operational command's declared
flags both before and after help, with backend and pre-run tripwires. The three
argument-ignoring shell scripts were vulnerable to ignoring trailing flags;
they now parse or reject the entire argument list before doing work. Publish's
loop already rejected unknown arguments; its help recognition now also waits
until all arguments are validated.

## Boundaries and malformed inputs

The CLI guard consumes parsed positionals, using pflag's `ArgsLenAtDash`; it
never scans raw flag values. `sync --from help` and `--from=help` retain their
literal flag value. `build -- help` and `build ./help` retain literal paths.
`search help --json` and `search --json help` retain the free-text query.
No owned CLI route forwards a child command; Cobra completion's protocol tail
is the explicit data exception.

Unknown flags, missing values and invalid booleans still fail before hooks,
including `build help --unknown`, `build --unknown help`,
`sync help --from` and `install help --plan=invalid`.
Shell help with unknown flags or missing publish option values exits 2 without
subprocesses. Publish option values equal to help remain names; a separate help
token requests usage. Coverage accepts `-- help` or `./help` for a literal
checkout. Its normal checkout argument and environment fallback are preserved.

## Verification and scope

`go test ./cmd/stark -run 'TestPositionalHelp|TestBuiltEntrypointHelpSafety' -count=1 -v`
runs parser/hook tripwires and builds the real shipping binary. The process
matrix invokes it and every `docs/scripts/*.sh` — globbed, not named, so a fifth
script cannot be added outside the gate — with a fixed four-variable environment
(no inheritance), isolated home/cwd, command tripwires, timeouts and before/after
file/directory snapshots. Each help case asserts a usage page; refusals assert
nonzero status. Both tests carry a floor on the number of routes and invocations
they actually ran, so a walk or glob that came back empty fails rather than
reporting a green pass over nothing. No production credentials, installs,
publishing or network operations are needed. Normal coverage-gate fixtures and existing command,
install and rendering tests remain in `go test ./... -count=1`.

Generated `catalog/*/{skills,commands}`, `vendor/stark-skills`, `vendor/plugins`,
`vendor/runtime-overrides/codex`, and packaged `dist/**` are excluded as runtime
copies whose behavior is owned by stark-skills, per AGENTS.md. Curated MCP JSON,
bundle metadata, schemas and GitHub workflow inline steps are configuration,
not separately invokable CLI entrypoints. The vendored stark-tui packages are
libraries owned upstream, not additional binaries. This audit does not claim
those upstream repositories are safe; their audit belongs to their own slice.
