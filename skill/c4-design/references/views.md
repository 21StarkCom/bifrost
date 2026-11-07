# Choose and scope the views

How to pick the views of a project, scope each one, and write flows and deployment views. The rules come from the
C4 model, IcePanel, LikeC4 and Structurizr guidance; [sources.md](sources.md) lists each page. The DSL syntax of
each predicate is in the `floorplan-dsl` skill of the floorplan repo (`skills/floorplan-dsl/`).

## The set of views

Make these views, and no others until a reader asks a new question:

| View                     | Id and title                                       | When                                            |
| ------------------------ | -------------------------------------------------- | ----------------------------------------------- |
| System context           | `index`, "System Context: <system>"                | Always (R7)                                     |
| Containers               | `containers` or `<system>`, "Containers: <system>" | For each system with containers (R7)            |
| Components               | `<container>`, "Components: <container>"           | Only for a container that a reader must open    |
| Flow                     | `flow<Name>`, "Flow: <use case>"                   | One for each main path through the code         |
| Tech stack               | `stack` (the scan writes it)                       | When an element has a `code` key                |
| Deployment               | `deployment` (the scan writes it)                  | When the system has `terraform` and `deploy` keys |

- A new view must answer a new question: who uses X, what X calls, how flow Y runs, or where X runs. Do not make a
  second view that answers the same question with other boxes.
- Give each view a stable id. The id is the name of the PNG, the URL in the studio and the key of a saved layout.
- The view `title` is the heading of the view in the README block that `floorplan build` writes, and the PNG shows
  no title. So write the type and the scope in each title: "Containers: Shop", never "Overview" or "Containers".
- Give each view a `description` of one sentence: the question that it answers.

## One view, one question

- **One level in each view.** A context view shows people and systems only. A container view shows the containers
  of one system and the people and systems that connect to them. Do not put a component next to a system, or an API
  endpoint next to a vendor.
- **One reader in each view.** A context view is for everyone: no protocols, no framework names, business words in
  the relationship titles. A container view and a component view are for engineers: protocols and technologies.
- **Size.** Aim for 15 elements or fewer. At 20 elements the view is too full: split it. Split a container view by
  domain or by feature, or make a view of one container and its direct neighbours. Each part keeps one level.
- **No orphans.** Each element is in at least one view, and each element in a view has a line to another element.
  The MCP tool `read-element` (server `floorplan-model`, with `project` set to the `name` of the project's
  `floorplan.config.json`) lists `includedInViews` for an element.

## Scope a view with predicates

- `view containers of shop { include * }` shows the system's containers, and each element with a direct
  relationship to them. Most container views need nothing more.
- `view of X { include * }` on a container with no children shows X and its direct neighbours, but not their
  neighbours.
- **`-> X ->` adds no neighbours.** It adds X only when an element in the view already connects to it. To add the
  neighbours of X, write `include X <-> *`, or `include X, * -> X, X -> *`.
- Prefer `X._` to `X.*`: it adds only the children of X that connect to elements in the view. `X.**` adds every
  level and grows fast.
- Put each `exclude` last. An `exclude` removes only what the lines before it included.
- Remove noise by a tag: `exclude * where tag is #deprecated`. An `exclude` can leave an element with no line in the
  view: look for one in the PNG.
- Change a relationship title for one view with `with`: `include shopper -> shop with { title 'buys products in' }`.
  Floorplan's own `index` view does this (`docs/architecture/model/views.c4` in the floorplan repo).
- A line with the label `[...]` merges relationships with different titles. Fix it in the model with one summary
  title, or set a title for the view with `with`.
- A `group` in a view draws a box around elements that have no parent in the view. Use it for a pair such as an
  API and its database, or for a bounded context. A group is not an element of the model.

## Layout and style

- Leave the layout to Graphviz. The default runs top to bottom: people at the top, data stores at the bottom. Use
  `autoLayout LeftRight` for a pipeline that reads left to right.
- The operator can move boxes in the studio. The studio saves that layout in `.floorplan/`; never edit it.
- When lines cross or loop round a box, change the model or the view first: one summary relationship in place of
  two, a relationship that the view does not need left out with `exclude`, or a split of the view. When the
  picture is still hard to read, ask the operator on the canvas to move the boxes in the studio.
- Set no colour and no shape in the model or in a view. The kit gives each kind its colour, its shape and its
  `notation`, and the studio shows the notations as the key of the view. A colour that the key does not explain is
  noise.
- The PNG has no key. When you put a PNG in a PR or a document, put the view title above it, and name each kind
  that a reader may not know.
- A solid line is a `sync` relationship, and a dotted line is `async`. A relationship with no kind gets a dashed
  line, which a reader cannot tell from a dotted one. So give a kind to each relationship.
- The PNG has a transparent background. An image viewer can show it on black; that is not a fault of the view.

## Flows

A flow shows the steps of one main path, in order, as a sequence view. The syntax is in the section Flows of the
skill.

- **One flow for one use case.** Name it by the use case: `flowCheckout`, "Flow: checkout". Make a flow for each
  path that a new engineer must know, not for each function. Good choices are the main use cases, a call to a
  critical external system, the start of the system, and the handling of an error that matters.
- **Each step has a relationship in the model.** Floorplan draws a step that has no relationship in the model, and
  `floorplan check` reports nothing. Before you add a step, find its relationship: the MCP tool
  `find-relationships` (server `floorplan-model`, with `project`) with the two elements, or a search of `model/`. Add the
  relationship to the model first.
- **The step title is the specific action**, and the relationship in the model keeps the general one. The model
  says `shop.web -> shop.api 'posts the cart to'`; a step says `shop.web -> shop.api 'posts the cart with the
  coupon'`.
- **A step title is a verb phrase** from the side of the sender: "runs the check", not "floorplan check". Put a
  command or a file name in the `notes` of the step.
- **A return step only when the answer matters:** it carries data that a later step uses, or it ends the flow.
  Leave out a plain acknowledgment. Write a reply with `<-`: `shop.web <- shop.api 'returns the order id'`.
- **The order of the lifelines** is the order in which each element first takes part in the flow, in the first
  branch of an `alt`. Write the `include` list in that order.
- Use `parallel` for steps that run at the same time, and `alt` with `when` and `else` for a choice. Name each
  branch by its condition. Floorplan's own flows `flowBuild` and `flowDesignLoop` use both.
- Show the failure path of a step when the failure changes what the system does: a retry, a timeout, a message
  that goes to a dead-letter queue. Use `alt`, and write the retry count or the timeout in the step's `notes`.
- Put `navigateTo <flow id>` on the relationship in the model that starts the flow. The reader of the container
  view can then open the flow from the line.

## Deployment views

- The scan writes the view `deployment` from the `terraform` and `deploy` keys. Do not write a second view with
  that id.
- Show one environment in each deployment view.
- Show your own containers on the nodes, not only the cloud products. A view of vendor icons alone does not tell the
  reader what runs where.
- Nest a node only where the thing runs in its parent. A managed service that a container reaches over the network
  is not inside the container's subnet.
- Each node has a technology, and no node is empty.
- Look for lines between zones or regions in the PNG. A line from an app in one zone to a database in another zone
  is a fault, unless the system does that on purpose.
- A Kubernetes namespace is a place, not an element: a node at most. A Kubernetes service is a relationship with a
  protocol, not a box.
