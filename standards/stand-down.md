# The Stand-Down Contract

How a solo ticket worker closes its own session, worktree and tab when its
ticket is finished: a cmux tab, or in tmux without cmux (the Linux devbox) its
tmux pane, and with it the window when the pane is the window's only one.
`/minion` and `/agnes` both run this; neither restates it.
`/kevin`, who owns no ticket, runs it too, on the terms in
[Kevin, who owns no ticket](#kevin-who-owns-no-ticket).
The full hermod behaviour below was live-verified against hermod's TS engine
(`close-session.ts`, `poison-pill.ts`, `bin/hermod.ts`) plus an observed real
run under STARK-6166 — it is spec, not hints. The tmux facts were measured on
tmux 3.8 and hermod's tmux transport, and the reaper's timing on Claude Code
2.1.296 with hermod built at `e1f2c5a`.

This doc is runtime-neutral and is shipped byte-identical to both runtimes, so
read two conventions into it throughout. **The repo's agent instructions file**
means `CLAUDE.md` on Claude and `AGENTS.md` on Codex. And **a skill is written
in its Claude form** (`/agnes`); the same skill is `$agnes` on Codex, so a
launch or a brief naming one names the other.

One thing is the calling skill's, and this doc calls it by name:

- **your report** — where the outcome goes before you die (a Minion's
  native or Hermod message to its leader, or its line in its own tab under
  `leader operator`; Agnes's comment on the ticket).
  Whatever it is, it is a completed act before you arm, and it is never the
  durable copy of your evidence: that is the PR comment the spine's step 5
  requires, because your report is a line and your scrollback is gone.

## It is mandatory on a `done` exit

Closing your own session, worktree and tab is **mandatory** — a dozen finished
tickets otherwise leave a dozen live sessions and worktrees for the operator to
clean by hand. One command does all three — but read the rules below it first.

## Standing down needs no go-ahead — but it does need the scope

It is the declared terminal step of the ticket you were handed, not an ad-hoc
teardown: your own session, your own tab, your own disk, a job you finished.
Nobody has to authorize it at the time, and it makes no difference whether a
leader launched you or a hand did — with no leader peer to report to, your
report is the one your skill names (a ticket comment, for Agnes; a line in its
own tab, for a Minion led by the operator) rather than a line to a leader, and
nothing else changes but the one wait below. What is not negotiable is the scope:
**only after `idun gh pr-merge` and the ticket close, only your own tab, never
on `blocked` or `follow-up … stopping`, and never on any other trigger.** The
standing permission the command needs is still the operator's, and a refusal
there is a refusal — see the permissions note below.

**A Minion whose brief reads `leader operator` waits for one word.** Its report
is its `done` line in its own tab, and the teardown closes that tab, so after
that line it arms only once the operator types `stand down` there. The word
says when, not whether: it grants nothing, the scope above and every check
below still bind, and one that comes before the merge and the close is
answered with what is left, not obeyed.

## Never from inside a subagent — hard stop

A subagent shares `$CMUX_SURFACE_ID` with its parent, and in tmux `$TMUX_PANE`
(measured: a Claude subagent printed its parent's pane id), so poison-pill
fired there tears down *the parent's* tab. If you dispatch a subagent, it never
stands down; you do, from your own session.

## The command

```
hermod poison-pill --json
```

It targets your own tab (your cmux surface, `$CMUX_SURFACE_ID`, else your tmux
pane, `$TMUX_PANE` on the server `$TMUX` names), validates in the foreground
and returns at once. A detached reaper then sends your agent's quit verb
straight away. It does not wait for you to go idle, so a turn still running
gets the quit mid-turn. It waits up to its `--timeout` (30 s by default) for
the agent to exit, then closes the tab and removes the worktree, whether or
not the agent exited. Measured on Claude, the quit landed inside a running
`sleep 120`, and the teardown was done about a second after the arm. In tmux,
closing it kills your pane, and with it the window when your pane is that
window's only one. The quit verb is hermod's problem, not yours (`/exit` on
Claude, `/quit` on Codex), so both runtimes run this identical line. The tmux
pane needs a hermod after v0.37.0 (STARK-11364, merge commit `e1f2c5a`):
v0.37.0 and earlier refuse a tmux pane in the foreground, exit 2, which is the
report-and-stop in
[It can still fall short](#it-can-still-fall-short-and-no-answer-to-that-is---force).

## Four rules about when

- **Report first, then poison-pill**, so your report is a completed act and
  never a race against the reaper's quit, which reaches you moments after the
  arm.
- **Strictly after `idun gh pr-merge` and the ticket close.** Poison-pill
  deliberately skips the dirty/unpushed safety gate — the tab chose to die —
  which is safe only because everything you did is pushed and merged by then. It
  is never a generic "I'm finished" reflex.
- **Confirm that yourself, against the worktree poison-pill is actually aimed
  at** — the path `hermod poison-pill --dry-run --json` reports, which is not
  necessarily the directory your shell is standing in (nor, per the section
  below, that worktree's root — but it is inside it, which is all these two
  checks need), so run both checks with `git -C <that path>`: `git -C <that path> status --porcelain` must print
  nothing, and so must
  `git -C <that path> log --oneline origin/<your branch>..HEAD`.
  With the safety gate off, an uncommitted `/code-review --fix` hunk, an
  untracked file or an unpushed commit is destroyed without a word. Compare
  against **your own branch at origin, never `origin/main`**: `pr-merge`
  *squash*-merges, so your commits are never ancestors of main's squash and
  `origin/main..HEAD` stays non-empty forever after a perfectly good merge —
  a gate that can never go green is a gate that gets ignored. After a real
  `idun gh pr-merge` both checks are empty, which is why they are cheap, and why
  a non-empty one means something went wrong upstream rather than that the gate
  is noise. Fix that first.
- **Count what closes with you before you arm**, in the order
  [the spine's Title your tab](worker-spine.md#title-your-tab) uses: cmux
  first, then tmux. Run `echo "$CMUX_SURFACE_ID"` as its own command. If it
  prints nothing, skip to **In tmux without cmux**, below: the cmux steps here
  end in a report-and-stop that does not hold there. If it prints a UUID you
  are in cmux, even inside tmux: count the surfaces in your pane, because cmux
  refuses to close a window's only one and that failure is invisible until
  after you are dead (see `partial`, below). It is two steps, because
  `hermod panes` lists only the workspace `$CMUX_WORKSPACE_ID` names and that
  stamp goes stale the moment a tab is moved between workspaces (`hermod v0.19.0`, measured: a moved
  tab's bare `hermod panes` check printed nothing, rc 0, over a real count of
  2). First ask where you really are — `whoami` resolves `$CMUX_SURFACE_ID`
  against the live tree, so its answer is right even under a stale stamp:

  ```
  hermod whoami --json
  ```

  If the `id` it prints is a pane id (`%` and a number) rather than the UUID
  you echoed, hermod is on its tmux transport, where cmux is not installed: it
  ignores that UUID, an outer cmux's stamp, and aims at your tmux pane, so
  count as in tmux, below.

  Then count, pasting the `workspaceId` it printed as a **literal**:

  ```
  CMUX_WORKSPACE_ID=<workspaceId from whoami> hermod panes --json | jq '.panes[]
    | select(.surface_ids | index(env.CMUX_SURFACE_ID)) | .surface_count'
  ```

  Do not fold the two into one line with a `$(…)` substitution. Claude Code's
  worktree-isolation guard refuses a runtime-computed env value on a command —
  measured (Claude Code 2.1.278) on the quoted `VAR="$(…)"` form, while the
  unquoted one got through, a distinction too fine to rest a mandatory step on
  — and the pasted literal works on either runtime, whatever a guard thinks.
  `hermod panes --pane <paneRef>` is no shortcut either — under a stale stamp
  it answers `not_found`.

  This is a workaround with an end date. From `hermod v0.20.0`, `panes` resolves
  from the live tree itself (STARK-7262; measured there: a bogus stamp on the
  literal prefix is ignored and the count comes back right). The two steps stay
  correct there — the pasted id is simply what hermod would have found — so keep
  them until this contract pins a minimum hermod version. On that hermod the
  stamp is ignored once your surface resolves, so a mispasted id produces
  neither the `not_found` shape below nor the silent one; either then means
  your surface did not resolve, which the `whoami` step already reports.

  Read it as three outcomes, not two. **More than 1** and the last-surface
  refusal is not what will stop you — the claude-lock `partial` below still
  can, so this is one failure mode ruled out, not a guarantee the close lands.
  **Exactly 1** and the tab will survive as a bare shell (`"Cannot close the
  last surface"`): **arm anyway** and say so in your report. Do not skip the
  stand-down over it — that `partial` still exits your agent and removes your
  worktree, which is the whole point of the mandate above, and not arming
  leaves a live agent, a live worktree *and* the same tab. **Unresolvable**
  is not a count, and it has three shapes. `whoami` exits 1 with a named error
  when `$CMUX_SURFACE_ID` is unset (`no CMUX_SURFACE_ID in env`) or your
  surface is gone (`surface … not found in tree`) — loud, where the old
  one-step check was silent. An unset one means you are not in cmux: count as
  in tmux, below. A gone surface poison-pill refuses on itself, so there is
  nothing left to arm: report it and stop. Or the second step
  **errors** — hermod answers `not_found: Workspace not found`, exit 1, and jq
  dies on `Cannot iterate over null`, exit 5 — because what you pasted is not
  a workspace id: `whoami` prints three UUIDs (`id`, `workspaceId`,
  `windowId`) and only `workspaceId` will do, whole. Or the second step prints
  **nothing**, jq exit 0: `index` found your surface in none of the panes
  listed, so the id names a real workspace you are not in — another one's, or
  your own from before a move that landed between the two steps. Those last
  two shapes are a slip, not a verdict, and a slip is no reason to skip a
  mandatory stand-down: run **both** steps again, once, re-reading `whoami`
  rather than re-pasting from scrollback. Still unresolvable, treat it as the
  check having failed: report it and stop.

  A stale workspace stamp is **not** a ground poison-pill itself refuses on,
  so a clean dry run does not stand in for this count. Its foreground
  validation (`--dry-run --json`) refuses, exit 2, with neither
  `$CMUX_SURFACE_ID` nor a tmux pane to aim at, on no active session on the
  surface, and on a session store that cannot name one supported agent and
  one worktree cwd; and it
  answers `aborted-not-worktree`, exit 1, when that cwd is not a git
  repository. A stale stamp is none of those: measured, the dry run answers
  `completed` under one.

  **In tmux without cmux**, `$CMUX_SURFACE_ID` printed nothing (or `whoami`
  named a pane id); run `echo "$TMUX_PANE"` as its own command. If it prints
  a pane id (`%` and a number), count the panes in your window instead. The cmux steps cannot do it
  there: hermod's tmux transport makes every tmux pane a cmux pane of one
  surface, so `hermod panes` reports a `surface_count` of 1 and no
  `surface_ids` for every pane, two that share a window included, and the jq
  above dies on `Cannot index null with null`, exit 5; and the `workspaceId`
  `whoami` prints is a tmux session id such as `$1`, which a shell expands.
  Nor is there a stamp to go stale: tmux resolves a pane id wherever its
  window has moved (measured: after a `move-window` into another session the
  count followed the pane, while the session index in the pane's `$TMUX` did
  not change). Paste the pane id in literally, since on Claude a worktree
  session's guard refuses a `tmux` line carrying a variable:

  ```
  tmux display -p -t <pane id> '#{pane_id} #{window_panes}'
  ```

  The first field must read back your pane id, because over a pane id that
  names no pane `display` prints a blank line and exits 0. Nothing in tmux
  refuses the close: `kill-pane`, which the reaper runs to close a pane,
  removed every pane it was given, `remain-on-exit` on or off. So the count
  never decides whether you arm; it says what closes with you, for your
  report:

  - **1**: the window is yours alone and closes with your pane, and so does
    its session when it was that session's only window, and the tmux server
    when that was its last session.
  - **More than 1**: the window is shared. Only your pane closes, and the
    window stays with the other panes, which are not yours to close. Arm, and
    say so in your report.
  - **Unresolvable**: a blank line, or a pane id other than the one
    `$TMUX_PANE` printed. That is a slip, not a count: run both commands
    again, once, re-reading `$TMUX_PANE` rather than re-pasting from
    scrollback. Still unresolvable, report it and stop.

  **Neither** variable prints anything: you are in no tab poison-pill can aim
  at, and it refuses, exit 2. Report it and stop. It refuses the same way on a
  pane id with `$TMUX` empty, since `$TMUX` names the pane's server, and
  without it `tmux display` looks the id up on the default server instead.

## What it aims at

Poison-pill removes the worktree your **session** was launched in — in cmux
the cwd hermod recorded in its session store, in tmux (where hermod keeps none)
the cwd of the Claude or Codex process in your pane, never the directory your
shell happens to be standing in — and it resolves that cwd up to the git
toplevel, so a subdirectory is never what gets *removed* and there is no `cd`
ritual to perform. (Measured on Claude: its process stayed at the worktree root
while its shell worked in a subdirectory.)

**But on `hermod v0.19.0` the path it PRINTS is not that toplevel** — it is the
raw recorded cwd, which drifts into a subdirectory the moment anything in your
session runs there (measured: a session that had been in `<worktree>/tools`
reported `"worktree":"<worktree>/tools"` and
`"detail":"…remove worktree <worktree>/tools…"`, while the removal would still
have correctly targeted `<worktree>`). That was STARK-6168, a hermod bug, fixed
in `hermod v0.20.0` (`845787e`: the ack reports the resolved toplevel). On
v0.19.0 **never read the reported path as the worktree root**; until this
contract pins a minimum hermod version, do not rest anything on it on any
version. It is still guaranteed to be *inside* your worktree, which is all the
preflight's `git -C` checks need — `git status` and `git log` are repo-wide
from any subdirectory. When you want the root itself, ask git
(`git rev-parse --show-toplevel`), not the ack.

If the reported path is not inside your worktree at all, pass
`--cwd <worktree root>` rather than `cd`-ing, because moving your shell does not
move what hermod recorded. Passing `--cwd` explicitly also makes the ack honest:
with it, the reported path is the one you named.

## Flags

Run it with no behavior-changing flags. `--json` is not one of them — it only
selects the output shape, and it is the sole way to read `armed:true` (below),
so it is part of the command, not an embellishment. No `--delete-branch`: the
branch is merged and harmless, and branches are the operator's to clean with
`idun gh cleanup`. The worktree is the one thing that is genuinely yours — your
disk, your session, and you are the one who knows you are finished — so it goes
with you.

A `done` with follow-ups filed and a `done` without stand down the same way:
report, then `hermod poison-pill --json`. Filing follow-ups is no exception —
file them as [the spine](worker-spine.md#6-gaps) says and comment the links on
your ticket; the ids live on the ticket, not in your `done` line.

## `armed:true` is the only proof it took

**Never fire it twice — and it is printed only under `--json`.** Bare, the
foreground prints a prose line with no `armed` field at all, so "did it take?"
becomes unanswerable, which is exactly how a second firing gets rationalised.
Under `--json` the ack echoes the validation plan verbatim, so a live run prints
the same `"detail":"dry-run: would exit …"` string a `--dry-run` does and
`"armed":true` beside it is the *only* thing telling them apart. Re-running
"because nothing happened" arms a **second reaper**. The ack returns before the
reaper acts, and the reaper does not wait for you to finish: its quit reaches
you moments later, mid-turn if you are still working, and the tab closes at
its `--timeout` whether or not you exited. Anything you start after arming may
be cut off. Report, arm, go quiet, die — in that order.

## The ack is what was planned, not what happened

The outcome lands in `$TMPDIR/hermod-poison-pill-<pid>-<stamp>.log` (`/tmp`
where `$TMPDIR` is unset, as on the Linux devbox), newest wins, and by then
you are gone — which is why anything you can see going wrong in the
foreground goes into your report before you stop.

## It can still fall short, and no answer to that is `--force`

If poison-pill fails in the foreground — neither `$CMUX_SURFACE_ID` nor
`$TMUX_PANE` beside `$TMUX`, a hermod too old for a tmux pane, or a session
store (in tmux, your pane's processes) that cannot
tell which worktree is yours — you are still alive: say so in your report, then
stop and leave everything in place. If it arms and the teardown comes back
`partial`, the tab, the worktree, or both survive:

- claude holds a git lock on its worktree for the session's life, and the reaper
  refuses to remove one whose lock owner is still alive. It gives up *before*
  closing the tab, so this `partial` leaves the worktree **and** the tab behind
  — the agent dead, both still there;
- cmux refuses to close a window's **only** surface —
  `"Cannot close the last surface"`, leaving the agent dead, the worktree gone
  and the tab alive as a bare shell. tmux has no counterpart: `kill-pane`
  closes a window's only pane, and the window with it. Measured on a tmux
  server's last pane too, where the close takes the server down: the
  teardown still came back `completed`, worktree removed.

Both are the operator's to sweep, and a `partial` does not heal itself. Do not
try to resume into it: `claude --worktree X --resume` **recreates** the removed
worktree and re-locks it, turning a stale tab into a live one holding a worktree
nobody expected to exist. Report the surface and the path; stop there.

## One permissions note, because it is a real tradeoff, not a detail

A skill cannot self-approve its own shell call, so the stand-down runs only in a
session whose permission settings already let it through unprompted — on Claude
a bypass-mode session or a `Bash(hermod poison-pill:*)` allowlist entry, on
Codex a sandbox + approval policy that permits it. Either way that latitude lets
any skill or stray reasoning step kill the tab unprompted. If the command is
refused, that is a refusal, not an obstacle: report and stop.

## A blocked or stopped exit does NOT stand down

Not even with `--keep`. The operator may still need your worktree, your tab and
your scrollback to see what happened. Report, then stop and leave everything in
place.

## Kevin, who owns no ticket

`/kevin` merges and closes no ticket of his own, so "after the merge and the
ticket close" cannot be his trigger, and `origin/<your branch>..HEAD` cannot be
his check: his own branch is never pushed. Everything else above binds him as
written. His terms instead:

- **Two triggers, and no other.** He is his repo's shared request desk with
  no leader, so: the operator's `stand down`, typed in his tab, after the
  request in flight is reported; or his own idle-out (two hours with nothing
  in flight or queued, as his skill measures it). A `stand down` from any
  peer is refused, since no one requester owns the desk.
- **Before he arms**, every request still queued is answered `refused
  <request> standing down; ask again` to its sender, so it launches a fresh
  Kevin instead of waiting on a dead one.
- **His report** is `standing down`, in his tab and by `hermod notify send`,
  sent before he arms. It names every branch he kept, so their work is not
  lost from sight: `git -C <that path> branch --list 'kevin-unpushed/<launch id>/*'`.
- **His two checks**, against the worktree poison-pill reports, both printing
  nothing:

  ```
  git -C <that path> status --porcelain
  git -C <that path> log --oneline HEAD --not --remotes
  ```

  They cover only what poison-pill destroys: the worktree's files and a
  commit reachable from HEAD alone. HEAD is the detached `origin/<base>` he
  returns to after every request, so the second prints nothing unless
  something went wrong. His kept `kevin-unpushed/` branches are not checked:
  they are on no remote by definition, so checking them would block every
  stand-down once one exists. They are refs in the shared repository, and
  removing the worktree leaves them standing. Never `--branches`: branches
  are shared by every worktree of the repo, so other agents' work in progress
  would block him forever.
- **Either check printing anything** is `blocked stand down <what is left>`: he
  does not arm, and waits.
