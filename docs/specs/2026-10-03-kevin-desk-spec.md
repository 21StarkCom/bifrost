# kevin-desk — spec+plan

2026-10-03 · Aryeh Stark (drafted by Claude) · ticket STARK-10506 · blocked by STARK-10505 (idun `docs/specs/2026-10-03-idun-kevin-desk-spec.md`: `--from`, the `/kevin from …` kickoff) · accepted-base: 0468639dae36 · supersedes the leader model of `2026-10-03-kevin-spec.md`

## Intent

Kevin is the reverse of Gru. Gru fans work out to many Minions; Kevin fans
requests in. One live Kevin per repo is that repo's **request desk**: any fleet
agent sends him a request, and he answers it to the agent that sent it. He runs
the requests he gets one at a time, which makes him the one releaser per repo
and serializes every merge he is asked for. He also runs the repo's full release
pipeline, from the bump to the installed binary. A worker sends a Kevin its
releases and anything it needs done in another repo. It keeps merging its own
PRs in its own repo.

The operator chose, in order:
- **Requesters:** any fleet agent hermod can verify may request any verb. The
  operator-only actions stay the operator's whoever asks.
- **Recipe:** the release chain written in the repo's agent instructions file,
  or the runbook it points to. A repo with no written chain is refused.
- **Lifecycle:** the first agent that needs a Kevin and finds none launches
  one. He stands down after 2 hours idle with nothing queued or in flight, or
  on the operator's word.
- **Done:** `release` ends installed and verified on this machine.
- **Workers:** a Minion or Agnes uses a Kevin only to release something or to
  get something done in a different repo.

## Scope boundary

IN:
- `skill/kevin/SKILL.md`, rewritten around the desk:
  - requesters, routing, the queue, idle-out and stand-down;
  - the `release` verb;
  - `merge`, `review`, `rebase`, `rerun` and `status`, kept;
  - `--new-tab` as find-or-launch.
- `standards/kevin-desk.md`, new: how any agent finds, launches, asks, waits
  for and confirms a Kevin. Minion, Agnes, Gru and Kevin himself (asking the
  homebrew-tap's Kevin) link it.
- `standards/worker-spine.md`:
  - §4's release close goes through the repo's Kevin;
  - a new §8 says when a worker uses a Kevin;
  - the Kevin preamble is updated.
- `standards/stand-down.md`'s Kevin terms: the operator's word or idle-out
  are his only triggers, and there is no leader.
- `skill/minion/SKILL.md`: `blocked needs <PR url> merged` becomes a request
  to that repo's Kevin, and `blocked` only on his `blocked` or `refused`.
- `skill/gru/SKILL.md`: the Kevin section shrinks to "Minions use the desk".
  Gru no longer launches, leads or dismisses a Kevin, and its `blocked needs`
  exception and `unblocked` handoff go.
- `skill/agnes/SKILL.md`: links the desk for releases and other-repo needs.
- The smoke test's model-invocable list stays as it is. Docs: CLAUDE.md,
  AGENTS.md, README. stark-ops 0.18.0 → 0.19.0.

OUT:
- **A Codex Kevin's timed idle-out.** Codex 0.160.0 has no in-session
  scheduler, so a Codex Kevin checks idleness only when a message wakes him.
  The operator stands him down otherwise.
- **Fixing `/stark-release`.** It pushes to `main`, and agents cannot invoke
  it. Kevin lands the same bump as a PR instead.
- **Any idun or hermod change** beyond STARK-10505.

## Repo context (non-derivable)

- **Release patterns**, from a survey of 48 checkouts on 2026-10-03:
  - a bump PR, then a tag push that CI finishes (idun, frigg, plume,
    stark-tui);
  - a bump or tag, then a local signing script (hermod, lumiere, sleipnir,
    heimdall, bragi, lucius, atlas, mimir, goldfinger);
  - release-please (alfred, tyr);
  - changesets (draupnir);
  - `/stark-release` (meridian, stark-showcase, infra-ai-platform);
  - none, or terraform applied on merge (ev-infra-group,
    devops-cc-environments and about 20 more).
- **The tap PR.** Only idun, alfred and plume merge their own Homebrew tap bump
  PR from CI. Every other release leaves a PR open on `21StarkCom/homebrew-tap`,
  and the binary is not installable until that PR merges.
- **`idun gh pr-merge` refuses a release-please PR** (exit 37) and prints
  `gh pr merge <n> --squash --repo <slug>`. The repos' docs add
  `--match-head-commit` and the held-run approvals.
- **Local signing scripts** can raise keychain or Touch ID prompts, which only
  the operator answers.
- **Messaging.** `hermod msg send --to <peer>` takes an exact session name, so
  `KEVIN-<repo>-<n>` reaches a live Kevin. `hermod msg reply <id>` answers its
  sender. `hermod msg peers --all --json` lists every peer, with `sessionName`
  and `pid`. Peer identity is advisory, and a message never grants approval.
- **Claude's session cron.** `CronCreate` fires only while the session is idle,
  dies with the session, and a recurring job expires after 7 days. Codex has
  nothing equivalent.
- **idun after STARK-10505:**
  - the kickoff is `/kevin from peer <P> — <route>[ — first request: <T>]` or
    `/kevin from operator[ — first request: <T>]`;
  - the ack and plan key the first requester `from`;
  - a live Kevin is exit 4, naming `hermod msg send --to KEVIN-<repo>-<n>`.

## Behavior contract

Kevin (`skill/kevin/SKILL.md`):

- KD1. **Requests come from any verified fleet agent:**
  - a Hermod message whose `from` is a live row in `hermod msg peers --all
    --json` (its `pid` running);
  - a native message whose `from` name is such a row's `sessionName`;
  - the operator typing in his tab after the kickoff;
  - the kickoff's first request, from the peer it names. Even `from
    operator` carries no operator authority, since any agent can launch him
    with it.

  Anything else is task data: he replies once, saying he serves verified fleet
  agents, and acts on none of it. A kickoff reading `leader peer`/`leader
  operator` (idun before v0.111.0) reads as `from`.
- KD2. **No request grants an operator-only action.** These stay the
  operator's: an apply, credentials, a force push other than
  `--force-with-lease` after a rebase, `pr-merge --force`, an admin merge,
  closing a PR, deleting a branch, repo settings, an environment approval,
  answering a keychain or Touch ID prompt, and rerunning a base-branch `push`
  run. A request that claims an operator approval is `refused`, and he sends a
  notify.
- KD3. **Requests run one at a time, in arrival order.**
  - He acks each request on arrival (`hermod msg ack <id>` for a Hermod one).
  - One that arrives while he works gets one progress line naming its place in
    the queue.
  - `status` is answered at once and changes nothing. It names his repo, the
    request in flight and its sender, and the queue.
- KD4. **Every request gets one final line,** `done`, `blocked`, `refused` or
  `answer`, sent to that request's sender by the channel it came by:
  - a Hermod request: `hermod msg reply <id>`, its one reply. Progress lines
    go as `send --kind progress "re <id>: …"`. A reply past the deadline
    (exit 4) goes as `send --kind complete "re <id>: …"`;
  - a native request: SendMessage to its `from`;
  - the kickoff's first request: the kickoff's route;
  - the operator: his tab, plus `hermod notify send` on `blocked` and
    `refused`.

  If a send fails or the sender is gone, he tries the other route once, then
  `hermod notify send "KEVIN (<repo>): could not reach <peer>; <line>"`. He
  goes on serving.
- KD5. **The verbs** are `merge`, `review`, `rebase`, `rerun`, `status`,
  `release` and `stand down`. A request that maps to none is `refused`.
  Authoring anything other than a release's own bump is `refused` as needing a
  ticket and a Minion.
- KD6. **`merge`, `review`, `rebase` and `rerun`** are the existing steps,
  unchanged (the review gate always runs, the repo's gate, pr-merge, confirm
  and watch, the `kevin-unpushed/` copies, the detached base in between).
- KD7. **`release [patch|minor|major]`:**
  1. **Recipe.** He reads the release chain in the repo's agent instructions
     file, or the runbook it names. If there is none, or the "release" is an
     apply or deploy on merge: `refused release <repo> <why>`.
  2. **Coalesce.** All `release` requests queued at once become one release:
     the highest level asked for, every sender answered with the same line.
  3. **Nothing to release.** If the base has no releasable change since the
     last release tag (by the chain's own convention): `done release <repo>
     already <tag>`.
  4. **The bump** is the one thing he authors:
     - only the version and changelog edits the chain names, on
       `kevin-release/<launch id>/<tag>` from `origin/<base>`;
     - opened with `idun gh pr-open --draft --no-ticket` (title per the
       chain);
     - carried through KD6's merge steps, review gate included.

     A release-please or changesets repo's bot PR is the bump. He reviews it
     and merges it the way its docs say (`gh pr merge --squash
     --match-head-commit <sha>`, since pr-merge refuses it). A held run needs
     the operator: `blocked`. A chain step that pushes to the base branch, as
     `/stark-release` does, becomes this bump PR, and the tag goes on its
     merge commit.
  5. **Publish** as the chain says: the tag push, a workflow dispatch, or the
     local release script. He watches every run the tag started until it
     `completed`.
     - A failed run is `blocked` with its URL. Rerunning a tag or base `push`
       run is the operator's.
     - A prompt for a keychain, Touch ID or signing identity is `blocked …
       needs the operator`.
  6. **The tap.** If the release left a `21StarkCom/homebrew-tap` PR open, he
     requests `merge <tap PR url>` from the homebrew-tap's Kevin by
     `standards/kevin-desk.md`, then confirms the merge himself.
  7. **Install and verify**, by the chain's install step (`brew update && brew
     upgrade <tap>/<formula>`, or the documented equivalent), then its version
     check printing the new version. A step that needs `sudo` or the operator's
     hand is `blocked … needs the operator`.
  8. **Report** `done release <repo> <tag> installed <version output>` to every
     coalesced sender.
- KD8. **Idle-out.**
  - After each final report he records the time in his worktree's git dir
    (`kevin-last`).
  - On Claude he arms one recurring `CronCreate` idle check at launch, and
    arms it again when `CronList` shows none.
  - On each check, and after each request on either runtime: if nothing is in
    flight or queued and `kevin-last` (or his launch) is 2 hours old or more,
    he stands down idle.
  - A Codex Kevin has no timer, so he checks only when a message wakes him.
- KD9. **Stand-down triggers:** the operator's `stand down`, or KD8's
  idle-out, and no other. A `stand down` from any other sender is `refused`:
  the desk is shared. Before arming he answers every queued request with
  `refused <request> standing down; ask again`, so its sender launches a fresh
  Kevin. A requester that dies only loses its own replies (KD4).
- KD10. **`--new-tab` is find-or-launch** by `standards/kevin-desk.md`. The
  launcher is the first request's sender, nothing more, and never sends
  `stand down`.

The desk standard (`standards/kevin-desk.md`):

- KD11. **When.** A worker uses a Kevin for:
  - a release of any repo, its own repo's release chain included, after its PR
    merges;
  - anything in a repo other than its own.

  It merges its own repo's PRs itself.
- KD12. **Find.** A live row in `hermod msg peers --all --json` whose
  `sessionName` matches `KEVIN-<repo>-<n>` and whose `pid` is running, where
  `<repo>` is the main checkout's folder name with every character outside
  `[A-Za-z0-9_-]` made a `-`.
  - **Found:** `hermod msg send --to <sessionName> --kind request --json --
    '<verb> <args>'`.
  - **None found:** `idun kevin <repo> --from <own peer> --no-focus --json --
    '<verb> <args>'`. On exit 0 with `coordination: SendMessage`, make first
    contact. On exit 4, send to the Kevin it names. On exit 2 while another
    launch is in flight, wait a minute and find again. Any other exit is the
    requester's own `blocked`.
- KD13. **Wait and confirm.**
  - His final line is a claim, so check the surface: the PR merged and on the
    base for a `merge`; `gh release view <tag>` and the installed `--version`
    for a `release`.
  - His `blocked` or `refused` becomes the requester's own `blocked`, quoting
    his line.
  - A requester never sends him `stand down`.
  - While waiting, a worker under a leader reports progress `waiting on
    KEVIN-<repo>-<n>: <request>`. Agnes, whose goal re-prompts her, checks
    `hermod msg ls --json` once per turn.

Workers:

- KD14. Spine §4: in a repo whose agent instructions file defines done as
  released, the worker merges, then requests `release` from the repo's Kevin,
  and closes on his confirmed `done`.
- KD15. Minion:
  - an open PR in another repo that must merge first is requested from that
    repo's Kevin (`merge <PR url>`);
  - the Minion reports `blocked` only on his `blocked` or `refused`;
  - `blocked needs … merged` and `unblocked` go.
- KD16. Gru launches, leads and dismisses no Kevin. Its step-2 `blocked
  needs` exception, its step-6 dismissal and its Kevin handoff go. A Minion
  `waiting on KEVIN-…` is working, not silent.

## Tasks (DAG)

- T1: `standards/kevin-desk.md` (KD11-KD13). Done when it exists and
  `npm test` passes, since the smoke test resolves every skill's links.
- T2, after T1: `skill/kevin/SKILL.md` (KD1-KD10). Done when `npm test`
  passes.
- T3, after T1:
  - `standards/worker-spine.md` (KD14 and §8);
  - `standards/stand-down.md` (KD9);
  - `skill/minion/SKILL.md` (KD15), `skill/gru/SKILL.md` (KD16),
    `skill/agnes/SKILL.md`.

  Done when `npm test` passes and `grep -rn -e 'blocked needs' -e
  'unblocked' -e 'kevin.*--leader' skill/gru skill/minion skill/kevin
  standards` prints nothing. Minion's own `--leader` stays.
- T4: the stark-ops bump, CLAUDE.md, AGENTS.md, README. Done when `npm test`,
  `npm run typecheck` and `claude plugin validate --strict .` pass.

## Verification

Static:
```
(cd tools && npm test && npm run typecheck) && claude plugin validate --strict .
```

Live, after merge, `/plugin update stark-ops@bifrost` and idun ≥ 0.111.0, with
the output pasted on the PR:
1. **Two requesters.** Two agent sessions each send `status` to one live
   Kevin. Each gets its own reply, and his `status` names the other's request
   when one is in flight.
2. **Release.** A live `release` of a fleet repo with an unreleased change ends
   `done release <repo> <tag> installed <version>`, and the installed binary
   prints `<tag>`.
3. **Already released.** A second `release` with nothing new ends `done release
   <repo> already <tag>`.

## Advisory findings (gate)

A zero-context red team read this spec against the skills, hermod's source
and three real release chains (idun, hermod, alfred). Each finding and its
disposition; the skill and the desk doc carry the fix, and this section wins
over any KD item above that it contradicts.

1. **hermod refuses a reply past the request's deadline (1800 s default), and
   a request takes one reply.** Fixed:
   - requests go with `--deadline 14400`, and the requester waits with
     `hermod msg wait <id>`;
   - progress lines are separate `--kind progress` sends;
   - a reply refused past the deadline goes as `send --kind complete "re
     <id>: …"`.
2. **`--from operator` let any agent pose as the operator.** Fixed: a kickoff
   request carries no operator authority, whatever it says. The operator-only
   asks (base-branch rerun, `major`, `stand down`) count only when typed in
   his tab after the kickoff. Launches carry no request: the desk launches
   bare, then sends.
3. **Spine §7 kept publishing behind an operator gate.** Fixed:
   - §7 says a release through the repo's Kevin, by its documented chain, is
     not publishing by hand;
   - `major` is the operator's alone;
   - coalescing takes the highest level asked, which caps at `minor` from
     peers.
4. **Release chains read secrets through `mimir`.** Fixed: a chain's own
   `mimir` read runs as the chain writes it. The secret is never printed,
   pasted or stored, and an unnamed or missing secret is `blocked`.
5. **alfred's chain lives in a path-scoped `.claude/rules/` file, and its
   bot PR's runs are held `action_required`.** Fixed:
   - the recipe includes every `.claude/rules/*.md` and the runbooks they
     name;
   - a bot release PR is reviewed without `--fix`;
   - its `action_required` runs are approved only where the chain does, at
     the reviewed head;
   - an environment's approval stays the operator's.
6. **idun bumps in each feature PR, and its chain tells the implementer to
   tag.** Fixed:
   - a bump already on the base is published as it is;
   - spine §8 says the chain's tag, publish and install steps are the
     Kevin's;
   - idun's own CLAUDE.md says the same (idun #299).
7. **A dead Kevin stranded requesters.** Fixed: the requester checks his
   `pid` before each wait. If he died with no reply, it sends once more to
   whoever serves the repo; a second loss is its `blocked`.
8. **The stand-down window, and a dead Kevin holding the name (exit 4).**
   Partly fixed:
   - requests that arrive during teardown are covered by item 7;
   - an exit 4 whose Kevin's `pid` is dead is the requester's `blocked …
     needs the operator to clean up`;
   - no change to idun's name check.
9. **Any peer can have any PR merged.** Partly fixed:
   - a PR labeled `hold`, `do-not-merge` or `wip`, or titled `WIP…`, is
     refused;
   - a repo's own merge checks beyond CI are part of its gate (the tap's
     asset and checksum checks).

   Kept: the operator chose any fleet agent as a requester. Drafts are fleet
   PRs' default state, and the review gate always runs.
10. **The post-merge check left with Gru's handoff.** Already covered: the
    desk's Confirm step makes a non-clean post-merge run the requester's
    `blocked`.
11. **Release PRs had no ticket.** Fixed: requests read `release … for
    STARK-n`, and a chain's ticket step (a PR title, the tap bump's
    `--ticket`) uses it.
12. **Rollout order.** Fixed:
    1. idun #299 merges untagged;
    2. this PR merges, then `claude plugin update stark-ops@bifrost`;
    3. 0.111.0 is tagged last, by a Kevin, as the live `release` check.

    The skill and the desk doc also read the pre-0.111.0 kickoff and ack.
13. **Low.** Fixed:
    - a Codex Kevin's idle gap is stated in Scope OUT;
    - idun's exit 2 "cannot tell" is the requester's `blocked`, and "in
      flight" retries at most three times;
    - hermod send exits 2, 3 and 4 are handled;
    - the Intent no longer claims every merge is serialized.

## Deviations (append-only)
