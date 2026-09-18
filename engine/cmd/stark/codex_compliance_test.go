package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/21StarkCom/bifrost/engine/internal/indexio"
	"github.com/21StarkCom/bifrost/engine/internal/load"
	"github.com/21StarkCom/bifrost/engine/internal/model"
	"gopkg.in/yaml.v3"
)

// Keep a relative or braced-variable root AND every intervening segment. Zero
// segments covers ../references/x.md; multiple segments covers the adapter's
// ${STARK_PLUGIN_ROOT:-...}/../../skills/gru/references/x.md (STARK-5068).
// Requiring ../ or ${...} before arbitrary segments avoids swallowing SKILL_DIR
// in the existing bare $SKILL_DIR/scripts/x.sh spelling (STARK-5065).
// Anchors and closing quotes/parens are outside the path character class.
//
// This check covers per-skill support roots, not all bundle assets. In particular
// standards/, tools/ and prompts/ stay with the bundle-asset contract in
// codex_assets_test.go (currently exercised for stark-plan and stark-ops).
// Broadening that inventory is separate from fixing support-path resolution.
var skillSupportRefRe = regexp.MustCompile(`(?:(?:\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^{}]*)?\}/|(?:\.\./)+)(?:[A-Za-z0-9_.-]+/)*)?(?:references|scripts|assets)/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*`)

var supportRootRe = regexp.MustCompile(`^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^{}]*)?\}/`)

// skillSupportRefs returns every support reference in a rendered skill body.
//
// The trim set is a single `.` on purpose. A match can only ever END in a
// character the pattern's own class allows, and that class is `[A-Za-z0-9_.-]`
// throughout — so `,`, `;`, `:` and `)` never entered the match and trimming
// them was dead work that read like a guarantee. `.` alone is reachable, from a
// path that closes a sentence: `references/hooks.md.`
func skillSupportRefs(body string) []string {
	refs := skillSupportRefRe.FindAllString(body, -1)
	for i, ref := range refs {
		refs[i] = strings.TrimRight(ref, ".")
	}
	return refs
}

// supportRefKind labels a reference for the dangling-reference message. A
// reference that leaves the skill's own directory is a different diagnosis: the
// reader must look in the SIBLING skill, not in this one. Getting this backwards
// is the wrong turn STARK-5065 cost a publish window on, so it has its own test.
func supportRefKind(ref string) string {
	if strings.HasPrefix(ref, "../") || strings.HasPrefix(ref, "${") {
		return "cross-skill"
	}
	return "skill-local"
}

// Resolve only roots supplied by the install under test, never the operator's
// environment or the shell fallback. An unknown variable cannot silently pass
// by resolving its tail against a same-named file in the citing skill.
func checkSupportRef(skillDir string, roots map[string]string, ref string) error {
	base, rel := skillDir, ref
	if match := supportRootRe.FindStringSubmatch(ref); match != nil {
		var ok bool
		base, ok = roots[match[1]]
		if !ok {
			return fmt.Errorf("unresolved support reference %q: unknown root %s", ref, match[1])
		}
		rel = ref[len(match[0]):]
	}
	if _, err := os.Stat(filepath.Join(base, filepath.FromSlash(rel))); err != nil {
		return fmt.Errorf("dangling %s support reference %q: %w", supportRefKind(ref), ref, err)
	}
	return nil
}

func splitSkillFrontmatter(t *testing.T, content string) (map[string]any, string) {
	t.Helper()
	if !strings.HasPrefix(content, "---\n") {
		t.Fatal("SKILL.md does not start with YAML frontmatter")
	}
	end := strings.Index(content[4:], "\n---\n")
	if end < 0 {
		t.Fatal("SKILL.md has no closing frontmatter fence")
	}
	end += 4
	var fm map[string]any
	if err := yaml.Unmarshal([]byte(content[4:end]), &fm); err != nil {
		t.Fatalf("invalid SKILL.md frontmatter: %v", err)
	}
	return fm, content[end+5:]
}

type openAIMetadata struct {
	Interface struct {
		DisplayName      string `yaml:"display_name"`
		ShortDescription string `yaml:"short_description"`
	} `yaml:"interface"`
	Policy struct {
		AllowImplicitInvocation *bool `yaml:"allow_implicit_invocation"`
	} `yaml:"policy"`
}

func isExplicitOnlyForRuntime(a *model.Artifact, rt model.Runtime) bool {
	if a.Type == model.TypeCommand {
		return true
	}
	explicitOnly := a.DisableModelInvocation
	if override, ok := a.Overrides[rt]; ok {
		if value, ok := override.Fields["disable-model-invocation"].(bool); ok {
			explicitOnly = value
		}
	}
	return explicitOnly
}

func TestExplicitOnlyPolicyHonorsRuntimeOverride(t *testing.T) {
	a := &model.Artifact{
		Type:                   model.TypeSkill,
		DisableModelInvocation: true,
		Overrides: map[model.Runtime]model.Override{
			model.RuntimeCodex: {
				Fields: map[string]any{"disable-model-invocation": false},
			},
		},
	}
	if isExplicitOnlyForRuntime(a, model.RuntimeCodex) {
		t.Fatal("Codex override should make the skill model-discoverable")
	}
	if !isExplicitOnlyForRuntime(a, model.RuntimeClaude) {
		t.Fatal("base Claude policy should remain explicit-only")
	}
}

// TestEveryCommittedCodexSkillMeetsNativeContract installs every committed
// bundle through the production adapter, then validates the actual files Codex
// discovers. This is intentionally inventory-derived: adding a skill without
// extending a hand-maintained test list cannot create a false green.
func TestEveryCommittedCodexSkillMeetsNativeContract(t *testing.T) {
	root := repoRoot(t)
	idx, err := indexio.LoadIndex(filepath.Join(root, "index.json"))
	if err != nil {
		t.Skipf("committed index.json not present (%v)", err)
	}

	expected := map[string]bool{}
	explicitOnly := map[string]bool{}
	bundleSet := map[string]bool{}
	for _, a := range idx.Artifacts {
		support, ok := a.Support[model.RuntimeCodex]
		if !ok || support == model.SupportUnsupported || a.Type == model.TypeMCP {
			continue
		}
		expected[a.Name] = true
		bundleSet[a.Bundle] = true
	}
	cat, err := load.Load(filepath.Join(root, "catalog"))
	if err != nil {
		t.Fatal(err)
	}
	for _, bundle := range cat.Bundles {
		for _, artifact := range bundle.Artifacts {
			if !expected[artifact.Name] {
				continue
			}
			explicitOnly[artifact.Name] = isExplicitOnlyForRuntime(artifact, model.RuntimeCodex)
		}
	}
	bundles := make([]string, 0, len(bundleSet))
	for bundle := range bundleSet {
		bundles = append(bundles, bundle)
	}
	sort.Strings(bundles)

	allowedFrontmatter := map[string]bool{
		"name": true, "description": true, "license": true,
		"metadata": true, "allowed-tools": true,
	}
	seen := map[string]bool{}
	for _, bundle := range bundles {
		dest := liveCodexInstall(t, bundle)
		roots := map[string]string{
			"STARK_PLUGIN_ROOT": filepath.Join(dest, ".agents", "stark", bundle),
			"STARK_ASSET_ROOT":  filepath.Join(dest, ".agents", "stark", bundle),
		}
		paths, err := filepath.Glob(filepath.Join(dest, ".agents", "skills", "*", "SKILL.md"))
		if err != nil {
			t.Fatal(err)
		}
		for _, skillPath := range paths {
			name := filepath.Base(filepath.Dir(skillPath))
			if seen[name] {
				continue
			}
			seen[name] = true
			t.Run(name, func(t *testing.T) {
				data, err := os.ReadFile(skillPath)
				if err != nil {
					t.Fatal(err)
				}
				if !utf8.Valid(data) {
					t.Fatal("SKILL.md is not valid UTF-8")
				}
				fm, body := splitSkillFrontmatter(t, string(data))
				if fm["name"] != name {
					t.Fatalf("frontmatter name = %v, directory = %s", fm["name"], name)
				}
				description, ok := fm["description"].(string)
				if !ok || strings.TrimSpace(description) == "" {
					t.Fatal("frontmatter description is missing")
				}
				if n := utf8.RuneCountInString(description); n > 1024 {
					t.Fatalf("description is %d characters; Codex limit is 1024", n)
				}
				if strings.ContainsAny(description, "<>") {
					t.Fatal("description contains an angle bracket, which Codex rejects")
				}
				for key := range fm {
					if !allowedFrontmatter[key] {
						t.Errorf("unsupported Codex SKILL.md frontmatter field %q", key)
					}
				}
				for _, forbidden := range []string{"$ARGUMENTS", "CLAUDE_PLUGIN_ROOT"} {
					if strings.Contains(body, forbidden) {
						t.Errorf("body retains host-only token %q", forbidden)
					}
				}

				metaPath := filepath.Join(filepath.Dir(skillPath), "agents", "openai.yaml")
				metaData, err := os.ReadFile(metaPath)
				if err != nil {
					if explicitOnly[name] || !os.IsNotExist(err) {
						t.Fatalf("required metadata missing: %v", err)
					}
				} else {
					var meta openAIMetadata
					if err := yaml.Unmarshal(metaData, &meta); err != nil {
						t.Fatalf("invalid agents/openai.yaml: %v", err)
					}
					if strings.TrimSpace(meta.Interface.DisplayName) == "" {
						t.Error("interface.display_name is empty")
					}
					shortLen := utf8.RuneCountInString(meta.Interface.ShortDescription)
					if shortLen < 25 || shortLen > 64 {
						t.Errorf("interface.short_description is %d characters; want 25..64", shortLen)
					}
					if meta.Policy.AllowImplicitInvocation == nil {
						t.Error("policy.allow_implicit_invocation is missing")
					} else if explicitOnly[name] == *meta.Policy.AllowImplicitInvocation {
						t.Errorf("allow_implicit_invocation = %t, want %t", *meta.Policy.AllowImplicitInvocation, !explicitOnly[name])
					}
				}

				for _, ref := range skillSupportRefs(body) {
					if err := checkSupportRef(filepath.Dir(skillPath), roots, ref); err != nil {
						t.Error(err)
					}
				}
			})
		}
	}

	for name := range expected {
		if !seen[name] {
			t.Errorf("Codex artifact %q was not installed from any bundle", name)
		}
	}
	for name := range seen {
		if !expected[name] {
			t.Errorf("installed unexpected Codex skill %q", name)
		}
	}
}

// TestSkillSupportRefs pins the extraction half of the support-reference check.
// The sibling cases are the ones that blocked publication: a bundle installs its
// skills side by side, so a citation that leaves the skill's own directory is
// correct, and the check must resolve it AS WRITTEN rather than against the
// citing skill (STARK-5065).
func TestSkillSupportRefs(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
		want []string
	}{
		{
			name: "sibling link keeps its prefix and drops the anchor",
			body: "Contract: [the check](../gru/references/operations.md#deterministic-re-brief-check).",
			want: []string{"../gru/references/operations.md"},
		},
		{
			name: "sibling link without an anchor",
			body: "See [operations](../gru/references/operations.md) for the contract.",
			want: []string{"../gru/references/operations.md"},
		},
		{
			// The `+` on the `../` run, not just its presence. With `{1}` this
			// yields `../gru/references/operations.md`, which RESOLVES in a real
			// install — so a genuinely broken two-level path would pass the gate
			// silently, the exact class the gate exists to catch.
			name: "every level of the relative run is kept",
			body: "[x](../../gru/references/operations.md)",
			want: []string{"../../gru/references/operations.md"},
		},
		{
			name: "skill-local link is unchanged",
			body: "Read [the dossier](references/stage1-dossier.md) first.",
			want: []string{"references/stage1-dossier.md"},
		},
		{
			name: "bare local path in prose, trailing sentence punctuation trimmed",
			body: "Run scripts/protect-paths.sh, then read references/hooks.md.",
			want: []string{"scripts/protect-paths.sh", "references/hooks.md"},
		},
		{
			name: "a preceding word is not swallowed as a path segment",
			body: "the references/operations.md file",
			want: []string{"references/operations.md"},
		},
		{
			name: "assets and nested paths",
			body: "[icon](../gru/assets/img/icon.png)",
			want: []string{"../gru/assets/img/icon.png"},
		},
		{
			// A shell variable is not a path segment. Widening the head to any
			// segment made this read as `SKILL_DIR/scripts/…` and fail a script
			// that ships with the skill.
			name: "a shell variable before a skill-local path is not part of it",
			body: `bash "$SKILL_DIR/scripts/gha-cost-breakdown.sh" --json`,
			want: []string{"scripts/gha-cost-breakdown.sh"},
		},
		{
			name: "a rooted script keeps its full spelling too",
			body: "${STARK_PLUGIN_ROOT:-x}/../../stark/stark-ops/scripts/helper.sh",
			want: []string{"${STARK_PLUGIN_ROOT:-x}/../../stark/stark-ops/scripts/helper.sh"},
		},
		{
			name: "variable rooted per-skill link",
			body: "[x](${VAR}/skills/gru/references/operations.md#check)",
			want: []string{"${VAR}/skills/gru/references/operations.md"},
		},
		{
			name: "standalone adapter rooted per-skill link",
			body: "[x](${STARK_PLUGIN_ROOT:-$HOME/.agents/stark/stark-ops}/../../skills/gru/references/operations.md)",
			want: []string{"${STARK_PLUGIN_ROOT:-$HOME/.agents/stark/stark-ops}/../../skills/gru/references/operations.md"},
		},
		{
			name: "parent support directory",
			body: "[x](../references/operations.md)",
			want: []string{"../references/operations.md"},
		},
		{
			name: "grandparent support directory",
			body: "[x](../../references/operations.md)",
			want: []string{"../../references/operations.md"},
		},
		{
			name: "relative skills directory with multiple segments",
			body: "[x](../../skills/gru/references/operations.md)",
			want: []string{"../../skills/gru/references/operations.md"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := skillSupportRefs(tc.body)
			if len(got) != len(tc.want) {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("ref %d = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

// TestSkillSupportRefResolution pins the resolution half against a real tree
// shaped like an install: two skills of one bundle side by side under skills/.
func TestSkillSupportRefResolution(t *testing.T) {
	root := t.TempDir()
	gruRefs := filepath.Join(root, "skills", "gru", "references")
	if err := os.MkdirAll(gruRefs, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(gruRefs, "operations.md"), []byte("contract\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	minion := filepath.Join(root, "skills", "minion")
	if err := os.MkdirAll(minion, 0o755); err != nil {
		t.Fatal(err)
	}
	skillDir := minion

	resolves := func(ref string) bool {
		return checkSupportRef(skillDir, nil, ref) == nil
	}

	body := "Contract: [the check](../gru/references/operations.md#deterministic-re-brief-check)."
	refs := skillSupportRefs(body)
	if len(refs) != 1 {
		t.Fatalf("got %q, want one reference", refs)
	}
	if !resolves(refs[0]) {
		t.Errorf("sibling reference %q did not resolve; a correct citation must not fail the check", refs[0])
	}
	// The tail alone is what the unprefixed pattern used to yield, and it resolves
	// against the CITING skill — the false dangling report this test exists to stop.
	if resolves("references/operations.md") {
		t.Fatal("test tree is wrong: minion must not carry its own references/operations.md")
	}
	// A sibling reference whose target is genuinely absent must still fail, and the
	// reference has to come from the EXTRACTOR: stating the literal here would make
	// the assertion depend on os.Stat and the fixture alone, so no change to the
	// pattern or the helper could ever break it.
	missing := skillSupportRefs("[gone](../gru/references/missing.md)")
	if len(missing) != 1 {
		t.Fatalf("got %q, want one reference", missing)
	}
	if resolves(missing[0]) {
		t.Errorf("a genuinely dangling sibling reference %q resolved", missing[0])
	}
}

// TestSupportRefKind pins the diagnosis. A backwards label sends the reader
// looking for the file inside the citing skill, which is where STARK-5065's
// original message sent me.
func TestSupportRefKind(t *testing.T) {
	for ref, want := range map[string]string{
		"${VAR}/skills/gru/references/x.md":  "cross-skill",
		"../references/operations.md":        "cross-skill",
		"../../references/operations.md":     "cross-skill",
		"../gru/references/operations.md":    "cross-skill",
		"../../gru/references/operations.md": "cross-skill",
		"references/stage1-dossier.md":       "skill-local",
		"scripts/protect-paths.sh":           "skill-local",
	} {
		if got := supportRefKind(ref); got != want {
			t.Errorf("supportRefKind(%q) = %q, want %q", ref, got, want)
		}
	}
}

// Exercise the same extraction, resolution and diagnostic path as the native
// contract. A local decoy makes prefix loss produce a false green, rather than
// an unrelated missing-file error that could accidentally satisfy the test.
func TestSupportRefResolutionAsWritten(t *testing.T) {
	for _, ref := range []string{
		"${VAR}/skills/gru/references/operations.md",
		"${STARK_PLUGIN_ROOT:-$HOME/.agents/stark/stark-ops}/../../skills/gru/references/operations.md",
		"../references/operations.md",
		"../../references/operations.md",
		"../../skills/gru/references/operations.md",
	} {
		t.Run(ref, func(t *testing.T) {
			root := t.TempDir()
			skillDir := filepath.Join(root, "skills", "minion")
			roots := map[string]string{
				"VAR":               root,
				"STARK_PLUGIN_ROOT": filepath.Join(root, "stark", "stark-ops"),
			}
			write := func(path string) {
				t.Helper()
				if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte("contract\n"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			write(filepath.Join(skillDir, "references", "operations.md"))
			refs := skillSupportRefs("[contract](" + ref + "#check).")
			if !slices.Equal(refs, []string{ref}) {
				t.Fatalf("extracted %q, want full path %q", refs, ref)
			}
			err := checkSupportRef(skillDir, roots, refs[0])
			want := fmt.Sprintf("dangling cross-skill support reference %q:", ref)
			if err == nil || !strings.HasPrefix(err.Error(), want) {
				t.Fatalf("with only a local decoy: got %v, want %s", err, want)
			}
			// Expected targets are fixture data, not computed by the resolver.
			target := filepath.Join(root, "skills", "gru", "references", "operations.md")
			switch ref {
			case "../references/operations.md":
				target = filepath.Join(root, "skills", "references", "operations.md")
			case "../../references/operations.md":
				target = filepath.Join(root, "references", "operations.md")
			}
			write(target)
			if err := checkSupportRef(skillDir, roots, refs[0]); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSupportRefUnknownRoot(t *testing.T) {
	ref := "${UNBOUND}/skills/gru/references/operations.md"
	refs := skillSupportRefs(ref)
	if !slices.Equal(refs, []string{ref}) {
		t.Fatalf("got %q, want %q", refs, ref)
	}
	err := checkSupportRef(t.TempDir(), nil, refs[0])
	want := fmt.Sprintf("unresolved support reference %q: unknown root UNBOUND", ref)
	if err == nil || err.Error() != want {
		t.Fatalf("got %v, want %s", err, want)
	}
}

func TestInstalledRootedSkillSupportRef(t *testing.T) {
	dest := liveCodexInstall(t, "stark-ops")
	skillDir := filepath.Join(dest, ".agents", "skills", "minion")
	roots := map[string]string{"STARK_PLUGIN_ROOT": filepath.Join(dest, ".agents", "stark", "stark-ops")}
	ref := "${STARK_PLUGIN_ROOT:-$HOME/.agents/stark/stark-ops}/../../skills/gru/references/operations.md"
	refs := skillSupportRefs("[contract](" + ref + "#deterministic-re-brief-check)")
	if !slices.Equal(refs, []string{ref}) {
		t.Fatalf("got %q, want %q", refs, ref)
	}
	if err := checkSupportRef(skillDir, roots, refs[0]); err != nil {
		t.Fatal(err)
	}
	// Delete only the installed temporary copy: the gate must now name the full
	// rooted reference, including the shell fallback, rather than its bare tail.
	if err := os.Remove(filepath.Join(dest, ".agents", "skills", "gru", "references", "operations.md")); err != nil {
		t.Fatal(err)
	}
	if err := checkSupportRef(skillDir, roots, refs[0]); err == nil || !strings.Contains(err.Error(), fmt.Sprintf("%q", ref)) {
		t.Fatalf("missing installed contract: got %v, want full reference %q", err, ref)
	}
	t.Log("installed Gru contract resolved; removing it produced the full-path dangling-reference diagnostic")
}

// Compare against the STARK-5065 extractor over BOTH committed plugin formats.
// Keep this measurement reproducible without an ad-hoc script. Differences are
// logged for review, not rejected: future bodies may use the newly fixed forms.
// Every extracted reference must still resolve in the shipped tree.
func TestCommittedSkillSupportRefCorpus(t *testing.T) {
	old := regexp.MustCompile(`(?:(?:\.\./)+[A-Za-z0-9_.-]+/)?(?:references|scripts|assets)/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*`)
	for _, runtime := range []string{"claude", "codex-plugins"} {
		t.Run(runtime, func(t *testing.T) {
			paths, err := filepath.Glob(filepath.Join(repoRoot(t), "dist", runtime, "*", "skills", "*", "SKILL.md"))
			if err != nil || len(paths) == 0 {
				t.Fatalf("no rendered skills: %v", err)
			}
			refs, skills, differences := 0, 0, 0
			for _, path := range paths {
				data, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				_, body := splitSkillFrontmatter(t, string(data))
				before := old.FindAllString(body, -1)
				for i := range before {
					before[i] = strings.TrimRight(before[i], ".")
				}
				after := skillSupportRefs(body)
				if !slices.Equal(before, after) {
					differences++
					t.Logf("%s: old=%q new=%q", path, before, after)
				}
				if len(after) > 0 {
					skills++
				}
				refs += len(after)
				root := filepath.Dir(filepath.Dir(filepath.Dir(path)))
				roots := map[string]string{"CLAUDE_PLUGIN_ROOT": root, "STARK_PLUGIN_ROOT": root, "STARK_ASSET_ROOT": root}
				for _, ref := range after {
					if err := checkSupportRef(filepath.Dir(path), roots, ref); err != nil {
						t.Errorf("%s: %v", path, err)
					}
				}
			}
			if refs == 0 {
				t.Fatal("support-reference corpus is empty")
			}
			t.Logf("files=%d refs=%d skills=%d old!=new=%d", len(paths), refs, skills, differences)
		})
	}
}
