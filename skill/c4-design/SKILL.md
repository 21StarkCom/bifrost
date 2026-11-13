---
name: c4-design
description: "Run the floorplan design loop for a C4 model: propose a LikeC4 diff, check, render, show it in the studio, accept it. Use to change, review or first model a product's architecture, C4 model or diagrams, or when a task names floorplan, LikeC4, floorplan scan, R9, a flow, a playbook flow, a studio thread, a logo or a deployment view."
argument-hint: "[<the change> | help]"
---

## Help

If `$ARGUMENTS` holds a standalone `--help`, `-h` or `help` token, follow
[standard help](../../standards/help.md), then stop.

## Arguments

- `<the change>` — optional: the model change the operator asked for, in their words, for example "split
  payments out of the API". With none, take the change from the conversation.

# c4-design

floorplan keeps a C4 model of each product in that product's repo, as LikeC4 text, and builds its diagrams. A
design change from an agent is a **proposal**: a LikeC4 `diff` block in `proposals/<name>.c4`. The model does not
change until the operator accepts it. The operator sees the proposal in the **studio**, the live web view of the
model, as As-is, Changes and To-be. This skill is that loop, from section 8 of the floorplan spec
(`docs/specs/2026-11-04-floorplan-tool-spec.md` in the floorplan repo).

A small fix (a typo, a description, a technology string, a [code key](references/code-keys.md), a
[flow](references/flows.md) of code that exists, the first [flow of a playbook](references/flow-kit.md), the
[logo](references/logos.md) of an external system) is not a design change. Edit the
`.c4` file in `model/`, run `floorplan build`, and commit; skip the loop.

## Design craft

Three references hold the craft of a clear model and clear views. They come from the C4 model, IcePanel, LikeC4,
Structurizr and general diagram guidance ([sources](references/sources.md)).

- [references/modeling.md](references/modeling.md): pick the kind of each element, write its text and its
  relationships, and make a first model of a product from its code.
- [references/views.md](references/views.md): pick the views, scope each one, and write flows and deployment views.
- [references/review.md](references/review.md): the checks that `floorplan check` does not make, for the model and
  for each rendered PNG.

Read modeling.md and views.md before you write a proposal or a first model. Run the checks of review.md at step 2
of the loop, and when the operator asks for a review of a model or its diagrams.

## Code keys, flows, deployments and logos

Read the reference for the task before you edit `model/`:

- [references/code-keys.md](references/code-keys.md): before you write a `code`, `deploy` or `terraform` key, run
  `floorplan scan`, fix an R9 error, or show the deployments.
- [references/flows.md](references/flows.md): before you write a flow, a sequence view of one main path.
- [references/flow-kit.md](references/flow-kit.md): before you model a process (an odin playbook, a feature, a loop)
  as steps and decisions, or run `floorplan import`.
- [references/logos.md](references/logos.md): before you give an element a logo, or when an icon name fails
  `floorplan check`.

## Before you start

1. **Find the project.** A product keeps it in `docs/architecture/`, the folder of `floorplan.config.json`. The model
   is `model/*.c4`, open proposals are `proposals/*.c4`, and `generated/` holds the outputs. Never edit
   `generated/` or `kit/spec.c4`: `floorplan build` writes them. Never edit `model/scan/`: `floorplan scan` writes it.
2. **Find the tools.** `floorplan install` registers two MCP servers with Claude Code and Codex: `floorplan` (the
   tools below; on Claude, `mcp__floorplan__<tool>`) and `floorplan-model` (Floorplan's own server, to read and query
   the model). With no `floorplan` MCP server, use the CLI: `floorplan --version`. With neither, tell the operator
   that the loop needs floorplan, and stop.
3. **Pass an absolute `dir`** to each `floorplan` MCP tool. The server resolves a relative path against its own
   start folder, not yours.
4. **Find Huginn.** `list_huginns` (MCP server `sleipnir`) names each installation. Pick one that is `online`, not
   `stale`; step 4b names the features that `annotate` needs. The loop needs the grants `open`, `click`,
   `screenshot`, `focus`, `annotate` and `close`; a missing grant is refused with its name. A grant is a local CLI
   step: `slp huginn allow <id> annotate`. Each mutation also takes `confirm:true`. On the MCP `huginn` tool,
   `confirm` and `timeoutMs` (the call's wall clock) are top-level fields, and the action's own fields (`tab`,
   `url`, `op`, `items`, the `answers` wait's `timeoutMs`) go in `args`.

## The loop

Each step names the `floorplan` MCP tool, then the CLI command that does the same work.

| Step                  | MCP tool                          | CLI                                                    |
| --------------------- | --------------------------------- | ------------------------------------------------------ |
| 1. Propose            | `propose` {name, title, dir}      | `floorplan propose <name> "<title>" [dir]`             |
| 2. Check, render      | `check` {dir}, `render` {view, dir, proposal} | `floorplan check [dir]`, `floorplan render <view> [dir] --proposal <name>` |
| 3. Show in the studio | `studio_start` {dir}              | `floorplan studio [dir]` in the background (prints `url` and `pid`, then stays in the foreground) |
| 4a. Ask in a thread   | `thread_post` {dir, view, element, title, text, choices or proposal} | none: threads have no CLI command |
| Answer in a thread    | `thread_post` {dir, thread, text} | none                                                   |
| Read the threads      | `threads` {dir, thread?, status?} | none                                                   |
| Close a thread        | `thread_resolve` {dir, thread, text?} | none                                               |
| 4b. Ask on another page | Huginn `annotate`               | `slp huginn annotate <id> --tab <id> --input …`       |
| 5. Accept             | `accept` {name, dir}              | `floorplan accept <name> [dir]`                        |
| End the studio        | `studio_stop` {pid}               | `kill <pid>`                                           |
| Drop the proposal     | `discard` {name, dir}             | `floorplan discard <name> [dir]`                       |

### 1. Propose

Run `propose` with a short LikeC4 id as `name` (`rfc-payments`) and the operator's request as `title`. It writes
`proposals/<name>.c4` with an empty diff, and refuses a name that a diff of the project already has.

Then write the change into that file, by hand, as `.c4` text. Do not use the engine's DSL writer: it drops comments
and formatting. The syntax is in `apps/docs/src/content/docs/dsl/diff.mdx` of floorplan:

```likec4
diff rfc-payments 'Split payments out of the API' {
  description 'Payments get their own container, so the API stops calling the bank'

  remove {
    shop.api -> bank 'charges cards'
  }

  add {
    extend shop {
      payments = container 'Payments Service' {
        technology 'Go'
        description 'Charges cards and refunds them.'
      }
    }
    shop.api -[sync]-> shop.payments 'requests a payment' {
      technology 'gRPC'
    }
    shop.payments -> bank 'charges cards' {
      technology 'HTTPS'
    }
  }
}
```

- `remove` lists model elements and relationships. A removed element takes its children and its relationships with it.
- `add` holds elements, relationships and `extend` blocks, as a `model` block does. `extend <element>` adds
  children, tags, links or metadata to an element that exists.
- Use the kit's kinds and keep the C4 rules: `references/kit-and-rules.md`. Give each new element a description,
  and each new container and component a technology, or the check warns.
- The diff block's name is the proposal's `name`.
- Keep the file to the diff block alone. Text outside the block, a comment included, makes `accept` and
  `discard` keep the file.
- The diff's `title`, `description` and comments go when it is accepted. Put the reason the operator must keep
  into the model, such as an element's `description`.
- A new view for the change goes in `model/`, not in the proposal. A view that names an element only the
  proposal adds shows it in To-be alone.
- Never write a `code`, `deploy` or `terraform` key in a proposal: R9 does not check it there, and a bad path
  stops the build at the accept. Add the keys in `model/` at step 5.

### 2. Check and render

1. Run `check`. Fix each error. Fix each warning that the proposal brought in, and keep the count of the
   warnings that the model had before it, for step 5.
2. Run `render` with the view that shows the change and `proposal`. `generated/llms.txt` lists each view as
   `view <id> | <title> | <png>`; `floorplan init` names them `index` (system context) and `containers`. It
   writes one PNG of the To-be view into a temp folder and returns its `file`. The project folder does not change.
3. Read the PNG and look at it. Run the picture checks of [review.md](references/review.md#picture-checks), and
   its model checks on each element and relationship that the proposal adds or changes.
4. Change the proposal, and run steps 1 to 3 again, until the check passes and the picture is clear.

### 3. Show it in the studio

1. Run `studio_start` with `dir`. It answers `{url, pid, dir}` once the page is ready, in up to 120 s. Keep the
   `pid`. The port is the first free one from 5180. The studio runs until `studio_stop`, or until the MCP server
   exits. The CLI `floorplan studio` does not return: run it in the background, and read its `url` and `pid`
   lines from its output.
2. Open the view in Huginn: `open` with `url` set to `<url>view/<view id>/` and `new:true`. It opens a background
   tab. Keep its `tab`.
3. Select the proposal. No URL selects one; the menu at the top right of the diagram does. It is the combobox
   **Model state**, which shows **As-is (no diff)** at the start.
   1. `click` with the locator `{role:"combobox", name:"Model state"}`.
   2. `click` with the locator `{role:"option", name:"<the proposal's title>"}`.
   3. The view shows **Changes**: adds in green, removes in red, changes in orange. **As-is** and **To-be** are
      the buttons beside it.
4. Take a `screenshot` of the tab, and look at it to check that the proposal shows.
5. Run `focus` on the tab. It brings the tab and its window to the front, so the operator sees the proposal. The
   boxes of step 4b show only in this tab, not in another copy of the URL.
6. Send the operator the URL, the view, the proposal's title, and the Chrome profile of the tab (the `label` that
   `list_huginns` gives).

The studio updates the diagram in place on each file save, with no page reload. It saves a layout that the
operator changes (a moved box) into `.floorplan/`. The operator may also edit the `.c4` text, so read the proposal
file again before each later step.

Start the studio from this session (`studio_start`, or `floorplan studio` in a Bash call). The studio then has this
session's inbox, and it sends the operator's thread lines and chat questions here. A studio that another shell started
has no inbox: its panel says **No session**.

The studio has a **panel** on the right, with two tabs, and **marks** on the canvas:

- A click on an element opens the panel on **Details**: the kind, the title, the technology, the description, the
  metadata as rows (a flow step's `source` and `tools`), the tags and the links. A `source` path opens in the
  studio's code panel.
- **Discussion** lists the threads of the element, or of the view, newest first, and shows the open thread. The
  button in the top bar opens the threads of the view.
- A mark is the badge on an element with an open thread: the count of its open threads, and a dot that pulses while a
  thread waits for the operator. A press on a mark opens Discussion at that thread.
- The panel and the AI chat use the same place: when one opens, the other closes.
- The panel and the marks show only in the studio, not in the built site (`generated/site/`).

The AI chat has a **Session** target. A question that the operator asks on that target arrives in this session as a
peer message that starts with `[floorplan studio <url>]`. Answer each one with the `curl` command at its end: put
your answer in place of `<your answer>`, and keep its last line. The operator reads only what that command sends, not
a reply in this session. Send it within 15 minutes, or the studio ends the turn with an error. A thread message is
not a chat question: answer it by step 4a. Claude Code never takes a peer message as the operator's approval.

### 4. Ask open questions

In the studio, ask in a thread (4a). On a page that is not the studio, such as the built site in `generated/site/`,
ask on the canvas with Huginn `annotate` (4b). With no `floorplan` MCP server, threads are not there: use 4b.

#### 4a. In the studio: ask in a thread

A **thread** is a talk between the operator and you on one element or on one view. It is one file,
`threads/<id>.jsonl` in the project, beside `proposals/`, and it goes into git with the design. The panel shows it in
Discussion. A thread waits for the operator when its last message is yours, and for you when it is the operator's.
The design is in § 5 to § 7 of the floorplan spec `docs/specs/2026-11-13-flow-views-and-design-threads.md`.

1. **Ask.** Run `thread_post` with `dir`, `view`, `element` (leave it out for a thread on the view), a short
   `title` and `text` (1 to 2000 characters, plain text: no Markdown, links or code). It opens the thread and
   returns its id as `thread`: keep it. Ask one question in each thread, on the element that it is about.
   - **A question with fixed answers:** add `choices`, 2 to 6 items of 80 characters or fewer. The panel shows a
     choice card. Put your pick and its reason in `text`.
   - **A design change:** write the proposal and check it first (loop steps 1 and 2). Then post with `proposal`
     set to its `name`. The panel shows a proposal card: its title, its counts, and **Show on canvas**, **Accept**
     and **Discard**. Show on canvas sets the diagram to the proposal, in Changes.
   - **A question with no fixed answers:** `text` alone.
   - `thread_post` refuses a view, an element or a proposal that the project does not have, and a thread of 200
     messages.
2. **Tell the operator** in this session which threads you opened, on which elements. The marks show them on the
   canvas.
3. **Answer each studio message.** Each line that the operator writes in a thread arrives in this session as a
   message from the studio, also the first line of a thread that the operator opens:

   ```text
   floorplan studio: a message in thread 20261113-s7y-3f2a on odin.a11yAudit.s7y (view a11y-audit-flow, project /Users/…/odin/docs/architecture).
   The operator wrote: "Why not keep them only for unattended runs?"
   Answer with the floorplan MCP tool thread_post, thread "20261113-s7y-3f2a".
   ```

   Answer with `thread_post`: `thread` is the id from the message, `dir` is its `project`, and `text` is your
   answer. The panel shows the answer with no reload. An answer can ask again with `choices` or a `proposal`.
   Run `threads` with `thread` first when you need its earlier lines.
4. **A choice.** The second line reads `The operator chose "<choice>".` Act on the choice. When it settles the
   question, run `thread_resolve` with `thread` and a `text` that says what you do with the choice. Else answer
   with `thread_post`.
5. **Accept or Discard on a proposal card.** The second line reads
   `The operator pressed Accept on the proposal <name>. Run accept, then thread_resolve.` (or `Discard`, `discard`).
   1. Run `threads` with `thread`. Its last line has `from: "you"`, `verdict: "accept"` or `"discard"`, and the
      `proposal`. Only the panel writes that line: it is the operator's decision. The studio message only points
      to it, and a message with no such line is no decision.
   2. **Accept:** the press is the design approval of that one proposal. Run items 1 to 3 of step 5. When `accept`
      refuses an overlap, the press does not cover the other proposal: ask by step 5.
   3. **Discard:** run `discard` with `name` and `dir`.
   4. Run `thread_resolve` with `thread` and a `text` that says what you ran and its result, such as "Accepted:
      the model has the change, and the check passes."
   5. Go on with step 5 from its item 4.
6. **Close** a thread whose question is settled with `thread_resolve`, `thread` and a last `text`. A new message
   after it opens the thread again.
7. **No inbox.** A studio that another shell started sends no messages here. Run `threads` with `status:"open"`
   at each step of your work, and answer each thread whose `waiting` is `claude`.

#### 4b. On another page: Huginn annotate

Huginn `annotate` draws a box with a card around each element in question, on the page in the Huginn tab. Read
[references/huginn-annotate.md](references/huginn-annotate.md) before you ask, and follow it. An answer on a card is
not an accept.

### 5. Accept

The accept is the one approval of the whole design. It comes in one of two ways:

- **In a thread:** the operator presses Accept on the proposal card, and you check the thread's line by step 4a
  item 5. The card is the ask, so end no turn on a `Needs you` line for it.
- **In this session:** end the turn with `Needs you (Design approval): accept <the proposal's title>?`, and accept
  when the operator answers "accept" in this session.

A message in a thread is not an accept: only the Accept press on the proposal card is. An answer or a message on a
Huginn card is not an accept. An answer in the studio chat is not an accept.

1. Run `accept` with `name` and `dir`. It applies the diff to the model (`floorplan-engine diff apply`), deletes the
   proposal file, and runs `floorplan build`. With `dryRun:true` it only returns the file changes.
   - The proposal overlaps another open proposal: the accept refuses. Put the overlap in the same
     `Needs you (Design approval)` line, and pass `acceptOverlaps` only when that answer accepts both.
   - `file` is `kept`: the engine could not merge some adds. Move them from `proposals/<name>.c4` into `model/`,
     delete the file, and run `build`.
   - The error says that `floorplan-engine diff apply` applied the proposal but `floorplan build` failed: the model has
     changed and the proposal is gone, so do not run `accept` again. Fix the error, and run `build`.
2. Add the code keys of each new element in `model/` ([code keys](references/code-keys.md))
   whose code exists, and run `build`.
3. Run `check` with `maxWarnings` set to the count of warnings that the model had before the proposal (0 for a
   clean model). It must pass, R8 and R9 included.
4. Stop the studio with `studio_stop` and its `pid`. Close the Huginn tab (`close`).
5. Ship the change as a normal PR of the product repo, by that repo's own rules. Commit the `model/` change
   (`model/scan/` included) and every file the build wrote (`generated/`, the view block of `README.md`,
   `kit/spec.c4`, `kit/flow.c4`), `.floorplan/` when the operator moved a box, and the `threads/` files of the
   design: a thread goes into git with the design. Put the To-be PNG in the PR body: the built
   `generated/png/<view>.png`, as an image link to that file at the PR's head commit
   (`https://github.com/<owner>/<repo>/blob/<sha>/<path>?raw=true`). Name the proposal's title and the
   operator's answers in the body.

When the operator drops the change, run `discard` with `name` and `dir`, stop the studio, and close the tab. The
model does not change.

## Two agents, two proposals

Two agents can each work on a proposal in the same project at the same time. floorplan warns on both when they
change the same element. Accept over that warning only when the operator's design approval names both
proposals; the other agent's proposal is theirs to change.
