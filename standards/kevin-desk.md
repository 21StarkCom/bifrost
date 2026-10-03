# The Kevin Desk

How any agent gets something done through a repo's Kevin. One live Kevin per
repo is that repo's request desk ([`/kevin`](../skill/kevin/SKILL.md)). Any
fleet agent sends him a request, and he answers it to the agent that sent it.
`/minion`, `/agnes`, `/gru` and Kevin himself (asking another repo's Kevin)
run this doc; none restates it.

This doc is runtime-neutral and is shipped byte-identical to both runtimes.
**The repo's agent instructions file** means `CLAUDE.md` on Claude and
`AGENTS.md` on Codex, and **a skill is written in its Claude form** (`/kevin`
is `$kevin` on Codex).

## When

- **A release** of any repo, your own repo's included. When the repo's agent
  instructions file defines done as *released*, you merge your PR, then send
  `release` to the repo's Kevin instead of running the chain yourself. One
  releaser per repo means no two agents race for a version number.
- **Anything in a repo other than your own**: a PR there that must merge
  first, a review, a rebase, a failed run, a status. A worktree session's git
  cannot leave its own worktree, and the other repo's rules are its Kevin's
  to apply.

Your own repo's PR you still carry through the spine and merge yourself.

## The requests

One per message, as plain prose with no `$`, quotes or backticks, since a
Hermod body is a shell argument. Name every PR and run by URL.

- `merge <PR url>`: review it, gate it, merge it, then watch the runs the
  merge started.
- `review <PR url>`: the review gate and the repo's gate, without the merge.
- `rebase <PR url>`: onto its base.
- `rerun <run url>`: a failed PR check. A base-branch `push` run is the
  operator's.
- `release [patch|minor] for STARK-n`: the repo's whole release chain,
  ending with the new version installed and verified on this machine. Name
  the ticket the release finishes; a chain that scopes its PRs or its tap
  bump to a ticket needs it. A `major` is the operator's to ask for.
- `status`: what he is doing and what is queued.

## 1. Find him

```
hermod msg peers --all --json
```

Look for the row whose `sessionName` is `KEVIN-<repo>-<n>`, where `<repo>` is
the folder name of the repo's main checkout (the basename of `frigg repos get
<repo> --json`'s `path`) with every character outside `[A-Za-z0-9_-]` made a
`-`. It is live only if `ps -p <its pid> -o pid=` prints the pid: hermod's
`liveness` is never `dead`, and `stale` can be a live session. There is at
most one, since idun launches one per repo. Live: go to step 3. None: step 2.

## 2. Launch him if none is live

```
idun kevin <repo> --no-focus --json
```

No request rides the launch: every request goes by step 3, so each one has a
ledger id you can wait on. idun reads your session stamp as his first
contact, `from` in the ack (`leader` before idun v0.111.0). You need idun
v0.109.0 or later (`idun --version`; older has no `kevin`). Read the exit code
before the ack:

- **0** with `verified: true`: launched. Take his `peerId` from the ack and
  go to step 3.
- **4**: a live Kevin already serves the repo, and stderr names him. Go back
  to step 1. If step 1 finds his row but his `pid` is not running, a dead
  Kevin still holds the name: your own `blocked … needs the operator to clean
  up <the path idun named>`.
- **2** naming another Kevin launch in flight: one is starting. Wait a
  minute and go back to step 1, at most three times. Any other **2**,
  including one that cannot tell whether a Kevin is alive, is your own
  `blocked`, quoting idun.
- **1** or **128+n**: your own `blocked`, quoting idun. A Kevin left standing
  is the operator's to sweep.

## 3. Send the request

To his provider-qualified `id` (the row's `id`, or the ack's `peerId`), never
his name alone, since names can collide across providers. Give it a four-hour
budget: his one reply is refused once a request's deadline passes, and a
queued release can outlast hermod's 30-minute default.

```
hermod msg send --to <his id> --kind request --deadline 14400 --json -- '<request>'
```

Keep the `id` the JSON prints: it is how you wait. Exit 3 (a Codex receipt
timeout) is a submitted message that may still arrive: wait on it. Exit 2 (a
refusal, such as an interrupted Codex turn): try once more a minute later,
then it is your own `blocked`. Exit 4 (over budget): your own `blocked`.

## 4. Wait

He acks your request when it arrives, and sends a progress line if others are
ahead of you. He works one request at a time, and a `release` can take an
hour. Progress lines come as separate messages. His final line is the reply
to your request, so wait on it:

```
hermod msg wait <request id> --timeout 540 --json
```

Repeat until it returns his reply or a terminal state. Before each repeat,
check that his `pid` still runs (`ps -p <pid> -o pid=`). If he is gone with no
reply, go back to step 1 and send the request once more to whoever serves the
repo now. A second loss is your own `blocked`. If the request expires
unanswered, read `hermod msg ls --json` for a `complete` message from him that
starts `re <request id>:`: he sends that when a reply can no longer go.

- **Under a leader** (a Minion): you are working, not idle. Send your leader
  `progress waiting on KEVIN-<repo>-<n>: <request>` every 30 minutes, as for
  any wait.
- **Under a goal** (Agnes): the wait above is your turn's work. Run one
  `hermod msg wait` per turn, not a loop of reads.

Never send him `stand down`. The desk is shared, and only the operator, or
his own idle-out, dismisses him.

## 5. Confirm

His final line is one of `done …`, `blocked …`, `refused …` or `answer …`, and
like any peer report it is a claim, not approval:

- **`done merge <PR url> merged <sha> …`**: check it yourself. The PR reads
  `MERGED` with that `mergeCommit`, and
  `gh api repos/<o>/<r>/compare/<sha>...<base> --jq .status` prints
  `identical` or `ahead`. A post-merge run that is not `success`, `skipped` or
  `neutral` means what the merge set off did not land: your own `blocked`.
- **`done release <repo> <tag> installed <version>`**: `gh release view <tag>
  --repo <o>/<r>` exists, and the installed binary's own version command
  prints `<tag>`.
- **`done release <repo> already <tag>`**: the release you needed is
  `<tag>`. Check that your merge commit is in it:
  `gh api repos/<o>/<r>/compare/<your sha>...<tag> --jq .status` prints
  `identical` or `ahead`.
- **`blocked …` or `refused …`**: your own `blocked`, quoting his line. It is
  his repo's problem, or the operator's, not yours to work around.

Once confirmed, carry on: rebase onto your base if it moved, or close your
ticket if the release was its last step.
