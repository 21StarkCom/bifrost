# Gru's stand-down

Read from [the Gru skill](../SKILL.md#stand-down), at the end of step 6.

Close your own session, worktree and tab by
[the stand-down contract](../../../standards/stand-down.md), as a Minion
does. You merge and close nothing yourself, so these terms take the place of
the contract's "after `njord pr-merge` and the ticket close":

- **Only in your own worktree.** Your shell can stand in the main checkout
  after step 6's cleanup, so read the path poison-pill aims at. Run
  `hermod poison-pill --dry-run --json` and read its `worktree`. Then run
  `git -C <that path> rev-parse --show-toplevel`, the path pasted in
  literally. Its last path segment must be your launch id: the epic, or
  `GRU-<n>` for `--tickets`, `<n>` the first ticket's number. valkyrie makes
  that worktree for each Gru it launches. Any other path, or a dry run that
  refuses, is a session that is not yours to close: end on the report, and
  leave the session, the worktree and the tab.
- **Only when the run is finished.** Step 6's report names no blocked or held
  ticket and no open question. A blocked or held Minion still waits on you,
  and a rerun `start` resumes the run in this tab, so either one keeps the
  tab. A ticket that your leader's `stand down` left unstarted does not.
  With a muninn leader or with none, these terms are the same.
- **Your report.** With a [muninn leader](leader-muninn.md), it is step 6's
  `report:` send, completed when `send.sh` exits 0. With none, the report in
  your tab closes with the tab. So first comment it on the epic, or on the
  first ticket of `--tickets`
  (`alfred task comment --body-file <file> STARK-n`). Write the file under
  `mktemp -d`, outside your worktree: a file inside it fails the contract's
  clean-tree check. Then send one
  `hermod notify send "<launch id> done: <n> tickets closed; report on STARK-n"`.
  Anything you see go wrong in a check or the poison-pill foreground goes
  into one more line of your report before you arm or stop.
- **Your branch was never pushed**, so the contract's check for unpushed
  commits is its Gru form, `git -C <that path> log --oneline HEAD --not --remotes`.
- **A check that prints anything is not yours to fix.** You make no commit,
  and the skill keeps your files out of your worktree, so a line from either
  check is work that is not yours: never push it, commit it or delete it.
  Name it in your report, and end on the report: arm nothing, and leave the
  session, the worktree and the tab.
- **The command** is `hermod poison-pill --delete-branch --json`, by the
  contract's [Flags](../../../standards/stand-down.md#flags).
- **A `partial` teardown** has no later step 6 to clean up after it. Your
  report names the surface and the path.
  [The launch doc](../../../standards/launch.md#6-after-the-launch) removes
  the worktree and the branch before the next Gru on the same launch id. A
  tab left as a bare shell stays for the operator to close.

Once it reads `armed:true`, say so and end the turn. Never fire it twice.
