# Tours

Read from [the c4-design skill](../SKILL.md#tours).

A **tour** is one page with numbered steps: the diagram of one flow, the screens of the app, the choices, before and
after. `floorplan tour build` writes it as one HTML file. The page opens from disk, on Folkvang and in the studio, with
no server. The design is the floorplan spec `docs/specs/2026-11-21-tours.md`.

The model holds the diagram and the words of each step. The tour file holds only what the model cannot hold: the
screens, the choices, before and after. Nobody places a box or a wire by hand.

## When to write a tour

| The operator asks to see         | Write                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| A spec of a change               | A tour of the flow that the spec adds, with screens of the app. Add `asis:` and `proposal:` when the change replaces a flow. |
| A suggestion in a thread         | A tour of the suggested flow, with `proposal:`, so the operator reads it step by step before the accept. |
| How a flow of the code works now | `floorplan tour new --view <id>`, then `floorplan tour build`. It needs no screens and no new words. Outside the project, write the tour file by hand ([below](#the-tour-file)). |

A tour shows one dynamic view. The structure of a system is a view, not a tour ([views.md](views.md)). A process of
decisions is a flow of the flow kit ([flow-kit.md](flow-kit.md)).

## The tour file

Keep it at `tours/<name>.tour.yaml` of the project folder, the folder of `floorplan.config.json`. The studio serves
only the tour files there, and a thread can only name a tour there. `<name>` is the name of the tour.

A tour file in another folder builds too, when the project must not change (a scratch folder, a review of another
team's repo). Write it by hand, with `model:` relative to the tour file or absolute. The page then opens from disk
and on Folkvang, but not in the studio.

```yaml
title: Plugins in each Space
model: .. # the project folder, relative to this file (an absolute path works too)
flow: pluginsInSpaces # a dynamic view of the project
proposal: plugins-in-spaces # optional: lay out flow with this proposal applied
asis: pluginsBeforeSpaces # optional: the flow before the change, behind the As-is switch
css: [screens/look.css] # optional: the look of the product, in each screen
roles: # optional: the roles of the step bar, in order; each screen names one
  owner: The owner of a Space
  admin: The admin
screens:
  - id: settings
    role: owner
    label: Space settings # optional: its button; default the id
    url: folkvang.evinced.space/spaces/aryeh-space/settings # optional: the address bar
    html: screens/settings.html # or image: screens/admin-today.png, with alt
    notes:
      - The settings of a Space get a pane **Plugins**, after People.
choices:
  - '**Who:** the owner of a Space, or an admin.'
before:
  - An admin gives the plugin one Space, one time.
after:
  - The owner of a Space turns the plugin on there.
```

- `title`, `model` and `flow` are required. Each other key is optional, and the build refuses a key that is not
  above.
- Each path is relative to the tour file.
- The first screen of each tour is `flow`: the diagram, the steps, before and after. Do not list it. `flow` is not a
  free screen id.
- A screen takes `id` (1 to 31 of `a-z`, `0-9` and `-`), `role` (a key of `roles`) and one of `html` or `image`.
  `label`, `url`, `alt`, `css` (the CSS of this screen) and `notes` are optional.
- A line of `notes`, `choices`, `before` and `after` may hold `**bold**` and `` `code` ``. Nothing else is markup.

## The words of a step

The flow is a `dynamic view` in `model/` ([flows.md](flows.md)). Each step gives its own words:

| Of the step                         | On the page                             |
| ----------------------------------- | --------------------------------------- |
| `title`, the label of the step      | the label on the wire of the active step, and the step panel |
| `description`                       | the sentence of the step panel          |
| the first fenced code block of `notes` | the call                             |
| the rest of `notes`                 | the why                                 |
| `color red`                         | a cut wire: the step turns a thing off  |
| an `alt` branch (`when`, `else`)    | a group of steps with its title, in the step bar |

```likec4
spaceOwner -> folkvang.backend 'the switch' {
  description 'You turn Forms on, in the settings of your Space.'
  notes '''
    ```
    PUT /api/v1/spaces/aryeh-space/plugins/forms   {"enabled": true}
    ```

    Only the owner of the Space, or an admin, passes. Each other person gets 403.
  '''
}
```

- A step with no `description` is a warning: its panel shows `<from> → <to> · <title>`. Give each step of a new flow
  a description. Keep a current flow as it is, and accept the warning.
- The diagram draws one wire for each pair of boxes. Its label shows the title of the active step. A wire of one
  step shows its title always. Each other wire shows only the numbers of its steps.
- Change the words of a step in the view, never in the tour file. A small fix of a view is not a design change: edit
  `model/` by the skill's small-fix rule.
- The tour draws the diagram, also for a view with `variant sequence`.

## As-is and To-be

Use both keys when a change replaces a flow.

1. **`asis:`** names a dynamic view of the flow before the change. Write it in `model/`, beside the new flow. The page
   switches between As-is and To-be. Two steps match by their source, their target and their index among the steps of
   that pair:
   - A To-be step that the As-is does not have is **New**.
   - A step of both with another `title`, `description` or `notes` is **Changed**.
   - An As-is step that the To-be does not have is **Removed**.
2. **`proposal:`** names a proposal in `proposals/`, by the skill's step 1. The build lays out `flow` in a copy of the
   project with the proposal applied, and marks each box that the proposal adds **New**. No file of the project
   changes.
3. Put the new flow in `model/`, not in the proposal: a `diff` block holds no view. The flow can name an element that
   only the proposal adds, and `floorplan check` passes.

- The step bar groups the `alt` branches of the To-be only.
- A step that only turns into a cut wire is not Changed.
- With `proposal:`, an include path of `floorplan.config.json` outside the project does not resolve in the copy.

## Screens

A screen is one mock of the app in the frame of the page. The page adds the frame, the address bar, the colour of the
role and the notes.

- **`image:`** a picture of the screen, such as a Huginn `screenshot` of the real app. Give it `alt`.
- **`html:`** an HTML part: the inside of one screen, with no `<html>`, `<head>` or `<body>`. Each part has its own
  shadow root, with the tour's `css`, then the screen's `css`. An `@import` in that CSS loads nothing.
- The page drops each `<script>`, frame, `<object>`, `<embed>`, `<link>`, `<meta>`, `on*` handler and `javascript:` URL
  of a part. A link and a form in a part go nowhere.

A part changes state with attributes, not a script:

```html
<button class="swb" data-state="p" data-cycle="off on confirm">Forms</button>
<div data-when="p=on">Forms is on.</div>
<div data-when="p=confirm">
  Turn Forms off?
  <button data-state="p=on">Keep it on</button>
  <button data-state="p=off">Turn it off</button>
</div>
```

- `data-state="key"` with `data-cycle="a b c"` moves the key to the next value at each click.
  `data-state="key=value"` sets it.
- The first element that names a key gives its first value.
- `data-when="key=value"` shows the element only in that state. It also takes `key=one|two` and `key!=value`.
- The page marks each `data-state` element with `data-now="<value>"`, and a `key=value` button with `aria-pressed`.
  Style the states by them.
- A key is 1 to 31 of `a-z`, `0-9` and `-`, from a letter. `s`, `step` and `m` are not free keys.
- All screens share each key: a part can show what another part turned on.

## Build and check the page

Each step names the `floorplan` MCP tool, then the CLI command that does the same work. Pass absolute paths to the MCP
tool.

| Step                        | MCP tool                         | CLI                                              |
| --------------------------- | -------------------------------- | ------------------------------------------------ |
| Write a tour file of a view | none                             | `floorplan tour new --view <id> [dir]`           |
| Build the page              | `tour_build` {tour, dir?, out?}  | `floorplan tour build <file> [--out <path>] [--json]` |

1. **Start the file.** `floorplan tour new --view <id> <dir>` writes `<dir>/tours/<id>.tour.yaml` with `title` (the
   title of the view), `model: ".."` and `flow`. It refuses to write over a file, and it writes only into the
   project. Rename the file for a tour of a spec. For a tour file outside the project, write the same three keys by
   hand.
2. **Add** the roles, the screens, the choices, before and after. A tour of a flow that exists can stop at step 1.
3. **Build.** `tour` is the path of the tour file. Its `model:` names the project. `dir` only resolves a relative
   `tour` or `out`. The page is `<name>.tour.html` beside the tour file, or at `out`. `tour_build` and `--json`
   return `{file, bytes, flow, screens, warnings, errors}`. `flow` holds `view`, `steps`, `boxes`, `proposal`, `asis`
   and `marks`, the counts of New, Changed and Removed steps and of new boxes.
4. **Fix each stop.** The build writes no file, and exits 1, on:
   - a key that a tour file does not allow, or a missing required key;
   - a project, a view or a proposal that does not exist, or a `flow` or `asis` that is not a dynamic view;
   - an error of the model;
   - a screen file or a `css` file that is not on disk, a `role` that `roles` does not name, or two screens with one id.
5. **Read each warning:** a step with no description, a screen with no notes.
6. **Look at the page.** Open it in Huginn, or take a headless Chrome screenshot. The URL holds the state: `s` (the
   screen), `step` (from 1), `m` (`asis` or `tobe`), and each key of a part. Look at these states:
   - step 1, the first step of each `alt` branch, and the last step: `<page>?s=flow&step=4`;
   - with `asis:`, the As-is and the To-be: `<page>?s=flow&m=asis`;
   - each screen, and each state that its notes name: `<page>?s=settings&p=on`.
7. **Check the words** of the flow by the flow checks of [review.md](review.md#flow-checks). The page shows the
   title of a step on its wire only while the step is active, so the picture checks of a rendered PNG do not apply.
8. **Sort each fault.** Unclear words, a wrong box or a missing step is a fix of the view in `model/`. A fault of the
   page itself, such as a step number that covers a box title, is a bug of floorplan: tell the operator, and do not
   change the model to hide it.

## Review in the studio

1. Run `studio_start` with `dir`, by the skill's step 3.
2. Open `<url>tour/<name>` in a Huginn tab. The page shows in a frame, with the panel of the design threads beside it.
   The URL takes the page's state too: `<url>tour/<name>?step=3`.
3. A save of the tour file, of a screen file or of the model builds the page again, and the studio shows it.
4. **Ask on a step:** `thread_post` with `dir`, `tour` (the `<name>` of the file), `step` (from 1), `title` and
   `text`. **Ask on a screen:** `screen` (its id) in place of `step`. Give neither `view` nor `element`: the view of
   the thread is the flow of the tour.
5. A thread on a step draws a mark on the label of its wire. A thread on a screen draws a mark on its button.
6. The studio's message names the anchor: `a message in thread <id> on step 3 of the tour plugins-in-spaces`. Answer
   it, and close it with `thread_resolve`, by [threads.md](threads.md#ask-in-a-thread).
7. `threads` gives each thread on a tour its `tour`, and its `step` or `screen`.

`thread_post` refuses a tour that `tours/` does not hold, and a screen that the tour does not have.

## Share and ship

- **Folkvang:** publish the one page with `folkvang_publish`. It needs no other file. The tool reads files by their
  path in the session's git worktree, so copy a page from another folder into the worktree, publish it, and delete
  the copy. Each publish makes a new version that never changes: publish to a private project unless the operator
  names another.
- **The repo:** commit the tour file, its screen files and its CSS with the model change, in the PR of step 5 of the
  skill. The page is a build output: build it again from them.
