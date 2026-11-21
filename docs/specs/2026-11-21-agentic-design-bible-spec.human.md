# Agentic design bible, in plain English

The landing-page bible did not help: models built pages as good without it, at twice the cost. Revision 2 of
this spec had a different fault. It kept every row of Huginn's popup and changed only the look, so it could
never find what you saw at a glance: "Installation ID" is a bad name for a button that takes a whole row,
Settings belongs in a gear at the top, and a past chat takes 4 clicks.

The bible is now a UX designer first and a stylist last. A builder on Fable 5.2 or Astra 6.2:

1. **Starts from your jobs.** You do four things weekly: start a new chat, go back to a past chat, copy the ID,
   open Settings. Everything else is rare. Size and place follow that.
2. **Challenges every element.** Each one must answer: which job, how often, does its name make sense, does
   Settings have it already, who depends on it. Then it is kept, moved, renamed, merged, removed, or added.
3. **Tests whole flows.** A new tool, `stark-eye`, counts the clicks of each job from the toolbar to done and
   predicts its time. Agent users who see only the screen try each job: a careful one, a hurried one, a
   keyboard-only one and a screen-reader one.
4. **Checks attention and clutter.** A model trained on eye tracking says where eyes land first; your weekly
   jobs must win that. Two published metrics flag clutter and colour noise.
5. **Shapes the look last,** with reference panels, measured checks and a critic that learns from expert
   critiques (later, Moran Shor's).

Research showed that agent users finish tasks that people fail. So they never decide: you do. Each agent user
is scored on how well it agrees with your results, and one that disagrees is not trusted for the next surface.

The proof: each model builds 5 panels with the bible and 5 without. They start from the popup that STARK-19619
ships, so the bible must beat a design you already like. You test-drive each panel as a consumer on one private
page: four real tasks each, timed, then "How easy was it?". The bible passes for a model when its panels clearly
win your test drive and you would keep one over the baseline.

To see the design, open `2026-11-21-agentic-design-bible-spec.visual.html` in a browser (it shows revision 3).
