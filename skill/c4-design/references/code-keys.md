# Link the model to its code

Read from [the c4-design skill](../SKILL.md#code-keys-flows-deployments-and-logos).

Three metadata keys, the D1 keys, tie an element to the files of its repo. A path is relative to the repo root (the
`git rev-parse --show-toplevel` of the project folder), not to the project folder.

| Key         | Its value                                                                                | It goes on                         |
| ----------- | ---------------------------------------------------------------------------------------- | ---------------------------------- |
| `code`      | a folder or a file, or a list of them: `code ['cmd/api/', 'internal/api/']`              | a `component` or a container kind  |
| `deploy`    | a Kubernetes manifest (a file or a folder), or a Terraform resource as `tf:<type>.<name>` | a container kind                   |
| `terraform` | a folder of `.tf` files, or a list of them                                               | a `softwareSystem`                 |

The container kinds are `container`, `webApp`, `mobileApp`, `database` and `queue`.

```likec4
shop = softwareSystem 'Shop' {
  description 'Takes and keeps the orders.'
  metadata {
    terraform 'infra'
  }

  api = container 'API' {
    technology 'Go'
    description 'Takes the orders.'
    metadata {
      code 'services/api/'
      deploy 'services/api/k8s/'
    }
  }
}
```

- Write the keys in `model/` files, as a small fix: edit, run `floorplan build`, and commit.
- Never write a key in a proposal. A proposal is not a build input, so the scan does not read it, and R9 does not
  check its paths. The key reaches the model only at the accept, where a bad path stops the build after
  `floorplan-engine diff apply` has changed the model. Accept a new element first, then add its keys in `model/`.

## floorplan scan

`floorplan scan [dir]` (MCP `scan` {dir}) reads the keys and writes `model/scan/`, and nothing else. It changes no
hand-written file and never commits. `floorplan build` runs it first; `--no-scan` (MCP `noScan:true`) skips it.

- The scan reads only the files that git tracks, and the URL of `origin`. Stage a new file (`git add`) before the
  scan, or its path is not in git.
- It writes `links.c4` (a link `https://github.com/<owner>/<repo>/tree/HEAD/<path>` for each `code` path),
  `stack.c4` and `stack-views.c4` (the tech stack of each element with a `code` key, and the view `stack`),
  `logos.c4` (the logo of each language, [Logos](logos.md)), and, from the `terraform` and `deploy` keys,
  `deployment.c4` and `deployment-views.c4` (the network, the deployments with the Google Cloud icon of each node,
  and the view `deployment`).
- `model/scan/` is the scan's. Each file starts with `// Written by floorplan scan. Do not edit.` Never edit one:
  R9 fails on the change, and the next scan writes the file again.
- The scan also owns the stack keys `language`, `language-version`, `runtime`, `frameworks` and `image`, the view
  ids `stack` and `deployment`, and the style group id `languageLogos`. Do not write them by hand: floorplan's
  engine adds a hand-written value of a key to the scan's value, and a second view or style group with one of
  those ids is a duplicate.
- A project with no key gets no `model/scan/` folder, and R9 passes.
- A key with a problem stops `floorplan build`: it prints the problem and writes no outputs.

## R9 and its fixes

`floorplan check` runs R9, an error: each key is on its kinds, each path is in git, each value is one the scan can
place, and `model/scan/` matches a new scan in memory. The fix for each failure:

| `floorplan check` says (R9)                                                                       | Fix                                                               |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `the code path <path> is not in git: git tracks no file or folder with this path.`                | Fix the path of the key in `model/`, or `git add` the file.       |
| `the code key is on a <kind>, but it goes only on a component or a container kind (…).`           | Move the key in `model/` to an element of a kind that takes it.   |
| `the file is not what floorplan scan writes now.`, or a file that is missing or extra under `model/scan/` | `model/scan/` is out of date: run `floorplan build`.      |

- The first two read the same for `deploy` and `terraform`. A path out of the repo, or a project out of a git
  checkout, is the first kind too.
- `deploy` also fails on a value that the scan cannot place: a manifest with no workload, workloads with no
  `terraform` cluster, and a `tf:` address with no node. Fix the key in `model/`, or the file it names.
- The check says to run `floorplan scan` for an out-of-date file. Run `floorplan build`: `model/scan/` is under
  `model/`, an input of R8, so a scan that changes a file makes R8 fail until the next build.

## Deployments

The network and the deployments come from the `terraform` and `deploy` keys:

1. Put a `terraform` key on the `softwareSystem`: the folders of its `.tf` files.
2. Put a `deploy` key on each container kind that runs: its Kubernetes manifest (a `Deployment`, `StatefulSet`,
   `CronJob` or `Job`), or `tf:<type>.<name>` for the resource it runs on, such as
   `tf:google_compute_instance.connector`.
3. Run `floorplan build`. The scan writes the nodes and the instances into `model/scan/deployment.c4`, and the view
   `deployment` into `model/scan/deployment-views.c4`. Run `render` on the view `deployment` and look at it.

- The scan reads only the `.tf` files that git tracks. It never reads Terraform state and never runs `terraform`:
  state can hold secret values.
- It draws a node for each `google` resource type that has a deployment kind of the kit
  ([kit-and-rules.md](kit-and-rules.md)), and lists the other `google_*` types in a comment.
- A manifest's workload goes in the first cluster by Terraform address. The scan reads plain manifests only, not
  Kustomize overlays, Helm charts or `kind: List` exports.
- One project has one deployment model: the `terraform` folders of all its systems share one environment, `gcp`.
- Write a `deployment` block by hand only for what no `.tf` file holds. Use the kit's deployment kinds, or R1
  fails.
