# The page method, for a page type

The method of a page type, such as `landing`: the playbook in
`design-bible/pages/<type>.md` and the rule cards that it links. Load the
bible first, by section 1 of [the skill](../SKILL.md). Each path below is
relative to the vault-docs clone, `~/Code/21Stark/vault-docs`.

- `ATLAS.md` is the index: how a builder uses the bible, the trust order of
  the sources, and a table of each card.
- `pages/<type>.md` is the playbook of one page type: the order of the
  sections, the cards that each section follows, and a checklist.
- A card holds one rule: its Rule, Why, Evidence, Do, Don't, Check and
  Exceptions, and, where they apply, its Conflict, WCAG floor and Draupnir
  part. The cards are in `principles/`, `foundations/`, `patterns/`
  and `content/`.

## 1. Build the page

To review a page that is already built, do only step 2 below (open the
cards), then go to section 3. Do not change the page.

Follow the steps of "A landing page" under "How a builder uses the bible" in
`ATLAS.md`. In short:

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

## 2. When a card does not answer a question

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

## 3. Run the Checks before you report done

Do not report the page done before you run the Checks.

1. Run each Check of each card that you opened in step 2 of section 1, on the
   built page, in a real browser. Use the screen size or the tool that a
   Check names, such as 320 CSS px wide or a Lighthouse run. When a Check
   names none, run it on each screen that the playbook names, such as 375 by
   667 CSS px and 1280 by 800 CSS px.
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
