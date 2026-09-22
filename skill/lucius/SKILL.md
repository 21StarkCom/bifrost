---
name: lucius
description: "Open a Lucius brainstorm in a cmux tab of its own with `hermod lucius`, then stop. Lucius is a standalone app, so this skill only launches him and never runs him in this session."
argument-hint: "[--new-tab] [<topic> | STARK-n | --resume | --topic <text>]"
disable-model-invocation: true
---

## Help

If `$ARGUMENTS`, trimmed, is exactly `help`, `--help` or `-h` (any case), or
holds a standalone `--help` or `-h` before any `--topic`, follow
[standard help](../../standards/help.md), then stop. A `help` inside a longer
topic is part of the topic, not a help request. The topic is the operator's own
words, and "help me price the tap" is a brainstorm.

# Lucius

Lucius is a standalone brainstorming app (the `lucius` repo). He is not a Claude
Code skill and must never be driven as one (his spec's D1). This skill does not
run him. It opens him in a cmux tab of his own with `hermod lucius`, and then it
stops. **You are the launcher, whatever the arguments.** Do not bind or comment
on the ticket, title a tab, or stand down. Lucius loads a ticket himself and
links his session from it when he ends, and hermod titles his tab.

## Arguments

- `<topic>` — free text: what the brainstorm is about. It reaches Lucius as
  `--topic <text>`, never bare.
- `STARK-n` — open the brainstorm on that ticket and its comments.
- `--topic <text>` — comes last. Everything after it is taken literally as the
  topic, even `help`, `resume`, a flag, a ticket id or `--new-tab`, so write
  `--new-tab` before it.
- `--resume` — reopen a parked brainstorm. Lucius asks which one, in his tab.
- `--new-tab` — accepted, and changes nothing. Lucius always opens in a tab of
  his own, so `/lucius --new-tab` does what `/agnes --new-tab` does: launch in a
  new tab and stop.

Pass at most one of a topic, a ticket, `--topic` and `--resume`. With no
argument, Lucius opens a brainstorm with no topic. Unlike `/agnes --new-tab`,
this does **not** fall back to the ticket alfred has bound to this session.
Given a ticket, Lucius loads it and comments on it when he ends, so he opens one
only when it is named.

## Launch

1. Read the arguments as one form. First drop every standalone `--new-tab`
   outside a `--topic` value. Then:
   - **`--topic` is present**: everything after it, trimmed, is the topic,
     a later `--new-tab` included. Nothing but `--new-tab` may come before
     it; anything else there is a conflict (below). If nothing follows it,
     stop and ask for the topic: hermod and Lucius both refuse an empty one.
   - **`--resume`** is the resume form.
   - **What is left is exactly `STARK-` and digits**, upper case, and that is
     the ticket form.
   - **A near miss:** a ticket id in another case (`stark-12`), or `help`,
     `resume`, `version` or `topic` on its own, in any case. **Stop and ask**
     which was meant. Lucius and hermod both refuse these rather than guess,
     because either guess opens a paid session.
   - **Any other word that starts with `-`** is a flag this launcher does not
     take, whether or not hermod or Lucius has it (`--no-focus`, `--version`,
     `-v`, a mistyped `--resume`). This skill passes on no flag but the forms
     above. **Stop and say so**; never let it become part of a topic, which
     would open a paid session on it. A topic that really has a word starting
     with a dash goes through `--topic`.
   - **Anything else that is not empty** is the topic. If nothing is left,
     there is no topic.

   Two forms at once (say `--resume` with a topic) is a conflict. Say so and
   stop; do not pick one.

2. Launch once, from whatever directory you are in. Lucius works no ticket in a
   worktree, so there is no repo to pick, no `--cwd` and no worktree for hermod
   to cut:

   ```
   hermod lucius --json                     # no topic
   hermod lucius --topic '<topic>' --json   # a topic
   hermod lucius STARK-n --json             # a ticket
   hermod lucius --resume --json            # a parked brainstorm
   ```

   Paste the topic in as one single-quoted word, writing each `'` inside it as
   `'\''`, so the shell hands it over byte for byte. A worktree session's guard
   lets a single-quoted `$` through (measured), because nothing expands it.
   Never pass a topic bare, and never after `--`. hermod reads a bare word as a
   ticket or a near miss, and Bun eats the first `--` before Lucius sees it.
   Leave the tab focused, because the operator asked to see it.

3. Check what came back before you call it launched, then stop.
   - **Exit 0** prints the ack. Report its `title` (`LUCIUS`, or `LUCIUS (n)`
     next to other Lucius tabs), `ref`, `workspaceRef` and `args`. The ack means
     hermod typed the command into that tab: **the launch was submitted, but
     nothing confirms Lucius started.** His own refusals print in his tab, not
     here (for example, a `STARK-n` when his config sets no
     `tickets.checkout`). Report it that way, and do not call it started.
   - **Exit 1 with `{error, placement}`** means the tab opened and the launch
     then failed. Report the error and `placement.ref`, the tab left open for
     inspection. **Do not launch again.** A second launch opens a second tab
     next to the broken one.
   - **Exit 2** means nothing opened. The error names a refused argument, or
     says `lucius not found on PATH` (install lucius, or set `HERMOD_LUCIUS_BIN`
     to its absolute path), or says `unknown command: lucius`: this hermod is
     too old (see [Prerequisites](#prerequisites)).

   For any other outcome, report what it printed. A nonzero exit is the answer,
   not something to work around.

Never fall back to running Lucius in this session: not `lucius` through a shell
tool, not his prompt, not a persona. He is an interactive app that needs a
terminal of his own. Never fall back to `hermod spawn lucius …` either. It skips
the title, the private topic file and the up-front refusals that
`hermod lucius` exists to provide.

## Prerequisites

- **A hermod with the `lucius` command** (STARK-8068, hermod `e23f0b5`). The
  Homebrew v0.21.0 is older and answers `unknown command: lucius`, exit 2, with
  no tab opened. hermod's own source at `e23f0b5` still reports v0.21.0, so the
  version string cannot tell the two builds apart. Neither can
  `hermod lucius --help`, which exits 0 on the old binary with the global help.
  So do not run a preflight: the launch's own exit 2 is the check, and it opens
  nothing.
- **The `lucius` executable**: `lucius` on `PATH`, or `HERMOD_LUCIUS_BIN` set to
  the absolute path of an executable file. hermod resolves it before it opens
  any tab.
