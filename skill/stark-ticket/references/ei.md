# EI tickets

EI is the Jira project of Evinced's AI & Infrastructure team. Use this page
with the checklist in `SKILL.md` when a ticket goes to EI.

## Where to file

- Run alfred from a checkout whose repo maps to EI in `[jira.repos]` of
  `~/.config/alfred/config.toml` (`devops-infra`). `--on-repo` reaches
  ClickUp only.
- Set `TYR_JIRA_ISSUE_WRITES_ENABLE=1` on each alfred write. Without it,
  alfred refuses: `jira writes are disabled`.
- Run the twin check from that checkout. To search EI by words, use
  `frigg atlassian search jql 'project = EI AND statusCategory != Done AND summary ~ "<words>"'`.

## Type and parent

- alfred files a Task, a Bug (`--bug`) or an Epic (`--epic`). It does not
  file a Sub-task or an Objective.
- Put each Task and Bug under its Epic with `--field 'parent={"key":"EI-<n>"}'`.
  A ticket with no Epic cannot go to Ready.
- A create that ADOPTS an existing issue by its marker drops the whole
  `--field` set, and alfred prints a warning line that says so. The adopted
  ticket keeps its own fields. Read that warning, then set each field the
  adopted ticket lacks with `frigg atlassian issue update`, below.
- An Epic also starts in Triage. Its Accept asks for no fields.
- Name unmerged work that the ticket needs as `Blocked by EI-<n>`.
  `alfred task link` makes a Relates link. alfred has no Blocks link.

## Fields

Each new EI ticket starts in Triage. Only the Prioritizer role moves it on:
Accept takes it to Backlog, then Commit to Ready takes it to Ready for work.
Each step refuses until its fields are set. Set them all on the create, so
that a Prioritizer can move the ticket without questions.

| Step | Field | `--field` |
|---|---|---|
| Accept | Classification | `customfield_10938=<value>`: `Product Roadmap`, `Support`, `Technical Debt & Engineering Health` or `Team Initiative` |
| Accept | Urgency | `customfield_10253=Normal`. Use `Expedite` only when the operator says so. |
| Accept | Source | `customfield_11153=<value>`: `Team` for the team's own work, the operator's included; `Agent` for work that an agent found, such as a follow-up; else the channel of the request (`Slack`, `/devops app`, `Form`, `Meeting`, `Steering`, `Oral`, `Scanner`) |
| Accept | Requester | `customfield_11151={"accountId":"<id>"}`: the person who asked, or the operator |
| Accept | Problem/outcome | `customfield_11152=<text>`: the problem and the outcome, in one or two sentences |
| Commit to Ready | Acceptance criteria | `customfield_11154=<text>`: the Acceptance lines, as plain sentences |
| Commit to Ready | Size | `customfield_11158=<value>`: `S` (up to 1 day), `M` (2–3 days) or `L` (up to 1 week). Ready refuses `XL`, so split that work first. |
| Commit to Ready | Risk class | `customfield_11155=<value>`: `Low`, `Standard` or `High` |
| Commit to Ready | Owner | `customfield_11156={"accountId":"<id>"}` |
| Commit to Ready | Parent | `parent={"key":"EI-<n>"}`: the Epic |
| Start | Assignee | `assignee={"accountId":"<id>"}` |
| After the create | Due date | not a `--field`: run `alfred task set-dates --due <when> EI-<n>` |

- Set the Assignee on the create. No step refuses without it, and no later
  step fills it for you.
- Do not pass `--field duedate=…`. alfred owns `duedate` and refuses the
  clause exit 2 before any call. Set the due date after the create with
  `alfred task set-dates --due <when> EI-<n>`, which takes `--due` alone on
  Jira. It is the field a draft drops, because no step refuses without it.
- Get the operator's account id with `frigg atlassian test-token`. Agents
  act under that account. Get another person's id with
  `frigg atlassian user by-email <email>`.
- Do not set Team. Automation sets it.
- Leave rank to the Prioritizers.

## Start or file

- `alfred task start` files the ticket as the operator, who holds the
  Prioritizer role. Then it moves the ticket through Accept and Commit to
  Ready to In Progress. Give it each field above that has a `--field` form,
  the assignee included. The due date is not one of them: set it after the
  create.
- If a field is missing, alfred binds the ticket but does not start it. It
  names the `alfred task move` command to run.
- `alfred task new` leaves the ticket in Triage for a Prioritizer.

## Read it back

Run `frigg atlassian issue get EI-<n> --json` after the create. A field alfred
could not set fails quietly: the ticket exists, and the field is `null`. Check
`status`, `parent`, `assignee`, `duedate`, `priority` and each `customfield_`
id in the table above. `alfred task edit` writes a custom field in ClickUp
only, so repair a missing EI field with frigg:
`frigg atlassian issue update EI-<n> --field '<id>=<json>' --confirm`. frigg
needs the same gate as alfred, so put `TYR_JIRA_ISSUE_WRITES_ENABLE=1` on that
command too. Preview it first with `--dry-run`. Then read the ticket back
again.
