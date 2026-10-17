# kevin-idle

A Claude Code mod that wakes an idle Kevin (`/kevin`, a repo's request desk)
so he can idle out without arming a timer of his own. In a session whose
project root is a `KEVIN-<repo>-<n>` worktree, it notes when each main-loop
turn starts and ends, and once he has gone `kevin.idle_seconds` without a
turn it submits one prompt, `kevin idle check`. Kevin runs his own check
(`skill/kevin/SKILL.md`, "Idle out") and decides; the wake's own turn
restarts the clock, so an idle Kevin is woken once per idle period, never
more. Every other session is left alone.

Install it on its own; the seven skill plugins do not need it:

```
/plugin install kevin-idle@bifrost
```

## Threshold

`kevin.idle_seconds` in the stark config, 7200 (two hours) by default, read
at session start from `config.json` (then `global/config.json`) under
`STARK_ASSET_ROOT`, else from `~/.claude/code-review/config.json`, the link
`tools/asset_links.ts` makes into the bifrost checkout. A missing file or a
value that is not a whole number of seconds reads as 7200. A change reaches
the next Kevin launched.

## The idle band

Between turns, a Kevin session shows the idle clock above the prompt, in the
operator's status-line gauge style:

```
IDLE ▐████░░░░░░▌ 48m / 2h · wakes 16:12
```

The 10 cells fade from light red to dark red and round down, so the bar
never reads full ahead of the wake (the wake's tick restarts it); `wakes` is
local time. The band is hidden while a turn runs (the wake's own included)
and while a survey shows, and restarts at `<1m` when the turn ends. It
refreshes on the mod's one-minute tick and shows whole minutes, so a
threshold is best set in whole minutes. Other sessions get no band.

## How Kevin knows it is armed

It attaches one note as context to every prompt that enters a Kevin session
(his kickoff and each request), in Kevin sessions only. The model reads it
beside the prompt; the operator never sees it. Its own wake carries no note:
a mod's own prompt does not pass through its own hook.

```
kevin-idle: the kevin-idle mod is armed in this session, at kevin.idle_seconds 7200. It sends you `kevin idle check` once you have gone 7200 seconds without a turn, so start no idle waker of your own.
```

The note does not go in the system prompt. Where an organization manages
Claude Code, the managed settings' plugins pass over an installed plugin's
`prompt.compose` and `prompt.context` hooks, and `claude plugin validate`
says so. A `prompt.submit` hook's context reaches the model there.

With no such note (a Codex Kevin, or a Claude without this mod) Kevin starts
`tools/kevin_idle.ts --detach` at launch instead, which wakes him by hermod at
the same threshold.

## Checking it

```
claude plugin validate mods/kevin-idle
claude plugin test mods/kevin-idle
```
