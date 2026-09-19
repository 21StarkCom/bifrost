// Package help renders a plain CLI help string in the shared 21Stark fleet look.
//
// The help TEXT stays in each command as a plain string (readable source; the
// wording is the contract). This package adds color and column-fitting at print
// time only, from a line-based rule set — the first matching rule wins:
//
//  1. Line 0 — the title, unless it is itself a usage line (rule 2 wins
//     there). "name — tagline" splits into a bold-cyan name and a plain
//     tagline; any other first line is bold as a whole.
//  2. A "Usage:" line (case-insensitive) — the label is bold magenta, the
//     invocation stays plain, so grep-style substring checks still match.
//  3. A non-indented line ending in ":" — a section heading, bold magenta.
//  4. Bullet icons ("•", "›", "!") and their bold label are blue; "!" is yellow.
//  5. A two-space-indented item row ("  <name>␣␣<desc>") — the name is split off
//     at the first run of 2+ spaces. Commands are cyan, flags green, argument
//     placeholders yellow, and quoted example values bright blue. A trailing
//     COUNT at the END of the description renders dim, as does a tag the
//     consumer named in Options.MutedTags. Nothing else does — see isMarker.
//  6. Prose. Lines in an examples section that start with the binary name get
//     the same syntax colors; every other line keeps normal contrast with
//     inline flags in green.
//
// The Go implementation is a 1:1 twin of the TypeScript one in ts/src/help
// (idun's original). Parity is by shared design and a shared fixture, not
// shared code — see docs/specs/2026-09-19-help-render-conformance.md.
//
// A disabled palette with no column budget is an exact identity transform:
// Render(raw, Options{Colors: colors.New(false)}) == raw, byte for byte. That
// test-pinned equivalence guarantees rendering never mutates help text.
//
// Stdlib only, per the go/ module's zero-dependency invariant.
package help
