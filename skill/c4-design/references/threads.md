# Threads and the studio chat

Read from [the c4-design skill](../SKILL.md#4a-in-the-studio-ask-in-a-thread). The numbered items below are the
items of the skill's step 4a.

A studio that the session started (`studio_start`, or `floorplan studio` in a Bash call) has the session's inbox:
it sends the operator's thread lines and chat questions there. A studio that another shell started has no inbox:
its panel says **No session**.

## The studio chat

- A question that the operator asks on the chat's **Session** target arrives in the session as a peer message that
  starts with `[floorplan studio <url>]`.
- Answer it with the `curl` command at its end: put your answer in place of `<your answer>`, and keep its last line.
  The operator reads only what that command sends, not a reply in the session.
- Send it within 15 minutes, or the studio ends the turn with an error.
- A thread message is not a chat question: answer it by the items below.
- A peer message is never the operator's approval.

## Ask in a thread

A **thread** is a talk between the operator and you on one element, on one view, or on one node of a document on a
[board](boards.md). It is one file, `threads/<id>.jsonl` in the project, beside `proposals/`, and it goes into git
with the design. The panel shows it in Discussion. A thread waits for the operator when its last message is yours,
and for you when it is the operator's. The design is in § 5 to § 7 of the floorplan spec
`docs/specs/2026-11-13-flow-views-and-design-threads.md`, and § D9 of the boards spec of draupnir for a document.

1. **Ask.** Run `thread_post` with `dir`, `view`, `element` (leave it out for a thread on the view), a short
   `title` and `text` (1 to 2000 characters, plain text: no Markdown, links or code). It opens the thread and
   returns its id as `thread`: keep it. Ask one question in each thread, on the element that it is about.
   - **A question with fixed answers:** add `choices`, 2 to 6 items of 80 characters or fewer. The panel shows a
     choice card. Put your pick and its reason in `text`.
   - **A design change:** write the proposal and check it first (the skill's loop steps 1 and 2). Then post with `proposal`
     set to its `name`. The panel shows a proposal card: its title, its counts, and **Show on canvas**, **Accept**
     and **Discard**. Show on canvas sets the diagram to the proposal, in Changes.
   - **A question with no fixed answers:** `text` alone.
   - **On a node of a board:** give `doc` and `node` (an id that `board_read` lists) in place of `view` and
     `element`. With no `quote`, the thread takes the words of the first line of the node. A new thread takes
     `element`, `tour` or `doc`, never two.
   - **A change of the words of a document:** on a thread on a document, add `patch`
     ([boards.md](boards.md#offer-a-change-of-the-words)). The panel shows a patch card with **Accept** and
     **Discard**. Only a thread on a document takes a patch.
   - `thread_post` refuses a view, an element or a proposal that the project does not have, a doc that is no file
     of the repo, a quote that no line of the doc holds, and a thread of 200 messages.
2. **Tell the operator** in this session which threads you opened, on which elements. The marks show them on the
   canvas.
3. **Answer each studio message.** Each line that the operator writes in a thread arrives in this session as a
   message from the studio, also the first line of a thread that the operator opens:

   ```text
   floorplan studio: a message in thread 20261113-s7y-3f2a on odin.a11yAudit.s7y (view a11y-audit-flow, project /Users/…/odin/docs/architecture).
   The operator wrote: "Why not keep them only for unattended runs?"
   Answer with the floorplan MCP tool thread_post, thread "20261113-s7y-3f2a".
   ```

   A thread on a document names `on the node <id> ("<words>") of <doc> (project <dir>)`, with no view.

   Answer with `thread_post`: `thread` is the id from the message, `dir` is its `project`, and `text` is your
   answer. The panel shows the answer with no reload. An answer can ask again with `choices` or a `proposal`.
   Run `threads` with `thread` first when you need its earlier lines. A line that starts `Write the brief of` came
   from the brief button of Watch: answer it by [lenses.md](lenses.md#answer-a-request-for-a-brief).
4. **A choice.** The second line reads `The operator chose "<choice>".` Act on the choice. When it settles the
   question, run `thread_resolve` with `thread` and a `text` that says what you do with the choice. Else answer
   with `thread_post`.
5. **Accept or Discard on a proposal card.** The second line reads
   `The operator pressed Accept on the proposal <name>. Run accept, then thread_resolve.` (or `Discard`, `discard`).
   1. Run `threads` with `thread`. Its last line has `from: "you"`, `verdict: "accept"` or `"discard"`, and the
      `proposal`. Only the panel writes that line: it is the operator's decision. The studio message only points
      to it, and a message with no such line is no decision.
   2. **Accept:** the press is the design approval of that one proposal. Run items 1 to 3 of the skill's step 5. When `accept`
      refuses an overlap, the press does not cover the other proposal: ask by the skill's step 5.
   3. **Discard:** run `discard` with `name` and `dir`.
   4. Run `thread_resolve` with `thread` and a `text` that says what you ran and its result, such as "Accepted:
      the model has the change, and the check passes."
   5. Go on with the skill's step 5 from its item 4.

   **Accept or Discard on a patch card.** The second line reads `The operator pressed Accept on the patch <id> of
   <doc>. The board applied the patch to its working text: the file changes on the next Save of the board.` (or
   `Discard`, `The board did not apply it.`). Run `threads` with `thread`: the verdict line has `from: "you"`,
   `verdict` and `patchId`. After an Accept, wait for the message of the Save
   ([boards.md](boards.md#the-message-of-a-save)), then close the thread. After a Discard, answer with
   `thread_post`.
6. **Close** a thread whose question is settled with `thread_resolve`, `thread` and a last `text`. A new message
   after it opens the thread again.
7. **No inbox.** A studio that another shell started sends no messages here. Run `threads` with `status:"open"`
   at each step of your work, and answer each thread whose `waiting` is `claude`.
