# Sources of the design references

[modeling.md](modeling.md), [views.md](views.md) and [review.md](review.md) come from the pages below, read on
2026-11-07. The references give the rules in their own words; read a page for the full reason. Where the sources do
not agree, the references take the rule that fits the floorplan kit and say so.

## C4 model (Simon Brown)

- Abstractions: https://c4model.com/abstractions, and the pages for software system, container, component and code
  under it.
- Microservices: https://c4model.com/abstractions/microservices
- Queues and topics: https://c4model.com/abstractions/queues-and-topics
- Diagram types: https://c4model.com/diagrams, and the pages for system context, container, component, dynamic,
  deployment and system landscape under it.
- Notation: https://c4model.com/diagrams/notation
- Review checklist: https://c4model.com/diagrams/checklist
- FAQ: https://c4model.com/faq and https://c4model.com/diagrams/faq
- How to review a diagram: https://dev.to/simonbrown/how-to-review-a-software-architecture-diagram-6p0
- Many relationships between two elements: https://dev.to/simonbrown/modelling-multiple-relationships-51bf
- The size of a diagram (20 elements): https://dev.to/simonbrown/diagramming-distributed-architectures-with-the-c4-model-51cm
- Cloud diagrams: https://dev.to/simonbrown/cloud-architecture-diagrams-3pbm

## IcePanel

- Core concepts: https://developer.icepanel.io/core-concepts/overview
- Modelling, diagramming, groups, flows, tags, drafts and versions: https://docs.icepanel.io
- Tips for effective diagrams: https://icepanel.io/academy/best-practices/tips-for-creating-effective-diagrams
- Common diagramming mistakes: https://icepanel.io/blog/common-diagramming-mistakes
- Define a system: https://icepanel.io/blog/c4-model-how-to-define-your-system
- Events and queues: https://icepanel.io/blog/how-to-diagram-events-icepanel
- Kubernetes: https://icepanel.io/blog/modelling-kubernetes-clusters-using-c4-model
- Common architectures: https://icepanel.io/blog/how-to-create-common-architecture-diagrams-with-the-c4-model
- E-book "Communicating software architecture with the C4 model" (Luca Mezzalira, hosted by IcePanel): its review
  checklist.

## LikeC4 and Structurizr

- LikeC4 DSL, views, predicates, dynamic views, deployment, styling and notations: https://likec4.dev/llms-full.txt
  (floorplan is a fork of LikeC4, so the DSL is the same).
- Structurizr model and views, implied relationships, dynamic views, deployment groups and patterns:
  https://docs.structurizr.com
- Structurizr inspections (coverage rules): https://docs.structurizr.com/workspaces/inspections

## General practice

- arc42 building block, runtime and deployment views: https://docs.arc42.org/section-5/,
  https://docs.arc42.org/section-6/ and https://docs.arc42.org/section-7/
- Azure, design diagrams: https://learn.microsoft.com/en-us/azure/well-architected/architect-role/design-diagrams
- Ilograph, diagram mistakes: https://www.ilograph.com/blog/posts/diagram-mistakes/ and
  https://www.ilograph.com/blog/posts/more-common-diagram-mistakes
- InfoQ, crafting architectural diagrams: https://www.infoq.com/articles/crafting-architectural-diagrams
- SEI, documenting software architectures: https://www.informit.com/articles/article.aspx?p=1641654&seqNum=5
- Line crossings hurt understanding most (Purchase):
  https://www.springerprofessional.de/en/which-aesthetic-has-the-greatest-effect-on-human-understanding/13633544
- Models made from code need a person to curate them: https://arxiv.org/abs/2407.17990

## Tested with floorplan 0.8

These points come from a run of the floorplan CLI, not from a page:

- A view of a container with no children shows its direct neighbours, and `-> X ->` adds no neighbours.
- A flow step with no relationship in the model draws, and `floorplan check` reports nothing.
- The card shows the `summary` in place of the `description`.
- A relationship with no kind gets a dashed line; `sync` is solid and `async` is dotted.
- A `specification` block in `model/` can declare a tag, and `floorplan check` accepts it.
- The PNG of `floorplan render` shows no view title and no key.
