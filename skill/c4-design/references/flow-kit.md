# The flow kit: a process as a diagram

Read from [the c4-design skill](../SKILL.md#code-keys-flows-deployments-and-logos).

A **flow** of the flow kit shows the steps of a process in order: an odin playbook, a feature, a loop. It is an
element of the kind `flow`, and its children are the steps. A decision is a diamond, and a start or an end is a pill.
It is not the sequence flow of [flows.md](flows.md), a `dynamic view` of the calls between the containers on one
path through the code. Use the flow kit for a process with steps and decisions. Use a sequence flow for the calls.

The design is in the floorplan spec `docs/specs/2026-11-13-flow-views-and-design-threads.md`, § 4.

## The four kinds

`kit/flow.c4` adds four kinds to the C4 kit. A project has the file only when it has a flow: `floorplan import`
writes it, and `floorplan build` writes it again only where it exists. Never edit it.

| Kind       | Shape       | Use                                                                 |
| ---------- | ----------- | ------------------------------------------------------------------- |
| `flow`     | `rectangle` | The process. Its children are its steps.                            |
| `step`     | `rectangle` | One action. Its title starts with its number: `3 · Run the audit`.  |
| `decision` | `diamond`   | A question with two or more ways out.                               |
| `terminal` | `pill`      | A start or an end.                                                  |

`floorplan check` has four rules for them, after R1 to R9:

| Rule                                                                                  | Level   |
| ------------------------------------------------------------------------------------- | ------- |
| R10: `step`, `decision` and `terminal` are only inside a `flow`                       | error   |
| R11: a `flow` is at the top level, or inside a `softwareSystem` or a container kind   | error   |
| R12: each relationship out of a `decision` has a title, such as `yes` or `no`         | warning |
| R13: each `flow` has a description and a view                                         | warning |

R6 asks for no title on a relationship between two flow elements: the order of the steps is the meaning.

## An odin playbook: import it

1. In the product repo, run `floorplan import playbook <file> [dir] --in <element>`, such as
   `floorplan import playbook playbooks/a11y-audit.md docs/architecture --in odin`. `--in` puts the flow inside an
   element that exists, such as the product's system. With no `--in`, the flow is at the top level.
2. It writes `model/flows/<name>.c4` and `kit/flow.c4`:
   - the flow, with the playbook's `description`, and its `tools`, `roots`, `max_turns`, `wall_clock_s` and
     `budgets` as metadata;
   - a `terminal` `Ask` (its params), one `step` for each item of `## Steps`, and a `terminal` `Answer`;
   - the metadata of each step: `source` (`<path>:<line>`) and `tools`;
   - a `decision` `<name>?` for each Liquid `{% if <name> %} … {% else %} … {% endif %}` block around items, with
     the ways out `yes` and `no`;
   - one relationship from each element to the next, and the view `<name>-flow`, top to bottom.
3. It writes a flow one time. It refuses to write over a flow file that exists. From then on, the model is the design:
   change it by hand.
4. Add the decisions by hand (below), run `floorplan build`, and commit. The first flow of a playbook records code
   that exists, so it is a small fix: skip the loop.

## The decisions by hand

A playbook writes most of its branches in prose, so the import makes a decision only for a Liquid block. Read the
text of each step, and add each branch by hand:

1. Find each place where the run can go two or more ways: a check, a retry, a stop on a failure, a rule that keeps
   or drops an item.
2. Add a `decision` inside the flow, after its step, with a short question as its title: `'A good tab?'`. Its
   description gives the test and each way out. Give it `metadata { source '<path>:<line>' }`, the line of the
   text that holds the branch.
3. Change the relationships: the step goes to the decision, and the decision goes to each way out. Give each way out
   its answer as the title: `'yes'`, `'no: stop, and say why'`, `'busy: once more'`. A retry goes back to an earlier
   step. A stop goes to the terminal `Answer`.
4. Keep the ids that the import gave (`s1`, `s7y`, `d1`). A thread names its element by its id, and a thread whose
   element id changes shows only on its view.
5. Link each step to each element that it uses (a container, an external system, a person) with a `-[sync]->`
   relationship. Put the tool in its `technology`.
6. Run `floorplan build` and `check`: R10 to R13 must pass. `render` the view `<name>-flow`, and look at the PNG by
   [review.md](review.md#picture-checks).

odin's `docs/architecture/model/flows/a11y-audit.c4` is an example. It has four decisions (`d1`, `d3`, `d4`, `d7`),
a retry from `d3` back to `s3`, and stops that go to `answer`.

## A flow with no playbook

A spec, an epic or another feature design has no importer. Run `floorplan import flow-kit [dir]`, which writes only
`kit/flow.c4`. Then write `model/flows/<name>.c4` by hand, in the form that the import writes. An element id must
not be a word of the DSL: `order = terminal 'Order'` fails to parse, so the example names it `done`.

```likec4
model {
  extend shop {
    checkout = flow 'Checkout' {
      description 'The customer pays for the cart, and the shop stores the order.'

      cart = terminal 'Cart' {
        description 'The customer presses Pay.'
      }
      s1 = step '1 · Check the cart' {
        description 'The API checks that each item is in stock.'
      }
      d1 = decision 'Is each item in stock?' {
        description 'Yes: charge the card. No: show the customer the items that are out of stock.'
      }
      s2 = step '2 · Charge the card' {
        description 'The API asks the bank to charge the card.'
      }
      done = terminal 'Order' {
        description 'The order is stored, or the customer sees why not.'
      }
    }
  }

  shop.checkout.cart -> shop.checkout.s1
  shop.checkout.s1 -> shop.checkout.d1
  shop.checkout.d1 -> shop.checkout.s2 'yes'
  shop.checkout.d1 -> shop.checkout.done 'no: show the items'
  shop.checkout.s2 -> shop.checkout.done
  shop.checkout.s2 -[sync]-> bank 'charges the card with' {
    technology 'HTTPS'
  }
}

views {
  view checkout-flow of shop.checkout {
    title 'Checkout (flow)'
    include *
    autoLayout TopBottom
  }
}
```

## Change a flow

A change to a flow that exists is a design change: run the loop of the skill. In the proposal, `extend` the flow to
add steps and decisions, and `add` and `remove` its relationships. To ask about a step or a decision, open a thread on
it in the studio (step 4 of the loop).
