# Ask on the canvas with Huginn annotate

Read from [the c4-design skill](../SKILL.md#4b-on-another-page-huginn-annotate), step 4b of the loop: a page that is
not the studio, such as the built site in `generated/site/`, or a project with no `floorplan` MCP server. In the
studio, ask in a thread (step 4a).

## The Huginn build

Pick a Huginn whose features list `annotate` and `annotateChat` (Huginn 0.69.97): the chat, the `choice` and
`thread` cards, `messages` and `reply` need `annotateChat`. With an older build, show `verdict` items with no `chat`,
and wait for Send with `answers` (`timeoutMs:120000`, again at `sent:false`); each answer keeps its `note`. `guide`
and `block` need `annotateGuide` (Huginn 0.69.54); with an older build, leave both out. Each `annotate` op is a
mutation, `answers` and `clear` included, so each takes `confirm:true`.

## Ask

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
