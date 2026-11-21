# The tools of the loop

How to run the tools of [the loop](../SKILL.md#2-the-loop-for-a-surface):
the run folder, the clock, `stark-eye`, the flow shell and its two plans, the
agent users, the fresh critic and the tests. The playbook of the surface
names its own files, its flow shell and its tests; this page uses Huginn's
popup as the example.

## The run folder

- The run folder, `<run>`, is the folder that the task names. With none, use
  `~/.local/share/design-bible/runs/<surface>-<YYYYMMDD-HHMM>/`.
- Keep it outside each repo. An agent user and the critic run in it, and
  they must see only the screen, never the code.
- Write `<run>/report.md`, and put the output of each `stark-eye` run in
  `<run>/eye/<step>/`, such as `<run>/eye/2-baseline/` or
  `<run>/eye/7-round-1/`. Save the text that each command prints in a
  `.txt` file beside its folder.

## The clock

At the start and the end of each step, run `date -u +%Y-%m-%dT%H:%M:%SZ`, and
write the time in the report. The minutes of each step set the time cap of
later runs.

## `stark-eye`

- Run `stark-eye` when it is on your `PATH`. Else run
  `npx -p @21starkcom/tools -p playwright stark-eye`.
- The package is on GitHub Packages. `npx` needs the scope line and a token
  with `read:packages` in `~/.npmrc`, as the "Install" section of draupnir's
  README says. When it still fails, print `Missing: stark-eye` and the
  error, and stop.
- When Playwright has no browser, run `npx playwright install chromium` in
  the folder of the install, once.
- `stark-eye --help` names each verb and option.

## The flow shell

- The playbook names it. For the popup, run this in the repo root:
  `bun apps/huginn/scripts/popup-flows.ts --port <n>`. It prints
  `Tasks: <path>`: the toolbar plan.
- Run it in the background: on Claude, a Bash call with
  `run_in_background`; on Codex, an `exec_command` session. Write down its
  PID, and stop only that PID (`kill <pid>`) at the end.
- The shell packages the extension when it starts. After each change to the
  extension, stop it and start it again, and read its new `Tasks:` path.
- In step 4, put each structure in the surface's own files, serve it, and
  measure it. Keep each structure's files in `<run>/structures/<n>/`, so you
  can put the one that won back.

## The two plans

- **The toolbar plan** is the `tasks.json` that the shell prints. Each task
  starts with a click on the toolbar button. Use it for `flow`, so the
  clicks and the seconds count from the toolbar, as the playbook's table
  does.
- **The open plan** is the same plan, with the surface open in each state and
  the toolbar click dropped from each task. Use it for `shoot`, `measure`
  and `walk`: the shots and the agent users see the surface open, a first
  click lands in it, and `measure` ranks the attention of the weekly
  controls in it, not the toolbar button.

  ```sh
  jq '.states |= map(. + {eval: "flowShell.toggle()"}) | .tasks |= map(.path |= .[1:])' <tasks.json> > <run>/open.json
  jq '.tasks |= map(select(.frequency == "weekly"))' <run>/open.json > <run>/open-weekly.json
  ```

- Write the plans again after each start of the shell: its port and its
  folder change.
- When a build changes a known path, edit the repo's tasks file (for the
  popup, `apps/huginn/scripts/popup-tasks.json`), and start the shell again.
  The tasks file is a dependent: the repo's test walks each known path.

## The verbs, in order

```sh
stark-eye flow --tasks <tasks.json> --out <run>/eye/<step>/flow
stark-eye shoot --tasks <run>/open.json --out <run>/eye/<step>/shoot
stark-eye measure <run>/eye/<step>/shoot
stark-eye walk --tasks <run>/open-weekly.json --persona <p> --user "<user>" --out <run>/eye/<step>/walk-<p>
stark-eye sheet <run>/eye/<step>/shoot
```

- Run the 4 personas of a walk at the same time, one process each.
- In step 4, walk only with `hurried` and `careful`.
- The five-second test sees the whole window, the shell's page too. Judge
  only what each answer says about the surface.

## How to read `measure`

- Judge only the floors of the surface: the lines that name it, such as
  `in popup`. A floor of the shell's own page (its tab strip, its toolbar
  button, its web page) is not the surface's. Leave it, and say so once
  under Floors.
- The `unclipped` floor fails each text with an ellipsis. The `visible`
  floor can fail the same text, when the centre of its cut end lies under
  the next element. When the playbook asks for an ellipsis, as on a long
  label or chat title, keep it, and check its control: the full text must be
  in a `title` (the tooltip) and in the accessible name.
  - When both hold, list each such line under Floors as `ellipsis: accepted`.
  - When one does not, the line is a fail: add the missing `title` or name.
  - Each other `unclipped` or `visible` fail is a fail.
- The diagnostics only advise. Give their numbers to the critic.

## The agent users

An agent user is a small model of your own vendor, never your own model:

| Runtime | `--user` |
|---|---|
| Claude | `claude -p --model claude-haiku-5-5 --allowedTools Read` |
| Codex | `codex exec -m gpt-6-luna -s read-only --skip-git-repo-check --ephemeral --image={image} -` |

## The fresh critic

1. Make a folder, `<run>/critic/<step>/`, with only these files: the PNG
   shots, the output of `measure` and `flow`, copies of the bible's
   `critic.md` and `challenge.md`, and the playbook's "The questions of the
   critic". `critic.md` sends the critic to the questions and the known
   answers of `challenge.md`. In step 3, add the challenge table. In step 4,
   add the shots and the numbers of each structure. From round 2 of step 7,
   add `rounds.md`: each finding of the earlier rounds, and what the walks
   and the floors showed of its fix. Put in no code, and none of your
   reasons.
2. Write the prompt in `prompt.md` in that folder: "You are the critic of the
   design bible. Read critic.md. Judge only what a person sees and does in
   these files. Write a punch list in the format of critic.md, worst first,
   and nothing else."
3. Start the critic:
   - On Claude: the Agent tool, a new general-purpose agent. Give it the
     prompt and the folder's path, and tell it to read only the files in the
     folder.
   - On Codex, in that folder:
     `codex exec -m <your model> -s read-only --skip-git-repo-check --ephemeral --image=<png> --image=<png> - < prompt.md`.
     Give one `--image=` for each shot. Keep the `=`: a bare `-i` takes the
     next word as one more image.
4. Save its punch list as `punch.md` in that folder.

## The tests

- The playbook's test command. For the popup: `bun test packages/huginn`.
- The repo's test of the tasks file. For the popup:
  `bun test apps/huginn/scripts/popup-flows.test.ts`.
- Run the tests once on the baseline, before you change a file. A test that
  fails there is not yours: name it in the report, and keep the count of
  failures the same.
