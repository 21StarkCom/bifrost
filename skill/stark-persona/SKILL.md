---
name: stark-persona
description: >-
  Assign a famous character persona for the session with weighted random selection. Use for persona, character, voice.
  /stark-persona.
disable-model-invocation: true
model: opus
revision: fefc4b333b06e7ec73b8bd0e396449f25f4dd359
revision_date: 2026-05-18T07:25:44Z
---

## Help

If `$ARGUMENTS` holds a standalone `--help`, `-h` or `help` token, follow
[standard help](../../standards/help.md), then stop.

# stark-persona

Session persona system: it picks a character persona for the session and shows
it in one `Persona:` line.

## Invocation

| Command | Behavior |
|---------|----------|
| `/stark-persona` | Weighted random pick |
| `/stark-persona "Name"` | Pick specific character |
| `/stark-persona --combo` | Mashup of 2-3 characters |
| `/stark-persona --off` | Deactivate persona |
| `/stark-persona --like` | Thumbs up current |
| `/stark-persona --hate` | Thumbs down current |
| `/stark-persona --survey` | Quick preference questions |
| `/stark-persona --add "Name" --from "Source" --traits "t1,t2"` | Add character |
| `/stark-persona --stats` | Inline summary |
| `/stark-persona --print-stats` | Full stats table |
| `/stark-persona --print-history` | Session history |
| `/stark-persona --print-roster` | All characters |
| `/stark-persona --print-weights` | Selection weights |

## Execution

Delegate all stateful operations to the TypeScript CLI:

```bash
node ${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/code-review}/tools/stark_persona.ts <subcommand> [args]
```

Parse the ARGUMENTS and map to the appropriate subcommand:
- No args or random → `select`
- `"Name"` → `select --name "Name"`
- `--combo` → `select --combo`
- `--auto` → `select --auto` (JSON output for stark-session)
- `--off` → `deactivate`
- `--like` → `rate --rating like`
- `--hate` → `rate --rating hate`
- `--survey` → `survey`
- `--add` → `add --name "..." --source "..." --traits "..."`
- `--stats` → `stats --format inline`
- `--print-stats` → `stats --format table`
- `--print-history` → `history`
- `--print-roster` → `print-roster`
- `--print-weights` → `print-weights`

After `select` returns persona data, print one line, the line that
stark-session prints: `Persona: {name} ({source}) — "{catchphrase}"`. Do not
change your voice.

A persona voice needs an exception in the root rules first: they write all text
to the operator in ASD-STE100.

## Deactivate

`/stark-persona --off` runs `deactivate`: `cmdDeactivate` in
`tools/stark_persona.ts` prints `Persona deactivated. Back to standard.` At
session end, stark-session runs `session-end` (`cmdSessionEnd`).
