package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDoctorNodeRuntimeFloor(t *testing.T) {
	for _, tc := range []struct {
		version string
		allowed bool
	}{{"v22.6.0", false}, {"v22.18.0", false}, {"v23.11.0", false}, {"v24.0.0", true}, {"v26.8.2", true}} {
		t.Run(tc.version, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, "node"), []byte("#!/bin/sh\nprintf '%s\\n' '"+tc.version+"'\n"), 0755); err != nil {
				t.Fatal(err)
			}
			t.Setenv("PATH", dir)
			ok, broken := nodeVersionCheck()
			if (broken == "") != tc.allowed || (ok != "") != tc.allowed {
				t.Fatalf("allowed=%v: ok=%q broken=%q", tc.allowed, ok, broken)
			}
			if !strings.Contains(ok+broken, "24.0") {
				t.Fatalf("missing supported floor: %s%s", ok, broken)
			}
		})
	}
}
