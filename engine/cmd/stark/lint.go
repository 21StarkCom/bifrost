package main

import (
	"fmt"

	"github.com/21StarkCom/bifrost/engine/internal/load"
	"github.com/21StarkCom/bifrost/engine/internal/validate"
	"github.com/spf13/cobra"
)

// runLint loads a catalog and prints suspicious-pattern findings. By default it is
// informational and returns 0 — plain `lint` is surfacing-only by its own contract
// (the `--strict` flag is what opts into blocking; pinned by TestLintDefaultExitsZero).
// Pass strict=true to return a non-zero exit when any finding lands; CI uses this to
// fail-closed on the dangerous patterns (curl-pipe-shell, prompt-injection,
// secret-file-read, base64-blob).
//
// LINT-SUMMARY is printed whenever a scan actually ran, so PR output surfaces the count.
// It is deliberately NOT printed when the catalog could not be read: a "0 finding(s)"
// line over an unread catalog measures nothing (pinned by
// TestLintStrictRefusesACatalogItCannotRead).
func runLint(catalogDir string, strict bool) int {
	cat, err := load.Load(catalogDir)
	if err != nil {
		fmt.Println("load error:", err)
		// `--strict` is a CI gate, and a gate that could not READ what it scans must not
		// report success — the same "passes by finding nothing to measure" shape as
		// check-bumps' missing baseline (STARK-8161). Exposure in `ci.yml` today is nil
		// only by accident of ordering: `validate`, `build --check` and `check-bumps` all
		// run earlier in the same job over this same `load.Load` and all three are
		// fail-closed. That is step ordering, not a property of this gate, and it does
		// not survive a reordering or a caller outside that workflow (STARK-8165).
		//
		// ExitValidation, not the 2 returned for findings below: spec §9.8 reserves 2 for
		// drift, and every other `load.Load` caller in this binary — validate, build,
		// check-bumps, sync — reports this exact failure as 1.
		//
		// Non-strict keeps returning 0: a caller that opted out of blocking opted out
		// here too (pinned by TestLintNonStrictStillExitsZeroOnALoadError).
		if strict {
			return ExitValidation
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
			// Two different failures reach here now, and they need different words:
			// "lint failed (strict)" sent an operator hunting for suspicious-pattern
			// findings when the real cause was a catalog that would not parse.
			switch runLint(dir, strict) {
			case 0:
				return nil
			case ExitValidation:
				return fmt.Errorf("lint --strict: catalog could not be read (see load error above)")
			default:
				return fmt.Errorf("lint failed (strict)")
			}
		},
	}
	cmd.Flags().BoolVar(&strict, "strict", false, "exit non-zero on any finding (CI gate)")
	return cmd
}
