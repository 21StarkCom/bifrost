# The lenses of the design panel

Read from [the c4-design skill](../SKILL.md#3-show-it-in-the-studio).

The studio panel shows an element through three **lenses**: Flow, Cost and Watch. Each lens answers one question.
Flow: who comes to the element, what it leans on, and the trip through its parts. Cost: where the cost goes.
Watch: what needs a look. The lenses read the relationships, the dynamic views, and a few metadata keys: the
**lens keys**. The code is `packages/floorplan-spa/src/design-panel/` of floorplan (`flow-lens.ts`, `cost-lens.ts`,
`watch-lens.ts`, `view.ts`).

## The tabs

A tab shows only when the model has its data. The panel shows no empty block and no zero figure.

| Tab        | Shows when                                                    | What it shows                                                                 |
| ---------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Flow       | a relationship crosses the border of the element             | Outside: the neighbours. Inside: the lines of the element.                    |
| Cost       | a direct part of the element has `cost-30d-usd`               | The map of the cost of the parts, and their list.                             |
| Watch      | the element has parts, or a `security` or `brief` key         | The brief, "Needs a look", `usage` and `support`, "Most connected", the views, "More data". |
| Facts      | always                                                        | The kind, the title, the technology, the description, the metadata, the tags and the links. |
| Discussion | always                                                        | The threads of the element.                                                   |

- The tabs come in that order, and the panel opens on the first one.
- The head of the panel shows the id, the owner and the state badge.
- The panel of a view, with no element, has Facts and Discussion.

## The lens keys

A lens key is a metadata key of an element. floorplan reads it, and no rule of `floorplan check` asks for it.

| Key                 | Value                                | What it adds to the panel                                                                 |
| ------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `owner`             | text                                 | The owner in the head.                                                                    |
| `status`            | text                                 | The state badge in the head.                                                              |
| `cost-30d-usd`      | a number as text, such as `729.00`   | On a direct part: its block in Cost, and its cost on its stop in Flow. On the element: the total of Cost. |
| `security`          | text                                 | A row of "Needs a look" in Watch, and a mark on its stop in Flow.                         |
| `brief`             | text: two or three sentences         | The brief of Watch.                                                                       |
| `usage`, `support`  | text                                 | One row each in Watch.                                                                    |

```likec4
shop = system 'Shop' {
  metadata {
    owner 'Team Checkout'
    status 'live'
    cost-30d-usd '1000'
  }

  api = container 'API' {
    technology 'Go'
    metadata {
      cost-30d-usd '729.00'
      security 'The admin route has no login.'
    }
  }
}
```

- **A model needs none of the keys.** A model of elements, relationships and views gives a full panel. "More data"
  in Watch names each key group that the element and its parts do not have: that is not a fault.
- **Add a key only when a source gives its value:** a bill, a dashboard, an owner file, a security review, or the
  operator. Never guess a value. Name the source in the `description` of the proposal.
- **`cost-30d-usd` is a number as text:** digits, then a dot and the cents if you have them. Write no `$`, no comma
  and no unit. The panel shows no cost for another form, or for a value under one cent.
- **Put the total on the element, and each figure on its direct part.** Cost reads the direct parts only, so a cost
  on a part of a part does not count there. When the total is more than the sum of the parts, Cost shows the
  difference as a hatched block, "No part yet". A total less than the sum gives way to the sum.
- **`security` goes on the element that has the fault.** Watch lists the element and each part below it that has
  the key.
- Put the keys in `model/`, or in a proposal for a design change. A `brief` goes through a proposal (below).

## Flow: the neighbours and the lines

**Outside** lists each neighbour of the element: each element at the other end of a relationship that crosses its
border, at the highest level that does not hold the element.

- A neighbour is incoming when the relationship ends in the element or its part, and outgoing when it starts there.
- The title of the first relationship is the sentence of the neighbour, and its kind is the tag. So give each
  relationship a title and a kind ([modeling.md](modeling.md)).

**Inside** shows one line of the element. A **line** is a dynamic view whose steps name the parts of the element: a
step with a part, or a part of a part, as its source or its target. A [flow](flows.md) that names the parts of an
element is a line of that element.

- **The order of the steps is the order of the stops.** The source of the first step is the first stop. A step
  with one end on the line adds its other end after that end, and the title of the step is the text of the new stop.
  The direction of a step does not count.
- The longest path of the steps is the line. An end that leads nowhere is a lookup on its stop, and a second path
  is a branch of four stops at most.
- Each stop shows its cost (`cost-30d-usd`) and its mark (`security`). An end outside the element is a stop of the
  shape `outside`.
- A stop that another line of the element also passes has a pill for that line, two at most.
- Inside opens on the first line, in the order of the views. With two lines or more, a row of pills picks the line.
- An element with no line shows Outside only, with no level toggle. An element with no parts has no line.

To give an element a line, write a flow by [flows.md](flows.md), and name its parts in the steps, in the order of
the trip. Write each step from an element that an earlier step reached, so that the stops make one path.

## Watch: the brief and the ask field

- The brief is the `brief` key of the element. With no key, floorplan makes a brief from counts, and the card has a
  button that asks Claude to write it.
- The ask field opens a thread on the element. Its first line arrives here as a studio message: answer it by step
  4a item 3 of the skill.

### Answer a request for a brief

A press on the button of the brief opens a thread on the element, with this line:

```text
Write the brief of <element id>: two or three sentences in the metadata key brief. Propose the change.
```

1. Read the element: its description, its parts, its relationships and its views. Write two or three sentences:
   what the element does, who comes to it, and what it leans on.
2. Write a proposal by loop steps 1 and 2. Put the brief in an `extend` of the element. The engine adds the key to a
   `metadata` block that the element has already. Use `"…"` around a text that has a `'`.

   ```likec4
   diff brief-shop 'Write the brief of shop' {
     description 'The brief comes from the model: its parts, its relationships and its views.'

     add {
       extend shop {
         metadata {
           brief 'Shop takes the orders of customers. It sends payments to the bank.'
         }
       }
     }
   }
   ```

3. Run `thread_post` with `thread`, `dir`, a `text` that gives the brief in one line, and `proposal`.
4. On the Accept press, run step 4a item 5 of the skill: `accept`, then `thread_resolve`. Watch then shows the brief
   of the model, with no button.
