---
name: stark-ticket
runtimes:
  - claude
  - codex
description: >-
  Use when about to write, file or rewrite a ticket: before `alfred task start`,
  `alfred task new` or `alfred task edit --desc-file`, when asked to open, file or
  spawn tickets (STARK in ClickUp, or EI in Jira), a bug or a follow-up, or when
  turning a review finding, a plan or a request into a ticket.
argument-hint: "[<intent> | <draft-file>]"
---

## Help

If `$ARGUMENTS` contains a standalone `--help`, `-h`, or `help`,
follow [standard help](../../standards/help.md), then stop.

## Arguments

- `<intent>` or `<draft-file>`; neither: the request in front of you.

# stark-ticket

A ticket is a work order for someone who was not in the room. Write its prose
in ASD-STE100 Simplified Technical English, so that each sentence has one
meaning for the reader, a person or an agent. Write a line or two per heading
for a small change.

## Pick the tracker first

Each tracker has its own twin check, its own fields and its own file command.
Decide before step 1, and follow that column to the end.

| | STARK (ClickUp) | EI (Jira) |
|---|---|---|
| Who owns it | the operator's own fleet work | Evinced's AI & Infrastructure team |
| Where alfred runs | any checkout | a checkout `[jira.repos]` maps to EI |
| Extra on each write | none | `TYR_JIRA_ISSUE_WRITES_ENABLE=1` |
| Twin check | `alfred task find` | `frigg atlassian search jql` |
| Fields | the description, and `--field` for a reporting field | nine fields that Accept and Commit to Ready refuse without |
| Read it back | `alfred task show` | `frigg atlassian issue get` |

Read [EI tickets](references/ei.md) in full before you write an EI ticket. It
holds the field ids, the parent Epic rule and the workflow steps. Each step
below that differs in EI says so.

## Write the prose this way

- Write a step (Scope, Acceptance, Verification) in sentences of 20 words or
  fewer, and a description (Goal) in sentences of 25 words or fewer.
- Write one instruction in each sentence, in the imperative and the active
  voice: "Raise the bound", not "The bound should be raised".
- Use one word for one meaning, and the same word for the same thing each
  time. Use the simple word: "use", not "utilize".
- Keep the articles and verbs. Do not remove them to make a sentence shorter.
- Use no more than three nouns in a row: "the bound on sitemaps", not "the
  sitemap discovery bound".
- Use simple tenses. Use an -ing form only in a name.
- Keep a paragraph to one topic and six sentences or fewer.
- Paste output, commands, paths, names and error text as they are. These rules
  apply only to your own prose.

## The steps

1. **Twin check.** `alfred task find` in the target repo. In EI, search the
   project instead: `frigg atlassian search jql 'project = EI AND
   statusCategory != Done AND summary ~ "<words>"'`. If a live ticket covers
   it, comment there instead of filing.

2. **Write** it from `alfred task start --template` in a file under
   `mktemp -d`, never inside a checkout. A bug's Goal names what broke,
   where, and the error text. Verification is commands and what they should
   print, or a required check by its name. A live write there names what
   it writes and how the run puts it back, or that it cannot. It runs on the
   operator's standing GO, so the step says it needs a GO only where the root
   rules keep the gate: a write the run cannot undo (unless all it leaves
   behind is scratch made for the run), `terraform apply`, publishing by
   hand, or credential handling (tokens, keys, service accounts, WIF and role
   grants, mimir writes). Unmerged work it needs:
   `Blocked by STARK-n` (`EI-n` in EI), then `alfred task link` both.

3. **Order Scope IN by dependency.** A step whose answer decides whether a
   later step is safe is a precondition, not a sibling. Put it first, and say
   what its answer gates: "List the services that create a third-party client.
   Turn the toggle off only if that list is empty." Read your Scope IN once
   from the bottom up. For each item, ask what must be true before it starts,
   and move that item above it.

4. **Carry the dates and the owner.** A ticket that comes from a todo, a
   message or a calendar item keeps that source's deadline. Put the earliest
   real deadline in the due date field, not only in the Goal prose. No create
   verb sets a due date, in either tracker: run `alfred task set-dates --due
   <when> <id>` after the create (on EI it takes `--due` alone, and
   `--field duedate=…` refuses, because alfred owns that field). Name one
   owner, and set that person as the assignee: `--field
   'assignee={"accountId":"<id>"}'` on an EI create, and `alfred task edit
   <id> --add-assignee <who>` after a ClickUp create, which has no assignee
   flag. A body that names an owner and a ticket with an empty assignee do
   not agree.

5. **Don't guess.** Claims about code or a tool come from output you ran or
   source you read, never `--help`, docs or memory. Paste output, never
   retype it, and never paste credentials or auth/env output. Mark anything
   unchecked `unverified: <claim> — check: <command>`.

6. **Give each unverified claim a path for a failed check.** The most likely
   way a ticket stalls is a precondition that turns out false. Write the next
   move on one line, next to the mark: who to ask, what to file, or that the
   work stops. Write `unverified: a credential for the dev tenant exists —
   check: <command>. If none: ask the tenant's owner for one, and hold the
   ticket.`, not the mark alone.

7. **Fresh eyes.** The author cannot review the draft: you re-read your intent,
   not the text. Dispatch ONE read-only subagent with **zero shared context** —
   it gets the draft's path and this contract, never your reasoning:

   > Read <path>. You have NO other context — that is deliberate. This is a
   > ticket: a work order for someone who was not in the room. Verify every
   > CHECKABLE claim by a DIFFERENT method than the ticket's own: test that
   > named paths and files exist, run the commands it cites, re-derive its
   > counts and dates from the sources it names. Then report DEFECTS ONLY,
   > numbered: (a) a Scope IN item that another item depends on but does not
   > follow; (b) a date, owner or dependency the body names but a field does
   > not carry; (c) an `unverified:` mark with no stated move for a failed
   > check; (d) an Acceptance line a reader cannot check; (e) a claim stated
   > as fact that you cannot verify — mark "cannot verify", distinct from
   > wrong; (f) an instruction that permits two incompatible readings. NOT
   > defects: style, scope opinions, "could say more". Severity per finding:
   > **blocker** (the worker produces a wrong result) / **defect** (wrong
   > fact) / **note** (minor ambiguity). Cite the exact line. **Zero findings
   > is a valid, expected output.** Your final message is the numbered list
   > (or "zero defects") — raw data, no prose.

   One dispatch for each draft. State a disposition for each finding — **fix**,
   **reject** (say why the zero-context read misjudged the intent), or
   **accept-as-known** — then apply every fix in one edit round. Do not
   dispatch again to confirm the fixes. The pass is spent.

8. **File** with `--desc-file <draft>`: `alfred task start` (your own work),
   `alfred task new` (a follow-up, unbound; `--on-repo <repo>` for another
   repo's, ClickUp only), `alfred task edit <id>` (a rewrite). In EI, set
   every field from [EI tickets](references/ei.md) on the create, and put
   `TYR_JIRA_ISSUE_WRITES_ENABLE=1` on the command.

9. **Validate what you filed.** The fields that live outside the description
   are the ones that fail quietly. Read the ticket back — `alfred task show
   <id>`, or `frigg atlassian issue get EI-<n> --json` — and confirm the due
   date, the assignee, the priority, the parent or epic link, each
   `Blocked by` link, and, in EI, each field in the reference table. Repair a
   ClickUp ticket with `alfred task edit` or `alfred task set-dates`, and an
   EI ticket as [EI tickets](references/ei.md#read-it-back) says. Then read it
   back again. Report the filed id only once the read-back agrees with the
   draft.
