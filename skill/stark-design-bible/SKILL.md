---
name: stark-design-bible
runtimes:
  - claude
  - codex
description: >-
  Use when you build, rebuild or review a web page, such as a landing page.
  Loads the design bible for one page type: its index and the playbook of
  that page type, then the rule cards that the playbook links, with the
  Checks to run on the page before you report it done.
argument-hint: "<page type, for example landing>"
---

## Help

If `$ARGUMENTS` contains a standalone `--help`, `-h`, or `help`,
follow [standard help](../../standards/help.md), then stop.

## Arguments

- `<page type>`: the type of the page, for example `landing`. It names the
  playbook `design-bible/pages/<page type>.md`. With none, use the page type
  that the task names. When the task names none, go on as for a page type
  with no playbook.

# stark-design-bible

The design bible is a set of short, testable rules for an agent that builds a
web page. It lives in the vault-docs clone, in `design-bible/`:

- `ATLAS.md` is the index: how a builder uses the bible, the trust order of
  the sources, and a table of each card.
- `pages/<type>.md` is the playbook of one page type: the order of the
  sections, the cards that each section follows, and a checklist.
- A card holds one rule: its Rule, Why, Evidence, Do, Don't, Check and
  Exceptions, and, where they apply, its Conflict, WCAG floor and Draupnir
  part. The cards are in `principles/`, `foundations/`, `patterns/`
  and `content/`.

Do not edit the bible: the vault-docs repo owns it. Name each rule that is
missing or wrong in your report.

## 1. Load the bible

The clone is `~/Code/21Stark/vault-docs`. Each path below is relative to it.

1. When `~/Code/21Stark/vault-docs` does not exist, clone it:
   `gh repo clone aryeh-stark/vault-docs ~/Code/21Stark/vault-docs`. When
   `design-bible/ATLAS.md` does not exist in it, the clone is older than the
   bible: run `git pull --ff-only` in the clone. When the clone or the pull
   fails, or `ATLAS.md` is still missing, print `Missing: <path>` and the
   error, and stop.
2. Read `design-bible/ATLAS.md`. Print `Read: design-bible/ATLAS.md`.
3. Find the playbook. The page type is a playbook only when it holds only
   lowercase letters, digits and hyphens, and
   `design-bible/pages/<page type>.md` exists.
   - When it is a playbook, read it, and print
     `Read: design-bible/pages/<page type>.md`.
   - When it is not, or there is no page type, list the names of the `.md`
     files in `design-bible/pages/`, without `.md`. Print
     `No playbook for <page type>. Playbooks: <names, comma-separated>`, or
     `No page type. Playbooks: <names, comma-separated>` when there is none.
     Read no playbook, and go on with the index only.
4. Print a `Read:` line for each other file of the bible that you read later,
   in the same form.

When the request names no page to build or review, stop here. The bible is
now in your context for the next request.

## 2. Build the page

To review a page that is already built, do only step 2 below (open the
cards), then go to section 4. Do not change the page.

Follow the steps of "How a builder uses the bible" in `ATLAS.md`. In short:

1. Build the sections in the playbook's order.
2. Open each card that the playbook links, in its section table and in its
   checklist. The links are relative to the playbook:
   `../patterns/primary-cta.md` is `design-bible/patterns/primary-cta.md`.
   Follow each card's Rule, Do and Don't. Skip a card that the playbook marks
   for a case your page does not have, such as a form.
3. Where a pattern card names a draupnir part, start from that part. Find it
   with the `search` tool of the `stark-draupnir` MCP server.
4. Take the colors, the fonts and the mood from the brand theme. A card never
   sets them.
5. When two sources on a card disagree, the lower tier number wins, by the
   trust order in `ATLAS.md`.

With no playbook, use the cards in the index tables of `ATLAS.md` that fit
each section of your page.

## 3. When a card does not answer a question

A card does not cover each case. When your question has no answer in the
cards:

1. Ask the librarian with the tool `ask_librarian`. Ask one question, and ask
   for evidence from the vault `design-docs`. Give the page and the section
   in `context`. When the tool is not there, run
   `librarian ask "<question>" --context "<page and section>"`.
2. Use the answer only through its citations: each fact cites a page of the
   vault `design-docs` and the date of that page. Apply the trust order of
   `ATLAS.md` to them.
3. After you use the answer, rate it with the id of its `id:` line: call
   `rate_answer` with that `id` and `helpful` or `wrong`, or run
   `librarian rate <id> helpful|wrong`. When it is wrong, say why in the
   note (`--note "<why>"` on the CLI).
4. Name the question and the cited pages in your report.

## 4. Run the Checks before you report done

Do not report the page done before you run the Checks.

1. Run each Check of each card that you opened in step 2, on the built page,
   in a real browser. Use the screen size or the tool that a Check names,
   such as 320 CSS px wide or a Lighthouse run. When a Check names none, run
   it on each screen that the playbook names, such as 375 by 667 CSS px and
   1280 by 800 CSS px.
   - `dom:`: query the page's DOM.
   - `count:`: count the elements that it names.
   - `measure:`: read the computed size, style or ratio that it names.
   - `screenshot:`: take a screenshot, and answer its yes or no question.
2. Tick each card of the playbook's checklist when each of its Checks
   passes. Check the playbook's required items too.
3. Fix each Check that fails, and run it again. In a review, do not fix
   it: report it.
4. In your report, give each Check with its card and its result: `pass`,
   `fail`, or `not run` and why. A Check that you did not run is not a pass.
