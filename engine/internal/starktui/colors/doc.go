// Package colors provides zero-dependency ANSI SGR styling (stdlib only).
//
// It ports the picocolors formatter, nesting-restore and 16-color SGR table,
// layered with the ansis precedence ladder (FORCE_COLOR > flags > NO_COLOR >
// auto), ansis's newline re-wrap, and ansis's hexToRgb for optional truecolor.
//
// API is a flat function-map: package-level funcs bound to the detected palette
// (colors.Red(s), colors.Bold(s), colors.Hex("#ff8800", s)), plus New(enabled)
// for an explicit palette that tests drive without touching a real TTY.
//
// A disabled palette makes every function the identity, so NO_COLOR and non-TTY
// output is plain. TTY detection is os.File.Stat + os.ModeCharDevice — no
// golang.org/x/term.
package colors
