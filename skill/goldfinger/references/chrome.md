# Chrome: page work goes to Huginn

Chrome and Chrome Canary page work (reading a page, finding an element in it, opening or
navigating a tab, filling a form, a page screenshot) goes to Huginn, sleipnir's browser companion,
for every agent: `slp huginn <action> <uuid> --tab <id>` (each action needs its own grant, and a
mutation adds `--yes`), or the sleipnir MCP server's `huginn` and `huginn_batch` tools
(`confirm: true`), taught in sleipnir's `docs/huginn.md`. It does not go through goldfinger's tree
too. When `slp huginn list --json` shows no Huginn online for that Chrome, or the action has no
grant, the operator turns Huginn on or gives the grant in Huginn's popup: report it. goldfinger's
part in a Chrome window is a background element action, `click`, `type`, `keys` or `set-value`
on an element target, a pixel target under the page check (below), and the `observe` or
`capture` that finds that target or reads a Chrome the operator is typing in (below).

**What a Huginn action does to the operator's focus and Chrome's windows**, as sleipnir's
`docs/huginn.md` gives it:

- **These do not activate Chrome:** its reads (`tabs`, `observe`, `find`, `read`, `screenshot`
  and the rest), `set-value`, `upload`, an insert-mode `type` (the default), `scroll` with `to`,
  `open` (a background tab) and `navigate`.
- **These activate Chrome:** pointer and key input (`click`, `hover`, `scroll` without `to`,
  `drag`, `gesture`, `key`), a keys- or compose-mode `type`, input guarded by an `origin`, and
  `audit-dropdown` first bring their tab to the front. It becomes its window's active tab, the
  window comes up, a minimized one back on screen, and Chrome takes the front from whatever the
  operator is using. `"inBackground": true` on `click`, `hover`, `scroll`, `drag`, `gesture`,
  `key` or `type` brings nothing forward (Chrome's focus emulation instead). It is refused with
  an `origin`, on `audit-dropdown` and while an older worker is loaded; agent sessions do not
  offer it, and a journey replays without it.
- **`focus`** makes the tab its window's active tab and brings that window to the front, a
  minimized one restored: it activates Chrome by design. **`resize`** makes the tab its window's
  active tab and sets the window's outer size, restoring a maximized window first: a binding
  (below) is made again.
- **The debugger bar.** Every action attaches Chrome's debugger but `tabs`, `open`, `focus` and
  `record` itself, and, outside a recording, `navigate` without `expect`, `close` and `resize`. A
  recording that keeps a workflow trace (`record start` with `trace`) or a demonstration holds the
  debugger between its actions too, until it stops. With Huginn's Quiet reads on (the operator
  turns it on in Huginn's popup), a plain `read` that reads by script attaches nothing; a frozen
  or discarded tab, a page Chrome keeps scripts out of, and a background tab in a Chrome before
  132 are still read by the debugger. While attached, Chrome shows its "started debugging this
  browser" bar in every window of that Chrome, until 5 s after the last attachment ends. The bar
  shrinks the page by 56 CSS px without moving the window, and, showing or leaving, can take the
  page's keyboard focus.

**Sharing a Chrome window:**

- **One tool per Chrome window.** A window driven with Huginn takes no goldfinger action, and one
  driven with goldfinger no Huginn action, until the agent binds them. Each Huginn `tabs` row
  carries its window's bounds (`window`: `left`, `top`, `width`, `height`, `state`, in screen
  points from the primary display's top left) and `browserPid`. Bind a Huginn tab to a goldfinger
  window only on a unique match: exactly one window in `goldfinger windows --pid <browserPid>`
  whose `frame` is those bounds, and no other window in Huginn's `tabs` with the same bounds.
  None, or more than one, is no binding, and so is a row with no `browserPid` or no `window` (an
  older worker's, or a window that closed).
- **Never carry coordinates or refs between the tools.** A Huginn `ref` or `point` means nothing
  to goldfinger, and a goldfinger target or `frame` nothing to Huginn: each finds its own element.
- **Pixel targets in a Chrome that Huginn drives.** The Chromium page check (see
  [targets.md](targets.md)) catches the bar: it moves the page 56 pt down without moving the
  window, so a pixel or text target taken before it showed or left is `stale_snapshot`, and
  nothing is sent. So:
  - Take the snapshot after your own last Huginn call in that window: a `capture`, or an
    `observe --screenshot`. One taken before it may show the page where it no longer is.
  - On `stale_snapshot`, take a new capture and read the point off it again. Never retry the old
    target: it stays stale, and no agent sees another's Huginn calls, so the bar can come or go
    again at any time.
  - The check sees where the page sits, not what it shows: content the page moved itself, as a
    scroll does, still leaves a pixel target on its old point. Prefer an element target, which
    reads its element's frame when it acts, and a text target, which checks its text.
- **Observe again after a Huginn call** before acting in that window: the call may have changed
  the page, its active tab or its window's frame.
- **Keys near the bar.** Before goldfinger `keys` or `type` into a Chrome, wait about 6 s after
  your own last Huginn call in that Chrome: the bar closes 5 s after the last action, plus 1 s of
  margin. These count as a call still running: a `huginn_batch` until its lease ends (up to 5 s
  after its last step), a JavaScript dialog Huginn holds until it is answered (up to 120 s), and a
  recording with a trace or a demonstration until it stops. The wait covers only your own calls:
  another agent's Huginn read can take the page's keyboard focus at any time. So in a Chrome that
  Huginn drives, prefer `set-value`, or `type` by element, and observe after `keys`, which reads
  nothing back.
- **While the operator types in a Chrome,** read it by goldfinger's `observe`, not Huginn, whose
  bar can take their keyboard focus.

**Consent, security and extension UI.** Press no browser consent, security or extension UI with
goldfinger, in Chrome or any other browser: a site's permission prompt, the debugger bar's
Cancel, an extension's install or site-access prompt (turning Quiet reads on raises one), a
certificate or Safe Browsing warning, a password or passkey prompt. The daemon cannot tell that UI
from the UI an agent aims at, so the rule is yours: leave it to the operator. A browser setting
that a task needs, such as the page zoom, is yours to change: change it back when the task ends.
