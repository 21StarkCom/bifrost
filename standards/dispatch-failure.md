# Multi-Agent Dispatch Failure Handling

Shared semantics for any skill that dispatches review domains and gets a
round back with no usable findings. Skills point here instead of inlining
identical §2d blocks.

## Health check (run after every dispatch round)

Count the agents that succeeded out of those dispatched. Each dispatcher
reports it in its own shape: `iac_review.ts --json` lists one
`agent_runs[]` entry per agent with an `ok` flag, and exits 3 when none
succeeded.

| Condition | Meaning | Action |
|-----------|---------|--------|
| `succeeded == 0` | Dispatch failure — every sub-agent failed. | Treat as **failure**, NOT a clean review. Run diagnostics, skip any remaining rounds, and report with the dispatch-failure summary below. |
| `succeeded > 0` AND `succeeded / dispatched < 0.5` | Low coverage. | Print `Low coverage — only N/M sub-agents succeeded. Results may be incomplete.` Continue normally. |
| `succeeded > 0` AND coverage healthy | Normal. | Proceed with finding classification. |

Zero findings is **only** "clean" when dispatch was healthy. A dispatch
failure that returns zero findings is a failure, not a pass.

## Diagnostics (when `succeeded == 0`)

```bash
which claude codex gemini
```

Then re-run the same dispatch restricted to one agent (for example,
`iac_review.ts … --agents codex`). The single-agent probe isolates
whether the failure is per-agent (one CLI broken / unauthenticated) or
systemic (all CLIs missing, network down).

## Dispatch-failure summary template

When reporting a dispatch failure, use this header instead of the normal
summary:

```markdown
## {Doc} Review — Dispatch Failure

**File:** {path}
**Status:** Review could not complete — {succeeded}/{total} sub-agents succeeded.

### Error Details
| Agent | Domain | Error | Stderr (truncated) |
|-------|--------|-------|-------------------|

### Diagnostics
- CLI availability: claude={yes/no}, codex={yes/no}, gemini={yes/no}
- Single-agent probe: {result}

### Recommendation
{e.g., "Check API keys/auth", "CLI not installed", "Network issue"}
```

Replace `{Doc}` with what was reviewed (for example, `Terraform`).
