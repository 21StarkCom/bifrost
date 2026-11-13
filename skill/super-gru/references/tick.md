# The tick

Read from [the Super-Gru skill](../SKILL.md#protocol), at each `tick` of the
listener.

1. **Free slots.** For each `live` or `reported` epic, test
   `~/.cache/stark-progress/run-<epic>.json`. A missing file is a free slot:
   go to the skill's step 7. Then, when an epic is `queued`, go to the
   skill's step 3: it reads the settings again, so a `parallel` that the
   pane raised starts a Gru now.
2. **Screens.** Read the screen of each Gru tab and each Minion tab of the
   run: `tmux capture-pane -p -t <pane>` in tmux,
   `hermod read-screen <surface UUID> --lines 20` in cmux. Act only on these
   screens:
   - **A known menu.** A menu that offers "Switch to Opus 5.5 and continue",
     or paid usage: take the option with no extra cost. Send only its number,
     with `tmux send-keys` or `cmux send`.
   - **A permission prompt or a sign-in.** Do not answer it. Put it on one
     `Needs you (Your hands: …)` line that names the tab and the page.
   - **Any other screen.** Leave it alone.
3. **Silence.** A `live` Gru with no heartbeat for 30 minutes gets one muninn
   note that asks for its state.
