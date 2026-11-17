# The tick

Read from [the Super-Gru skill](../SKILL.md#protocol), at each wake. Part 1
runs at each wake: a `tick`, a message of the listener, a native message
from a Gru, an operator message, and a listener that exits with no `tick`
and no message. Parts 2 and 3 run only at a `tick`.

1. **Free slots.** For each `live` or `reported` epic, test
   `~/.cache/stark-progress/run-<epic>.json` and
   `~/.cache/stark-progress/run-<epic>.settings.json`. When both files are
   missing, the slot is free: go to the skill's step 7. You write the
   settings file before the launch, and the Gru deletes both files at the
   end of its run. So a missing run file beside a settings file is a Gru
   that has not written its run file yet, not a free slot. Then, when an
   epic is `queued`, go to the skill's step 3: it reads the settings again,
   so a `parallel` that the pane raised starts a Gru now.
2. **Screens.** Read the screen of each Gru tab and each Minion tab of the
   run: `tmux capture-pane -p -t <pane>` in tmux,
   `hermod read-screen <surface UUID> --lines 20` in cmux. A Gru whose run
   finished closes its own tab after its `report:`, by its stand-down. A Gru
   that reported a blocked or held ticket or an open question keeps its tab,
   and so does a Gru whose stand-down stopped on a check. So skip only a Gru
   tab that is gone. Act only on these screens:
   - **A known menu.** A menu that offers "Switch to Opus 5.5 and continue",
     or paid usage: take the option with no extra cost. Send only its number,
     with `tmux send-keys` or `cmux send`.
   - **A permission prompt or a sign-in.** Do not answer it. Put it on one
     `Needs you (Your hands: …)` line that names the tab and the page.
   - **Any other screen.** Leave it alone.
3. **Silence.** A `live` Gru with no heartbeat for 30 minutes gets one muninn
   note that asks for its state.
