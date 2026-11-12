# Gru's progress files

Read from [the Gru skill](../SKILL.md#progress-pane).

The `stark-progress` mod (`mods/stark-progress/`, its own install) shows your
run in the Gru pane beside your chat, from files under
`~/.cache/stark-progress/`: each ticket's stage and verdict (`moving`, `slow`,
`stalled`, `idle`, `held`, `blocked`, `done`), the tickets worth a look, a Log
tab of the big steps you and each Minion did, and the run's settings, which
the operator changes there. Its README is the contract. The
files are yours to write whether or not the
mod is installed, on either runtime; a write that fails costs one line and
never holds the run. Write each file but the log whole, to a `.tmp` beside it
renamed over it, as [the spine's command](../../../standards/worker-spine.md#progress-file)
does for a ticket's file; append to the log, and never rewrite it.

- **The run file**, `~/.cache/stark-progress/run-<launch id>.json`, the launch
  id being the epic's or valkyrie's `GRU-<n>`:
  `{"epic":"<STARK-epic, or the first ticket>","session":"<your session id>","tickets":["STARK-a",…],"titles":{"STARK-a":"<its title>",…},"maxWorkers":<N>,"minionAgent":"<agent>"}`,
  where `titles` holds each ticket's title as `alfred task show` gives it,
  so the pane names a ticket before its worker writes a file, and
  `maxWorkers` and `minionAgent` are your `--max-workers` and
  `--agent` (default 3 and `claude`).
  Your session id is `echo "$CLAUDE_CODE_SESSION_ID"` (`$CODEX_THREAD_ID` on
  Codex), run as its own command and pasted in. Write it with this one
  command, each ticket's id and then its title after `--args --`, in run order,
  each value quoted under
  [the spine's quoting rule](../../../standards/worker-spine.md#progress-file):

  ```
  mkdir -p ~/.cache/stark-progress && jq -n --arg epic '<STARK-epic, or the first ticket>' --arg session '<your session id>' --argjson maxWorkers <N> --arg minionAgent '<agent>' '($ARGS.positional | [range(0; length; 2) as $i | {key: .[$i], value: .[$i + 1]}]) as $t | {epic: $epic, session: $session, tickets: ($t | map(.key)), titles: ($t | from_entries), maxWorkers: $maxWorkers, minionAgent: $minionAgent}' --args -- 'STARK-a' '<title of STARK-a>' 'STARK-b' '<title of STARK-b>' > ~/.cache/stark-progress/run-<launch id>.json.tmp && mv ~/.cache/stark-progress/run-<launch id>.json.tmp ~/.cache/stark-progress/run-<launch id>.json
  ```

  Step 1 writes it, a split rewrites it, and step 6 deletes it.
- **The settings file**, `~/.cache/stark-progress/run-<launch id>.settings.json`,
  is the operator's: the pane's Settings tab writes it, and you never do.
  Read it with `cat` before each launch (step 3) and before each scope change
  (step 1). A missing or unparsable file, or a field that is absent or of the
  wrong type, means the run file's value. The run file holds neither
  `followUps` nor `decideForMe`, so each such case means true for them.
  - `maxWorkers` (1 to 8) is N.
  - `minionAgent` (`claude` or `codex`) is the agent of each first launch. A
    relaunch keeps the agent it had.
  - `followUps` (default true): true lets a ticket a Minion files, on a
    `follow-up … stopping` report too, join the run. False leaves it on the
    board, named in step 6's report; a ticket that waits on it stays blocked.
  - `decideForMe` (default true): true lets you file a split and add a
    ticket that joins by a `Blocked by` link or a named dependency. False
    stamps the ticket that needs the choice `blocked`, does not launch it, and
    names the choice in step 6's report. A later read that finds it true takes
    the choice as step 1 says.

  Step 6 deletes it with the run file.
- **A ticket's file**, `~/.cache/stark-progress/<STARK-n>.json`, is its
  worker's to write, with two stamps of yours, each the ticket's title and PR
  url (`pr` empty while it has none) written by
  [the spine's command](../../../standards/worker-spine.md#progress-file) under
  its quoting rule, never as JSON you assemble yourself: a `"` in the title
  would leave a file the mod cannot parse, drawn as `ticket` and left out of
  the closed count. The stamps: `blocked` on a `blocked` or
  `follow-up … stopping` report (step 4), and `closed` once you confirm the
  ticket finished (step 5). The `closed` stamp is what counts a ticket no
  worker writes for: a ticket step 2 finds closed already has none. A stamp
  writes your own folder as `worktree`; the mod reads git only in a folder
  named for the ticket, so it skips yours. A stamp leaves `hold` empty.
  A ticket whose file has `hold` set reads as worth a look on your pane:
  `held by its settings: <merge or release>`.
- **The run's log**, `~/.cache/stark-progress/run-<launch id>.log.jsonl`,
  feeds the pane's Log tab beside each ticket's own log, which its worker
  keeps by [the spine's log file](../../../standards/worker-spine.md#log-file).
  Append one line at each big step of yours: the start (step 1), each
  launch (step 3), each ticket that joins or splits (step 1), each block
  (step 4), and each confirmed `done` (step 5). Use the spine's command with
  the run's file in place of the ticket's, under its rules for a line:
  plain words a five-year-old can follow, 20 words or fewer, and no ids.
  Name a ticket by what it does: "Sent a helper to make the board show each
  step." Your stamps on a ticket's file append nothing to that ticket's log.
  Step 6 deletes the run's log with the run file.
- **A ticket's settings file**, `~/.cache/stark-progress/<STARK-n>.settings.json`,
  is the operator's, written in the ticket pane of the Minion's tab. Its
  Minion reads it ([the spine's ticket settings](../../../standards/worker-spine.md#ticket-settings))
  and deletes it at the close; you never write it, and step 6 deletes what
  is left of the run's.
