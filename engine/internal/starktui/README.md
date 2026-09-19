# `internal/starktui` — vendored snapshot of the fleet help renderer

A committed copy of two packages from **`21StarkCom/stark-tui`**, pinned at tag
**`go/v0.3.3`** (commit `521ad44e9eb97600e5443ed5fa75530928143ddf`):

| here | upstream |
|---|---|
| `colors/` | `go/colors` — the fleet ANSI palette |
| `help/` | `go/help` — the line-based CLI help colorizer |

`cmd/stark/help.go` renders every `stark --help` page through `help.Render`
(STARK-6770, epic STARK-7636). The rules, the invariants and the deliberate
quirks are specified upstream in
`stark-tui/docs/specs/2026-09-19-help-render-conformance.md`.

## Why a copy and not `require`

`stark-tui` is **private**; `bifrost` is the 21Stark org's only **public** repo.
A plain `require github.com/21StarkCom/stark-tui/go` breaks in two places:

- **CI.** `.github/workflows/ci.yml` carries only `secrets.GITHUB_TOKEN`, which
  is scoped to this repository and cannot read another private repo in the org.
  `go test ./...` could not fetch the module, so `engine (validate + drift +
  tests)` — one of `main`'s five required contexts — would go red and stay red.
- **Anyone who clones this repo.** It is public; the module is not fetchable
  without org credentials, so `go build ./cmd/stark` would fail for everyone
  outside the fleet.

The alternatives were `go mod vendor` (commits the *entire* third-party graph —
cobra, jsonschema, go-toml, yaml, flock, x/sys, x/text — into a public repo, and
sweeps `engine/vendor/` into the `gofmt -l .` and gitleaks gates), or an
org-read credential in a public repo's Actions (a security downgrade that still
leaves public `go build` broken). This snapshot is the smallest option that
keeps CI green and public builds working.

Both packages are **stdlib-only** upstream, so the snapshot adds **zero** module
dependencies — `engine/go.mod` is untouched by it. That is pinned by
`cmd/stark/starktui_snapshot_test.go`, along with the rule that nothing in here
may import the rest of `bifrost`: a back-reference would make the refresh below
destructive.

Both packages also compile and pass their full suite under the engine's pinned
Go 1.24 toolchain, despite upstream's `go/go.mod` declaring `go 1.26` — that
line is a floor for the module as a whole, not a requirement of this code.

## Do not hand-edit

This is generated content in the same sense as `vendor/stark-skills/`: the fix
for anything wrong in here lands **upstream in stark-tui**, then comes back
through the refresh. A local edit is silently reverted by the next refresh, and
`.gitattributes` marks the tree `linguist-generated=true` so a code review
reports findings on these paths in the review body rather than as an inline
thread that can only be resolved in the other repo.

The upstream test suite and the four shared conformance goldens
(`help/testdata/fixture*.ansi`) came along with the copy, so `go test
./internal/starktui/...` pins this tree's behavior against the same bytes the Go
and TypeScript twins are held to.

## Refreshing

The **only** edit applied to upstream's bytes is the import path. From
`engine/`, with `$ST` pointing at a stark-tui checkout at the tag you want:

```sh
cp -R "$ST"/go/help/.   internal/starktui/help/
cp -R "$ST"/go/colors/. internal/starktui/colors/
sed -i '' \
  's|github.com/21StarkCom/stark-tui/go/colors|github.com/21StarkCom/bifrost/engine/internal/starktui/colors|g' \
  internal/starktui/help/*.go
go test ./internal/starktui/... ./cmd/stark -count=1
```

Then update the tag and commit in the table above — `stark help --help` and every
other page is rendered by this code, and the table is the only record of which
upstream revision is shipping.
