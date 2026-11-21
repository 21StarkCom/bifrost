---
name: stark-design-bible
runtimes:
  - claude
  - codex
description: >-
  Use when you build, rebuild or review a web page or a small surface, such
  as a landing page or Huginn's popup. A surface gets the design loop: jobs,
  challenge, structures, look, then rounds of stark-eye and a fresh critic.
  A page type gets its playbook, its rule cards and their Checks.
argument-hint: "<surface or page type, for example popup or landing>"
---

## Help

If `$ARGUMENTS` contains a standalone `--help`, `-h`, or `help`,
follow [standard help](../../standards/help.md), then stop.

## Arguments

- `<name>`: a surface, such as `popup`, or a page type, such as `landing`.
  With none, use the one that the task names. When the task names none, go
  on as for a name with no playbook.

# stark-design-bible

The design bible is a set of short, testable rules for an agent that builds
a web page or redesigns a small surface. It lives in the vault-docs clone, in
`design-bible/`. It holds two methods:

- **The loop, for a surface** (section 2). A playbook in `surfaces/` gives the
  facts of the surface. `challenge.md`, `critic.md`, the taste board in
  `taste/` and the craft cards in `craft/` give the method.
- **The page method, for a page type** (section 3). A playbook in `pages/`
  gives the sections of the page, and rule cards give the rules.

Do not edit the bible: the vault-docs repo owns it. Name each rule that is
missing or wrong in your report.

## 1. Load the bible

The clone is `~/Code/21Stark/vault-docs`. Each path below is relative to it.

1. When `~/Code/21Stark/vault-docs` does not exist, clone it:
   `gh repo clone aryeh-stark/vault-docs ~/Code/21Stark/vault-docs`. When
   `design-bible/challenge.md` does not exist in it, the clone is older than
   the loop: run `git pull --ff-only` in the clone. When the clone or the
   pull fails, or `design-bible/ATLAS.md` is still missing, print
   `Missing: <path>` and the error, and stop.
2. Read `design-bible/ATLAS.md`. Print `Read: design-bible/ATLAS.md`.
3. Find the playbook. The name is a playbook only when it holds only
   lowercase letters, digits and hyphens, and its file exists:
   - `design-bible/surfaces/<name>.md`: read it, print
     `Read: design-bible/surfaces/<name>.md`, and run the loop (section 2).
   - Else `design-bible/pages/<name>.md`: read it, print
     `Read: design-bible/pages/<name>.md`, and run the page method
     (section 3).
   - Else list the names of the `.md` files in `design-bible/surfaces/` and
     `design-bible/pages/`, without `.md`. Print
     `No playbook for <name>. Surfaces: <names>. Page types: <names>`, or
     `No name. …` when there is none. Read no playbook, and go on with the
     page method on the index only.
4. Print a `Read:` line for each other file of the bible that you read later,
   in the same form.

When the request names nothing to build or review, stop here. The bible is
now in your context for the next request.

## 2. The loop, for a surface

Before step 1, set up the tools by
[references/loop-tools.md](references/loop-tools.md): the run folder, the
clock, `stark-eye`, the flow shell and its two plans, the agent users and the
fresh critic. Write the report as you go, in `<run>/report.md`, with the
headings of step 8.

**The jobs.** The task gives them as `jobs.md`. With none, the job table of
the playbook is the jobs.

**The time cap.** When the task names one, write it at the top of the report,
and keep the stop rule of step 7. Write the clock time at the start and the
end of each step in the report.

1. **Jobs.** Read `jobs.md`, the playbook, `challenge.md`, `critic.md`, and
   the repo's agent instructions files on the path of the surface's code.
   Write the job of the surface in one sentence.
2. **Walk the baseline.** On today's panel, before you change a file:
   1. Run `flow` with the toolbar plan: the clicks, the keys and the
      predicted seconds of each job. This table is "the flows before".
   2. Run `shoot` with the open plan, then `measure`.
   3. Run `walk` with the open plan on the weekly jobs, once with each
      persona: careful, hurried, keyboard and screen-reader.
   4. Run the tests of step 8. A test that fails here is not yours.
   5. Write the first clicks that missed, the dead ends (a task that does not
      reach its end), the five-second answers, the failed floors and the
      failed tests.
3. **Challenge.** Fill the challenge table of `challenge.md`: one row for
   each element of the panel, and one row for each job with no element. Give
   each verdict its reason and its known answer (`K1` to `K6`). Find the
   dependents of each element as the playbook says. Then a fresh critic
   attacks the table with `critic.md`, and you answer each finding in the
   table.
4. **Structure.** Make 3 structures in grey kit markup: the kit's parts with
   no styling of your own. Each structure keeps a path for each job. For each
   structure, write the known paths in a tasks file, then run `flow`, and
   `walk` the weekly jobs with the hurried and the careful persona. Pick by
   the numbers: the fewest clicks and seconds on the weekly jobs, then the
   first clicks. Then a fresh critic attacks the 3 with their shots and
   numbers. Write each structure's numbers and the reason of the pick.
5. **Look.** Read the taste board of the surface, and open its crops. Write
   5 moves, each tied to a crop and its move, as `ref-04/3`. Style the
   structure that won with the craft cards. A move that breaks a craft card,
   a floor or the kit rule loses.
6. **Build.** Draw each state of the playbook's table, in the light and the
   dark theme. Write the code that each flow needs, also outside the surface.
   Fix each dependent of each element that moved, and put the new known
   paths in the repo's tasks file. A part that the kit does not have is a kit
   wish: list it, and build from the parts that the kit has.
7. **See, walk and fix.** Each round:
   1. Run `shoot`, `measure`, `flow` and `walk` as in step 2, on the build.
   2. Fix each failed floor, and each weekly job that is slower than the
      baseline: more clicks or more predicted seconds.
   3. A fresh critic gets the shots, the numbers of `stark-eye` and
      `critic.md`, and writes a punch list in its format.
   4. Fix each item of severity 2 or 3.

   Stop when the punch list has no item of severity 2 or 3, after round 4,
   or when 20 minutes of the time cap are left.

   A walk or a floor outranks a critic's fix: when a fix makes a weekly job
   slower, a walk miss, or a floor fail, undo it, and answer the item in the
   report. An item of severity 2 or 3 that is left at the stop goes to the
   report as open, with its reason.
8. **Finish green.** Run the tests that the playbook names, and the repo's
   own test of the tasks file. Each must pass. Stop the flow shells that you
   started. Then finish the report, with these headings:
   - **Job**: the sentence of step 1, and the clock of each step.
   - **Challenge table**: the table of step 3, with the critic's findings
     and your answers.
   - **Flows before and after**: one table, one row for each job: the clicks
     and the predicted seconds before and after.
   - **Walks**: each persona's first clicks and task results, before and
     after, and the five-second answers.
   - **Structures**: the 3, with their numbers and the pick.
   - **Moves**: the 5 moves, each with its crop.
   - **Punch lists**: each round's list, and what you fixed.
   - **Floors**: each failed floor of the last round, with its reason.
   - **Tests**: each command and its result.
   - **Kit wishes** and **Bible gaps**: the parts you wished for, and the
     rules that are missing or wrong.

A fresh critic is your own model in a new context. It never sees the code or
your reasons: it judges what a person sees and does.
[references/loop-tools.md](references/loop-tools.md) gives its command on
each runtime.

## 3. The page method, for a page type

Follow [references/page-method.md](references/page-method.md): build the
sections in the playbook's order, open the cards, ask the librarian where a
card does not answer, and run each card's Check before you report the page
done.
