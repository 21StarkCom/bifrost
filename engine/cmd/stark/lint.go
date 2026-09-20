package main

import (
	"fmt"

	"github.com/21StarkCom/bifrost/engine/internal/load"
	"github.com/21StarkCom/bifrost/engine/internal/validate"
	"github.com/spf13/cobra"
)

// runLint loads a catalog and prints suspicious-pattern findings. By default it is
// informational and returns 0 — preserving the spec §7.4 surfacing-only contract for
// callers that opt out of blocking. Pass strict=true to return a non-zero exit when
// any finding lands; CI uses this to fail-closed on the dangerous patterns
// (curl-pipe-shell, prompt-injection, secret-file-read, base64-blob). Always prints
// LINT-SUMMARY so PR output surfaces the count.
func runLint(catalogDir string, strict bool) int {
	cat, err := load.Load(catalogDir)
	if err != nil {
		fmt.Println("load error:", err)
		// `--strict` is a CI gate, and a gate that could not READ what it scans must not
		// report success — the same "passes by finding nothing to measure" shape as
		// check-bumps' missing baseline (STARK-8161). Exposure in `ci.yml` today is nil
		// only by accident of ordering: `stark validate` runs one step earlier and is
		// fail-closed on this same `load.Load` error. That is step ordering, not a
		// property of this gate, and it does not survive a reordering or a caller
		// outside that workflow (STARK-8165).
		//
		// Non-strict keeps returning 0: spec §7.4 makes that mode explicitly
		// surfacing-only, and a caller that opted out of blocking opted out here too.
		if strict {
			return 2
		}
		return 0
	}
	r := validate.LintBodies(cat)
	for _, w := range r.Warnings {
		fmt.Printf("lint  %s: %s\n", w.Where, w.Msg)
	}
	fmt.Printf("LINT-SUMMARY: %d suspicious-pattern finding(s)\n", len(r.Warnings))
	if strict && len(r.Warnings) > 0 {
		return 2
	}
	return 0
}

func newLintCmd() *cobra.Command {
	var strict bool
	cmd := &cobra.Command{
		Use:   "lint [catalog-dir]",
		Short: "Content scan of artifact bodies (suspicious patterns); use --strict to fail on findings",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := "catalog"
			if len(args) == 1 {
				dir = args[0]
			}
			if code := runLint(dir, strict); code != 0 {
				return fmt.Errorf("lint failed (strict)")
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&strict, "strict", false, "exit non-zero on any finding (CI gate)")
	return cmd
}
