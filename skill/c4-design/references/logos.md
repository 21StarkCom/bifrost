# Logos

Read from [the c4-design skill](../SKILL.md#code-keys-flows-deployments-and-logos).

A logo is the `icon` of an element: an icon that LikeC4 bundles, named `<set>:<name>`. The sets are the folders of
`packages/icons/` in the floorplan repo: `tech` (vendors, products and languages, such as `tech:github`), `gcp`
(Google Cloud products, such as `gcp:cloud-sql`), `aws`, `azure` and `bootstrap`. floorplan 0.5.0 and later write the
logos of the languages and of Google Cloud. You write the logos of the external systems.

**External systems.** Give each external system `icon <name>` in `model/`, as a small fix: edit, run
`floorplan build`, and commit. No scan does it, because no key of the model names a vendor. A new external system
in a proposal takes its `icon` in the `add` block, as it takes its `description`.

```likec4
github = externalSystem 'GitHub' {
  description 'Hosts the repos and runs CI.'
  icon tech:github
}

slack = externalSystem 'Slack' {
  description 'Gets the alerts.'
  icon tech:slack
}
```

- Use a bundled icon only when it names the same vendor or product as the element.
- Use the icon of the product when one is bundled: `tech:jira` for Jira, `tech:claude` for Claude,
  `gcp:key-management-service` for Cloud KMS. Else use the icon of the vendor: `tech:google-cloud`.
- Give no `icon` to an element that names two or more vendors, or to a vendor with no bundled icon (HiBob,
  Twingate, Cursor). The repos keep no brand files.
- An internal element can take an `icon` too. That icon wins over the language logo below.

**Languages.** `floorplan scan` writes `model/scan/logos.c4`: the style group `languageLogos`, with the logo of
the language of each element of `stack.c4` (`tech:go`, `tech:typescript`, `tech:javascript`, `tech:python`).

- The view `stack` applies the group. A hand-written view shows the language logos only when you add the line
  `global style languageLogos` to it. No hand-written view has the line by default.

  ```likec4
  view containers of shop {
    include *

    global style languageLogos
  }
  ```

- The scan leaves an element with a hand-written `icon` out of the group, so the element keeps its own icon.
- When each element of `stack.c4` has a hand-written `icon`, the scan writes no `logos.c4`. A view with the line
  then fails `floorplan check` with `Could not resolve reference to GlobalStyleId named 'languageLogos'.` Remove
  the line from the view.

**Google Cloud.** The scan writes `icon` on each node of `model/scan/deployment.c4`, by the resource type:
`tech:google-cloud` on the environment `gcp`, `gcp:project` on a project, `gcp:cloud-sql` on a
`google_sql_database_instance`, and so on. An instance keeps the icon of its element.

- Never edit `logos.c4` or the icons of `deployment.c4`. They are scan files: R9 fails on the change, and the next
  scan writes them again.

**An unknown icon name fails `floorplan check`,** in `model/` and in a proposal. In `model/`, `floorplan build`
then writes no outputs. The language reads the name as a reference, so no rule R1 to R9 is needed:

```
model/model.c4:12 error FLOORPLAN Could not resolve reference to LibIcon named 'tech:hibob'.
```

Fix the name, or remove the `icon`.

**No technology text from an icon.** Each floorplan project sets `"inferTechnologyFromIcon": false` in its
`floorplan.config.json`. `floorplan init` writes the key from floorplan 0.5.0 on; add it by hand to an older project.

```json
{
  "name": "shop",
  "title": "shop",
  "inferTechnologyFromIcon": false
}
```

Without the key, the engine gives each element with an icon and no `technology` a technology text from the icon's
name, such as "Github" or "Slack", under its title. The text repeats the logo, and it can spell a brand name wrong
("Github" for GitHub).

A node shows one icon, so frameworks and runtimes stay as text in the element's card.
