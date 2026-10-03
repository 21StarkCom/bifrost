# cloud-local-routing — spec+plan

2026-10-03 · Aryeh Stark (drafted by Claude) · epic STARK-10514 · children: T2 is STARK-9754 (idun, existing); T1, T3, T4, T5 and T6 are filed from this spec once it is accepted · accepted-base: (filled at sign-off)

## Intent

Gru launches one local Minion per ticket today, and each one holds a slot on
this machine. Some tickets need nothing local: their work lives in one GitHub
repo, and the repo's required CI checks, or commands that need only `git` and
`node`, prove it. Those can run in a Claude cloud session on the self-hosted
pools instead.

The verdict is made once, by whoever writes the ticket, through `/stark-ticket`.
It is recorded on the ticket, and Gru routes on it without asking: `cloud`
goes to `idun cc dispatch --ticket`, anything else to `idun minion`. A cloud
session has no alfred and no idun, and it is told neither to close the ticket
nor to merge, so it stops at an open PR. The repo's Kevin carries that PR
through his existing `merge`, and Gru confirms the merge and closes the
ticket. A cloud failure falls back to a local Minion only when no cloud PR can
still appear. Otherwise it is escalated. A wrong `cloud` verdict costs a
retry, never a stuck ticket and never two PRs.

The operator decided, 2026-10-03:
- **Who routes:** Gru, automatically, per ticket. No question to the operator.
- **Who decides:** stark-ticket, when it writes the ticket. The rules live in
  that skill.
- **Where the verdict lives:** a ClickUp field `runs_in` (the one Gru reads)
  and a `## Runs in` body section. No `cloud` tag.
- **Filing is one call:** alfred grows `--field` on `task start` and
  `task new`.
- **The five cloud rules** in RT2, as written, `git`/`node` commands
  included in rule 2.
- **The finish:** Kevin's `merge`; Gru closes the ticket; a cloud PR Kevin
  cannot merge is closed and redone by a fresh local Minion.
- **Re-verification:** Kevin's `merge` gains `for STARK-n`, which re-runs the
  ticket's `git`/`node` Verification steps on the head he merges, after his
  review fixes (KV1).
- **Cloud cap:** at most `--max-workers` cloud sessions working at once,
  counted apart from the Minions.
- **A long-running session:** Gru tells the operator once it has run 3 hours
  without stopping, and keeps watching it.
- **idun's headless dispatch** is a child of this epic (STARK-9754).

## Scope boundary

IN:
- alfred: the `runs_in` dropdown, a `## Runs in` template heading, and
  `--field` on `task start` and `task new`.
- idun: headless `cc dispatch` (STARK-9754), and a second child that makes it
  usable by Gru: `--repo`/`--cwd` for the whole dispatch, `--json` with
  distinct exit codes, PR-capable pools only, the default branch as the
  session's start, two preamble rules, the session id in the outcome comment,
  and a read of a session's state.
- bifrost `skill/stark-ticket/SKILL.md`: the verdict, its section, its field.
- bifrost `skill/gru/SKILL.md`: route, dispatch, watch the session and its PR,
  hand the PR to Kevin, confirm, close, fall back.
- bifrost `skill/kevin/SKILL.md`: `merge <PR> for STARK-n` re-runs the
  ticket's `git`/`node` Verification steps before the merge.
- bifrost `standards/kevin-desk.md`: the new request form, and how Gru waits
  on a Kevin without blocking.

OUT:
- A `cloud` tag (operator dropped it).
- A Minion taking over a cloud PR's branch. A fallback starts fresh.
- Any other change to Kevin: no new verb, and `merge` without `for STARK-n`
  and `release` are unchanged.
- Agnes, `/minion` and every other launcher: only Gru routes. Agnes and a
  Minion stay local.
- Follow-up messages into a cloud session (STARK-9754's follow-up verb) and
  archiving one (STARK-10513). Gru only reads a session's state.
- Backfilling `runs_in` on existing tickets. Unset is `local`.
- A per-run override flag on Gru. The operator forces a ticket local by
  setting its field.
- The runner image, the pools, devops-cc-environments.
- Making `## Runs in` a required section in alfred's gate.

## Repo context (non-derivable)

**alfred** (`~/Code/21Stark/alfred`):
- `internal/fieldschema/schema.go` is the one field table. A dropdown's first
  option is `fieldschema.None` (`"none"`). An unset dropdown is absent from
  `task show --json`'s `.item.fields` map. ClickUp cannot delete or retype a
  field once created, so a row is never edited after it ships; a changed row
  is a new field and an orphan.
- `alfred repo init` creates the space's fields on purpose; a `--field` write
  whose cache misses ensures the same schema. The first live write of
  `runs_in` creates the field: a one-way door.
- `task edit` is the only write verb that parses `--field` (`task find`
  parses it as a filter); `task start` (`cmd_task_start.go` `taskStart`) and
  `task new` (`cmd_task.go` `taskNew`) parse neither `--field` nor
  `--add-tag`.
- The description gate (`cmd_task_start.go` `refuseShapeless`) requires the
  sections `goal`, `scope`, `acceptance`, `files`, `verification`, and refuses
  any `<…>` placeholder of `startTemplate` left in the text. A placeholder
  under a new `## Runs in` heading is refused if left unfilled; the heading
  itself stays optional.
- `alfred repo info --json` prints `binding`: `clickup`, `jira`, or empty
  when unbound. In a Jira-bound repo `task start`/`task new` file a Jira
  issue; `task edit --field` refuses a Jira key or a bare id there, but a
  `STARK-n` handle still routes to ClickUp.
- The Homebrew `alfred` shadows a dev build (alfred's CLAUDE.md), so a branch
  check runs `go run ./cmd/alfred`.

**idun** (`~/Code/21Stark/idun`):
- `cc dispatch` refuses a real run without a TTY:
  `src/cc/cc.ts` `cc: dispatch: claude --cloud needs an interactive terminal`.
  STARK-9754 adds the headless path (`claude -p <desc> --environment <ccpool>
  --output-format json`, parsing `ok`, `session_id`, `url`).
- `--ticket` takes everything from the cwd today: the `alfred repo info` and
  `task find` reads behind `repoGuard` (`src/cc/cc_ticket.ts`), the GitHub
  origin and seat push check (`src/cc/cc_dispatch.ts`), and claude's git
  source, since the spawn (`src/claude/claude_lib.ts`) passes no `cwd`. There
  is no `--repo` or `--cwd`. `idun minion` resolves `--repo` through frigg in
  `src/lib/ticket_launch.ts`. Gru launches by `--repo`/`--cwd`, never by
  `cd`-ing its shell into another checkout.
- claude has a hidden `--ref`: "Branch, tag, or SHA to check out in the
  remote session; defaults to local current branch. Requires --cloud or
  --environment." (claude 2.1.288). Without it a session starts from whatever
  branch the checkout has checked out.
- Pools come from `cc.dispatch.environments` in `~/.config/idun/config.json`
  (`{ name, id }` rows: cloud-agent-1..3). `choosePool` picks the least loaded
  (`capacity_in_use + pending_session_count`) and never refuses on load.
- The exit-0 outcome comment names the session id only when idun's session
  lookup works; otherwise it says "Session not identified". A dispatch with
  no git source, or one that landed off the self-hosted pools, still exits 0
  with warnings (`describeSession`).
- The ticket preamble (`renderTicketDescription`) says: read the repo's
  CLAUDE.md, work on a branch, open a PR titled `type(STARK-n): subject`, do
  not close the ticket. It also carries the root rules, which end the spine in
  a squash-merge, and tells the session to follow a missing tool's intent
  with what it has. So without a "do not merge" rule, the session can merge
  its own PR with `gh pr merge`.
- STARK-10513 (in progress) reads a session as its owning seat:
  `GET /v1/sessions/<id>?beta=true`, which returns `session_status`
  (`"pending"` observed). It also tries each candidate seat to find the owner.

**The cloud session** (devops-cc-environments `runner/Dockerfile`,
`runner/hooks/spawn-runner.ts`, `CLAUDE.md`):
- Tools: `claude`, `git`, `gh`, `curl`, `openssh-client` and the bare `node`
  22 binary (no `npm`/`npx`). Nothing can be installed.
- Egress: `api.anthropic.com:443` only. Git goes through Anthropic's proxy.
  `gh` works only under governed git: confirmed for cloud-agent-1 since
  2026-09-24, unverified for cloud-agent-2/-3 (STARK-9577 Phase 0). Without
  `gh` the session can push a branch but cannot open the PR.
- Cloud sessions push `claude/…` branches (the runner's resume trusts
  `claude/*` refs). Minions push `worktree-STARK-n` (Claude) or `STARK-n`
  (Codex) (`idun src/minion/minion.ts`).
- 1 CPU, 4 GiB, 10 GiB disk. Released after 15 min idle; a Stop hook asks the
  session once to commit and push, and the runner's own push at release is
  best-effort. The 210-minute cap counts from the session's spawn on a pod,
  not from dispatch: at 210 it is released, at 225 sent SIGTERM, and the Job
  deadline is 240. A released session resumes only on a new message.
- Pools are shared with other seats and capped at 10 pods. Past the cap a
  session waits for a pod, for as long as it takes; nothing refuses it.

**bifrost:**
- Gru never writes a ticket custom field. Closing a ticket is a status move
  (`alfred task move STARK-n done`), not a field write.
- Kevin's `merge <PR url>` (`skill/kevin/SKILL.md`, "merge and review") runs
  `/code-review xhigh --fix`, un-drafts, runs the repo's gate on the head he
  will merge, posts one PR comment with the gate run, merges with
  `idun gh pr-merge`, confirms, and watches the post-merge runs. He refuses a
  closed or merged PR and a held one (`hold`, `do-not-merge`, `wip` label,
  `WIP` title), and reports `blocked` on a head mismatch (exit 16) or a red
  required check. Closing a PR is outside his authority.
- `standards/kevin-desk.md` step 4 waits with a blocking `hermod msg wait`.
  Gru cannot block: it watches many tickets. `hermod msg status <id> --json`
  is the non-blocking read (`acknowledgement`, `replyId`, `body`).
- Gru's no-queue merge hold (`skill/gru/SKILL.md` Authority) runs one merge
  per repo at a time. A Minion "merges on its own and says nothing before it
  does", so a hold must be sent ahead of time, never at the moment of merge.
- Gru's "Kevin" section says it "neither launch[es], lead[s] nor dismiss[es]
  a Kevin" and asks one only for work no ticket covers. `CLAUDE.md` says
  "Gru neither launches, leads nor dismisses a Kevin"; `AGENTS.md` says "Gru
  neither launches nor dismisses one". GR8 changes all three.
- Gru posts ticket comments today only to quarantine a claimed approval
  (`alfred task comment --body-file`); GR11 adds the fallback comment.
- The worker spine re-runs verification after the review's fixes
  (`standards/worker-spine.md`). On a cloud PR, CI re-runs the required checks
  on the head Kevin merges, but nothing re-runs a `git`/`node` step the
  session ran before his `--fix`. KV1 makes Kevin do it. A Hermod request
  body is plain prose with no `$`, quotes or backticks (kevin-desk "The
  requests"), so the commands cannot ride the request: Kevin reads them off
  the ticket with alfred, as a local session can.
- Kevin's `release [patch|minor|major] [for STARK-n]` already takes a ticket
  and moves none; `merge … for STARK-n` follows the same form.
- Skill edits bump the owning plugin's `version` in
  `.claude-plugin/marketplace.json`: stark-ticket → `stark-plan`; gru and the
  worker `standards/` docs → `stark-ops`.

## Behavior contract

### alfred (AL)

- AL1. The schema carries `runs_in`: type `drop_down`, options `none`,
  `cloud`, `local`, in that order, not laddered.
- AL2. `alfred task start --template` prints a `## Runs in` section after
  `## Verification`, with one placeholder line, `<local, or cloud by
  /stark-ticket's rules — then why>`. `requiredSections` is unchanged.
- AL3. `task start` and `task new` accept `--field <name>=<value>`,
  repeatable, with `task edit`'s validation. WHEN a field value is invalid,
  or the verb would file a Jira issue, the verb shall refuse with exit 2
  before any write: nothing created, nothing journaled.
- AL4. WHEN `task start` or `task new` exits 0 with `--field`, the ticket
  shall carry the field. IF the ticket was created but a field write failed,
  THEN the verb shall exit non-zero and name both the ticket and the field.
- AL5. `task new --on-repo <repo> --field …` sets the field on the ticket
  filed in that repo's list.

### idun (ID)

- ID1. STARK-9754 as written: a headless `cc dispatch` on a self-hosted pool,
  no retry.
- ID2. `cc dispatch --ticket` takes `--repo <name>` (resolved as `idun minion`
  resolves it) or `--cwd <path>`, mutually exclusive. The resolved directory
  is used for everything the cwd supplies today: the alfred reads behind
  `repoGuard`, the GitHub origin and seat push check, and claude's spawn
  `cwd`. Without either flag, the cwd as today.
- ID3. `cc dispatch --json` on a real headless run, by exit code:
  - **0:** a session was made. stdout is one JSON object with `ticket`,
    `session_id`, `url`, `environment`, `seat` and `warnings`: an array,
    empty when clean, of `{ code, text }`, where `code` is `no_source` (the
    session has no git source and can never push or open a PR), `not_byoc`
    (not on a self-hosted pool) or `other_pool`.
  - **3:** uncertain: the submission ran, and its outcome could not be read
    (unparseable output, a lost connection). A session may exist.
  - **any other non-zero:** nothing was dispatched (a refusal before the
    spawn, or claude's `ok:false`).
- ID4. A `--ticket` dispatch picks only among pools marked able to open a PR
  (idun's choice of mechanism; proposal: `pr: true` on the
  `cc.dispatch.environments` row). IF none is marked and visible, THEN it
  shall refuse, nothing dispatched. A free-text dispatch is unchanged.
- ID5. A `--ticket` dispatch passes claude `--ref <the repo's default
  branch>`, so the session starts from it whatever the checkout has checked
  out.
- ID6. The ticket preamble gains three rules: "Run every Verification step
  you can and paste each command and its output in the PR body.", "Do not
  merge the PR." and "Open the PR once, when the work is finished, and push
  nothing to it afterwards." The PR body's runs are context for Kevin's
  review, not the evidence: KV1 re-runs them.
- ID7. A `--ticket` dispatch that exits 0 always names the `session_…` id from
  claude's JSON in its outcome comment, whether or not the session lookup
  works.
- ID8. `idun cc session <session_…|URL> --json` prints `{ session_id, seat,
  state, status }`, finding the owning seat as STARK-10513 does. `state` is
  `working` while the API reports the session queued or running, `stopped`
  for any other status the API returns, and `unknown` when no seat can read
  it. `status` is the API's raw value. unverified: the API's status values —
  check: read one session through its whole life during T3, and pin the
  mapping in a test.

### stark-ticket (RT)

- RT1. Every ticket stark-ticket writes or rewrites carries a `## Runs in`
  section. Its first word is the verdict, `cloud` or `local`, then ` — ` and
  the reason. A `cloud` reason names the required checks and commands that
  prove the Acceptance (`cloud — CI's test and typecheck cover every
  Acceptance line`); a `local` reason names the first rule the ticket fails.
- RT2. The verdict is `cloud` only when every rule holds; otherwise `local`,
  and any doubt is `local`:
  1. One repo with a GitHub origin; the work needs no change in another repo.
  2. Every Verification step either names one of the repo's required PR
     checks by its check name (`CI's test check passes`), or is a command
     that needs only `git` and `node` inside the checkout and writes nothing
     outside it. Read the workflow file and the ruleset; do not guess. A step
     that a required check already runs is written as the check's name, not
     its command: Kevin skips named checks and runs commands (KV1).
  3. Nothing local or live: no alfred, idun, mimir, frigg, hermod, cmux,
     Keychain, gcloud, kubectl, terraform or brew; no live smoke; no secrets;
     no writes to ClickUp, Slack or GCP.
  4. Not an epic; no open `Blocked by`.
  5. Fits about 3 hours on 1 CPU and 4 GiB.
- RT3. The filing call carries `--field runs_in=<verdict>`: `task start`,
  `task new` (with `--on-repo` when it applies), or `task edit` for a rewrite,
  together with `--desc-file`. A rewrite re-decides the verdict and writes the
  field and the section in the same call.
- RT4. WHERE the filing would create a Jira issue (`alfred repo info --json`
  → `binding` other than `clickup`), stark-ticket passes no `--field`, and the
  section reads `local — not a ClickUp ticket`.

### Gru (GR)

Terms:
- **Route:** from GR1.
- **Cloud PR:** a PR in the ticket's repo whose title contains `(STARK-n)`
  and whose head branch starts with `claude/`. Gru finds it with
  `gh pr list --repo <o>/<r> --state all --search "STARK-n in:title" --json
  number,url,title,state,headRefName,mergeCommit`. A Minion's PR is never a
  cloud PR.
- **Session:** the `session_id` from the dispatch's JSON, or on a rerun the
  newest `idun cc dispatch:` comment on the ticket that names one (ID7). Its
  state is `idun cc session <id> --json`'s `state` (ID8).
- **Fallen back:** the ticket carries a comment opening `Gru: cloud
  fallback`. A fallen-back ticket is `local` for good, in this run and every
  later one, and step 2's Minion rules apply to it.

Routing:
- GR1. In step 1 Gru reads `runs_in` (`alfred task show STARK-n --json`,
  `.item.fields.runs_in`; absent is unset) and the first word of the
  `## Runs in` section. The route is `cloud` only when both read `cloud`. IF
  exactly one of them reads `cloud`, THEN the route is `local` and the step-6
  report names the ticket, the field and the section. Every other case is
  `local` with nothing to report, a Jira ticket's `local` section with no
  field included.

Each pass (step 2, and step 4's 30-minute pass), for each cloud-routed ticket
that has not fallen back, in this order:
- GR2. **A merged cloud PR** → GR10, whatever else holds. Gru checks this
  first, before any dispatch, hand-off, fallback, or reading of a Kevin reply.
- GR3. **An open cloud PR.** Its session `stopped`, or no session known → hand
  it to Kevin (GR8), unless a Gru request for it is in flight. Its session
  `working` or `unknown` → wait.
- GR4. **No cloud PR, a session known.** `working` or `unknown` → wait.
  `stopped` → fall back (GR11). A session still not `stopped` 3 hours after
  its dispatch → tell the operator once, with its URL, and keep watching it;
  never fall back while it is not `stopped`, since a fallback while the
  session can still open a PR makes two PRs. The 3 hours is a heads-up, not a
  verdict: the runner's 210-minute cap counts from the pod's spawn, so a
  session that queued for a pod can still be working past it. GR3 and GR4 go
  on as usual once it stops.
- GR5. **A closed, unmerged cloud PR** that GR11 did not close (no fallback
  comment) → escalate; someone else closed it.
- GR6. **No cloud PR, no session** → ready for dispatch (GR7).

Dispatch (step 3):
- GR7. Gru dispatches a ready cloud ticket with `idun cc dispatch --ticket
  STARK-n --repo <ticket's repo> --json`, resolving the repo exactly as for
  `idun minion` (the proven `--cwd` fallback included). It does so only while
  fewer than `--max-workers` of its cloud sessions read `working` or
  `unknown`. That count is kept apart from the Minions: N Minions and N cloud
  sessions may run at once. By exit code (ID3):
  - **0, `warnings` empty:** wait (GR3, GR4).
  - **0 with a `no_source` warning:** the session can never open a PR → fall
    back (GR11), naming it.
  - **0 with any other warning:** the session may still open a PR → escalate,
    naming it, and watch it under GR3 and GR4 like any other.
  - **3:** escalate; the ticket is blocked. Never fall back, since a session
    may exist.
  - **any other:** nothing was dispatched → fall back (GR11).

Hand-off (step 4):
- GR8. Gru sends `merge <PR url> for STARK-n` to the repo's Kevin by
  `standards/kevin-desk.md`: find him, launch him bare if none, and send with
  `--deadline 14400`. This replaces Gru's "neither launch, lead nor dismiss a
  Kevin" for cloud PRs: Gru may launch a bare Kevin through the desk, and
  still never leads or dismisses one. At most one Gru request per repo's
  Kevin is in flight. In a no-queue repo the Kevin merge takes that repo's one
  merge slot: before sending it, Gru tells every live Minion in that repo that
  has not merged to hold its merge. Once Kevin's merge is confirmed, the repo
  returns to its one-merge-at-a-time sequence: Gru clears one held Minion at
  a time, as Authority's hold already does. A Minion already merging contends
  by the spine's §4 rule.
- GR9. Gru reads each in-flight request once per pass, never with a blocking
  wait: `hermod msg status <request id> --json`, then on `acknowledgement`
  `replied`, `hermod msg status <replyId> --json`'s `body`. Kevin's death,
  an expired request and his stand-down resend follow kevin-desk step 4. A
  rerun `start` holds no request ids: GR3 sends again, and Kevin answers a
  request for an already-merged PR `refused`, which GR2 turns into GR10.

Outcomes:
- GR10. **Done.** On Kevin's `done merge <PR url> merged <sha> …`, or GR2:
  the PR reads `MERGED`, its `mergeCommit` is on the ticket's base
  (`gh api repos/<o>/<r>/compare/<sha>...<base> --jq .status` → `identical`
  or `ahead`), and no post-merge run failed (kevin-desk step 5). The
  verification evidence is Kevin's gate comment (the required checks'
  conclusions) plus, when the ticket's Verification holds any command, a PR
  comment opening `Kevin verification for STARK-n at <sha>` (KV1) whose
  `<sha>` is the PR's final `headRefOid` or its `mergeCommit`, with one entry
  for each command step Gru itself reads off the ticket. A comment that does
  not match all three (the opening line, the sha, every step) is no evidence:
  a Kevin running a skill older than T6 reads `for STARK-n` as a plain merge
  and posts no such comment. In a repo whose done is
  *released*, Gru then sends Kevin `release for STARK-n` and confirms it by
  kevin-desk step 5. Then Gru runs `alfred task move STARK-n done` and checks
  that `alfred task show` reads `done`. IF the evidence is missing or does not
  match, Kevin reported `verification failed after merge`, a post-merge run
  failed, or the release failed, THEN the ticket stays open and Gru
  escalates. Merged work is never redone.
- GR11. **Fall back.** WHEN Kevin's line is `blocked …` or `refused …`
  (after GR2, and other than kevin-desk's stand-down resend), or GR4 or GR7
  says so, Gru does three things in order:
  1. Posts `alfred task comment --body-file <file> STARK-n`, the file opening
     `Gru: cloud fallback — <why>`, with the session URL when there is one.
  2. Closes the open cloud PR, if there is one, with `gh pr close <url>
     --comment '<why, quoting Kevin's line>; Gru is redoing STARK-n with a
     local Minion.'`. Gru never closes any PR that is not a cloud PR.
  3. Treats the ticket as a ready `local` ticket that waits for a Minion slot.
- GR12. **Stray.** At a fallen-back ticket's Minion `done`, IF an open cloud
  PR for it exists, THEN Gru escalates its URL and closes nothing.
- GR13. Gru never sends a message into a cloud session, never archives one,
  never merges a PR itself, and never closes a PR except under GR11.
- GR14. The step-6 report lists cloud tickets on their own: dispatched,
  merged by Kevin and closed, fallen back (with the reason), escalated, and
  field/section mismatches.
- GR15. Cloud routing needs the idun release that ships T3 (T5 names its
  version). IF `idun --version` is older, THEN every ticket routes `local`,
  and the report says why once.

### Kevin (KV)

- KV1. **`merge <PR> for STARK-n`** runs `merge`'s steps 1-5 as today, then
  verifies before step 6:
  1. **Rebase first.** `idun gh pr-merge` rebases onto the base before it
     merges, so Kevin rebases the PR onto `origin/<base>` and pushes it the
     way his `rebase` verb does. The head he verifies is then the head
     pr-merge merges, unless the base moves again.
  2. **The steps.** He reads the ticket (`alfred task show STARK-n`) and takes
     each Verification step that is a command. A step that names a required
     check is skipped: CI runs it on that head.
  3. **Under his Authority.** A command runs only in his worktree. IF it
     needs anything beyond `git` and `node`, or would write outside the
     worktree or to any remote (a push, a tag, `gh`, an install), THEN he
     does not run it, reports `blocked … verification step <k> needs the
     operator`, and runs nothing more. Such a ticket was routed to the cloud
     by mistake.
  4. **The record.** He posts one PR comment opening `Kevin verification for
     STARK-n at <sha>`, `<sha>` being the head he ran on, with each command
     and its output. IF a step fails, THEN he reports `blocked … verification
     step <k> failed, see <comment url>` and merges nothing. Commands and
     output go only in the PR comment, never in his reply line, which stays
     plain prose.
  5. **After the merge** (step 8), IF the PR's final `headRefOid` is not that
     `<sha>` (pr-merge rebased onto a base that moved), THEN he runs the steps
     again at the detached `mergeCommit` and posts a second comment with the
     same opening line at that sha. A failure there is `blocked …
     verification failed after merge, see <comment url>`; the merge stands.

  Every `blocked` keeps `merge`'s existing rules for a block,
  `kevin-unpushed/` included.
- KV2. IF the PR's title does not contain `(STARK-n)`, THEN Kevin replies
  `refused … PR is not STARK-n's` and runs nothing.
- KV3. `merge <PR>` without `for STARK-n` is unchanged, and `review <PR>`
  takes no `for`. Like `release … for STARK-n`, the form moves no ticket and
  writes no ticket field.

### Kevin desk (KD)

- KD1. `standards/kevin-desk.md` step 4 gains a third waiting mode, **under
  Gru's loop**: one non-blocking `hermod msg status` read per request per
  pass, never `hermod msg wait`. Kevin's liveness check and the one resend are
  unchanged.
- KD2. Its "When" names Gru's use: a cloud ticket's PR and its release. "The
  requests" gains `merge <PR url> for STARK-n`: `merge`, plus a re-run of the
  ticket's command Verification steps on the rebased head, and again at the
  merge commit if the head moved (KV1).

## Tasks (DAG)

Each task ships as its own PR in its own repo, through that repo's spine.

- **T1 — alfred (child C1): AL1-AL5.** Files:
  `internal/fieldschema/schema.go` (+ test),
  `internal/cli/cmd_task_start.go`, `internal/cli/cmd_task.go` (+ tests),
  alfred's CLAUDE.md and help text. One test per criterion:
  `TestRunsInSchemaRow` (AL1), `TestRunsInTemplateHeading` (AL2),
  `TestRunsInStartNewFieldFlag` (AL3), `TestRunsInFieldWriteFailure` (AL4),
  `TestRunsInOnRepoField` (AL5). Done when, in the alfred checkout:
  ```
  out=$(go test ./internal/fieldschema/... ./internal/cli/... -run 'TestRunsIn' -v 2>&1) &&
  for t in TestRunsInSchemaRow TestRunsInTemplateHeading TestRunsInStartNewFieldFlag TestRunsInFieldWriteFailure TestRunsInOnRepoField; do
    grep -e "--- PASS: $t" <<<"$out" >/dev/null || { echo "missing: $t"; exit 1; }
  done &&
  go run ./cmd/alfred task start --template | grep -x '## Runs in'
  ```
  `go test -run` matching nothing exits 0, hence the check per name. Depends
  on nothing.
- **T2 — idun (STARK-9754): ID1.** Its tests' names contain `headless`. Done
  when `bun test src/cc -t 'headless'` passes (bun refuses a filter that
  matches no test) and that ticket's live probe output is pasted on it.
  Depends on nothing.
- **T3 — idun (child C3b): ID2-ID8.** Files: `src/cc/cc.ts`,
  `src/cc/cc_dispatch.ts`, `src/cc/cc_ticket.ts`, `src/lib/ticket_launch.ts`,
  `src/claude/claude_lib.ts`, a new `src/cc/cc_session.ts` (+ tests),
  `src/tui/capabilities.ts`, `scripts/smoke-help.ts`, `scripts/smoke-tui.ts`
  (a new verb is registered in all three), idun's CLAUDE.md, the dispatch
  spec. Done when, after `bun install`, `bun test src/cc` passes and
  `bun test src/cc -t '<name>'` passes for each of: `dispatch --ticket
  --repo` (ID2, asserting the spawn's `cwd`), `dispatch --json` (ID3, all
  three exit classes), `dispatch pr pools` (ID4), `dispatch default branch`
  (ID5), `ticket preamble` (ID6, all three sentences verbatim), `ticket outcome
  session` (ID7), `cc session` (ID8). Run them one per name: bun refuses a
  filter that matches nothing, so each run proves its test exists. Plus the
  live evidence on the ticket: one headless `--ticket --repo … --json`
  dispatch whose session starts on the default branch, and `idun cc session`
  read across that session's life. Depends on T2 (same code path); reuses
  STARK-10513's owner lookup once merged.
- **T4 — bifrost (child C2): RT1-RT4.** Files: `skill/stark-ticket/SKILL.md`,
  `.claude-plugin/marketplace.json` (stark-plan bump), `CLAUDE.md`,
  `AGENTS.md`. Done when `(cd tools && npm test)` passes and, from the repo
  root:
  ```
  for p in 'Hub origin' 'required PR check' 'Keychain' 'not an epic' '1 CPU' 'runs_in=' '## Runs in' 'binding'; do
    grep -q -F -e "$p" skill/stark-ticket/SKILL.md || { echo "missing: $p"; exit 1; }
  done
  git show origin/main:.claude-plugin/marketplace.json > /tmp/stark-plan-base.json
  node -e 'const v=(f)=>JSON.parse(require("node:fs").readFileSync(f,"utf8")).plugins.find((p)=>p.name==="stark-plan").version;process.exit(v("/tmp/stark-plan-base.json")===v(".claude-plugin/marketplace.json")?1:0)'
  ```
  Three separate commands, each of which must succeed: a worktree session's
  guard refuses a `git` call nested in `$(…)` or in a `node` string
  (measured), and the implementer runs in a worktree.
  Depends on T1: until `--field` exists on `task start`/`new`, the skill's
  filing line fails.
- **T6 — bifrost (child C5): KV1-KV3, KD2.** Files: `skill/kevin/SKILL.md`,
  `standards/kevin-desk.md`, `.claude-plugin/marketplace.json` (stark-ops
  bump), `CLAUDE.md`, `AGENTS.md`. Done when `(cd tools && npm test)` passes
  and, from the repo root, each of these succeeds:
  ```
  grep -q -F -e 'merge <PR> for STARK-n' skill/kevin/SKILL.md
  grep -q -F -e 'alfred task show STARK-n' skill/kevin/SKILL.md
  grep -q -F -e 'PR is not STARK-n' skill/kevin/SKILL.md
  grep -q -F -e 'Kevin verification for STARK-n' skill/kevin/SKILL.md
  grep -q -F -e 'verification step' skill/kevin/SKILL.md
  grep -q -F -e 'verification failed after merge' skill/kevin/SKILL.md
  grep -q -F -e 'merge <PR url> for STARK-n' standards/kevin-desk.md
  grep -q -F -e 'cloud' standards/kevin-desk.md
  git show origin/main:.claude-plugin/marketplace.json > /tmp/stark-ops-base.json
  node -e 'const v=(f)=>JSON.parse(require("node:fs").readFileSync(f,"utf8")).plugins.find((p)=>p.name==="stark-ops").version;process.exit(v("/tmp/stark-ops-base.json")===v(".claude-plugin/marketplace.json")?1:0)'
  ```
  Depends on nothing.
- **T5 — bifrost (child C4): GR1-GR15, KD1.** Files:
  `skill/gru/SKILL.md`, `standards/kevin-desk.md`,
  `.claude-plugin/marketplace.json` (stark-ops bump), `CLAUDE.md`,
  `AGENTS.md`. Done when `(cd tools && npm test)` passes and, from the repo
  root:
  ```
  for p in 'cc dispatch --ticket' 'runs_in' 'Gru: cloud fallback' 'gh pr close' 'claude/' 'idun cc session' 'state all' 'merge <PR url> for STARK-n' 'Kevin verification for STARK-n' 'no_source'; do
    grep -q -F -e "$p" skill/gru/SKILL.md || { echo "missing: $p"; exit 1; }
  done &&
  grep -q -F -e "Gru's loop" standards/kevin-desk.md &&
  ! grep -q -F -e 'neither launch, lead nor dismiss' skill/gru/SKILL.md &&
  ! grep -q -F -e 'neither launches, leads nor dismisses a Kevin' CLAUDE.md &&
  ! grep -q -F -e 'Gru neither launches nor dismisses one' AGENTS.md
  git show origin/main:.claude-plugin/marketplace.json > /tmp/stark-ops-base.json
  node -e 'const v=(f)=>JSON.parse(require("node:fs").readFileSync(f,"utf8")).plugins.find((p)=>p.name==="stark-ops").version;process.exit(v("/tmp/stark-ops-base.json")===v(".claude-plugin/marketplace.json")?1:0)'
  ```
  Separate commands as in T4, each of which must succeed.
  Depends on T1 (Gru reads the field), T3 (Gru's dispatch and session read)
  and T6 (Gru sends `merge … for STARK-n`; both edit `kevin-desk.md`,
  `CLAUDE.md` and `AGENTS.md` and bump stark-ops, so T5 rebases onto T6 and
  bumps again).

## Verification

Static, in bifrost after T4 and T5:
```
(cd tools && npm test && npm run typecheck) && claude plugin validate --strict .
```

Live, after T1-T6 are merged, released where their repo releases, and
`/plugin update` has fetched stark-plan and stark-ops. Paste every output on
the epic:
1. **Verdicts.** `/stark-ticket` files a small bifrost change whose
   Verification is CI's `test` plus one `node` command:
   `alfred task show <it> --json` has
   `.item.fields.runs_in` `cloud`, and its body opens `## Runs in` with
   `cloud — `. It also files a trivial idun change, which reads `local`.
2. **Cloud end to end.** `/gru start --tickets <both>`: the bifrost ticket is
   dispatched (an `idun cc dispatch:` comment naming a `session_` id); its
   PR's head branch starts `claude/`; `idun cc session <id> --json` reads
   `working`, then `stopped`; Kevin's reply is `done merge …`; the PR carries
   a `Kevin verification for STARK-n at <sha>` comment with the `node`
   command and its output, `<sha>` matching the PR's final head or merge
   commit;
   `gh pr view <url> --json state,mergeCommit` reads `MERGED`; and
   `alfred task show` reads `done`, with no operator step. The idun ticket
   goes to a local Minion.
3. **Mismatch.** A third ticket with `runs_in` set to `cloud` by
   `alfred task edit` and a `## Runs in` section reading `local`: Gru launches
   a Minion, and its report names the mismatch.
4. **Fallback.** With every pool's PR mark removed from idun's config for one
   Gru run (the operator's edit, restored after), a `cloud` ticket's dispatch
   is refused by ID4: the ticket gets a `Gru: cloud fallback` comment, goes to
   a local Minion in the same pass, and the report names why.

## Open questions

None. The operator settled the three this draft raised (2026-10-03):
- **RT2 rule 2:** keep `git`/`node` commands. Kevin re-runs them on the
  merged head after his fixes (KV1, task T6).
- **Cloud cap:** the same number as `--max-workers`. Read as N cloud sessions
  alongside N Minions, counted apart (GR7); if one shared budget was meant,
  only GR7's count changes.
- **A long-running session:** a heads-up to the operator at 3 hours, no
  archive, no fallback (GR4).

## Advisory findings (gate)

Three zero-context, read-only reviewers read the first draft: a red team, a
fact-checker (about 62 claims re-verified against source), and the
done-when advisory pass. Their findings and what became of each:

| Finding | Disposition |
|---|---|
| The session can merge its own PR: the root rules it carries end in a squash-merge, and nothing forbids it | Fixed: ID6 "Do not merge the PR"; GR2 finds a merged cloud PR first |
| No step checks for a merged PR before a re-dispatch or fallback (a rerun, or a second `merge` request answered `refused`) | Fixed: GR2 runs first on every pass; GR9 |
| The 225-minute clock ran from dispatch, but the runner's cap runs from the pod's spawn, and a full pool queues without limit | Fixed: no clock. GR3/GR4 wait on the session's state (ID8); no fallback while it can still open a PR; a heads-up to the operator at 3 h |
| GR5 and GR6 shared the 225-minute boundary, so GR6's timeout could never fire | Gone with the clock |
| `--repo` alone would still seed the session from Gru's own worktree | Fixed: ID2 moves every cwd-derived read and the spawn; the T3 test asserts the spawn's `cwd` |
| Any `(STARK-n)` PR was taken to be the cloud session's, though a Minion's PR has the same title | Fixed: a cloud PR's head branch starts `claude/`; GR11 closes only those |
| The session's node-only Verification output would predate Kevin's fixes | Fixed, per the operator: rule 2 is kept, and Kevin's `merge … for STARK-n` re-runs those commands on the merged head (KV1, T6). A first fix narrowing rule 2 was overruled |
| A non-zero dispatch may still have made a session; the outcome comment names it only when idun's lookup works | Fixed: ID3 exit 3 escalates and never falls back; ID7 |
| The GR8 hold was sent "when a Minion reaches its merge", which Gru cannot see | Fixed: the hold goes out before Kevin's merge is sent |
| A session with no git source still exits 0 with warnings | Fixed: GR7 falls back on any warning |
| A Jira ticket's `local` section with no field read as a mismatch | Fixed: GR1 reports a mismatch only when exactly one source says `cloud` |
| GR11 would fire on every fallen-back ticket before its Minion's `done` | Fixed: GR12 checks at the Minion's `done` and matches `claude/` PRs only |
| GR16 belonged to no task | Fixed: GR15, in T5 |
| T1's binary check ran the Homebrew alfred | Fixed: `go run ./cmd/alfred` |
| T2's done-when was not a command | Fixed: `bun test src/cc -t 'headless'` plus the live probe |
| T4/T5's version checks hard-coded today's versions | Fixed: compared with `origin/main`'s manifest, in a form a worktree session's guard runs (the first fix, a nested `git merge-base`, was refused by the guard when measured) |
| RT2's rules, GR8's hand-off and the Kevin-rule change had no done-when | Fixed: phrase checks per rule and per changed sentence |
| T3's files missed `ticket_launch.ts` and `claude_lib.ts` | Fixed, plus the new verb's registration files |
| Facts: 210 is a release, not a kill; the Stop hook asks rather than pushes; STARK-9523 is closed (now STARK-9577); `.item.fields`; `binding` can be empty; `--field` on a `STARK-n` handle from a Jira-bound cwd; `AGENTS.md` wording | Fixed in Repo context |
| A worktree guard refusing `cd` is unproven | Reworded: Gru launches by `--repo`/`--cwd`, which needs no claim about the guard |

Scoped pass over the text the operator's answers added (KV1-KV3, KD2, T6,
and the changed GR4, GR7, GR8, GR10, RT1, RT2, ID6). It ran T6's checks on
today's files (all fail) and found:

| Finding | Disposition |
|---|---|
| KV1 verified the pre-merge head, but `idun gh pr-merge` rebases onto the base before it squash-merges, so the merged code was never the code verified | Fixed: KV1 rebases first, and re-runs at the merge commit if the head moved |
| GR10 could not tell Kevin's verification ran: a Kevin on a pre-T6 skill reads `for STARK-n` as a plain merge, and his gate comment carries no marker | Fixed: a `Kevin verification for STARK-n at <sha>` comment, matched on the line, the sha and every command step Gru reads off the ticket |
| KV1's `blocked` line put a raw command and its output into a Hermod reply, which must carry no `$`, quotes or backticks | Fixed: the reply names the step number and the comment URL; commands and output stay in the PR comment |
| A bifrost Verification step like `(cd tools && npm test)` passed RT2 as a required check, then KV1 blocked it as needing `npm` | Fixed: RT2 writes a required check by its check name, and KV1 skips named checks |
| KV1 ran ticket text without Kevin's Authority limits (a push to the base, a tag, an install) | Fixed: KV1 step 3 |
| GR7 fell back on any dispatch warning, but only `no_source` stops a session from opening a PR | Fixed: warning codes in ID3; `no_source` falls back, anything else escalates and is watched |
| GR8 lifted the hold on every held Minion at once | Fixed: back to one merge at a time |
| T3 checked "both" ID6 sentences after ID6 grew to three | Fixed |
| T6 pinned neither of KV1's `blocked` forms nor KD2's "When" text | Fixed: phrase checks for the marker, both `blocked` forms and the "When" text |

## Deviations (append-only)
