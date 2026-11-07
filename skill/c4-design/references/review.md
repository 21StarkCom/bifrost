# Review a model and its views

A checklist for the model text and for each rendered PNG. Run it at step 2 of the loop, before you show a proposal
to the operator, and when the operator asks for a review of a model or its diagrams. The checks come from the C4
model review checklist, IcePanel, LikeC4 and Structurizr guidance; [sources.md](sources.md) lists each page.

## What `floorplan check` already covers

Do not check these by hand: `floorplan check` reports them ([kit-and-rules.md](kit-and-rules.md)).

- A kind that is not in the kit (R1), a container or a component in the wrong parent (R2), children of a person or an
  external system (R3).
- A system, container or component with no description (R4), a container or component with no technology (R5).
- A relationship with no title, or with no technology between two containers (R6).
- No context view, or a system with containers and no container view (R7).
- Outputs that do not match the model (R8), and code keys and `model/scan/` (R9).

The checks below are the ones that no rule makes. A model can pass `floorplan check` with no warnings and still fail
most of them.

## Model checks

Read the `.c4` files of `model/` and of the proposal. For each check, the fix is in
[modeling.md](modeling.md) or [views.md](views.md).

The MCP tools of the server `floorplan-model` take a `project` argument. Pass the `name` of the project's
`floorplan.config.json`; `list-projects` lists the names. With no `project`, a tool reads the project `default`,
which can be another model of the workspace.

| #  | Check                                                                                       | How to find a failure                                                     |
| -- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| M1 | Each element has the right kind: the tests of modeling.md, in order.                        | A library, a folder, a pod, a load balancer or a team as an element.     |
| M2 | Each relationship title is a verb phrase that reads "source <title> target".                | A title of one word, "uses", "calls", or a noun.                          |
| M3 | Each relationship has a kind (`sync` or `async`).                                           | A relationship written with `->`, not `-[sync]->` or `-[async]->`.       |
| M4 | Each arrow starts at the element that starts the work. No `<->` for a call.                 | `<->`; a title in the passive voice ("is called by").                    |
| M5 | One relationship for each pair of elements, with a summary title.                           | Two or more relationships between the same two elements.                  |
| M6 | A relationship is in the model once, at the lowest level known.                             | The same pair at the system level and at the container level.            |
| M7 | Each description says what the element does, and for whom when the title does not say it.  | "Handles business logic", "Backend service", a copy of the title; a description that leaves out a main job of the element. |
| M8 | Each technology names a language, a framework or a product; no code path.                   | A path such as `packages/api` in `technology`.                            |
| M9 | One name for one thing; no acronym that a reader may not know; no "Service A".             | Two titles for one role ("Customer", "User"); one title that can name two elements. |
| M10 | Each element is in a view, and each element has a relationship.                           | `read-element` (server `floorplan-model`, with `project`): an empty `includedInViews`. |
| M11 | Each step of a flow has a relationship in the model between the same two elements.        | `find-relationships` (server `floorplan-model`, with `project`) for each step's pair. |
| M12 | The model matches the code: each container runs, each relationship is a real call.       | A `code` path with no entry point (no `main`, no `bin`, no server start); a call in the code with no relationship; a process in the code with no element. |
| M13 | Each relationship technology names a protocol, a format or a mechanism.                    | An SDK or a library name ("Floorplan SDK"): the call stays in one process. |
| M14 | Each hand-written view has a `description`: the question that it answers.                 | A `view` block with no `description`.                                     |

## Picture checks

For a proposal, run `render` with the proposal for each view that the change touches. For a review with no
proposal, render each view of the project: `generated/llms.txt` lists them. Read each PNG. Look at the whole picture
first, then at each box and each line. The PNG has a transparent background, and a viewer can show it on black.

The scan writes the views `stack` and `deployment`. Skip P1 for them: their title is the scan's.

| #  | Check                                                                                       | A failure looks like                                                       |
| -- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| P1 | The view title names the type and the scope ("Containers: Shop").                         | "Overview", "Containers", no title. The PNG has no title: read the view. |
| P2 | All elements are at one level.                                                              | A component next to a system; a vendor next to an endpoint.               |
| P3 | The view has 20 elements or fewer, and a reader can follow each line.                      | More than 20 boxes; lines that cross many times; a line that loops round. |
| P4 | Each line has a title, and the title reads right in the direction of the arrow.            | A line with no label; "receives data from" on an arrow that points out.   |
| P5 | No line has the label `[...]`.                                                              | `[...]`: relationships with different titles merged into one line.        |
| P6 | No label is cut short, and no box is out of place.                                          | A title that ends in "…"; a box far from the boxes it connects to.        |
| P7 | The words match the reader: no protocols on a context view.                                 | `HTTPS`, `gRPC` or a framework name on the context view.                  |
| P8 | No infrastructure on a context or container view.                                           | A box for a load balancer, a cluster, a namespace or a gateway.           |
| P9 | Each line style and colour has a meaning in the key of the kit.                             | A dashed line: a relationship with no kind (M3).                          |
| P10 | The change of a proposal shows in its To-be view.                                          | A new element that no view shows; a change outside the rendered view.     |

## Flow checks

- One flow shows one use case, and its title names the use case ("Flow: checkout").
- Each step title is the specific action, as a verb phrase from the sender.
- The flow names leaf elements only.
- Detail is in the `notes` of a step, not in its title. A command or a file name is detail.
- A return step shows only an answer that matters: data that a later step uses, or the end of the flow.
- The `include` list orders the lifelines by the step where each element first takes part.
- A step that can fail in a way that changes the flow shows the failure path with `alt`.
- The relationship in the model that starts the flow has `navigateTo` with the flow's id.

## Deployment checks

- The view shows one environment.
- Each node has a technology, and no node is empty.
- The view shows your containers on the nodes, not only cloud products.
- No line goes between two zones or regions, unless the system does that on purpose.

## Report the findings

1. Fix each failure in a proposal by yourself when the fix is clear, and run `check` and `render` again.
2. Put each failure that needs the operator's choice in a question on the canvas (step 4 of the loop). Name the
   check, such as "M5", the element id, and your suggested fix.
3. For a review with no proposal, list the findings in the chat, one line each: the check, the element id or the
   view id, what is wrong, and the fix.
4. Sort each fix into one of two groups:
   - **Small fix, in `model/`:** a title, a description, a `summary`, a technology, the `sync` or `async` kind of a
     relationship, the title of a relationship, a view, or a step of a flow of code that exists.
   - **Proposal:** add or remove an element or a relationship, change the kind of an element or its parent, or
     change the two elements that a relationship connects.

## Anti-patterns

| Anti-pattern                                                    | Fix                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| One view that shows everything                                  | One view for each question; split at 20 elements                            |
| One bus container with all the services around it              | One `queue` for each queue or topic, or the topic named on each line        |
| Modules of a monolith as containers                             | One container; its modules as components                                    |
| Microservices of many teams as containers of one system         | One `softwareSystem` for each team's service                                |
| A managed database of your own as an external system            | A `database` container of your system                                       |
| Pods, Kubernetes services, ingresses or Docker as boxes         | Deployment nodes; a Kubernetes service is a relationship                    |
| One arrow for each use case between two boxes                   | One relationship with a summary title, and a flow for each use case         |
| A relationship drawn again at each level                        | The lowest level only; the views of the parents show it                     |
| A second copy of a view for the To-be state                     | A proposal, or a tag on the elements that change                            |
| A flow step with no relationship in the model                   | Add the relationship to the model first                                     |
| Colours or styles that the key does not explain                 | No colours in the model; the kit's kinds give the colours                   |
| A PNG kept as the truth, or a model change with no review       | Views from the model; a change as a proposal that the operator accepts      |
