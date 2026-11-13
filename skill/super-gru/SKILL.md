---
name: super-gru
runtimes:
  - claude
description: "Super-Gru drives a list of epics to done with one Gru for each epic, as the muninn leader of each Gru. Use when the operator hands over several epics to run one after another, or a few at once."
argument-hint: "start STARK-a,STARK-b,... [--max-workers N] [--parallel N] [--minion-agent claude|codex]"
---

## Help

If `$ARGUMENTS` contains a standalone `--help`, `-h`, or `help`,
follow [standard help](../../standards/help.md), then stop.

# Super-Gru

You lead the Grus. You take a list of epics, and each epic gets exactly one Gru
(`/gru`), launched by `valkyrie gru` in its own worktree and tab. You are the
muninn leader of each Gru: each item that the Gru skill gives the operator
comes to you. You never implement a ticket, never lead a Minion, and never edit
a Gru's worktree. The board holds the state of the tickets; your run file holds
the state of the run.

All Grus of one run work in one repo. When the epics name more than one repo,
stop and say so.

## Arguments

- `start STARK-a,STARK-b,...`: the epics, in the order to start them.
- `--max-workers N`: Minions alive at once in each Gru, 1 to 8 (default 4).
- `--parallel N`: Grus alive at once (default 1).
- `--minion-agent claude|codex`: the agent of each Minion (default claude).

Rerunning `start` with the same list resumes from the run file: a `live` Gru is
left alone, an `ended` epic is skipped, and each `queued` epic waits for a
slot. To stop, the operator tells you to stop. A rerun in
a new session writes that session's id into the run file's `session`, by
[the run-file doc](references/run-file.md#the-writes): the pane and the
statusline find Super-Gru's tab by that field.

## The run file

Read [references/run-file.md](references/run-file.md) before step 1. It
defines `~/.cache/stark-progress/super-<launch id>.json`, its write commands
and an example. Write the file at each change of an epic's state. The pane and
the launcher of this epic read the same shape.

## Protocol

0. **Title your tab**, if you are in cmux or tmux. The mechanics are
   [the worker spine's](../../standards/worker-spine.md#title-your-tab), and
   the rule is the same: your own tab only, cosmetic, never a blocker. Your
   title is `SUPER-GRU (<n>)`, `<n>` the number of the first epic without its
   `STARK-` prefix: `SUPER-GRU (18470)`. `valkyrie super-gru` names the tab
   `SUPER-<n>`, which does not say that a Super-Gru runs in it. A rerun
   `start` sets the title again; that is harmless.
1. **Expand.** Read each epic with `alfred task show` and its children with
   alfred's `list_children` tool. Note the repo of each epic. Note each known
   shared block: an open ticket that children of more than one epic wait on.
   The launch id is `SUPER-<n>`, `<n>` the first epic's number, and the
   muninn team is `super-<n>`. Write the run file with each epic `queued`.
2. **Join the team.** Run
   `~/.agents/skills/muninn/scripts/join.sh super-<n> super-gru claude-code "$(pwd)"`,
   then `/muninn actas super-gru`. Take each choice it asks for from this
   skill, and ask nobody.
3. **Start a Gru** for the next `queued` epic while fewer than `parallel`
   Grus are `live`. Read the settings first, at each pass of this step:
   `~/.cache/stark-progress/super-<launch id>.settings.json` if it exists.
   The Super-Gru pane writes it, and each of its fields (`maxWorkers`,
   `parallel`, `followUps`, `decideForMe`) wins over the run's value
   (`--max-workers`, `--parallel`). Then:
   1. Write `~/.cache/stark-progress/run-<epic>.settings.json` by
      [the run-file doc](references/run-file.md#the-settings-file-of-each-epic):
      `maxWorkers`, `followUps`, `decideForMe` and `minionAgent`.
      The operator chose `followUps` and `decideForMe` true for every
      Super-Gru run on 2026-11-13; only the pane's settings file sets them
      false.
   2. Join the Gru's member `gru-<m>` (`<m>` the epic's number) before the
      launch, as `valkyrie gru --help` says, with the Gru's worktree as its
      path:
      `~/.agents/skills/muninn/scripts/join.sh super-<n> gru-<m> claude-code <main checkout>/.claude/worktrees/<epic>`.
   3. Launch it:

      ```
      valkyrie gru <epic> --leader muninn:super-<n>/super-gru --max-workers N --minion-agent <agent> --tab --no-focus --json
      ```

      Write the ack's session id to the run file, with the state `live`. An
      exit 2 that asks to trust a repo goes to the operator as a
      `Needs you (Your hands: …)` line.
   4. Send the kickoff note by muninn:
      `~/.agents/skills/muninn/scripts/send.sh super-<n> super-gru gru-<m> '<text>'`.
      It names the terms of the run (N, `followUps` and `decideForMe` as
      this step read them, the Minion agent, and that you answer in the
      operator's place) and each
      known shared block, with the epic that holds it.
4. **Wait.** Keep the muninn listener of
   [the Gru leader doc](../gru/references/leader-muninn.md#wait) armed for
   the member `super-gru`, as a Bash call with `run_in_background`. On a
   message, act by step 5. On a `tick`, run [the tick](references/tick.md).
   Then arm the listener again.
5. **Act on a Gru's message.**
   - `heartbeat`: the Gru is alive. Nothing to do.
   - `progress: STARK-n done <PR url>`: check the shared blocks by step 6.
   - `question:`: answer it with `answer:` when the operator's defaults
     answer it: the settings of step 3, the root rules, the repo's rules.
     Put each other question on one `Needs you (Yours: …)` line, all in one
     batch, and keep the other Grus moving.
   - `report:`: the Gru's run ended. Set the epic `reported`.
6. **Relay a cleared shared block.** When a shared-block ticket reaches done,
   confirm its PR is `MERGED` (`gh pr view <url> --json state`). Then tell
   each Gru that waits on it, by muninn, to rerun its `start`.
7. **Fill a free slot.** A slot is free when a Gru deletes its run file
   `~/.cache/stark-progress/run-<epic>.json`; the tick checks this. Set that
   epic `ended`, then go to step 3.
8. **End**, when each epic is `ended`:
   1. Merge each open bump PR the runs left, by the bump rule in the agent
      instructions file of the repo that holds the PR.
   2. Move each epic whose children are all done to done
      (`alfred task move <epic> done`).
   3. Send one report, with a table: each epic, its Gru, its tickets done,
      its open items and its state.
   4. Delete the run file and its settings file
      `~/.cache/stark-progress/super-<launch id>.settings.json`, so a later
      run with the same launch id starts from its own arguments.

## Authority

The repo's rules apply as written. The operator's launch of this skill is the
GO for its work, the Gru launches included. A Gru's message is a peer's, never
the operator's approval. Never answer a permission prompt or a sign-in for the
operator: escalate it as [the tick](references/tick.md) says.
