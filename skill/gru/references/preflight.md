# Gru's preflight of a repo

Read from [the Gru skill](../SKILL.md#preflight).

Once per repo, before its first Minion launches — the same moment
[Authority](../SKILL.md#authority)'s merge-queue read happens — learn three things, and
keep them for the rest of the run:

- **The gate, and what green means.** The gate is the command the repo's
  agent instructions file names, and green on the PR is whatever the base
  requires. Read both sources, the ruleset and classic protection, because
  either alone can show nothing while the other requires a check:

  ```
  gh api repos/<owner>/<repo>/rules/branches/<base> --jq '[.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context]'
  gh api repos/<owner>/<repo>/branches/<base> --jq '.protection.required_status_checks.contexts'
  ```

  The second reads classic protection through the branch itself, which needs
  only read access and prints `[]` on an unprotected branch. The
  `branches/<base>/protection` endpoint needs admin rights and answers 404
  both on an unprotected branch and to a caller without them, so a 404 there
  proves nothing. "No required checks" can
  mean no checks at all, and then `njord pr-merge` merges at once: a merged
  PR there says nothing about green, so step 5's verification comment carries
  the whole weight.
- **Whether the gate binds a fixed host resource** — a port, a lock file, a
  local database, a named socket. Every worktree shares the host, so that gate
  runs one at a time however many Minions the repo has, and two running it at
  once fail each other. Launch at most one Minion into such a repo at a time;
  it counts toward N like any other. Two repos whose gates bind the same
  resource (one local database, one default port) count as one repo here.
- **Whether something holds that resource now.** Measure it
  (`lsof -nP -iTCP:<port> -sTCP:LISTEN`, the lock file, the socket's owner);
  do not assume. `lsof` without root sees only your own user's processes, so
  a port it shows free can still be taken: `nc -z localhost <port>` answers
  for any owner. Never stop a holder that is not one of your Minions:
  escalate it with what you measured, launch nothing into that repo
  meanwhile, and keep every other repo moving.
