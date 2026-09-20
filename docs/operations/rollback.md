# stark-marketplace — Rollback runbook

This runbook covers two rollback scenarios. Read [`SECURITY.md`](../SECURITY.md) first — the trust model dictates what "rollback" means here. There is **no destructive rollback** of a signed release: signatures are immutable, transparency-logged, and possibly already pinned by consumers.

## 1. Bad-bundle yank (catalog)

A published bundle version is **content-locked** by `stark check-bumps`. Yanking is not "delete the bytes" — it's "publish a successor that supersedes it."

**Procedure:**
1. **Don't** edit the affected artifact in place. `check-bumps` would block the PR; even if you bypassed it, the cosign-signed manifest for the prior release still records the old digest, and any consumer with `stark verify-manifest` against the old release will still see the artifact as valid.
2. **Do** ship a new version of the bundle (or the affected artifact) that:
   - Has a higher SemVer than the bad one
   - Replaces the bad behavior with either a fixed implementation or an empty/no-op shell that prints a deprecation notice
   - References the bad version in its CHANGELOG entry
3. **Then** post an advisory:
   - Update `docs/SECURITY.md` with a "Yanked versions" section listing `bundle/version` pairs and the reason
   - Edit the affected GitHub Release page notes with a header: `⚠️ DO NOT USE — superseded by vX.Y.Z due to <one-line reason>`. Don't delete the release (consumers may have pinned the SHA; deleting breaks `stark verify-manifest`).
   - Email/Slack the alert channel (notification channel `email` in `ev-infra-group/infra/monitoring.tf`) with the same advisory.

> **The SemVer bump is not what reaches a native Codex consumer (STARK-7998; measured 2026-09-20
> on codex-cli 0.155.1 — pinned by nothing, CI has no Codex, so re-measure before leaning on it.
> `CLAUDE.md` "Version-bump immutability" records what each probe did and did not establish,
> including that the `upgrade` path and the recorded source shape were measured separately).**
> Step 2 assumes a consumer that re-fetches when a version moves. That holds for Claude Code and
> not for the `dist/codex-plugins/` packages: their manifest carries the root `VERSION`, not the
> bundle's, so a bundle bump changes no byte of the Codex package
> (`TestABundleBumpChangesNoByteOfTheCodexPackage`), and `version` only names the cache directory
> (`~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`) rather than gating retrieval. What
> a native consumer tracks is the marketplace's git branch — a bare `codex plugin marketplace add`
> of this repo records the source with no ref and clones the default branch — advanced only by an
> explicit `codex plugin marketplace upgrade`. That is the default path and the only one measured:
> `add` also takes `--ref`, so a consumer who pinned one follows that ref and a successor landing
> on `main` may never reach them at all. Two consequences during an incident:
> - **The fix reaches them, but not because you bumped.** `upgrade` re-installs from the refreshed
>   marketplace snapshot regardless of version, so step 2's replacement bytes arrive once they are
>   on `main` and the consumer upgrades. The SemVer bump is not what carries them, and nothing
>   prompts the upgrade — a consumer who never runs it keeps the bad bundle indefinitely.
> - **Deleting the bundle withdraws nothing.** A plugin dropped from the marketplace manifest and
>   deleted from the repo stayed in `~/.codex/plugins/cache/` and enabled in the consumer's
>   `config.toml`, with `errors: []`; `upgrade` does not remove it. So a yank here has to be a
>   *replacement* published under the same bundle name — either of step 2's two forms, the fixed
>   implementation or the empty/no-op shell — and deleting the bundle is not a substitute for
>   either. Step 3's advisory is the only control that reaches a consumer who does not upgrade
>   at all.

## 2. Signed-release revocation

Cosign keyless signatures have **no native revocation**. The transparency log is append-only; we cannot un-sign. What we can do:

1. **Tag the bad release**: edit its GitHub Release notes with `⚠️ DO NOT INSTALL — see docs/SECURITY.md §<n>`. Notes are mutable; the underlying signed bytes are not.
2. **Cut a successor**: bump `VERSION`, push to main. `sign-manifest.yml` produces `v<next>` with a fresh signed manifest. This is the only artifact `stark verify-manifest` will validate against once the advisory is published.
3. **Document in `docs/SECURITY.md`**: add the bad SHA + tag + reason to a "Revoked releases" subsection. `stark verify-manifest --root .` against the bad release will still cryptographically succeed (we can't help that); the docs are the policy layer.
4. **If the bad signed manifest reveals a compromised signer identity** (e.g., the workflow ref subject was modified to allow another workflow to mint signatures), rotate the pin in `engine/internal/provenance/verify.go` `signerIdentity` and re-sign everything; existing consumers will need to upgrade `stark` to the new verifier.

The cosign signer identity is pinned exactly in `engine/internal/provenance/verify.go`:
```
https://github.com/21StarkCom/bifrost/.github/workflows/sign-manifest.yml@refs/heads/main
```
A signature from any other workflow, ref, or repo fails `stark verify-manifest`.

## 3. Who pages whom

- **Catalog / signing pipeline failure**: CI failures on `sign-manifest.yml` block the release but don't page. Watch via `gh run watch` or set up a personal GitHub notification on workflow failures.
- **For incident escalation**: notify `@aryeh-stark` (CODEOWNERS-required on `engine/internal/validate/allowlist.go` and `engine/internal/provenance/`).

## 4. Drills

- Yanking a bundle: practice on a no-op skill (e.g., add a `stark-test-yank` bundle, "yank" it, verify the advisory flow). Don't ship the practice yank publicly.
