# Model a product

How to pick the kind of each element, write its text and its relationships, and make a first model from code. The
rules come from the C4 model, IcePanel, LikeC4 and Structurizr guidance; [sources.md](sources.md) lists each page.
The kinds and the rules of `floorplan check` are in [kit-and-rules.md](kit-and-rules.md).

## Start from the reader

Write one sentence before you model or draw: "As a <reader>, I want to <goal>, so that I can <outcome>." The
sentence sets the level and the scope. A new engineer who asks "what talks to what" needs the container view. A
product manager who asks "who uses this" needs the context view. Model only what some reader needs.

## Pick the kind of each element

| The thing                                                                     | Kind                                    |
| ----------------------------------------------------------------------------- | --------------------------------------- |
| A human role that uses a system: a shopper, an operator, an on-call engineer  | `person`                                |
| A system that one team builds, owns and can see inside                        | `softwareSystem`                        |
| A system that another team or a vendor owns, or that you cannot see inside    | `externalSystem`                        |
| A unit that runs in its own process: a server, a CLI, a worker, a function    | `container`                             |
| Code that runs in the browser (an SPA)                                        | `webApp`                                |
| An app on a phone                                                             | `mobileApp`                             |
| Data that you own: a schema, a bucket, a cache, a file store                  | `database`                              |
| A queue or a topic that you own                                               | `queue`                                 |
| A group of code behind one interface, inside one container                    | `component`                             |

Use these tests, in order:

1. Another team or a vendor owns it, or you cannot see inside it: `externalSystem`.
2. Your team owns it, and it runs in its own process or keeps its own data: a container kind.
3. It is code behind an interface inside one process: `component`.
4. None of the above: it is not an element. See [Leave it out](#leave-it-out).

The cases that agents get wrong most often:

- **A system is not a team, a domain or a capability.** "Payments" is a system only when one team builds and runs
  it as one thing. The words "app", "service" and "product" do not tell the level.
- **A web app that sends a large JavaScript bundle is two containers:** the `webApp` in the browser, and the
  `container` that serves the API. A server that renders HTML is one `container`.
- **A managed data service that you own is a container of your system,** not an external system: a Cloud SQL
  database, a GCS bucket, a Pub/Sub topic. You own its schema or its data. The vendor goes on the deployment view.
- **A serverless function or a cron job is a container.**
- **"Database" names three things.** Model the data (the schema) as a `database` container. The database server
  is a deployment node.
- **Microservices depend on ownership.** One team owns all of them: each service is a `container` with its own
  `database` in one `softwareSystem`. Each team owns one service: each service is a `softwareSystem`.
- **Queues and topics.** Do not draw one bus container in the middle with every service around it. Model each
  queue or topic as its own `queue` container, or leave it out and name it on the arrow ("publishes order events
  to … via `orders` topic", technology `Pub/Sub`). Use one way in the whole project.
- **An AI agent.** Use `person` when it acts as a user (it runs the CLI or reads the UI for a person). Use a
  `container` when it is a program that your system runs, and an `externalSystem` for a vendor API that you call
  (Anthropic, OpenAI).
- **A component cannot deploy alone.** A unit that you can deploy alone is a container.
- **A package with no entry point is a library, not a container.** A folder with no `main`, no `bin` and no
  server start runs inside the process of each container that imports it.

### Leave it out

These are not elements of a context, container or component view:

- A library, a package, a JAR or a folder. Name a library in the `technology` of the container that uses it.
- Kubernetes objects (a pod, a service, an ingress, a namespace), Docker, load balancers, DNS, firewalls, NAT and
  API gateways that only route. They belong on the deployment view, as nodes, or nowhere. The scan writes the
  nodes that the kit has kinds for from the `terraform` and `deploy` keys.
- External systems that do not connect directly to the system in the view.
- Utility code: helpers, data classes, logging. Do not make a component of it.
- Classes, functions and tables (C4 level 4). Put a `link` to the code, or a `code` key, on the component.

## Write the text of an element

- **Title.** The name that people in the team use. Write out an acronym that a reader of the view may not know
  ("API", "CLI" and "UI" are fine; "OMS" is not). Use one name for one thing in all views: "Shopper" everywhere,
  never also "Customer" or "End user". Never "Service A" or "DB1". Name a component by what it does in the domain
  ("Order pricing"), not by a pattern ("Manager", "Helper").
- **`description`.** One or two sentences: what it does, and for whom when the title does not say it. Start with a
  verb: "Takes the orders of the shoppers and sends them to the warehouse." Never "Handles business logic" or
  "Backend service".
- **`summary`.** When the description runs past two lines on the card, add a `summary` of one short line. The card
  then shows the `summary` in place of the `description`.
- **`technology`.** For a container or a component: the language and the main framework or runtime ("Go, gRPC",
  "TypeScript, React"). For a data store: the product ("Cloud SQL for PostgreSQL"). Do not put a code path in it:
  the `code` key holds the path and the scan makes the link.
- **`icon`.** Only on an external system, for its vendor: see the section Logos of the skill.
- Write the text in the language of the readers: a context view is for everyone, so its text has no protocols and
  no framework names.

## Write the relationships

- **One direction.** Draw each arrow from the element that starts the work: the caller, the sender, or the reader
  of a queue. Never use `<->` for a call; keep it for traffic that goes both ways on its own, such as replication.
- **A title on every relationship** (R6). Write a verb phrase that reads as "source <title> target": `shop.web ->
  shop.api 'posts the cart to'`. Never "uses", "calls" or a noun such as "orders".
- **A technology on each relationship between containers** (R6): the protocol and the format, such as
  `HTTPS/JSON`, `gRPC`, `SQL`, `Pub/Sub`, or `stdio` for a child process. Not a library or an SDK name: a call
  through a library stays inside one process, so the callee is not a container.
- **A kind** from the kit on each relationship: `-[sync]->` (a solid line) for a call that waits for its answer, or
  for a person who works in a UI, and `-[async]->` (a dotted line) for a message or an event. A relationship with no
  kind gets a dashed line, which the key does not explain and which looks like the dotted one.
- **One relationship for one pair of elements.** When A does three things with B, write one title that sums them
  up ("browses and buys products in"). Show each use case as a flow, not as one more arrow. Several titles for one
  pair make one line with the label `[...]` on a view.
- **Model a relationship once, at the lowest level that you know.** `shopper -> shop.web` also draws
  `shopper -> shop` on the context view. Do not add the same relationship again at the system level.
- **Give the context view its own words.** A container-level title can be too technical for the context view.
  Change it in the view, not in the model: `include shopper -> shop with { title 'buys products in' }`.

## Make a first model from code

Use this when a repo has code but no model. A first model of code that exists is not a design change: write it in
`model/`, and do not make a proposal. Show it to the operator in the studio (step 3 of the loop) and ask the open
questions on the canvas (step 4) before the PR.

1. Run `floorplan init` when the repo has no `docs/architecture/floorplan.config.json`. Replace the whole starter
   model.
2. **The system.** One repo that one team owns is usually one `softwareSystem`. A monorepo of several teams can
   hold several systems: ask the operator who owns what.
3. **The containers.** List each unit that starts its own process. Read these places:
   - entry points: `cmd/*/main.go`, `main.py`, `bin` in `package.json`, `src/main.*`;
   - the build and run files: `Dockerfile`, `docker-compose.yml`, `Procfile`;
   - the deploy files: Kubernetes `Deployment`, `StatefulSet`, `CronJob` and `Job` manifests, Cloud Run and
     Cloud Functions resources in `.tf` files;
   - a front end: a Vite, Next.js or similar app folder.
4. **The data stores.** Read the migrations, the ORM models, the `.tf` resources (`google_sql_database_instance`,
   `google_storage_bucket`, `google_pubsub_topic`) and the connection settings. Make one `database` or `queue` for
   each store that the system owns.
5. **The people.** Read the roles in the auth code, the UI routes and the CLI help. Make one `person` for each role
   that uses the system in a different way.
6. **The external systems.** Read the SDK clients, the base URLs, the API key settings and the Terraform
   providers. Keep only the systems that a container calls or that call a container.
7. **The relationships.** For each container, read the calls that it starts: HTTP and gRPC clients, SQL, publish
   and subscribe, file reads. Write one relationship for each pair, from the caller, with a title, a technology and
   a kind.
8. **The components.** Model the components of a container only when a reader needs them: a large container, or one
   that a change will split. Group the code by what it does behind an interface; leave out utility code.
9. **The code keys.** Add the `code`, `deploy` and `terraform` keys (the section "Link the model to its code" of
   the skill).
10. **The views.** Write the views by [views.md](views.md), run `floorplan build` and `floorplan check`, render each
    view, and run the checks of [review.md](review.md).
11. Put each guess in a question for the operator, with the file that made you guess. Never fill a gap with an
    invented element: a model that an agent makes from code alone is often vague, and it can show things that do
    not exist. The operator's review of the first model is what makes it true.

## Planned and old elements

- A planned change is a proposal (the loop of the skill). Do not keep a second copy of a view for the To-be state.
- An element that stays in the model but goes away later can take a tag. Declare the tag in a `specification` block
  in `model/` (the kit declares no tags), and put it first in the element body:

  ```likec4
  specification {
    tag deprecated
  }

  model {
    legacy = container 'Legacy API' {
      #deprecated
      technology 'Java'
      description 'Takes the orders of old clients until they move to the new API.'
    }
  }
  ```

  A view can then leave the tagged elements out: `exclude * where tag is #deprecated`.

## IcePanel words in floorplan

| IcePanel           | floorplan                                                                    |
| ------------------ | ---------------------------------------------------------------------------- |
| Landscape          | A project; the fleet landscape of `floorplan studio --all`                   |
| Domain             | No kind. Use one project for each domain, or a `metadata` key                |
| Actor              | `person`                                                                     |
| System             | `softwareSystem`, or `externalSystem` for a system of another owner          |
| App, Store         | A container kind; `database` or `queue` for a store                          |
| Component          | `component`                                                                  |
| Connection         | A relationship with a title, a `technology` and a kind                       |
| Lower connection   | An implied relationship: a view of the parent draws the child relationship   |
| Via                | A `queue` element, or the topic named in the title and the `technology`      |
| Diagram            | A view                                                                       |
| Group              | A `group` in a view; a deployment node for a place where things run          |
| Flow               | A `dynamic view` with `variant sequence`                                     |
| Tag                | A tag that a `specification` block declares                                  |
| Status             | A tag, such as `#deprecated`                                                 |
| Draft              | A proposal                                                                   |
| Version            | A git commit                                                                 |
