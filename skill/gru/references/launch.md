# Launch checks

Read from [the Gru skill](../SKILL.md#protocol).

## A repo that does not resolve by name

Check the repo per ticket and at launch with `urd repos get <ticket's
repo> --json`, which exits 3 on a name the registry does not carry.
valkyrie does not read urd: it resolves `--repo <name>` to the one
checkout under its `repos.roots` (default `~/Code`, less `repos.exclude`)
whose origin is that name, and exits 2, naming the repo, when none or more
than one is. Read one record when you launch: a whole-registry read cached
for the run misses a repo registered after it. Exit 3, or a record
whose `stale` is true because its path is gone from disk, means the name
will not resolve and that ticket needs a path instead. The path is a guess:
the fleet is one clone per repo, so take the root from any registered
record's `path` (its `dirname` — never a hardcoded `~/Code/21Stark`; the
fleet has checkouts under other roots) and try `<root>/<repo>`. **Prove the
guess before you launch into it** — `git -C <path> rev-parse --show-toplevel`
must print that same path. valkyrie refuses a `--cwd` outside any git checkout
(exit 2), but one inside some other checkout launches into that repo's main
checkout, exits 0, and the ack looks normal, so the Minion would implement
the ticket in the wrong codebase. A
guess that does not prove out makes the ticket blocked, not ready — record
it with its repo name, leave it alone on later passes, escalate it under
[Authority](../SKILL.md#authority) when it happens, and keep every other ticket moving. `--repo` and `--cwd` are mutually exclusive,
so the fallback replaces `--repo`: never send both, and never reach for
`--cwd` for a repo that resolves by name. After a `--cwd` launch, confirm
the Minion landed where you meant — `hermod msg peers`, that peer's `cwd`
under the intended repo — because step 2's ownership rule matches on the
ticket id alone, so a misrouted Minion otherwise reads as a correctly-owned
one. Once a guessed path proves out, register it with
`urd repos set <repo> --path <p>`, so the next `urd repos get` finds it.

## Your peer id and the first contact

The brief valkyrie writes invokes `/minion` (`$minion` on Codex), names
the ticket and your peer id, and gives the route from
[Coordination route](../SKILL.md#coordination-route) with a Hermod fallback. valkyrie
takes your peer id from your own
`$CLAUDE_CODE_SESSION_ID` (`$CODEX_THREAD_ID` on Codex), and refuses the
launch (exit 2) when it finds neither or both. **Your peer id** is the `id` of the
`hermod msg peers` row whose `sessionId` is yours — the whole
`<provider>:<id>` address (`claude:<uuid>`), never the bare session id,
which the fallback bridge may not resolve. Look it up before your first launch, so
you know what the ack has to say. Then read the first ack's `prompt` before
you launch a second Minion: the peer it names must be that `id`. If valkyrie
refused, pass the `id` as `--leader <peer id>` on every launch. Once the
ack is verified, and only when its `coordination` is `SendMessage` (the
Claude → Claude route), make the first contact through
[Coordination route](../SKILL.md#coordination-route): one line naming the ticket and
saying you are its leader, to the launch `name`. A `hermod-msg` Minion gets
no first contact; its brief already names you. The brief already carries
the assignment, so do not restate it. This is how a Claude Minion learns
your `SendMessage` return address. If the ack named
someone else, that first Minion is briefed with the wrong leader and its
reports go to another session, where step 4 never sees them: send it the
correction now through [Coordination route](../SKILL.md#coordination-route), to the
ack's `peerId` or native address, and pass `--leader` on every later
launch. Do not rest on the correction: `/minion` takes its leader from the
brief, and nothing tells it to trust a peer message that moves it. In step
4 read that ticket off the board and its PR instead of waiting on a report,
knowing what the board cannot show: `done` closes the ticket and a
follow-up comments on it, but `blocked` leaves no mark on either, so that
Minion's peer going idle with its ticket still open is your only sign — ask
it what happened through [Coordination route](../SKILL.md#coordination-route):
`STARK-n: report your status to me.` Its answer reaches you whatever its
brief said — `hermod msg reply` goes to the sender, and a native answer
goes to your `from`. Count the ticket blocked, not owned, until it
answers.

## Exit codes

Read each launch's exit code before its ack. **0** with `verified: true`
is a launch: append it to the run's [log](../SKILL.md#progress-pane). **1**: something was placed or started and did not come up,
and valkyrie's stderr names what it left standing. When the tab opened, that
is the tab and the worktree, and under `--json` stdout still carries a
complete ack whose only tells are `verified: false` and an `error` field,
on either runtime; when Hermod could not place the tab, or a Codex
worktree could not be cut, stdout carries no ack at all. The ticket is
blocked: reap the tab stderr named as [deaths.md](deaths.md#reap-a-dead-minions-tab) reaps a dead
Minion's tab, name what stays in your report, and never relaunch over it. **2**: refused before anything was
created — a bad argument, a repo that does not resolve, a `--cwd` outside
any git checkout, both or neither session stamps without `--leader`, an
existing worktree for the id on a Codex launch (a Claude one re-enters it,
saying so on stderr), a leftover branch `STARK-n` on a Codex launch, or a
main checkout Codex does not trust, which the operator trusts once. The
ticket is blocked: escalate it with what valkyrie printed and keep the other
tickets moving. **4**: a live agent or tab holds the id, and valkyrie's stderr
lists each holder. Never relaunch it. A holder that step 2 counts — a live
peer whose `cwd` ends in the ticket id — owns the ticket; count it owned.
Any other holder — a tab only titled with the id, such as a dead Minion's
that never retitled itself, or a session that is no Hermod peer — makes the
ticket blocked, not owned, since step 2 would read it ready again on the
next pass: escalate it with the holders valkyrie printed.
**128+n**: interrupted; report it.
