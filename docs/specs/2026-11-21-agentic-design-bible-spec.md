# Agentic design bible — spec

2026-11-21 · Aryeh Stark (drafted by Claude) · approved 2026-11-21 · epic: filed on approval · follows STARK-18913 and
STARK-19006 · revision 4: revision 3 (challenge first, whole flows, the look last), plus six measures from the research
of 2026-11-21 (agent users like people, predicted time, attention, accessibility walks, a critic with examples, clutter)

Visual: `2026-11-21-agentic-design-bible-spec.visual.html` (it draws revision 3). `?s=<screen>` opens each screen.

## Intent

A builder agent on Fable 5.2 (`claude-fable-5-2`, in Claude Code) or Astra 6.2 (`gpt-6.2-astra`, in Codex)
redesigns a surface as an experience: what it holds, what each thing is called, where it sits, and the flows that
start there. The look comes last. The bible carries the UX skill that the operator does not claim: it challenges each
element against the user's jobs, walks each job end to end with agent users, measures time, attention and access,
then shapes the look with reference panels and measured checks. Huginn's popup is the first surface.

## Why

- Revision 2 restyled rows and could never find the operator's three faults: "Installation ID" is a bad name on a
  full row; Settings belongs in a gear; past chats had no quick access (4 clicks).
- The landing bible's rule cards gave no gain at twice the cost (`design-bible/proof/landing-pilot-2.md`).
- Research (sources in slice 1): LLM agents finish tasks that people fail (100% and 97% against 88% in a synthetic
  cognitive walkthrough) and find fewer failure points; NN/g calls synthetic users shallow. So agent users need
  limits and a check against people.
- The operator tests as a consumer, not as a design judge. Moran Shor (Product Designer) reviews as the expert later.

## The lever

1. **Jobs before pixels.** Start from the user's jobs and how often each happens.
2. **Each element earns its place:** keep, promote, demote, move, rename, merge, remove or add, with a reason.
3. **A flow is the unit of test:** counted, timed, walked by agent users, from the toolbar click to the job done.
4. **The look comes last,** on the structure that won.

## The surface: Huginn's popup

- Files: `packages/huginn/extension/popup.{html,css,js}` in sleipnir, 320 CSS px wide.
- **The baseline is the popup of STARK-19619,** the worked example below as shipped. The bible's panels must beat it.
  The dry run of slice 5 also runs on the old popup (sleipnir `89be5d83`) to check that the challenge finds the
  operator's three faults.
- **The jobs** (the operator's use, 2026-11-21; no usage data exists): weekly — start a new chat, go back to a past
  chat, copy the browser ID, open Settings; rare — screenshot, record and stop, the recordings, Quiet reads, the label,
  fix "No host". Each arm of the proof gets them as `jobs.md`.
- **What stays:** each job keeps a path; the kit rule (`packages/huginn/CLAUDE.md:66-69`); the MV3 CSP; the tests of
  `packages/huginn` green. The kit is frozen for the proof; a build lists the parts it wishes for.
- **What a builder may challenge:** everything else, with the code a flow needs outside the popup.
- **Who depends on an element:** the live proofs, the messages that name it, and the tests that pin it. A move fixes
  each in the same build.

## Design

### The pieces and their homes

| Piece | Home | What it holds |
|---|---|---|
| The loop | bifrost `skill/stark-design-bible/SKILL.md` (rewrite) | The procedure below. Codex reads the same file. |
| The evidence | vault-docs `design/` (the `design` doc set) | The research and guidance pages that cards quote, with the new sources of slice 1. |
| The playbook | vault-docs `design-bible/surfaces/popup.md` | States, constraints, dependents, critique questions. |
| The challenge catalog | vault-docs `design-bible/challenge.md` | The questions each element answers, and the known answers. |
| The critic rubric | vault-docs `design-bible/critic.md` | Nielsen's 10 heuristics, the challenge questions, a list of generic-design faults, and expert critiques as examples. |
| The taste board | vault-docs `design-bible/taste/popup.md`; crops in a run folder | 12 reference panels with 3 to 5 named moves each. |
| The craft cards | vault-docs `design-bible/craft/*.md` | About 12 cards for the look, each with a Measure. |
| The eye | draupnir `packages/tools`, bin `stark-eye` | `shoot`, `measure`, `flow`, `walk`, `sheet`. |
| The flow shell | sleipnir `apps/huginn/scripts/popup-flows.ts`, `src/popup-flows-fixture.ts` | The packaged extension, served with a `chrome` stub, its states and tasks. |
| The proof | vault-docs `raw/design-proof/popup/`; report `design-bible/proof/popup-pilot.md` | Builds, agent users, the test-drive page, the report. |

### The loop (the skill)

1. **Jobs.** Read `jobs.md`, the playbook and the repo rules. Write the job of the surface in one sentence.
2. **Walk the baseline.** Run `flow` and `walk` on today's panel: clicks, predicted time, first clicks, dead ends.
3. **Challenge.** Fill the challenge table: each element, its job, frequency, name test, verdict and new place; each
   job with no element. A fresh critic attacks the table.
4. **Structure.** Make 3 structures in grey kit markup. Count, time and walk each. Pick by the numbers, then a critic.
5. **Look.** Write 5 moves from the taste kit, each tied to a crop. Style the structure that won.
6. **Build.** Every state, the code each flow needs, each dependent fixed.
7. **See, walk and fix.** Run the eye. Fix each failed floor and each job that got slower. A fresh critic gets the
   shots, the numbers and the rubric, and writes a punch list. Fix each item of severity 2 or 3. Stop when none is
   left, after round 4, or with 20 minutes of build time left.
8. **Finish green.** Tests green. Report the challenge table, the flows before and after, the walks, the moves, each
   punch list and the kit wishes.

A fresh critic is the builder's own model in a new context: the Agent tool, or `codex exec --model <id>`.

### The challenge catalog

Questions for each element: which job, how often, what a miss costs, does the name say what it does in the user's
words, does its size match its frequency, is its state normal (noise) or an exception (signal), does another surface
hold it, who depends on it, and does the reason that put it here still hold. Known answers, each with evidence from
`design/`: a weekly job is one click from the toolbar; a value the user copies is a button, not a row; a normal state is
quiet; a duplicate in Settings lets the popup drop it; an icon keeps a visible label unless the first-click test shows
that people know it; a fix shows the exact command with a Copy.

### The eye: `stark-eye`

- `shoot`: headless Chromium, each state and stone, three probes (focus, hover, reduced motion), box data.
- `measure`: floors that must pass (visible, unclipped text; contrast 4.5:1 and 3:1; 24 px targets or the WCAG
  2.5.8 spacing exception; no overflow; the probes). Diagnostics that only advise:
  - type sizes, ink levels, edges, gaps, radii and icon alignment, as in revision 3;
  - **attention:** a saliency map from UMSI retrained on UEyes; the controls of the weekly jobs should hold the most
    salient areas;
  - **clutter and colour:** the feature-congestion and colourfulness metrics of Aalto Interface Metrics (AIM).
- `flow --tasks <tasks.json>`: runs each task's known path by role and accessible name. It counts clicks, keys and
  surface changes, and **predicts the time** with the Keystroke-Level Model, each pointing time from Fitts's law on
  the box data (distance and width). A path that misses the task's end check fails by name.
- `walk --tasks <tasks.json> --user "<cmd>" --persona <p> --runs <n>`: agent users see only the screen, never the
  code. Personas:
  - **careful:** the live shell with numbered marks, until done or twice the known steps;
  - **hurried:** one shot, no accessibility tree, one and a half times the known steps;
  - **keyboard:** Tab, arrows, Enter and Escape only, with the focus ring in each shot;
  - **screen reader:** the accessibility tree only, acting by role and name.
  Tests: five-second ("What is this for? What can you do here?"), first click, task walk.
- `sheet`: states side by side for a person.
- UMSI and AIM are Python. Slice 3 runs each as a pinned sidecar; a model that does not run on the build host is
  left out, and the report says so. `stark-eye` loads Playwright through `loadPlaywright` (`.claude/rules/tools.md`).

### The flow shell (sleipnir)

- `popup-flows.ts` serves the packaged extension. A shell page holds the popup, a side panel and a tab. The stub
  routes `chrome.sidePanel.open`, `chrome.tabs.create` and `chrome.runtime.openOptionsPage` to the shell, and answers
  the worker's messages from a fixture: 8 past chats, 3 recordings, an installation, a label.
- `chat.html` runs in the side panel on the stub's chat port. If a spike shows it cannot, a stand-in panel shows which
  chat opened, and the end check reads the stub's log.
- `tasks.json` holds each job as plain words, its seed state, its end check and its frequency. A test holds the stub to
  each `chrome.*` call and worker message of the pages it serves; three shots are matched with real Chrome.

## The worked example

The old popup, challenged: STARK-19619 ships it. Open chat splits into "New chat" and the 3 latest chats; the
Installation ID row becomes an "ID" button at the top right; Settings becomes a gear beside it; Screenshot, Record and
a Recordings link share one row; Quiet reads, the pencil and the footer move to Settings; the Connected badge becomes
a dot. New chat 3 → 2 clicks, past chat 4 → 2. The dry run of slice 5 must find at least these on the old popup.

## The proof

### Arms and builds

| Arm | Builder | Bible |
|---|---|---|
| A | Fable 5.2 in Claude Code | yes |
| B | Fable 5.2 in Claude Code | no |
| C | Astra 6.2 in Codex | yes |
| D | Astra 6.2 in Codex | no |

- 5 builds in each arm, shuffled, unattended, each alone in a new copy of sleipnir at one pinned commit after
  STARK-19619, outside `~/Code`, with a new config folder that holds only its arm's skills and MCP servers: no root
  rules, no auto memory, no GitHub token, no `alfred`.
- One brief for all arms, with `jobs.md`: "Redesign Huginn's popup and the flows that start there, and make it
  fabulous. Challenge every element. Keep a path for each job and the kit rule. Leave the tests of `packages/huginn`
  green. Do not commit, push, open a PR or file a ticket."
- A and C also get the skill, the taste kit and `stark-eye`. B and D get the browser and the flow shell only. A B or D
  build that reads the bible's paths or runs `stark-eye` is void and is built again.
- Model and effort are pinned, the same for both arms of a model. The time cap comes from slice 5. The harness runs
  the tests and takes the final shots.

### Eligibility

The same for each arm: the tests pass, each state renders, each floor passes, and `flow` finds a path for each job. A
model with fewer than 3 eligible panels in an arm is inconclusive.

### The operator's test drive (the gate)

- A private folkvang page serves each eligible panel live in the flow shell, at actual size. It names no arm and no
  model, and shuffles the panels and the tasks.
- For each panel the operator does the 4 weekly jobs from plain words. The page records success, time and clicks,
  then asks "How easy was it?", 1 to 7. A failed task scores 0. The baseline runs first as a warm-up.
- A final round shows the top 2 of each model and the baseline: "Which would you keep using?" and "Ship it?".

### Agent users and critics (a second view)

- `walk` runs every task on every eligible panel with each persona, a small model of each vendor as the user, 3 runs
  each, never a builder's model.
- **Calibration:** the report gives each persona's agreement with the operator's results, task by task. A persona
  whose agreement is below one half is marked "not trusted" for the next surfaces.
- Two critics, one of each vendor, score each panel blind with the rubric; no critic scores its own model's arms.

### The gate

The bible passes for a model when both hold:

1. The operator's scores rank the bible panels above the others by an exact rank test (Mann-Whitney) at p ≤ 0.05:
   with 5 eligible panels in each arm, 21 or more of the 25 cross pairs (12 of 252 orders).
2. In the final round, the operator would keep a bible panel of that model over the baseline, and answers "Ship it?"
   with yes for it.

A small gain counts as a fail, by design.

### After the proof

- If the operator's pick beats the baseline, it ships (slice 7). Its kit wishes go to draupnir first.
- Moran Shor reviews the shipped panel and the rubric. Moran's critiques replace the UICrit examples in the rubric.
- On a pass, a new epic adds the next surfaces: Settings, the chat side panel, Recordings.

## Slices (one PR each)

1. **vault-docs:** the `design` doc set gets the research sources of 2026-11-21: the NN/g articles on icons and synthetic
   users, the papers (UXAgent, Agent A/B, Synthetic Cognitive Walkthrough, PerceptUI, UICrit, UEyes, AIM, TaskAudit,
   ScreenAudit, the automated Keystroke-Level Model), and the frontend guides of Anthropic, OpenAI and Chrome.
2. **vault-docs:** the playbook, the challenge catalog, the critic rubric with UICrit examples, the taste board, the
   craft cards, and the lint for `challenge.md` and `craft/`. Blocked by slice 1.
3. **draupnir:** `stark-eye` with its five verbs, the personas, KLM time, the UMSI and AIM sidecars, the `tools.md`
   rule. Live run on a fixture page.
4. **sleipnir:** the flow shell, its fixture, `tasks.json` and their tests, with the chat-page spike first.
5. **bifrost:** the rewritten skill, `landing` on its old path, a minor bump of stark-design, and a timed dry run on each
   model, on the baseline and on the old popup. Blocked by slices 2, 3, 4 and STARK-19619.
6. **vault-docs:** the proof: builds, void check, agent users with calibration, critics, test-drive page, report. The
   sweep of the epic. Blocked by slice 5.
7. **sleipnir:** ship the operator's pick, if it beats the baseline. Blocked by slice 6.

## To check in slice 5

- Claude Code runs `claude-fable-5-2`. Codex runs `gpt-6.2-astra` with images, and `codex exec` as the critic.
- The config of arm D cannot reach the copy of today's bible skill in `~/.agents/skills`.
- The build host has Claude Code, Codex, Bun, the sleipnir toolchain, Chromium and Python for the sidecars.
- The dry run's challenge table on the old popup holds the operator's three faults. If not, fix the catalog first.

## Decisions

- Jobs and flows are the lever; the look is the last step.
- Agent users are limited and checked against people; they never decide the gate.
- Each claim about the look or the flow is a floor, a diagnostic, a count, a time or a walk, not a sentence.
- The operator decides as a consumer. Moran Shor is the expert review after the proof.
- The jobs go to every arm; only the method is the bible's.
- The tool goes in draupnir, the loop in bifrost, the knowledge in vault-docs, the shell in sleipnir.

## Not built: add when it hurts

- Usage counters in the extension, to replace the operator's frequencies.
- A test drive by more people; a critic of the other vendor inside the loop.
- A PerceptUI-style user model trained on the operator's own test-drive answers.
- RTL and zoom states; pixel diffs between rounds; a container for each build.
