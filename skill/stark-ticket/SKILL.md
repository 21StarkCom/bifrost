---
name: stark-ticket
runtimes:
  - claude
  - codex
description: >-
  Use when about to write, file or rewrite a ticket: before `alfred task start`,
  `alfred task new` or `alfred task edit --desc-file`, when asked to open, file or
  spawn tickets, a bug or a follow-up, or when turning a review finding, a plan or
  a request into a ticket.
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

1. **Twin check.** `alfred task find` in the target repo. If a live ticket
   covers it, comment there instead of filing.
2. **Write** it from `alfred task start --template` in a file under
   `mktemp -d`, never inside a checkout. If the template prints a `Runs in`
   section, delete it. A bug's Goal names what broke, where, and the error
   text. Verification is commands and what they should print, or a required
   check by its name. A live write there names what
   it writes and how the run puts it back, or that it cannot. It runs on the
   operator's standing GO, so the step says it needs a GO only where the root
   rules keep the gate: a write the run cannot undo (unless all it leaves
   behind is scratch made for the run), `terraform apply`, publishing by
   hand, or credential handling (tokens, keys, service accounts, WIF and role
   grants, mimir writes). Unmerged work it needs:
   `Blocked by STARK-n`, then `alfred task link` both.
3. **Don't guess.** Claims about code or a tool come from output you ran or
   source you read, never `--help`, docs or memory. Paste output, never
   retype it, and never paste credentials or auth/env output. Mark anything
   unchecked `unverified: <claim> — check: <command>`.
4. **File** with `--desc-file <draft>`: `alfred task start` (your own work),
   `alfred task new` (a follow-up, unbound; `--on-repo <repo>` for another
   repo's), `alfred task edit <id>` (a rewrite).
