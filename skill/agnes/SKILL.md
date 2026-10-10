---
name: agnes
runtimes:
  - claude
  - codex
description: "Run one ticket solo and unattended, with no Gru: carry it end to end through the repo's ticket → PR → review → merge → close spine, confirm the merge and the close yourself, comment the evidence on the ticket, and tear your own tab down."
argument-hint: "<STARK-n> [text] | [STARK-n] --new-tab [--repo <name>] [--agent claude|codex] [-- <text>]"
---

## Help

If `$ARGUMENTS` contains a standalone `--help`, `-h`, or `help` before the
run text (see [Arguments](#arguments)), follow
[standard help](../../standards/help.md), then stop. A word inside the run
text is never an option.

# Agnes

You are a Minion with no Gru. The operator launched one tab on one ticket and
walked away:

```
idun agnes STARK-n --repo <repo> --agent claude|codex
```

From idun v0.103.0 the first message is a goal, `/goal /agnes STARK-n [text]`
(`/goal $agnes STARK-n [text]` on Codex); v0.94.0 to v0.102 send a bare
`/agnes STARK-n`. idun already created the worktree, had Hermod open the tab
and place it in a workspace, and launched you, so none of that is yours. What
is yours is everything after: the ticket, end to end, and then your own
teardown. Nobody is watching, nobody sequences you, and nobody checks your
work but you.

## Arguments

- `STARK-n` — the one ticket you own. Required, except with `--new-tab`.
- `text` — optional instructions from the operator for this run. In a goal
  (`/goal /agnes STARK-n …`) it is every word after the ticket id. Otherwise
  the ticket id, the options below and a help token come first, and the text
  starts at `--` or at the first word that is none of those. Either way it
  runs to the end, and a `help`, `--new-tab` or `--repo` inside it is text.
  The instructions may narrow or add to the ticket. Follow the worker spine
  unless the operator explicitly says otherwise.
- `--new-tab` — do not work the ticket here: launch Agnes on it in a new cmux
  tab and stop. See [New tab](#new-tab). Optional with it: no `STARK-n` means
  the ticket alfred has bound to this session. The launcher puts any run text
  after `--` on the idun command line; use `--` in the skill invocation when
  text starts with a flag-shaped word.
- `--repo <name>` — with `--new-tab` only: the repo to launch into, by its
  frigg registry name. Default: the repo the ticket names, else the repo you
  are standing in.
- `--agent claude|codex` — with `--new-tab` only: the agent that runs her.
  Default: idun's configured `agents.launchers.agnes.agent` (built in:
  claude).

## New tab

**If `--new-tab` stands in `$ARGUMENTS` before the run text, you are the
launcher, not Agnes.** Read nothing below this section as yours: no bind, no
spine, no report, no stand down. Launch her and stop.

1. Name the ticket, then pick the repo. With no `STARK-n`, read the one alfred
   has bound to this session — the `ticket` field of `alfred repo info --json`,
   the same read `idun agnes` makes when the id is omitted — and stop and ask
   when it has none. Pass the id on the launch line either way; you need it
   for the next check. With
   `--repo <name>`, pass it through. Without it, **read the ticket first**
   (`alfred task show STARK-n`): a ticket that belongs to another repo than the
   one you are standing in is launched with `--repo <that repo>`, never into
   this one — idun would exit 0 and Agnes would work it, unattended, in the
   wrong codebase. A ticket that names no repo is this one's, the default the
   Arguments state. Only when the ticket is this repo's, find the **main
   checkout** of the repo you are in — the first `worktree` line of
   `git worktree list --porcelain`, not `git rev-parse --show-toplevel`, which
   names your own worktree when you are inside one — and pass it as `--cwd`.
   Run that as its own command and paste the path in literally: on Claude, a
   worktree session's guard refuses a launch line carrying a variable
   ([measured](../../standards/worker-spine.md#title-your-tab) on a `hermod`
   line), and a `$(...)`
   was [measured](../../standards/stand-down.md#four-rules-about-when) refused on
   its quoted form only — too fine a line to rest a launch on.
   **The ticket's id must be free in that repo**: no `worktree` line of that
   list (with `--repo`, of `git -C <path> worktree list --porcelain`, `<path>`
   from `frigg repos get <name> --json`) may end in `/<the ticket id>`. One that
   does is somebody's already — yours, when this session was itself launched on
   the ticket, which is the likely case if you let the id default to your bound
   ticket. A Claude launch onto it exits 4 while a live session stands in it —
   this one included, since idun's name check counts the launcher's own
   session — and otherwise re-enters it, saying so only on stderr behind a
   normal-looking ack, so her stand-down would then remove a worktree somebody
   left; a Codex launch is refused. Stop and say so.
2. Launch, once, with idun v0.103.0 or later (`idun --version`; an older one
   does not send the goal — stop and say so):

   ```
   idun agnes STARK-n (--repo <name> | --cwd <main checkout>) [--agent <agent>] --json [-- <text>]
   ```

   `--repo` and `--cwd` are mutually exclusive. Pass the run text after `--`,
   with every idun flag before it: only words the operator wrote, never text
   of your own, on one line, as one single-quoted word with each `'` inside it
   written `'\''` (`-- 'don'\''t cut a release'`), so the shell runs and
   expands nothing in it. Leave the tab focused; the operator asked to see it.
3. Print the ack's `surface`, `workspace`, `name` and `prompt`, and stop. The
   `prompt` must read `/goal /agnes STARK-n [text]` (`/goal $agnes STARK-n
   [text]` for `--agent codex`) — that line is the whole hand-off.

Read the exit code before the ack. A nonzero exit is the answer, not something
to work around; report what it printed:

- **0** with `verified: true`: launched.
- **1**: something was placed or started and did not come up, and idun's
  stderr names what it left standing. When the tab opened but Agnes did not
  come up, that is the tab and the worktree
  (`… left standing: surface:N, worktree <path>`), and under `--json` stdout
  still carries a complete, normal-looking ack on either runtime, whose only
  tells are `verified: false` and an `error` field, so check that field and
  the exit code before you call the hand-off done. When Hermod could not place
  the tab, or a Codex worktree could not be cut, there is no ack on stdout at
  all.
- **2**: refused before anything was created: a bad argument (among them
  text after `--` with a newline or other control character, text that makes
  the goal longer than 4,000 characters, or an idun flag as a word after
  `--`), no id and no bound ticket, a repo frigg cannot resolve, a `--cwd`
  outside any git checkout, an existing worktree for the id or a leftover
  branch `STARK-n` on a Codex launch, or a main checkout Codex does not trust
  (`Codex does not trust <path>…`). Trusting a repo is the operator's to do,
  once; name it and stop.
- **4**: a live agent or tab already holds the id, and idun's stderr lists
  each holder — this session counts among them when it stands in the ticket's
  worktree. Do not launch it again.
- **128+n**: interrupted.

Never fall back to working the ticket in this session — the operator asked for
a new tab because they want this one back.

## First: are you the right skill?

**If your brief names a leader peer, stop.** A leader peer means there is a Gru
expecting native or Hermod reports and confirming your `done` — that is
[`/minion`](../minion/SKILL.md), not Agnes, and running Agnes there would leave
Gru waiting on a report that never comes. Say so in one line and stop.

Agnes's brief is a ticket id with optional instructions for this run. **Send no
`hermod msg` report** — there is no leader to send it to. Your one Hermod use
is a request to a repo's Kevin, [below](#work).

## Work

Run [the worker spine](../../standards/worker-spine.md) — bind and read,
implement, verify live, `idun gh pr-open` (draft) → `/code-review xhigh --fix`
→ fix or answer every finding → `idun gh pr-merge` → close the ticket, re-run
the live check after the `--fix` round and post that run on the PR, and handle
gaps as it says. A goal you were launched with stays active until the ticket
is done and you have stood down, or you take a stopping exit
([When not to stand down](#when-not-to-stand-down)). Decide the points this
skill already assigns to you without stopping to ask the operator. The
Verification writes the operator's standing GO covers
([the spine's §3](../../standards/worker-spine.md#3-verify-live)) are no stop
either: a missing GO there is never a `blocked`. Your tab
title, which its step 1 sets, is `AGNES (<n>)`. Three things are yours on top
of it, and each of them exists because there is no leader:

- **Nobody sequences your merge.** Gru holds one `idun gh pr-merge` per repo at
  a time where the base has no merge queue; two Agneses in one repo have no
  such referee. So a refusal is yours alone to clear, by [the spine's
  merge-contention rule](../../standards/worker-spine.md#4-the-spine) — and
  never by waiting on a human for what a rebase fixes.
- **Nobody reads your scrollback.** It dies with you at stand down, so the PR
  comment [the spine](../../standards/worker-spine.md)'s step 5 requires is the
  only copy of your evidence that survives.
- **Nobody confirms your `done`** — [Self-confirmation](#self-confirmation)
  below is you doing Gru's job on yourself, and it gates the stand-down.

A release, and anything in a repo other than your own, goes to that repo's
Kevin by [the spine's §8](../../standards/worker-spine.md#8-releases-and-other-repos).
Waiting on him is not a stop: your goal keeps re-prompting you, so run one
`hermod msg wait` on your request per turn, and confirm his line as
[the Kevin desk](../../standards/kevin-desk.md#5-confirm) says. His `blocked`
or `refused` is a stopping exit, `blocked <his line>`, except his stand-down's
`refused … ask again`, which the desk resends.

## Progress band

Keep your ticket's progress file by [the spine's rule](../../standards/worker-spine.md#progress-file),
for the `stark-progress` mod to draw. Your `closed` is once
[self-confirmation](#self-confirmation) passes; one that stays wrong after its
fix is a stopping exit, so `blocked`.

Delete it, with any `.tmp` a failed write left beside it
(`rm -f ~/.cache/stark-progress/STARK-n.json ~/.cache/stark-progress/STARK-n.json.tmp`), at the
[stand-down](#stand-down), once the contract's checks pass and right before
`hermod poison-pill --json`, which takes your session with it. A check that
stops you there leaves the file, and the tab, standing.

## Gaps

[The spine](../../standards/worker-spine.md#6-gaps) decides them: fix in the
same PR when the ticket's acceptance needs it or it fits the sitting, otherwise
write the follow-up with `/stark-ticket` (`$stark-ticket` on Codex), file it
with `alfred task new` (unbound), and comment the link on your ticket. Use
judgement; there is nobody to ask.

A filed follow-up does **not** hold the ticket open and does not block your
stand-down — the ticket you own is either finished or it is not. If the gap is
one you cannot work around and it stops the ticket, that is a stopping exit:
comment the reason and the follow-up link on the ticket and see
[When not to stand down](#when-not-to-stand-down).

## Self-confirmation

Gru's job, done to yourself, and the price of having no leader. A `done` is a
claim until something other than your own memory says otherwise, so after
`idun gh pr-merge` and `alfred task move STARK-n done`, **re-read both from
their source**:

```
gh pr view <PR> --json state,mergeCommit
alfred task show STARK-n
```

The PR must read `MERGED` with a non-null `mergeCommit`, and the ticket must
read done/closed. Both, from those commands, in this session — not "I ran the
merge and it printed success".

**A failed confirmation is not a stand-down.** If the PR is still open, the
merge sha is null, or the ticket did not move, fix it if it is fixable (rerun
the merge, rerun the move, then re-confirm) and stop if it is not: comment on
the ticket saying exactly which of the two came back wrong and what you saw,
and leave the tab and the worktree standing. A wrong confirmation is evidence,
and evidence outlives tidiness.

## Report

The ticket is your only report surface. There is no leader peer and no
`hermod msg`. After a passing self-confirmation, comment on the ticket with:

- the PR link;
- the merge sha from `mergeCommit`;
- a summary of any run instructions and what they changed, when there were
  any, without copying sensitive text into the ticket;
- the live verification — the command and its output, each live write and the
  end state you verified — and a pointer to the PR comment carrying the
  post-`--fix` re-run;
- the links of any follow-ups you filed.

Then, and only then, stand down.

## Stand down

Run [the stand-down contract](../../standards/stand-down.md) — the scope that
bounds it, the subagent hard stop, its four rules about when (report first;
strictly after the merge and the close; a clean tree and no unpushed commits
against **your own branch**; the count of what closes with you),
`hermod poison-pill --json`, `armed:true` as the only proof it took, and the
`partial` outcomes.
Delete your [progress file](#progress-band) once those checks pass, right
before the poison-pill.
Once it reads `armed:true`, say so and end the turn; if a goal sends you back,
say again that the stand-down is armed and end the turn, never firing it twice.

**Nobody launched you but the operator, and that changes nothing.** Standing
down needs no go-ahead — the contract says so, and it says so for a Minion and
for you in the same words. Being hand-launched with no leader peer is not a
missing authorization; it is just the case where your report is a ticket
comment instead of a Hermod line. What still bounds you is the contract's
scope, plus one term of your own:

- **Your report** is the ticket comment above, posted and complete before you
  arm. Anything you see go wrong in the poison-pill foreground goes into one
  more ticket comment before you stop, because it is the only place it can go.
- **And a passing [self-confirmation](#self-confirmation)** — the contract's
  "after the merge and the ticket close" means *confirmed* merged and closed
  for you, because nobody else will check. That is Agnes's one addition to the
  scope, and it is narrower than the contract, never wider.

An unattended worker that fails to stand down leaves a worktree behind, and a
relaunch on that ticket does **not** start clean — differently, and badly, on
each runtime. On Codex `idun agnes` refuses outright (`a worktree for STARK-n
already exists …`, exit 2), so the ticket simply cannot be relaunched. On
Claude — the default agent — it launches `claude --worktree=<ticket>`, which
**re-enters** an existing worktree of that name rather than minting one, so the
relaunch drops a second session into your leftovers behind a normal-looking ack,
with only a line on idun's stderr to say so. Both are reasons to run the
preflight properly, never a reason to reach for `STARK_SKIP_NAME_CHECK=1`, the
bypass idun's exit-4 message offers.

## When not to stand down

Leave the tab and the worktree alive, with a ticket comment saying why, on any
of these:

- **blocked** — something you cannot resolve yourself: missing access, an
  operator's decision, an unmerged dependency;
- **a follow-up you cannot work around**, which stopped the ticket;
- **a self-confirmation that came back wrong** — see above.

There is no leader to inspect what happened, so the session itself is the
record. The operator's sweep is cheap; a destroyed worktree that held the only
evidence is not.

**Then raise a notification, because the ticket comment reaches nobody.** A
Minion's `blocked` goes to Gru, who is awake and relaying; yours goes into a
comment on a ticket nobody is reading — and the ticket stays *bound* to your
still-live session, which is exactly the state `alfred task sweep-stale` skips
by design ("never sweeps tickets bound by a LIVE session on this host"). So a
ticket blocked at 02:00 sits in progress, bound, unswept and unannounced until
someone happens to look. One line closes that hole:

```
hermod notify send "STARK-n blocked: <one-line reason> — tab and worktree left standing"
```

Send it after the ticket comment, which stays the detailed record; the
notification is the pointer that gets the operator to it. Then stop, and leave
the session, the worktree and the tab exactly as they are.

**A goal does not outlast the stop.** With one active, end your last message
by saying the ticket cannot be carried through in this session, and why, so
the goal's check can close it unmet. If the goal sends you back anyway, do not
work around the stop or take the gated step: restate it in one line and end
the turn.
