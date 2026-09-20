package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// The actual tree supplies flags and validators; every operational hook becomes
// a tripwire. Thus a nonempty successful response cannot disguise real work.
func TestPositionalHelpBeforeBackend(t *testing.T) {
	for _, route := range walk(newRootCmd()) {
		if !route.Runnable() || route.Name() == "help" || route.Name() == "search" {
			continue
		}
		path := strings.Fields(route.CommandPath())[1:]
		cases := [][]string{{"help"}, {"help", "--help=false"}, {"--help=false", "help"}, {"other", "help"}}
		route.Flags().VisitAll(func(f *pflag.Flag) {
			if f.Name == "help" {
				return
			}
			value := "fixture"
			if f.Value.Type() == "bool" {
				value = "true"
			}
			flag := "--" + f.Name + "=" + value
			cases = append(cases, []string{flag, "help"}, []string{"help", flag})
		})
		for _, args := range cases {
			t.Run(strings.Join(append(append([]string{}, path...), args...), " "), func(t *testing.T) {
				root := newRootCmd()
				for _, c := range walk(root) {
					if c.Runnable() {
						c.Run = nil
						c.RunE = func(*cobra.Command, []string) error { t.Fatal("backend ran"); return nil }
						c.PreRunE = func(*cobra.Command, []string) error { t.Fatal("pre-run ran"); return nil }
					}
				}
				var out bytes.Buffer
				root.SetOut(&out)
				root.SetErr(&out)
				root.SetArgs(append(append([]string{}, path...), args...))
				if err := root.Execute(); err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(out.String(), "Usage:") || !strings.Contains(out.String(), route.CommandPath()) {
					t.Fatalf("not route help: %s", out.String())
				}
			})
		}
	}
}

func TestPositionalHelpBoundaries(t *testing.T) {
	for _, tc := range []struct {
		args               []string
		wantError, wantRun bool
	}{
		{[]string{"build", "help", "--unknown"}, true, false},
		{[]string{"build", "--unknown", "help"}, true, false},
		{[]string{"sync", "help", "--from"}, true, false},
		{[]string{"install", "help", "--plan=invalid"}, true, false},
		{[]string{"sync", "--from", "help"}, false, true},
		{[]string{"sync", "--from=help"}, false, true},
		{[]string{"build", "--", "help"}, false, true},
		{[]string{"build", "./help"}, false, true},
		{[]string{"search", "help", "--json"}, false, true},
		{[]string{"search", "--json", "help"}, false, true},
	} {
		t.Run(strings.Join(tc.args, " "), func(t *testing.T) {
			root := newRootCmd()
			ran := false
			c, _, err := root.Find(tc.args)
			if err != nil {
				t.Fatal(err)
			}
			c.Run = nil
			c.RunE = func(*cobra.Command, []string) error { ran = true; return nil }
			var out bytes.Buffer
			root.SetOut(&out)
			root.SetErr(&out)
			root.SetArgs(tc.args)
			err = root.Execute()
			if (err != nil) != tc.wantError || ran != tc.wantRun {
				t.Fatalf("err=%v ran=%v output=%s", err, ran, out.String())
			}
		})
	}
}

func snapshotHelpFixture(t *testing.T, root string) map[string]string {
	t.Helper()
	result := map[string]string{}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		if d.IsDir() {
			result[rel] = "dir"
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		result[rel] = fmt.Sprintf("%x", sha256.Sum256(b))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

// Build the shipping main and execute it and all four owned shell entrypoints
// with an empty environment, isolated home/cwd, and subprocess tripwires.
func TestBuiltEntrypointHelpSafety(t *testing.T) {
	bin := filepath.Join(t.TempDir(), "stark")
	build := exec.Command("go", "build", "-o", bin, ".")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	traps := filepath.Join(t.TempDir(), "bin")
	if err := os.Mkdir(traps, 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"git", "go", "node", "cosign", "dirname", "sed", "perl", "jq", "mktemp", "gitleaks", "actionlint", "curl"} {
		if err := os.WriteFile(filepath.Join(traps, name), []byte("#!/bin/sh\nprintf tripwire >> \"$HOME/trips\"\nexit 97\n"), 0755); err != nil {
			t.Fatal(err)
		}
	}
	// Real content called help catches accidental path reads; a valid manifest
	// would reach cosign if verify-manifest swallowed it.
	if err := os.WriteFile(filepath.Join(root, "help"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	before := snapshotHelpFixture(t, root)
	count := 0
	run := func(executable string, args []string, wantHelp bool) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, executable, args...)
		cmd.Dir = root
		cmd.Env = []string{"HOME=" + root, "PATH=" + traps, "NO_COLOR=1", "TERM=dumb"}
		out, err := cmd.CombinedOutput()
		if wantHelp {
			if err != nil || !bytes.Contains(out, []byte("Usage:")) {
				t.Fatalf("%s %v: %v\n%s", executable, args, err, out)
			}
		} else if err == nil || bytes.Contains(out, []byte("Usage:")) {
			t.Fatalf("expected refusal: %s %v: %v\n%s", executable, args, err, out)
		}
		if got := snapshotHelpFixture(t, root); !reflect.DeepEqual(before, got) {
			t.Fatalf("filesystem/backend effect: %s %v: %v", executable, args, got)
		}
		count++
	}
	for _, c := range walk(newRootCmd()) {
		if c.Name() == "search" || c.Name() == "help" {
			continue
		}
		path := strings.Fields(c.CommandPath())[1:]
		for _, tail := range [][]string{{"help"}, {"--help=false", "help"}, {"help", "--help=false"}} {
			run(bin, append(append([]string{}, path...), tail...), true)
		}
		if c.Runnable() {
			run(bin, append(append([]string{}, path...), "help", "--unknown"), false)
		}
	}
	for _, args := range [][]string{
		{"install", "--repair", "help", "--plan", "--yes"},
		{"install", "--remove", "missing.json", "help", "--force"},
		{"sync", "--from", "missing", "help", "--check"},
		{"import", "--from", "missing", "help", "--dry-run"},
		{"build", "--fix", "help", "--check"},
	} {
		run(bin, args, true)
	}
	for _, args := range [][]string{{"sync", "help", "--from"}, {"install", "help", "--plan=bad"}, {"build", "--unknown", "help"}} {
		run(bin, args, false)
	}
	for _, name := range []string{"ci-local", "coverage-gate", "publish", "verify-native-install"} {
		script, err := filepath.Abs(filepath.Join("..", "..", "..", "docs", "scripts", name+".sh"))
		if err != nil {
			t.Fatal(err)
		}
		for _, arg := range []string{"help", "-h", "--help"} {
			run(bash, []string{script, arg}, true)
		}
		run(bash, []string{script, "help", "--unknown"}, false)
		run(bash, []string{script, "--unknown", "help"}, false)
		if name == "publish" {
			for _, args := range [][]string{{"--ci", "help"}, {"help", "--ci"}, {"--bundle", "help", "help", "--ci"}} {
				run(bash, append([]string{script}, args...), true)
			}
			for _, args := range [][]string{{"help", "--bundle"}, {"--add-skill", "--ci", "help"}} {
				run(bash, append([]string{script}, args...), false)
			}
		}
	}
	t.Logf("PASS: %d built CLI/script invocations; zero subprocess trips or fixture changes", count)
}
