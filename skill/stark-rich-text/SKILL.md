---
name: stark-rich-text
runtimes:
  - claude
  - codex
description: >-
  Use before you write a Slack message, a Jira description or comment, or
  GitHub text (a PR body, an issue, a comment), and when a task names Block
  Kit, ADF or mrkdwn. Write Markdown and run the fleet command that converts
  and sends it. Do not write code that builds Block Kit or ADF.
argument-hint: "[slack | jira | github]"
---

## Help

If `$ARGUMENTS` contains a standalone `--help`, `-h`, or `help`,
follow [standard help](../../standards/help.md), then stop.

## Arguments

- `slack`, `jira` or `github`: the surface. With none, use the surface that
  the request names.

# stark-rich-text

Write the text as Markdown in a file. Then run one command of the table. The
command converts the Markdown to the format of the surface and sends it.

## The rule

Do not write code that builds Block Kit or ADF: no script, no one-time
converter, no JSON made by a program. When the commands below cannot make a
result, file a ticket on frigg with `/stark-ticket` (`$stark-ticket` on
Codex), and say so in your report.

## The commands

| Surface | Write | Command |
|---|---|---|
| Slack message | Markdown | Check: `frigg slack preview --file <md>`. Send: `frigg slack send (--channel\|--dm\|--mpim) <target> --file <md> --confirm` |
| Slack, past Markdown: a real mention `<@Uxxx>`, a button | raw blocks, a JSON array | `frigg slack send (--channel\|--dm\|--mpim) <target> --blocks <file> --fallback <text> --confirm` |
| Jira description | Markdown | `frigg atlassian issue create --project <P> --type <T> --summary <S> --markdown-file <md> --confirm`, or `frigg atlassian issue update <KEY> --markdown-file <md> --confirm` |
| Jira comment | Markdown | `frigg atlassian issue comment <KEY> --markdown-file <md> --confirm` |
| Jira, past Markdown: a mention, a panel, a status | raw ADF, a JSON document | `--adf-file <file>` in place of `--markdown-file`, on `issue create` and `issue comment`. On `issue update`: `--fields-json <file>`, a JSON map with a `description` key |
| A ticket through alfred | Markdown, as it is | `alfred task new --desc-file <md> <title>`, or `alfred task edit --desc-file <md> <id>`. alfred converts it for Jira |
| GitHub text: a PR body, an issue, a comment | Markdown, as it is | `njord pr-open --body-file <md>`, or `gh pr comment <n> --body-file <md>`, `gh issue create --title <T> --body-file <md>` |

## What each surface needs

- **Slack.** `frigg slack send` refuses, `--dry-run` included, until
  `TYR_SLACK_WRITES_ENABLE=1` is set. `frigg slack preview` needs no switch and
  sends nothing.
  - `--dry-run` in place of `--confirm` prints the target and the blocks.
  - `--thread <ts>` replies in a thread.
  - `--as-user` posts as the user. Its switch is
    `TYR_SLACK_USER_WRITES_ENABLE=1`, in place of `TYR_SLACK_WRITES_ENABLE`.
  - A mention in Markdown stays literal text. Use the raw blocks row for a
    mention that notifies.
  - `--channel` takes `#name` or an id. `--dm` takes an email or a `Uxxx` id.
    `--mpim` takes a list with commas.
- **Jira.** Each write, `--dry-run` included, needs
  `TYR_JIRA_ISSUE_WRITES_ENABLE=1`. The Markdown flags need frigg 0.80.0 or
  later.
  - `--dry-run` in place of `--confirm` prints the request and sends nothing.
  - `issue update` has no `--adf-file`. For raw ADF, give `--fields-json <file>`
    with the ADF document as the value of its `description` key.
  - `--markdown-file -` and `--adf-file -` read stdin. `--markdown <text>`
    takes a short text inline.
  - For an EI ticket, use `/stark-ticket` first: it names the required fields.
- **GitHub.** GitHub renders Markdown. Give the file as it is, and use no
  converter.

## Raw blocks and raw ADF

Write the JSON file by hand, for the one element that Markdown cannot say.
Keep the rest of the message in Markdown where a second send can carry it.
`frigg slack preview --blocks <file> --fallback <text>` checks a file of
blocks before you send it.
