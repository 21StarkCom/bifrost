# Launch a worker in a new tab

Read this when `/minion`, `/agnes` or `/gru` runs with `--new-tab` (`$minion`,
`$agnes`, `$gru` on Codex). You are the launcher, not the worker: no bind, no
spine, no report, no stand down, and no tab title. The worker you launch titles
its own tab. Launch once, read the result, and stop, except when you lead the
Minion you launch ([step 6](#6-after-the-launch)).

Never fall back to doing the worker's job in this session: the operator asked
for a new tab.

## 1. Name the id

- **Minion and Agnes:** the `STARK-n` given, else the `ticket` field of
  `alfred repo info --json`. With neither, stop and say so. Put the id on the
  launch line either way: `valkyrie minion` takes it as its first word, and any
  other first word starts a persona dev worker, not a ticket Minion.
- **Gru:** valkyrie makes the launch id itself: the epic, or `GRU-<n>` from the
  **first** ticket of `--tickets`. Never the id of a ticket Gru will work: that
  id names Gru's own worktree, so Gru's step 2 reads its own peer row as the
  Minion that owns the ticket and never launches it.

## 2. Pick the repo

- With `--repo <name>`, pass it through.
- **Minion and Agnes** without `--repo`: read the ticket first
  (`alfred task show STARK-n`). A ticket of another repo launches with
  `--repo <that repo>`. Trap: valkyrie exits 0 on a launch into the wrong repo,
  and the worker works the ticket in the wrong codebase. A ticket that names no
  repo is this repo's.
- Otherwise pass `--cwd <main checkout>`: the first `worktree` line of
  `git worktree list --porcelain`, not `git rev-parse --show-toplevel`, which
  names your own worktree. Run it as its own command and paste the path in
  literally. Trap: on Claude, a worktree session's guard refuses a launch line
  that carries a variable or a `$(...)`.
- `--repo` and `--cwd` are mutually exclusive.

## 3. Check that the id is free

No `worktree` line of that list (with `--repo`, of
`git -C <path> worktree list --porcelain`, `<path>` from
`urd repos get <name> --json`) may end in `/<id>`. If one does, stop and say so.
Trap: the id defaults to your bound ticket, whose worktree is often the one you
stand in. A Claude launch onto a held id exits 4 while a live session stands in
it, this one included, and otherwise re-enters the worktree, said only on
stderr behind a normal ack. A Codex launch onto it is refused.

## 4. Launch once

Use valkyrie 0.1.1 or later (`valkyrie --version`). With no valkyrie, or an
older one, stop and say so.

```
valkyrie minion STARK-n [--leader <peer>|operator] (--repo <name> | --cwd <main checkout>) [--agent <agent>] --json
valkyrie agnes STARK-n (--repo <name> | --cwd <main checkout>) [--agent <agent>] --json [-- <text>]
valkyrie gru (STARK-<epic> | --tickets STARK-n,…) [--minion-agent <agent>] [--max-workers N] (--repo <name> | --cwd <main checkout>) [--agent <agent>] --json
```

A flag you omit falls to idun's config, which valkyrie reads
(`agents.launchers.<worker>`; built in: claude, and 3 workers for Gru).

- **Minion:** `--leader operator` passes through as written. When valkyrie
  refuses it, say so and stop; never relaunch with yourself as the leader.
  Without `--leader`, valkyrie names you as the leader from your session stamp
  (`claude:$CLAUDE_CODE_SESSION_ID` or `codex:$CODEX_THREAD_ID`), and exits 2
  when it finds neither stamp or both. Then pass the `id` of the
  `hermod msg peers` row whose `sessionId` is yours as `--leader`.
- **Agnes:** pass the run text after `--`, with every valkyrie flag before it.
  Pass only words the operator wrote, on one line, as one single-quoted word
  with each `'` inside it written `'\''` (`-- 'don'\''t cut a release'`).
- **Gru:** your `--agent` argument is the Minions' agent, so it goes on the
  line as `--minion-agent`. The line's `--agent` is Gru's own runtime: yours.
  valkyrie writes Gru's first message itself. `--new-tab` stays off the line.
- **Agnes and Gru:** leave the tab focused; the operator asked to see it.

## 5. Read the exit code, then the ack

A nonzero exit is the answer: report what valkyrie printed, and do not work
around it.

- **0** with `verified: true`: launched. The ack's `prompt` must read as you
  meant (`$` for `/` on Codex):
  - `/minion STARK-n`, naming your leader. For a peer leader, `coordination`
    names the route (`SendMessage` or `hermod-msg`). An operator leader's ack
    carries `leader: "operator"` and no `coordination`.
  - `/goal /agnes STARK-n [text]`.
  - the `/gru start …` line you meant.
- **1**: something started and did not come up, and valkyrie's stderr names
  what it left standing. Trap: when the tab opened, stdout under `--json` still
  carries a normal ack whose only signs are `verified: false` and an `error`
  field. When Hermod could not place the tab, or a Codex worktree could not be
  cut, stdout carries no ack.
- **2**: refused before anything was made. Causes: a bad argument (for Agnes,
  run text with a control character, a goal over 4,000 characters, or a
  valkyrie flag after `--`), no id and no bound ticket, a repo name that no
  checkout or more than one under valkyrie's `repos.roots` (default `~/Code`)
  has as its origin, a `--cwd` outside any checkout, no session stamp or both
  without `--leader`, an existing worktree or leftover branch for the id (a
  Codex launch; a Gru launch on either runtime), or a main checkout that Codex
  does not trust (`Codex does not trust <path>…`). Trust is the operator's own
  grant: name the path and stop.
- **4**: a live agent or tab holds the id, and valkyrie's stderr lists each
  holder. Do not launch again.
- **128+n**: interrupted.

## 6. After the launch

- **Agnes and Gru:** print the ack's `surface`, `workspace`, `name` and
  `prompt`, and stop.
- **Minion, another peer leads:** print the ack's `surface`, `workspace`,
  `name`, `sessionId`, `peerId`, `coordination` and `prompt`, and stop. Give
  the native address to that leader. For Claude to Claude, that leader sends
  the first `SendMessage` to `name`; until then the Minion reports through
  Hermod.
- **Minion, `leader operator`:** print the ack's `surface`, `workspace`, `name`
  and `prompt`, and stop. The Minion prints each report in its own tab, and
  after its `done` waits there for the operator's `stand down`.
- **Minion, you lead it:** do not stop. You are Gru for one ticket. Make
  [Gru's step 3](../skill/gru/SKILL.md#protocol) first contact by
  [Gru's Coordination route](../skill/gru/SKILL.md#coordination-route), then
  handle its report by Gru's steps 4 and 5: one relaunch of a real death at
  most, and the confirm (PR merged, the verification comment on it, the ticket
  closed). Then tell the operator the outcome. Gru's Authority binds you: never
  edit the Minion's worktree and never reap its tab.

There is no launch in which nobody receives a Minion's report. A launch with no
leader is `/agnes --new-tab`.

`--new-tab` starts a Gru; it does not resume one. To resume, rerun `start` in
the tab of the Gru that runs. A second `--new-tab` on the same input meets the
first Gru's worktree, and on Codex its branch, and valkyrie refuses it (exit
2). When that Gru has ended, remove its worktree with
`git -C <main checkout> worktree remove <path>` and its branch with
`git -C <main checkout> branch -d <launch id>`, never with `--force` or `-D`,
then launch.
