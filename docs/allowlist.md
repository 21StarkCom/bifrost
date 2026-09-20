# MCP command + agent.tools allowlists

Auto-generated from `engine/internal/validate/allowlist.go` and `engine/internal/validate/toolsallow.go`. **Do not hand-edit** — run `stark allowlist > docs/allowlist.md` after touching either source file (CI fails closed otherwise).

Governance: adding an entry takes a PR touching only the allowlist file, with a written justification and maintainer (`@aryeh-stark`) review. CODEOWNERS names the reviewer but is not an enforced merge gate today. See [`SECURITY.md` §2](SECURITY.md).

## MCP `command` allowlist

MCP `command` values must be a basename present here. Every entry widens the set of binaries an MCP server may spawn on a developer's machine.

| Command |
| --- |
| `brain` |
| `node` |
| `npx` |
| `uvx` |

## `agent.tools` allowlist

Tool grants on `agent` artifacts are surfaced for install-time consent. Unknown grants emit a `stark validate` warning (not a hard error) so reviewers see them in PR output.

| Tool |
| --- |
| `Bash` |
| `Edit` |
| `Glob` |
| `Grep` |
| `NotebookEdit` |
| `Read` |
| `Task` |
| `TodoWrite` |
| `WebFetch` |
| `WebSearch` |
| `Write` |
