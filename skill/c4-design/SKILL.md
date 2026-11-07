---
name: c4-design
description: "Run the floorplan design loop for a C4 architecture model: propose a model change as a LikeC4 diff, check it against the C4 rules, render it, show it to the operator in the floorplan studio through Huginn, ask open questions on the canvas with Huginn annotate, and accept it into the model and a PR. Also link the model to its code with the code, deploy and terraform keys and floorplan scan, fix an R9 error, write a flow as a sequence view, give each external system its vendor logo, and show the deployments from Terraform and Kubernetes files. Also make a first model of a product from its code, and review a model or its diagrams against the C4 review checklist. Use when the operator asks to change, add to or redesign a product's architecture, its C4 model, diagram or views (a new system, container, component or relationship, a split or a merge), when the operator asks to review or improve an architecture diagram or a C4 model, when a repo holds a floorplan project (docs/architecture/floorplan.config.json), or when a task names floorplan, LikeC4, a C4 diagram, a model proposal, floorplan scan, a flow, a logo or a deployment view."
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

A small fix (a typo, a description, a technology string, a [code key](#link-the-model-to-its-code), a
[flow](#flows) of code that exists, the [logo](#logos) of an external system) is not a design change. Edit the
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

## Link the model to its code

Three metadata keys, the D1 keys, tie an element to the files of its repo. A path is relative to the repo root (the
`git rev-parse --show-toplevel` of the project folder), not to the project folder.

| Key         | Its value                                                                                | It goes on                         |
| ----------- | ---------------------------------------------------------------------------------------- | ---------------------------------- |
| `code`      | a folder or a file, or a list of them: `code ['cmd/api/', 'internal/api/']`              | a `component` or a container kind  |
| `deploy`    | a Kubernetes manifest (a file or a folder), or a Terraform resource as `tf:<type>.<name>` | a container kind                   |
| `terraform` | a folder of `.tf` files, or a list of them                                               | a `softwareSystem`                 |

The container kinds are `container`, `webApp`, `mobileApp`, `database` and `queue`.

```likec4
shop = softwareSystem 'Shop' {
  description 'Takes and keeps the orders.'
  metadata {
    terraform 'infra'
  }

  api = container 'API' {
    technology 'Go'
    description 'Takes the orders.'
    metadata {
      code 'services/api/'
      deploy 'services/api/k8s/'
    }
  }
}
```

- Write the keys in `model/` files, as a small fix: edit, run `floorplan build`, and commit.
- Never write a key in a proposal. A proposal is not a build input, so the scan does not read it, and R9 does not
  check its paths. The key reaches the model only at the accept, where a bad path stops the build after
  `floorplan-engine diff apply` has changed the model. Accept a new element first, then add its keys in `model/`.

### floorplan scan

`floorplan scan [dir]` (MCP `scan` {dir}) reads the keys and writes `model/scan/`, and nothing else. It changes no
hand-written file and never commits. `floorplan build` runs it first; `--no-scan` (MCP `noScan:true`) skips it.

- The scan reads only the files that git tracks, and the URL of `origin`. Stage a new file (`git add`) before the
  scan, or its path is not in git.
- It writes `links.c4` (a link `https://github.com/<owner>/<repo>/tree/HEAD/<path>` for each `code` path),
  `stack.c4` and `stack-views.c4` (the tech stack of each element with a `code` key, and the view `stack`),
  `logos.c4` (the logo of each language, [Logos](#logos)), and, from the `terraform` and `deploy` keys,
  `deployment.c4` and `deployment-views.c4` (the network, the deployments with the Google Cloud icon of each node,
  and the view `deployment`).
- `model/scan/` is the scan's. Each file starts with `// Written by floorplan scan. Do not edit.` Never edit one:
  R9 fails on the change, and the next scan writes the file again.
- The scan also owns the stack keys `language`, `language-version`, `runtime`, `frameworks` and `image`, the view
  ids `stack` and `deployment`, and the style group id `languageLogos`. Do not write them by hand: LikeC4 adds a
  hand-written value of a key to the scan's value, and a second view or style group with one of those ids is a
  duplicate.
- A project with no key gets no `model/scan/` folder, and R9 passes.
- A key with a problem stops `floorplan build`: it prints the problem and writes no outputs.

### R9 and its fixes

`floorplan check` runs R9, an error: each key is on its kinds, each path is in git, each value is one the scan can
place, and `model/scan/` matches a new scan in memory. The fix for each failure:

| `floorplan check` says (R9)                                                                       | Fix                                                               |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `the code path <path> is not in git: git tracks no file or folder with this path.`                | Fix the path of the key in `model/`, or `git add` the file.       |
| `the code key is on a <kind>, but it goes only on a component or a container kind (…).`           | Move the key in `model/` to an element of a kind that takes it.   |
| `the file is not what floorplan scan writes now.`, or a file that is missing or extra under `model/scan/` | `model/scan/` is out of date: run `floorplan build`.      |

- The first two read the same for `deploy` and `terraform`. A path out of the repo, or a project out of a git
  checkout, is the first kind too.
- `deploy` also fails on a value that the scan cannot place: a manifest with no workload, workloads with no
  `terraform` cluster, and a `tf:` address with no node. Fix the key in `model/`, or the file it names.
- The check says to run `floorplan scan` for an out-of-date file. Run `floorplan build`: `model/scan/` is under
  `model/`, an input of R8, so a scan that changes a file makes R8 fail until the next build.

## Flows

A flow shows the steps of one main path through the code, in order, as a sequence diagram. Write it as a
`dynamic view` with `variant sequence` in a `views` block of `model/`:

```likec4
dynamic view flowCheckout {
  variant sequence
  title 'Flow: checkout'
  description 'The web app sends the cart to the API, which stores the order.'

  // The order of the lifelines, left to right
  include
    customer,
    shop.web,
    shop.api,
    shop.db

  customer -> shop.web 'presses Pay'
  shop.web -> shop.api 'posts the cart'
  shop.api -> shop.db 'stores the order'
  shop.web <- shop.api 'returns the order id'
}
```

- Name leaf elements only: people, external systems, and containers or components with no children. A sequence
  view shows only leaf elements, so a step names `shop.api`, never `shop`.
- Write one flow for each main path, not one for each function. Read the code of each step before you write it.
- floorplan's own model has two flows to copy: `flowBuild` and `flowDesignLoop` in `docs/architecture/model/views.c4`
  of floorplan. They use `alt` with `when` and `else`, `loop`, `parallel`, and a step's `notes`. The syntax is in
  `apps/docs/src/content/docs/dsl/Views/dynamic.mdx` there.
- Run `floorplan build`, then `render` the flow's view id and look at the PNG, as in step 2 of the loop.
- No rule asks for a flow.

## Deployments

The network and the deployments come from the `terraform` and `deploy` keys:

1. Put a `terraform` key on the `softwareSystem`: the folders of its `.tf` files.
2. Put a `deploy` key on each container kind that runs: its Kubernetes manifest (a `Deployment`, `StatefulSet`,
   `CronJob` or `Job`), or `tf:<type>.<name>` for the resource it runs on, such as
   `tf:google_compute_instance.connector`.
3. Run `floorplan build`. The scan writes the nodes and the instances into `model/scan/deployment.c4`, and the view
   `deployment` into `model/scan/deployment-views.c4`. Run `render` on the view `deployment` and look at it.

- The scan reads only the `.tf` files that git tracks. It never reads Terraform state and never runs `terraform`:
  state can hold secret values.
- It draws a node for each `google` resource type that has a deployment kind of the kit
  (`references/kit-and-rules.md`), and lists the other `google_*` types in a comment.
- A manifest's workload goes in the first cluster by Terraform address. The scan reads plain manifests only, not
  Kustomize overlays, Helm charts or `kind: List` exports.
- One project has one deployment model: the `terraform` folders of all its systems share one environment, `gcp`.
- Write a `deployment` block by hand only for what no `.tf` file holds. Use the kit's deployment kinds, or R1
  fails.

## Logos

A logo is the `icon` of an element: an icon that LikeC4 bundles, named `<set>:<name>`. The sets are the folders of
`packages/icons/` in the floorplan repo: `tech` (vendors, products and languages, such as `tech:github`), `gcp`
(Google Cloud products, such as `gcp:cloud-sql`), `aws`, `azure` and `bootstrap`. floorplan 0.5.0 and later write the
logos of the languages and of Google Cloud. You write the logos of the external systems.

**External systems.** Give each external system `icon <name>` in `model/`, as a small fix: edit, run
`floorplan build`, and commit. No scan does it, because no key of the model names a vendor. A new external system
in a proposal takes its `icon` in the `add` block, as it takes its `description`.

```likec4
github = externalSystem 'GitHub' {
  description 'Hosts the repos and runs CI.'
  icon tech:github
}

slack = externalSystem 'Slack' {
  description 'Gets the alerts.'
  icon tech:slack
}
```

- Use a bundled icon only when it names the same vendor or product as the element.
- Use the icon of the product when one is bundled: `tech:jira` for Jira, `tech:claude` for Claude,
  `gcp:key-management-service` for Cloud KMS. Else use the icon of the vendor: `tech:google-cloud`.
- Give no `icon` to an element that names two or more vendors, or to a vendor with no bundled icon (HiBob,
  Twingate, Cursor). The repos keep no brand files.
- An internal element can take an `icon` too. That icon wins over the language logo below.

**Languages.** `floorplan scan` writes `model/scan/logos.c4`: the style group `languageLogos`, with the logo of
the language of each element of `stack.c4` (`tech:go`, `tech:typescript`, `tech:javascript`, `tech:python`).

- The view `stack` applies the group. A hand-written view shows the language logos only when you add the line
  `global style languageLogos` to it. No hand-written view has the line by default.

  ```likec4
  view containers of shop {
    include *

    global style languageLogos
  }
  ```

- The scan leaves an element with a hand-written `icon` out of the group, so the element keeps its own icon.
- When each element of `stack.c4` has a hand-written `icon`, the scan writes no `logos.c4`. A view with the line
  then fails `floorplan check` with `Could not resolve reference to GlobalStyleId named 'languageLogos'.` Remove
  the line from the view.

**Google Cloud.** The scan writes `icon` on each node of `model/scan/deployment.c4`, by the resource type:
`tech:google-cloud` on the environment `gcp`, `gcp:project` on a project, `gcp:cloud-sql` on a
`google_sql_database_instance`, and so on. An instance keeps the icon of its element.

- Never edit `logos.c4` or the icons of `deployment.c4`. They are scan files: R9 fails on the change, and the next
  scan writes them again.

**An unknown icon name fails `floorplan check`,** in `model/` and in a proposal. In `model/`, `floorplan build`
then writes no outputs. The language reads the name as a reference, so no rule R1 to R9 is needed:

```
model/model.c4:12 error FLOORPLAN Could not resolve reference to LibIcon named 'tech:hibob'.
```

Fix the name, or remove the `icon`.

**No technology text from an icon.** Each floorplan project sets `"inferTechnologyFromIcon": false` in its
`floorplan.config.json`. `floorplan init` writes the key from floorplan 0.5.0 on; add it by hand to an older project.

```json
{
  "name": "shop",
  "title": "shop",
  "inferTechnologyFromIcon": false
}
```

Without the key, LikeC4 gives each element with an icon and no `technology` a technology text from the icon's name,
such as "Github" or "Slack", under its title. The text repeats the logo, and it can spell a brand name wrong
("Github" for GitHub).

A node shows one icon, so frameworks and runtimes stay as text in the element's card.

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
   `stale`, and whose features list `annotate`. `guide` and `block` (step 4) also need the feature
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

Then write the change into that file, by hand, as `.c4` text. Do not use LikeC4's DSL writer: it drops comments
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

### 2. Check and render

1. Run `check`. Fix each error. Fix each warning that the proposal brought in, and keep the count of the
   warnings that the model had before it, for step 5.
2. Run `render` with the view that shows the change and `proposal`. `generated/llms.txt` lists each view as
   `view <id> | <title> | <png>`; `floorplan init` names them `index` (system context) and `containers`. It
   writes one PNG of the To-be view into a temp folder and returns its `file`. The project folder does not change.
3. Read the PNG and look at it. Run the picture checks of [review.md](references/review.md#picture-checks), and its model checks on each element and relationship that the proposal adds or changes.
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
a box, a card shows the question, with **Correct**, **Wrong**, a list of the other tags and a note field. The bar at
the top of the page counts the answers and has the button **Send to Odin**. The contract is in `docs/huginn.md` of
sleipnir, section **Annotate**.

1. Run `annotate` with `op:"show"`, `confirm:true` and the `tab`:
   - `title`: the proposal's title, for the bar.
   - `tags`: the choices that the questions share, 1 to 30, such as `keep`, `change`, `remove`.
   - `items`: one item for each element in question, 1 to 100. Each item is `{id, locator, tag, confidence,
     why, question}`: `tag` is your own pick and one of `tags`, `confidence` is `high`, `medium` or `low`,
     `why` is your reason, and `question` is what the operator decides.
   - The `locator` of an element is `{testId:"rf__node-<element id>"}`, such as `rf__node-shop.payments`: each
     box of the diagram carries its element's id that way. To ask about a relationship, box its source element,
     and name the relationship in the `question`.
   - `guide:true` walks the operator through the items one at a time, with the card of the current item open.
     `block:true` stops a press on a box from also selecting the element under it.
2. Read the result. An element in `missing` has no box: fix its `locator`, and run `show` again. The boxes do not
   show in Huginn's own `screenshot`, so do not look for them there.
3. Tell the operator in the chat that the questions are on the page, and that **Send to Odin** sends the answers.
4. Run `annotate` with `op:"answers"`, `timeoutMs:120000` (on MCP, in `args`, with a top-level `timeoutMs` of
   150000 so the call outlives the wait) and `confirm:true`. It waits for Send. At the timeout it answers
   `sent:false` with the answers so far; run it again. Each answer is `{id, verdict, tag?, note?}`. `verdict` is `correct` (the operator agrees with your pick), `wrong`, `retag`
   (with the `tag` they chose) or `null`.
5. Change the proposal by the answers and their notes, and run step 2 again.
6. Run `annotate` with `op:"clear"` and `confirm:true` when no question is open.

A navigation or a reload of the tab removes the boxes and the answers, and `answers` then fails. Show the items
again. A file save does not remove them. A new `show` replaces the boxes of the last one.

### 5. Accept

The accept is the one approval of the whole design. End the turn with
`Needs you (Design approval): accept <the proposal's title>?`, and accept when the operator answers "accept" in
the chat. An answer on the canvas is not an accept.

1. Run `accept` with `name` and `dir`. It applies the diff to the model (`floorplan-engine diff apply`), deletes the
   proposal file, and runs `floorplan build`. With `dryRun:true` it only returns the file changes.
   - The proposal overlaps another open proposal: the accept refuses. Put the overlap in the same
     `Needs you (Design approval)` line, and pass `acceptOverlaps` only when that answer accepts both.
   - `file` is `kept`: LikeC4 could not merge some adds. Move them from `proposals/<name>.c4` into `model/`,
     delete the file, and run `build`.
   - The error says that `floorplan-engine diff apply` applied the proposal but `floorplan build` failed: the model has
     changed and the proposal is gone, so do not run `accept` again. Fix the error, and run `build`.
2. Add the code keys of each new element in `model/` ([Link the model to its code](#link-the-model-to-its-code))
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

Two agents can each work on a proposal in the same project at the same time. LikeC4 warns on both when they
change the same element. Accept over that warning only when the operator's design approval names both
proposals; the other agent's proposal is theirs to change.
