# Flows

Read from [the c4-design skill](../SKILL.md#code-keys-flows-deployments-and-logos).

A process with steps and decisions, such as an odin playbook, is a flow of the flow kit, not this page:
[flow-kit.md](flow-kit.md).

A flow shows the steps of one main path through the code, in order, as a sequence diagram. Write it as a
`dynamic view` with `variant sequence` in a `views` block of `model/`:

```likec4
dynamic view flowCheckout {
  variant sequence
  title 'Flow: checkout'
  description 'The web app sends the cart to the API, which stores the order.'

  // The order of the lifelines, left to right
  include
    customer,
    shop.web,
    shop.api,
    shop.db

  customer -> shop.web 'presses Pay'
  shop.web -> shop.api 'posts the cart'
  shop.api -> shop.db 'stores the order'
  shop.web <- shop.api 'returns the order id'
}
```

- Name leaf elements only: people, external systems, and containers or components with no children. A sequence
  view shows only leaf elements, so a step names `shop.api`, never `shop`.
- Write one flow for each main path, not one for each function. Read the code of each step before you write it.
- floorplan's own model has two flows whose syntax you can copy: `flowBuild` and `flowDesignLoop` in
  `docs/architecture/model/views.c4` of floorplan. `flowBuild` uses `alt` with `when` and `else`, `parallel` and a
  step's `notes`; `flowDesignLoop` uses `loop` and `notes`. The syntax is in
  `apps/docs/src/content/docs/dsl/Views/dynamic.mdx` there. Write the titles and steps by
  [views.md](views.md#flows), not by those two.
- Run `floorplan build`, then `render` the flow's view id and look at the PNG, as in step 2 of the loop.
- No rule asks for a flow.
