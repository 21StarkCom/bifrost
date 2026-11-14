# The Super-Gru run file

Read from [the Super-Gru skill](../SKILL.md#the-run-file).

`~/.cache/stark-progress/super-<launch id>.json` is the state of one Super-Gru
run. `<launch id>` is `SUPER-<n>`, `<n>` the number of the first epic.
Super-Gru writes it; the pane and the launcher only read it.

## The shape

The file holds these fields, and no other field:

- `session`: the session id of Super-Gru.
- `epics`: the epics, in the order of the `start` list.
- `grus`: one object for each epic, keyed by the epic:
  - `launch`: the Gru's launch id (the epic), or null while `queued`.
  - `session`: the Gru's session id from the launch ack, or null.
  - `state`: `queued`, `live`, `reported` or `ended`.
- `settings`: `maxWorkers`, `parallel`, `minionAgent`, `followUps` and
  `decideForMe`.

Example:

```json
{
  "session": "6f1c2a9e-0b7d-4c55-9e1a-3d2f8a7b4c10",
  "epics": ["STARK-100", "STARK-200"],
  "grus": {
    "STARK-100": {"launch": "STARK-100", "session": "a3e9d0f2-55c1-4b8e-8f2a-1c7d9e6b3a44", "state": "live"},
    "STARK-200": {"launch": null, "session": null, "state": "queued"}
  },
  "settings": {"maxWorkers": 4, "parallel": 1, "minionAgent": "claude", "followUps": true, "decideForMe": true}
}
```

## The writes

Each write goes to a temp file and renames it over the old one, so a reader
never sees half a file. Quote each value by
[the spine's rule](../../../standards/worker-spine.md#progress-file).

The first write, at step 1, with each epic `queued`:

```
jq -n --arg session '<your session id>' --argjson maxWorkers 4 --argjson parallel 1 --arg minionAgent 'claude' '$ARGS.positional as $e | {session: $session, epics: $e, grus: ($e | map({key: ., value: {launch: null, session: null, state: "queued"}}) | from_entries), settings: {maxWorkers: $maxWorkers, parallel: $parallel, minionAgent: $minionAgent, followUps: true, decideForMe: true}}' --args -- 'STARK-100' 'STARK-200' > ~/.cache/stark-progress/super-SUPER-100.json.tmp && mv ~/.cache/stark-progress/super-SUPER-100.json.tmp ~/.cache/stark-progress/super-SUPER-100.json
```

A change of one Gru's entry, from the file you read:

```
jq --arg e 'STARK-100' --arg s '<Gru session id>' --arg st 'live' '.grus[$e] = {launch: $e, session: $s, state: $st}' ~/.cache/stark-progress/super-SUPER-100.json > ~/.cache/stark-progress/super-SUPER-100.json.tmp && mv ~/.cache/stark-progress/super-SUPER-100.json.tmp ~/.cache/stark-progress/super-SUPER-100.json
```

A rerun of `start` in a new session, from the file you read, before any
other write:

```
jq --arg s '<your session id>' '.session = $s' ~/.cache/stark-progress/super-SUPER-100.json > ~/.cache/stark-progress/super-SUPER-100.json.tmp && mv ~/.cache/stark-progress/super-SUPER-100.json.tmp ~/.cache/stark-progress/super-SUPER-100.json
```

## The settings file of each epic

Before each Gru starts, write its settings file. The Gru reads it before each
launch, by [its progress-pane doc](../../gru/references/progress-pane.md).
Put in `maxWorkers`, `followUps` and `decideForMe` as the skill's step 3 read
them:

```
jq -n --argjson maxWorkers 4 --argjson followUps true --argjson decideForMe true --arg minionAgent 'claude' '{maxWorkers: $maxWorkers, followUps: $followUps, decideForMe: $decideForMe, minionAgent: $minionAgent}' > ~/.cache/stark-progress/run-STARK-100.settings.json.tmp && mv ~/.cache/stark-progress/run-STARK-100.settings.json.tmp ~/.cache/stark-progress/run-STARK-100.settings.json
```

## The log file

`~/.cache/stark-progress/super-<launch id>.log.jsonl` holds your big steps,
one JSON line each, as [the skill's log rule](../SKILL.md#the-log) lists
them. The pane's Log tab shows them beside each Gru's own log. Append a line
with the spine's log command, with this file in place of the ticket's:

```
mkdir -p ~/.cache/stark-progress && jq -nc --arg text '<the step, in plain words>' '{at: (now | todate), text: $text}' >> ~/.cache/stark-progress/super-SUPER-100.log.jsonl
```

Write each line by [the spine's rules for a line](../../../standards/worker-spine.md#log-file):
plain words a five-year-old can follow, 20 words or fewer, and no ids. Name
an epic by what it does: "Started the Gru for the video work." or "The Gru
for the video work finished: 12 of 12 jobs done."
