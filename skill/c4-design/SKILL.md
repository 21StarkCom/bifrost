---
name: c4-design
description: "Run the floorplan design loop for a C4 model: propose a LikeC4 diff, check, render, show it in the studio, accept it. Use to change, review or first model a product's architecture, C4 model or diagrams, or when a task names floorplan, LikeC4, floorplan scan, R9, a flow, a logo or a deployment view."
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
[flow](references/flows.md) of code that exists, the [logo](references/logos.md) of an external system) is not a design change. Edit the
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
   `stale`, and whose features list `annotate` and `annotateChat` (Huginn 0.69.97): step 4's chat, its `choice`
   and `thread` cards, `messages` and `reply` need `annotateChat`. With an older build, show `verdict` items with
   no `chat`, and wait for Send with `answers` (`timeoutMs:120000`, again at `sent:false`); each answer keeps
   its `note`. `guide` and `block` need
   `annotateGuide` (Huginn 0.69.54); with an older build, leave both out. The loop needs the grants `open`,
   `click`, `screenshot`, `focus`, `annotate` and `close`; a missing grant is refused with its name. A grant is a
   local CLI step: `slp huginn allow <id> annotate`. Each mutation also takes `confirm:true`, and every
   `annotate` op is a mutation, `answers` and `clear` included. On the MCP `huginn` tool, `confirm` and
   `timeoutMs` (the call's wall clock) are top-level fields, and the action's own fields (`tab`, `url`, `op`,
   `items`, the `answers` wait's `timeoutMs`) go in `args`.

## The loop

Each step names the `floorplan` MCP tool, then the CLI command that does the same work.

| Step                  | MCP tool                          | CLI                                                    |
| --------------------- | --------------------------------- | ------------------------------------------------------ |
| 1. Propose            | `propose` {name, title, dir}      | `floorplan propose <name> "<title>" [dir]`             |
| 2. Check, render      | `check` {dir}, `render` {view, dir, proposal} | `floorplan check [dir]`, `floorplan render <view> [dir] --proposal <name>` |
| 3. Show in the studio | `studio_start` {dir}              | `floorplan studio [dir]` in the background (prints `url` and `pid`, then stays in the foreground) |
| 4. Ask on the canvas  | Huginn `annotate`                 | `slp huginn annotate <id> --tab <id> --input …`       |
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
   boxes of step 4 show only in this tab, not in another copy of the URL.
6. Send the operator the URL, the view, the proposal's title, and the Chrome profile of the tab (the `label` that
   `list_huginns` gives).

The studio updates the diagram in place on each file save, with no page reload. It saves a layout that the
operator changes (a moved box) into `.floorplan/`. The operator may also edit the `.c4` text, so read the proposal
file again before each later step.

### 4. Ask open questions on the canvas

Huginn `annotate` draws a box around an element of the page, with a label. When the operator holds the pointer on
a box, its card opens. The bar at the top of the page counts the answers and has the button **Send to Odin**. The
contract is in `docs/huginn.md` of sleipnir, section **Annotate**.

Give each question the card that fits it, by the item's `kind`:

| `kind` | Use it when | The item gives | Its answer |
|---|---|---|---|
| `verdict` (default) | you made a pick, and the operator checks it | `tag` (one of `tags`), `confidence`, `why`, `question` | `{id, verdict, tag?}` |
| `choice` | the operator picks one of 2 to 6 designs, such as where a box goes | `question`, `options` (`[{label, detail?}]`), `pick` (your label), `why` | `{id, choice}` |
| `thread` | the question has no fixed answers, such as what a service owns | `remark` | `{id}`: the thread is the answer |

1. Run `annotate` with `op:"show"`, `chat:true`, `confirm:true` and the `tab`:
   - `title`: the proposal's title, for the bar.
   - `tags`: the choices of the verdict cards, 1 to 30, such as `keep`, `change`, `remove`. A show with a
     verdict item needs them.
   - `items`: one item for each element in question, 1 to 100: `{id, kind, locator}` and the fields of its kind.
     `confidence` is `high`, `medium` or `low`, and `why` is your reason.
   - The `locator` of an element is `{testId:"rf__node-<element id>"}`, such as `rf__node-shop.payments`: each
     box of the diagram carries its element's id that way. To ask about a relationship, box its source element,
     and name the relationship in the `question`.
   - `guide:true` walks the operator through the items one at a time, with the card of the current item open.
     `block:true` stops a press on a box from also selecting the element under it.
2. Read the result. An element in `missing` has no box: fix its `locator`, and run `show` again. Keep `last` (0)
   for `messages`. The boxes and cards do not show in Huginn's own `screenshot`, so do not look for them there.
3. Tell the operator in the chat that the questions are on the page, that each card takes a message to you, and
   that **Send to Odin** sends the answers. The bar covers the studio's toolbar. When it hides a part of the page
   that the operator needs, tell them to press the dock button, the last button of the bar: it moves the bar to the
   bottom of the page, and a new `show` keeps it there.
4. Run `annotate` with `op:"messages"`, `after` set to `last`, `timeoutMs:120000` (on MCP, in `args`, with a
   top-level `timeoutMs` of 150000 so the call outlives the wait) and `confirm:true`. It returns at a new
   message, at Send, or at the timeout, with `{sent, last, messages:[{n, id, from, text}]}`.
   - Answer each message whose `from` is `person` in its card: `reply` with `item` set to the message's `id`, a
     `text` of at most 4000 characters, and `confirm:true`. The open card shows the reply at once.
   - Keep each item's thread, its messages and your replies in order, for the next `show`.
   - Pass the new `last` as `after`, and run `messages` again until `sent` is `true`.
5. Run `annotate` with `op:"answers"`, `timeoutMs:0` and `confirm:true`. Each answer has its kind's shape above.
   `verdict` is `correct` (the operator agrees with your pick), `wrong`, `retag` (with the `tag` they chose) or
   `null`; `choice` is an option's label or `null`. With the chat, an answer has no `note`: read the threads.
6. Change the proposal by the answers and the threads, and run loop step 2 again. To ask again, run `show` with each
   item's `thread` (`[{from, text}]`, `from` being `person` or `caller`): a new `show` replaces the boxes and
   their threads, so a thread you do not send again is gone.
7. Run `annotate` with `op:"clear"` and `confirm:true` when no question is open.

A navigation or a reload of the tab removes the boxes, the answers and the threads; `answers`, `messages` and
`reply` then exit 4. Show the items again, each with its thread. A file save does not remove them.

### 5. Accept

The accept is the one approval of the whole design. End the turn with
`Needs you (Design approval): accept <the proposal's title>?`, and accept when the operator answers "accept" in
the chat. An answer or a message on the canvas is not an accept.

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
   `kit/spec.c4`), and `.floorplan/` when the operator moved a box. Put the To-be PNG in the PR body: the built
   `generated/png/<view>.png`, as an image link to that file at the PR's head commit
   (`https://github.com/<owner>/<repo>/blob/<sha>/<path>?raw=true`). Name the proposal's title and the
   operator's answers in the body.

When the operator drops the change, run `discard` with `name` and `dir`, stop the studio, and close the tab. The
model does not change.

## Two agents, two proposals

Two agents can each work on a proposal in the same project at the same time. floorplan warns on both when they
change the same element. Accept over that warning only when the operator's design approval names both
proposals; the other agent's proposal is theirs to change.
