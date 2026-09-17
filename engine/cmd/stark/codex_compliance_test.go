package main

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/21StarkCom/bifrost/engine/internal/indexio"
	"github.com/21StarkCom/bifrost/engine/internal/load"
	"github.com/21StarkCom/bifrost/engine/internal/model"
	"gopkg.in/yaml.v3"
)

// A support reference as the body WRITES it, including a relative prefix that
// leaves the skill's own directory. The optional `(?:\.\./)+<segment>/` head is
// load-bearing: skills in one bundle install side by side under `skills/`, so
// `../gru/references/operations.md` is a correct citation of a sibling's support
// file. Without it the pattern matched only the `references/…` tail, which then
// resolved against the CITING skill's directory and reported a dangling path
// nobody wrote — `stark-ops/minion` failed exactly that way and blocked
// publication (STARK-5065). RE2 returns the leftmost match, so where the prefix
// applies the longer form wins.
//
// The `../` run is REQUIRED before that segment, not optional. A bare
// `<segment>/scripts/…` head would swallow whatever token precedes a skill-local
// path — `$SKILL_DIR/scripts/gha-cost-breakdown.sh` in a shell snippet became
// `SKILL_DIR/scripts/…` and failed a script that is present, trading one false
// dangling report for another (measured against `stark-gha-cost`).
//
// `#` is deliberately outside the class, so a `#anchor` ends the match and never
// reaches os.Stat. Same for the quote/paren that closes a markdown link target.
var skillSupportRefRe = regexp.MustCompile(`(?:(?:\.\./)+[A-Za-z0-9_.-]+/)?(?:references|scripts|assets)/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*`)

// skillSupportRefs returns every support reference in a rendered skill body,
// trimmed of the sentence punctuation that follows a bare path in prose.
func skillSupportRefs(body string) []string {
	refs := skillSupportRefRe.FindAllString(body, -1)
	for i, ref := range refs {
		refs[i] = strings.TrimRight(ref, ".,;:)")
	}
	return refs
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
					if _, err := os.Stat(filepath.Join(filepath.Dir(skillPath), filepath.FromSlash(ref))); err != nil {
						kind := "skill-local"
						if strings.HasPrefix(ref, "../") {
							kind = "cross-skill"
						}
						t.Errorf("dangling %s support reference %q", kind, ref)
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
			// The Codex bundle-asset retarget emits this shape. It resolved
			// skill-locally before and must keep doing so; validating a bundle
			// asset root is out of this check's reach either way.
			name: "a bundle asset root keeps its old skill-local reading",
			body: "${STARK_PLUGIN_ROOT:-x}/../../stark/stark-ops/scripts/helper.sh",
			want: []string{"scripts/helper.sh"},
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
		_, err := os.Stat(filepath.Join(skillDir, filepath.FromSlash(ref)))
		return err == nil
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
	// A sibling reference whose target is genuinely absent must still fail.
	if resolves("../gru/references/missing.md") {
		t.Error("a genuinely dangling sibling reference resolved")
	}
}
