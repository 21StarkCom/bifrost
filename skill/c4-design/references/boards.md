# Boards: a playbook or a spec as a live page

Read from [the c4-design skill](../SKILL.md#code-keys-flows-deployments-and-logos).

A **board** is a page of the floorplan studio that shows one document of the repo, an odin playbook or a design
spec, as flows. The operator plays a scenario on it, walks it step by step, and changes it. A board is not the C4
model: a change of a container, a system or a relationship stays in the loop of the skill. The design is
`docs/specs/2026-11-22-boards-spec.md` in draupnir.

## When to open a board

Open a board when the operator wants to see, to play with or to change a playbook or a spec. The document must
match a glob of `boards.include` of the project config, from the git top level. The default globs are
`playbooks/*.md` and `docs/specs/*.md`.

The board needs floorplan 0.17.0 or later: `floorplan board --help` prints the help of the verb. With an older
floorplan, install the new one by item 2 of the skill's "Before you start".

## The two files

- **The document holds its words.** odin runs the playbook file, and a person reads the spec file.
- **The flow file holds the flows that the words do not fix.** It is `<name>.flow.json` next to the document:
  `a11y-audit.flow.json` beside `a11y-audit.md`. Git holds both.
- **A playbook fixes its process in its text:** the front matter, the numbered steps, the rules and each `{% if %}`
  branch. The board reads them. Its flow file only refines nodes of that text, and has no `flows`: a second copy
  of the wiring would drift.
- **A spec is prose.** You write each flow of the spec in its flow file.
- **No flow file is needed.** With none, the board shows the automatic map of the text alone.

## The tools

Pass the absolute project folder as `dir`, as for each `floorplan` MCP tool. `doc` is the path of the document from
the git top level, with `/` between its parts and no `..`: `playbooks/a11y-audit.md`. Each tool refuses a doc
outside the git top level, and a doc that no glob matches.

| Step | MCP tool | CLI |
| --- | --- | --- |
| Open the board | `board_open` {dir, doc, port?} | `floorplan board <file> [--dir <dir>] [--port <port>] [--no-open]` |
| Read the board | `board_read` {dir, doc} | none |
| Point at a node | `board_point` {dir, doc, node or quote, say?, inputs?} | none |
| Ask or offer a patch | `thread_post` {dir, doc, node, quote?, title, text, choices or patch} | none |
| End the studio | `studio_stop` {pid} | `kill <pid>` |

## Open a board

1. Run `board_open` with `dir` and `doc`. It starts the studio on the board page, and answers `{url, pid, dir}`
   when the page is ready. Keep the `pid`.
2. It opens no window. Send the operator the `url`, or open it in Huginn as step 3 of the skill opens a view.
3. Start the studio from this session, so that it sends the save message and the thread lines here. The CLI
   `floorplan board` does not return: run it in the background, and read its `url` and `pid` lines.
4. The studio runs until `studio_stop` with the `pid`, or until the MCP server exits.

## Write a flow file

1. Run `board_read` with `dir` and `doc`. It answers `{dir, doc, kind, flowFile, nodes, problems, inputs}`: each
   node with its `id`, `kind`, `title` and `lines`, and each input of the scenario with its `id`, `label`, `type`,
   `options` and start `value`.
2. Read the document. Find each process that the operator wants to see, and each place where it goes two ways.
3. Write `<name>.flow.json` next to the document with your own file tools, in the form below.
4. Run `board_read` again. Fix the flow file, and run it again, until `problems` holds no problem of the flow file
   ([below](#the-problems-of-a-flow-file)).
5. Check that `nodes` holds each node of your flows, as `f:<flow id>:<node id>`. `board_point` and `thread_post`
   take that id.

### The form

The form is `flow/1` of `@21starkcom/board/core`. The reader refuses each key that the form does not name.

```json
{
  "schema": "flow/1",
  "lanes": [{ "id": "person", "title": "Person", "hint": "checks each finding" }],
  "nodes": [{ "quote": "7. Show the findings to the person", "lane": "person", "title": "Show the findings" }],
  "flows": [
    {
      "id": "code",
      "title": "A code run",
      "lanes": [{ "id": "cli", "title": "The CLI" }],
      "inputs": [{ "id": "resolves", "label": "Each selector resolves to a model", "type": "boolean", "value": true }],
      "nodes": [
        { "id": "start", "kind": "start", "lane": "cli", "title": "Start a run", "quote": "<words of one line>" },
        { "id": "check", "kind": "rule", "lane": "cli", "title": "Each selector resolves?", "when": "resolves", "quote": "<words of one line>" },
        { "id": "run", "kind": "step", "lane": "cli", "title": "Run the agents", "quote": "<words of one line>" },
        { "id": "stop", "kind": "end", "lane": "cli", "title": "Stop with exit 2", "quote": "<words of one line>" }
      ],
      "edges": [
        { "from": "start", "to": "check" },
        { "from": "check", "to": "run", "on": "yes" },
        { "from": "check", "to": "stop", "on": "no", "label": "a selector has no model" }
      ]
    }
  ]
}
```

| Key | Form |
| --- | --- |
| `schema` | `"flow/1"`. The board reads no other value. |
| `lanes` | Optional: `[{ id, title, hint }]`, each key required. A lane of the board, such as the person. |
| `nodes` | Optional: `[{ quote, lane?, title?, when?, then?, exit? }]`. One entry refines one node of the text. |
| `flows` | Optional: `[{ id, title, hint?, lanes, inputs?, nodes, edges }]`. One flow is one band of the board. |
| a flow's `lanes` | `[{ id, title, hint? }]`. |
| a flow's `inputs` | `[{ id, label, hint?, type, options?, value }]`. `type` is `boolean` or `select`; `value` is the start value. |
| a flow's `nodes` | `[{ id, kind, lane, title, text?, when?, pass?, quote? }]`. `kind` is `start`, `step`, `rule` or `end`. |
| a flow's `edges` | `[{ from, to, label?, on? }]`. `on` is `yes` or `no`: the answer of the rule that takes this way. |

- **A quote** is the exact words of one line of the document, its Markdown marks (`` ` ``, `**`) included. The board
  binds it to the first node whose text holds it, so copy words that only one node holds.
- **An entry of `nodes`** binds by its `quote`. `lane` moves the node to a lane of the top `lanes`: the board ignores
  a lane id that is not there, and reports no problem. On a rule, `when` and `then` are its IF and THEN in short
  words, and `exit` is where a matching item goes, such as `output.dropped`.
- **A node of a flow** has a `quote` of the line that it comes from: with no quote, it binds to no line. `lane` names
  a lane of its flow. `text` is one or two sentences under the title.
- **A rule** has two edges out: one with `on: "yes"` and one with `on: "no"`. Its `when` is a condition over the
  ids of the inputs of its flow: names, `true`, `false`, quoted strings, numbers, `==`, `!=`, `not`, `and`, `or`
  and brackets, such as `kind == "feature" or spans`. `pass` (`yes` or `no`, default `no`) is the way out that the
  flow takes when the operator removes the rule.
- **An id** of a flow, a lane, an input or a node is new in its list. The id of a flow has no `:`.
- **A playbook's flow file** has `lanes` and `nodes`, and no `flows`.

### The problems of a flow file

`board_read` lists four problems of a flow file, and one fault that stops the reader. The message of each one names
the flow file, or asks Claude to add the missing way of a rule. Fix each one:

- **A fault of the file:** not JSON, a `schema` other than `flow/1`, a key of the wrong type, or a key that the form
  does not name. The board then shows the text alone.
- **A stale quote:** no node of the text holds the quote. Copy the words of the line again.
- **An unknown lane:** a node of a flow names a lane that its flow does not have.
- **A rule with one way out:** the rule has fewer than two edges out.
- **A line to no node:** an edge names a node that its flow does not have.

Each other problem is of the words of the document, such as a spec of more than 300 lines, a long sentence or a
param that is not declared. It is not a fault of the flow file. Leave the document as it is, and report the problem
to the operator.

## Offer a change of the words

Change the flow file with your file tools. Offer a change of the words of the document as a **patch** in a thread
on its node, so that the operator decides on the board:

1. Run `thread_post` with `dir`, `doc`, `node` (an id that `board_read` lists), `title`, `text` and `patch`. With no
   `quote`, the thread takes the words of the first line of the node. To offer one more patch in the same thread,
   run `thread_post` with `thread`, `text` and `patch`.
2. `patch` is `{ id, title, edits: [{ find, replace }] }`, in the form of your Edit call:
   - `id` is new in the thread, and `title` has 1 to 120 characters.
   - Each `find` is in the document exactly one time, with 1 to 2000 characters. Each `replace` has 0 to 4000.
   - A patch has 1 to 20 edits. Each one reads against the document as it is, and no two finds overlap.
3. The page shows the patch as a card with Accept and Discard. Accept applies the patch to the working text of the
   board and writes the verdict line in the thread. The file changes only when the operator saves the board.
4. The studio then sends a line to this session, by [threads.md](threads.md#ask-in-a-thread) item 5.

## Point at a node

Run `board_point` with `dir`, `doc` and one of these, not both:

- `node`: an id that `board_read` lists;
- `quote`: the words of one line of the document.

Add `say`, plain text of at most 2000 characters, and `inputs`, the values of inputs of the scenario by their ids,
each of the type that `board_read` lists, such as `{"unattended": true}`. It writes one pointer file in the temp
folder of the OS and answers `{file, pointer}`. A new call replaces the pointer of the document.

An open board draws the pointer beside the node at once, with `say` as its words. The page moves to the node and
takes `inputs` as the scenario only when the operator turned **Follow Claude** on. Point to show a case as a person
at a white board does: the rule, with the inputs that make it answer `no`.

## The message of a save

The page applies no edit to a file until the operator presses Save. Then the studio sends one message to this
session:

```text
floorplan studio: the operator saved the board of playbooks/a11y-audit.md (repo /Users/…/odin).
Files written: /Users/…/odin/playbooks/a11y-audit.md.
Edits: document: <the label of an edit>; flow file: <the label of an edit>.
Next: read the change with git diff, run the tests of the repo, and open a PR with the change.
```

- **A playbook:** read the change with `git diff`, run the tests of the repo, and open a PR by the repo's rules.
- **A flow of a spec:** the flow file changed. Offer the matching change of the words of the spec as a patch
  ([above](#offer-a-change-of-the-words)). The Save after its Accept sends one more message. When the words changed
  too, read `git diff` and open a PR.
- **The words of a spec alone:** read `git diff`, and open a PR.

## Nothing opens by itself

The page opens no panel and no window for news from a session. A file change, a thread line or a pointer shows as
a status line and a mark on a node. So write each question in a thread on its node, with `thread_post`, and tell
the operator in this session which threads you opened. A pointer's `say` is no question: the operator may not see
it.
