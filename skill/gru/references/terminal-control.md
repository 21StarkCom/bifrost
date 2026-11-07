# Gru's terminal control

Read from [the Gru skill](../SKILL.md#terminal-control).

You never type prose into a Minion's terminal. The brief rides the
`valkyrie minion` launch and every word after it follows
[Coordination route](../SKILL.md#coordination-route). Messages are not worker control. What does go
to a Minion's surface is control, and only this. Every `<surface UUID>` below
is verified, re-read from `hermod msg peers --json` right before the key and
never carried over from an earlier pass: the `surfaceId` of the live row whose
`cwd` ends in the ticket id **and** sits under that ticket's repo, and whose
`id` is the peer id the launch ack named when you have that ack (the ack's
`surfaceId` is the same UUID; its `surface` is a `surface:N` ref). Step 2's
ticket-id match alone is not enough for
a key — any session standing in a worktree named for the ticket matches it,
the operator's own included — so a row that fails either test gets no key;
escalate it instead. Paste the UUID in literally, since on Claude a worktree
session's guard refuses a `hermod` line carrying a variable.

- **Interrupting a busy Minion** — the "Gru interrupt" hermod's `msg` help
  names. A message cannot do it, because a busy recipient may hold the message
  until its turn ends, so the key is Escape:

  ```
  hermod send-key <surface UUID> escape
  ```

  Then observe idle yourself, because the key's exit code says only that cmux
  took the key: re-read that peer's `activity` (`hermod msg peers --json`; the
  default table does not show it) a few times over about a minute until it
  reads `idle`, or, where it reads `unknown`, read its screen once for an idle
  prompt. One that is not idle by then is escalated; you do not keep pressing
  keys or keep reading. An interrupt drains nothing: a message you sent it
  while it was busy may still be held. On the Hermod route check
  `hermod msg status <id>` on each. A native send has no state to re-read: a
  Claude message with no `[Cross-session delivery notice]` reached the session
  and drains at its next tool round. Either way, when you tell the Minion why through
  [Coordination route](../SKILL.md#coordination-route), name what you had already sent
  instead of sending it again.
- **Answering a known menu** — one you have read on its screen
  (`hermod read-screen <surface UUID>`), whose options you know and whose
  answer is yours to give: send the one key that picks it
  (`hermod send-key <surface UUID> <key>`) and read the screen again to see it
  took. A permission prompt — Claude asking to allow a tool call, Codex asking
  to approve a command — is never yours to answer, whatever it would run: it
  is the operator's consent, and you grant nothing: escalate it. A menu in
  which the Minion asks to go on with its own ticket's work asks for a GO
  its launch already gave: pick the option that goes on. A
  question in prose is answered through
  [Coordination route](../SKILL.md#coordination-route), never typed.
- **A slash command**, which you almost never need. Never `/clear` a Minion:
  one Minion is one ticket, never reused. On a Claude Minion, prefer hermod's
  `claude` verbs (`hermod claude --help`), which check the session is idle and
  report only what they observed. Where only `hermod send` fits, know that it
  presses Enter by default, as a separate key after the text, and that
  `--not-enter-press` types without it. Into a TUI, prefer the split form: a
  plain `send` presses Enter the instant the text is typed, and the split puts
  a separate command between them. End on the screen either way, since a
  send's exit code proves only that cmux took the keys:

  ```
  hermod send --not-enter-press <surface UUID> "<text>"
  hermod send-key <surface UUID> enter
  hermod read-screen <surface UUID> --lines 20
  ```

  Never submit with a `\n` inside the text: a TUI in the middle of a redraw
  drops it, a long paste swallows it, and the command sits unsent.
