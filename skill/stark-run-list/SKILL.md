---
name: stark-run-list
runtimes:
  - claude
  - codex
description: "Use when the operator asks for a Slack List of a Gru or Super-Gru run, or to stop the sync of one: one row for each epic and each ticket, kept current until the run ends."
argument-hint: "[<SUPER-n | STARK-n | GRU-n>] [--name <text>] | stop <run id>"
---

## Help

If `$ARGUMENTS` contains a standalone `--help`, `-h`, or `help`,
follow [standard help](../../standards/help.md), then stop.

# stark-run-list

Make a Slack List that mirrors one Gru or Super-Gru run, and start its sync.
The List has one row for each epic and each ticket, with the columns Ticket,
Done, Status, Kind, Epic, PR and Notes. A watcher process syncs it each 2
minutes from the run's files in `~/.cache/stark-progress` and from alfred. The
watcher ends by itself after the run file is gone, with one last sync. It only
reads the run's files, so Gru and Super-Gru change no step for it.

`tools/run_list.ts` does the work. Its `--help` gives each verb and file.

## Arguments

- `<run id>`: `SUPER-n` for a Super-Gru run, `STARK-n` or `GRU-n` for a Gru
  run: the launch id in the name of its run file. With none, use the run of
  this session (step 1).
- `--name <text>`: the name of the List.
- `stop <run id>`: stop the watcher of that run, then report.

## Steps

```bash
TOOLS="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools"
```

For `stop <run id>`, run `node "$TOOLS/run_list.ts" stop <run id>`, report
its line, and stop. Else:

1. **Find the run.** With no run id, find the run file in
   `~/.cache/stark-progress` (`super-*.json` or `run-*.json`, not
   `*.settings.json` or `*.stats.json`) whose `session` is this session's id
   (`$CLAUDE_CODE_SESSION_ID`, or `$CODEX_THREAD_ID` on Codex). With no match,
   stop and ask for the run id.
2. **List the children.** For a `SUPER-n` run, call alfred's `list_children`
   tool once for each epic in the run file's `epics`. Write a JSON map of each
   epic to the `custom_id` of each child to a file under `mktemp -d`:
   `{"STARK-100": ["STARK-101", "STARK-102"]}`. A Gru run needs no file: its
   run file names its tickets.
3. **Pick the name.** Use `--name` when the operator gave one. Else name the
   theme of the epics in a few words, then `run (Super-Gru)` or `run (Gru)`:
   `AWS parity run (Super-Gru)`.
4. **Start it** from inside a git checkout, since alfred needs one:

   ```bash
   node "$TOOLS/run_list.ts" start <run id> --name '<name>' [--children <file>]
   ```

   It makes the List, shares it with the operator's Slack user, prints its
   URL, and starts the watcher. A second `start` on the same run uses the same
   List, adds the children of a new `--children` file, and starts a watcher
   only when none runs. The first sync adds one row about each 3 seconds, for
   Slack's rate limit.
5. **Report** the List URL, the watcher's pid and its log path from the
   output.

## Traps

- The List writes go through `frigg invoke` as the bot. When `start` prints
  `not shared`, the read token is not a user's: the operator cannot open the
  List until it is shared.
- The tool makes no view. The List shows Slack's default views; a view
  grouped by Epic is one the operator makes in Slack.
- A rename of a choice or of the List in Slack stays: a sync writes only the
  Done, Status, PR and Notes cells.
