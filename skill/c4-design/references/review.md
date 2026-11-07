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

The MCP tools of the server `floorplan-model` take a `project` argument: the project's id. The id is the `name` of
the project's `floorplan.config.json`, and `list-projects` lists each id. With no `project`, a tool reads the
project `default`, which can be another model.

The server reads only the projects under the folder where the session started. When `list-projects` does not list
the project, read the project's `generated/model.json` in place of the tools: `views.<id>.nodes` lists the elements
of a view, `views.<id>.edges` its lines, and `relations` the relationships of the model. In a flow, an edge with
no `relations` is a return step or a step with no relationship. It is a return step `a <- b` when it goes from `b`
to `a` and the model has the relationship `a -> b`. The key `dir: "back"` does not mark a return step: a forward
step drawn from right to left has it too.

| #  | Check                                                                                       | How to find a failure                                                     |
| -- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| M1 | Each element has the right kind: the tests of modeling.md, in order.                        | A library, a folder of code, a pod, a load balancer or a team as an element. |
| M2 | Each relationship title is a verb phrase that reads "source <title> target".                | A title of one word, "uses", "calls", or a noun.                          |
| M3 | Each relationship has a kind (`sync` or `async`).                                           | A relationship written with `->`, not `-[sync]->` or `-[async]->`.       |
| M4 | Each arrow starts at the element that starts the work. No `<->` for a call.                 | `<->`; a title in the passive voice ("is called by").                    |
| M5 | One relationship for each pair of elements, with a summary title.                           | Two or more relationships between the same two elements; one relationship whose title covers only some of what the source does with the target. |
| M6 | A relationship is in the model once, at the lowest level known.                             | The same pair at the system level and at the container level.            |
| M7 | Each description says what the element does, and for whom when the title does not say it.  | "Handles business logic", "Backend service", a copy of the title; a description that leaves out a main job of the element. |
| M8 | Each technology names a language, a framework or a product; no code path.                   | A path such as `packages/api` in `technology`.                            |
| M9 | One name for one thing; no acronym that a reader may not know; no "Service A".             | Two titles for one role ("Customer", "User"); one title that can name two elements. |
| M10 | Each element is in a view, and each element has a relationship. A relationship of a child counts for its parent. | `read-element` (server `floorplan-model`, with `project`): an empty `includedInViews`. |
| M11 | Each step of a flow has a relationship in the model between the same two elements. A return step `a <- b` uses the relationship `a -> b`. | `find-relationships` (server `floorplan-model`, with `project`) for each step's pair. |
| M12 | The model matches the code: each container runs, each relationship is a real call, and each process that the product ships or runs has an element. One element is one process role: a bin that runs in two roles that other elements call apart (a CLI, and the server that its `mcp` command starts) is two elements. | A `code` path of a `container` with no entry point (no `main`, no `bin`, no code that starts a server when the package runs; a start function that only other packages call is not one), or of a `webApp` with no `index.html` and no bundler entry; a call in the code with no relationship; a shipped process with no element. Put a process that the repo holds but does not ship (an editor extension, a dev tool) in a question for the operator. |
| M13 | Each technology on a relationship names the protocol, the format or the transport of the call, as modeling.md says. A relationship from a person needs no technology, so removing a bad one is a fix too. | A library, an SDK or a tool name alone ("Floorplan SDK", "Vite", "Huginn"), or the name of a product at one end of the call. |
| M14 | Each hand-written view has a `description` of one sentence, which says what a reader learns from the view. | A `view` block with no `description`.                                     |

## Picture checks

For a proposal, run `render` with the proposal for each view that the change touches. For a review with no
proposal, render each view of the project: `generated/llms.txt` lists them. Read each PNG. Look at the whole picture
first, then at each box and each line. The PNG has a transparent background, and a viewer can show it on black.

The scan writes the views `stack` and `deployment`. Skip P1 for them: their title is the scan's. A `stack` card
shows a logo, so it cuts a long text first. Report a cut on `stack` only when the text breaks a rule of
modeling.md, such as a code path in `technology` (M8); never shorten a text below what modeling.md asks to fit it.

| #  | Check                                                                                       | A failure looks like                                                       |
| -- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| P1 | The view title names the type and the scope ("Containers: Shop").                         | "Overview", "Containers", no title. The PNG has no title: read the view. |
| P2 | All elements are at the level of the view, by the rule "One level in each view" of views.md. | A component next to a system; a vendor next to an endpoint.               |
| P3 | The view has 20 elements or fewer, and a reader can follow each line.                      | More than 20 boxes; lines that cross many times; a line that loops round. |
| P4 | Each line has a title, and the title reads right in the direction of the arrow.            | A line with no label; "receives data from" on an arrow that points out.   |
| P5 | No line has the label `[...]`.                                                              | `[...]`: relationships with different titles merged into one line.        |
| P6 | No text is cut short, and no box is out of place. The text is each line of a card (title, technology, description) and the label of each line. | Text that ends in "…" or "..."; a box far from the boxes it connects to. |
| P7 | The words match the reader: no protocols on a context view.                                 | `HTTPS`, `gRPC` or a framework name on the context view.                  |
| P8 | No infrastructure on a context or container view.                                           | A box for a load balancer, a cluster, a namespace or a gateway.           |
| P9 | Each line style and colour has a meaning in the key of the kit.                             | A dashed line: a relationship with no kind (M3).                          |
| P10 | The change of a proposal shows in its To-be view.                                          | A new element that no view shows; a change outside the rendered view.     |

## Flow checks

- One flow shows one use case, and its title names the use case ("Flow: checkout").
- Each step title is the specific action, as a verb phrase from the sender.
- The flow names leaf elements only.
- Detail is in the `notes` of a step, not in its title. A command, a flag or a path is detail. A title names a
  file in plain words ("updates the README") and puts its path in `notes`.
- A return step shows only an answer that matters: data that a later step uses, or the end of the flow.
- The `include` list orders the lifelines by the step where each element first takes part, read as views.md says.
- A step that can fail in a way that changes the flow shows the failure path with `alt`.
- The relationship of the flow's first step has `navigateTo` with the flow's id, as views.md says.

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
   - **Proposal:** add or remove an element or a relationship, change the kind of an element or its parent, or
     change the two elements that a relationship connects or its direction.
   - **Small fix, in `model/`:** each other fix. Examples: a title, a description, a `summary`, a technology, the
     `sync` or `async` kind or the `navigateTo` of a relationship, a view, and the steps, `notes` and `include`
     list of a flow that shows code that exists.

   The sort holds for each model that exists, also when a fix makes the model match the code (M12). The one
   exception is a first model of a repo with no model, which modeling.md writes in `model/`.

## Anti-patterns

| Anti-pattern                                                    | Fix                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| One view that shows everything                                  | One view for each question; split above 20 elements                         |
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
