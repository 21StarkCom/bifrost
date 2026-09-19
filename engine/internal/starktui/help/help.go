package help

import (
	"os"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/21StarkCom/bifrost/engine/internal/starktui/colors"
)

// Palette names the roles the help rules paint, so a consumer can reuse the
// exact same tones outside a rendered help page (an error hint, a completion
// listing) instead of re-deriving them from the raw palette.
type Palette struct {
	Title    func(string) string // the binary name on the title line
	Heading  func(string) string // "Usage:" and every section heading
	Command  func(string) string // a subcommand / verb name, and example prose
	Flag     func(string) string // --flag / -f, inline and in item names
	Arg      func(string) string // <placeholder> and BARE_CONSTANTS
	Value    func(string) string // a quoted example value
	Bullet   func(string) string // the • / › bullet and its label
	Warning  func(string) string // the ! bullet and its label
	Emphasis func(string) string // bold, for a title with no tagline
	Muted    func(string) string // a trailing (count) / (tag) marker on an item row
}

// NewPalette maps the fleet help roles onto a colors palette. A disabled palette
// makes every role the identity.
func NewPalette(c colors.Colors) Palette {
	if c.Bold == nil { // the zero Colors value is a disabled palette, not a panic
		c = colors.New(false)
	}
	bold := c.Bold
	return Palette{
		Title:    func(s string) string { return bold(c.Cyan(s)) },
		Heading:  func(s string) string { return bold(c.Magenta(s)) },
		Command:  c.Cyan,
		Flag:     c.Green,
		Arg:      c.Yellow,
		Value:    c.BlueBright,
		Bullet:   c.BlueBright,
		Warning:  c.Yellow,
		Emphasis: bold,
		Muted:    c.Gray,
	}
}

// Options configures a render.
type Options struct {
	// Colors is the palette to paint with. The zero value is a disabled palette
	// (plain text), so a caller that forgets to set it never sprays ANSI.
	Colors colors.Colors
	// Columns is the width to fit to. Zero (the default) keeps the authored
	// layout verbatim — no reflow at all.
	Columns int
	// Binary is the command name that marks an example line in an examples
	// section (e.g. "frigg"). Empty means: infer it from the title or usage line.
	Binary string
	// MutedTags are the exact tag texts a consumer wants dimmed on top of the
	// default (a trailing COUNT). Give the inner text without the parentheses —
	// {"TUI", "creds-free"} dims "(TUI)" and "(creds-free)". A named tag is
	// still subject to isMarker's structural guards (no flag, no <>/(){}, at
	// most markerWidth runes), which veto it silently.
	//
	// This is opt-in BY DESIGN. A tag's shape says nothing about its weight:
	// "(TUI)" and "(DELETE)" are indistinguishable to a renderer, and dimming
	// the second would make a destructive verb the faintest row on the page. The
	// consumer knows which of its own tags are metadata; the renderer does not
	// guess.
	MutedTags []string
}

// A 2-space-indented row split into name, the gap, and the description.
var (
	itemRow = regexp.MustCompile(`^( {2})(\S.*?)( {2,})(\S.*)$`)
	bullet  = regexp.MustCompile("^( {2})([•›!]) (.*)$")
	heading = regexp.MustCompile(`^\S.*:\s*$`)
	// An examples section: a non-indented heading whose words include
	// "example"/"examples". The flanking classes spell out JS's \b (word =
	// [0-9A-Za-z_]) so the twin agrees on "3examples:" / "examples2:".
	examplesHeading = regexp.MustCompile(`(?i)(^|[^a-z0-9_])examples?([^a-z0-9_].*)?:\s*$`)
	// Continuation lines that fold into the row above them.
	bulletCont = regexp.MustCompile(`^ {4}\S`)
	itemCont   = regexp.MustCompile(`^ {4,}\S`)
	// An option name preceded by start-of-text or a separator, so a flag inside
	// prose is highlighted without tinting the sentence around it.
	inlineFlag = regexp.MustCompile("(^|[\\s([{'\"`,;|])(--?[a-zA-Z][\\w-]*)")
	// The syntax tokens, in precedence order: double-quoted, single-quoted,
	// flag, <placeholder>, BARE_CONSTANT (word boundaries checked by hand — RE2
	// has no \b).
	syntaxToken = regexp.MustCompile(`("[^"\n]*")|('[^'\n]*')|(--?[a-zA-Z][\w-]*)|(<[^>\n]+>)|([A-Z][A-Z0-9_]*(?:/[A-Z][A-Z0-9_]*)*)`)
)

// Render colorizes and column-fits raw. With a disabled palette and no column
// budget it returns raw unchanged, byte for byte.
func Render(raw string, opt Options) string {
	p := NewPalette(opt.Colors)
	lines := strings.Split(raw, "\n")
	binary := opt.Binary
	if binary == "" {
		binary = inferBinary(lines)
	}
	muted := mutedSet(opt.MutedTags)
	out := make([]string, 0, len(lines))
	examples := false
	for i := 0; i < len(lines); i++ {
		first := i
		line := lines[i]
		if line != "" && !isSpace(line[0]) {
			examples = examplesHeading.MatchString(line)
		}
		// Reflow bullet paragraphs and item descriptions before fitting columns:
		// a continuation line folds into the row it continues. A blank line or a
		// new row always ends the paragraph.
		if opt.Columns > 0 {
			var cont *regexp.Regexp
			switch {
			case bullet.MatchString(line):
				cont = bulletCont
			case itemRow.MatchString(line):
				cont = itemCont
			}
			if cont != nil {
				for i+1 < len(lines) && cont.MatchString(lines[i+1]) {
					i++
					line += " " + strings.TrimLeft(lines[i], " \t")
				}
			}
		}
		out = append(out, colorizeLine(line, first, p, opt.Columns, examples, binary, muted))
	}
	return strings.Join(out, "\n")
}

func colorizeLine(line string, index int, p Palette, columns int, examples bool, binary string, muted map[string]bool) string {
	// 1. Title — unless line 0 IS the usage line (the shape every frigg L3 page
	// has), in which case rule 2 owns it: bolding an invocation whole reads as a
	// title that happens to say "usage".
	if index == 0 && !isUsage(line) {
		if dash := strings.Index(line, " — "); dash != -1 {
			return wrap(p.Title(line[:dash])+line[dash:], columns, "", "")
		}
		return wrap(p.Emphasis(line), columns, "", "")
	}

	// 2. Usage line — paint only the label, so the invocation stays greppable.
	if isUsage(line) {
		return wrap(p.Heading(line[:len(usageLabel)])+line[len(usageLabel):], columns, "", "")
	}

	// 3. Section heading — a non-indented line that ends in a colon.
	if heading.MatchString(line) {
		return wrap(p.Heading(line), columns, "", "")
	}

	// 4. Bullets precede item rows so extra spaces in prose cannot become a gap.
	if m := bullet.FindStringSubmatch(line); m != nil {
		paint := p.Bullet
		if m[2] == "!" {
			paint = p.Warning
		}
		body := inlineFlags(m[3], p)
		if label := leadingLabel(body); label != "" {
			body = p.Emphasis(paint(label)) + body[len(label):]
		}
		return wrap(body, columns, "  "+paint(m[2])+" ", "    ")
	}

	// 5. Item row — colored name + readable description. Stack on narrow screens.
	if m := itemRow.FindStringSubmatch(line); m != nil {
		styledName := syntax(m[2], p)
		description := describe(m[4], p, muted)
		prefix := m[1] + styledName + m[3]
		indent := visibleWidth(prefix)
		if columns > 0 && columns-indent < 24 {
			return wrap(styledName, columns, "  ", "  ") + "\n" + wrap(description, columns, "    ", "    ")
		}
		return wrap(description, columns, prefix, strings.Repeat(" ", indent))
	}

	// 6. Examples / prose — preserve the authored indent when wrapping.
	if strings.TrimSpace(line) == "" {
		return line
	}
	indent := line[:len(line)-len(strings.TrimLeft(line, " "))]
	body := line[len(indent):]
	if examples && binary != "" && strings.HasPrefix(body, binary+" ") {
		return wrap(syntax(body, p), columns, indent, indent)
	}
	return wrap(inlineFlags(body, p), columns, indent, indent)
}

// usageLabel is the rule-2 label. Every slice that splits it off the invocation
// is sized from this, so the label and the offsets cannot drift apart.
const usageLabel = "usage:"

// isUsage reports whether line opens with the usage label. Some CLIs author it
// capitalized and some lowercase; it is the same rule.
func isUsage(line string) bool {
	return len(line) >= len(usageLabel) && strings.EqualFold(line[:len(usageLabel)], usageLabel)
}

// describe styles an item row's description: inline flags in green, and a
// TRAILING parenthetical dimmed when it is METADATA — a count like "(10)", or a
// tag the consumer named in Options.MutedTags — so metadata reads as metadata
// instead of competing with the sentence it follows. Only a trailing marker
// qualifies; a parenthetical mid-sentence is part of the description.
func describe(text string, p Palette, muted map[string]bool) string {
	body, marker := splitTrailingMarker(text, muted)
	if marker == "" {
		return inlineFlags(text, p)
	}
	return inlineFlags(body, p) + p.Muted(marker)
}

// splitTrailingMarker peels a trailing "(...)" group off the end of s, returning
// the body (including the space that separates them) and the marker. It returns
// an empty marker when s does not end in a balanced group, when the group is not
// preceded by a space, when the group IS the whole description, or when the
// group does not look like METADATA (see isMarker) — a trailing
// "(--account accounts/<id>)" is a usage hint whose flag must stay green, not a
// tag to grey out.
func splitTrailingMarker(s string, muted map[string]bool) (body, marker string) {
	if !strings.HasSuffix(s, ")") {
		return s, ""
	}
	depth := 0
	for i := len(s) - 1; i >= 0; i-- {
		switch s[i] {
		case ')':
			depth++
		case '(':
			depth--
			if depth != 0 {
				continue
			}
			if i == 0 || s[i-1] != ' ' {
				return s, "" // glued to a word, or the whole description
			}
			if !isMarker(s[i:], muted) {
				return s, ""
			}
			return s[:i], s[i:]
		}
	}
	return s, "" // unbalanced
}

// markerWidth caps how long a trailing group may be and still read as a tag.
// Longer than this it is a sentence, and dimming it would hide content. It is a
// RUNE count, not a display width: the TS twin has no stdlib-free East-Asian
// width table to agree with, and a tag is short under either measure — counting
// runes is the one measure both sides can compute identically.
const markerWidth = 20

// isMarker reports whether a trailing parenthetical is METADATA the renderer may
// dim. Two things qualify, and nothing else:
//
//  1. A COUNT — all digits with NO leading zero, like "(10)" or "(45)". A
//     leading zero makes it a file MODE ("(0600)"), which is load-bearing
//     rather than metadata — see isCount.
//  2. A tag the CONSUMER named in Options.MutedTags, matched exactly.
//
// Anything else keeps full contrast. An earlier version dimmed any short
// trailing group, which inverted the emphasis on real help pages: "(TUI)" and
// "(creds-free)" are shaped exactly like "(DELETE)", "(WRITE)", "(required)",
// "(read-only)" and "(may return PII)", so dimming the first pair dimmed a
// destructive verb's warning too. Shape does not carry weight — the consumer
// knows which of its own tags are metadata, so it says so.
//
// The structural guards still apply on top — including OVER an explicit
// MutedTags entry, which they veto silently: a group carrying a flag or a
// <placeholder>, or wider than markerWidth, is a usage hint whatever its text.
func isMarker(group string, muted map[string]bool) bool {
	inner := strings.TrimSuffix(strings.TrimPrefix(group, "("), ")")
	if strings.TrimSpace(inner) == "" || visibleWidth(group) > markerWidth {
		return false
	}
	if strings.ContainsAny(inner, "<>(){}") {
		return false
	}
	// A flag stays green: reject exactly what inlineFlags would have painted,
	// using its own pattern. A hand-rolled word scan misses a flag introduced by
	// any of the other separators inlineFlag accepts — "('--json' only)",
	// "(see [--json])", "(a,--json)" — and would grey the flag out.
	if inlineFlag.MatchString(group) {
		return false
	}
	return isCount(inner) || muted[inner]
}

// isCount reports whether inner is a bare run of decimal digits with NO leading
// zero — "45" is a count, "0600" is not. A multi-digit run starting with '0' is
// a file MODE, and a mode is load-bearing: frigg writes `-o FILE (0600)` to
// promise that secret-bearing output lands in a 0600 file rather than on
// stdout, so dimming it is the same emphasis inversion the muted-tag narrowing
// exists to prevent. "0" itself is still a count.
//
// The empty string is NOT one: the TS twin spells this as /^(0|[1-9][0-9]*)$/,
// which requires at least one digit, and an empty-loop "true" here would dim
// "()" in Go and leave it bright in TS the moment the whitespace guard above
// moved or went away.
func isCount(inner string) bool {
	if inner == "" {
		return false
	}
	for _, r := range inner {
		if r < '0' || r > '9' {
			return false
		}
	}
	// Every rune is an ASCII digit by here, so len is the DIGIT count — byte and
	// rune measures coincide and the leading-zero test cannot be fooled by a
	// multi-byte rune.
	return len(inner) == 1 || inner[0] != '0'
}

// mutedSet indexes Options.MutedTags for lookup. A nil/empty list means only a
// count is dimmed.
func mutedSet(tags []string) map[string]bool {
	if len(tags) == 0 {
		return nil
	}
	m := make(map[string]bool, len(tags))
	for _, t := range tags {
		m[t] = true
	}
	return m
}

// leadingLabel returns the "Label:" prefix of a bullet body, or "" when the body
// does not open with one (mirrors /^([^:]+:)/).
func leadingLabel(body string) string {
	i := strings.IndexByte(body, ':')
	if i <= 0 {
		return ""
	}
	return body[:i+1]
}

// inlineFlags highlights option names in prose without tinting the explanation
// around them.
func inlineFlags(text string, p Palette) string {
	return replaceAllSubmatch(inlineFlag, text, func(groups []string) string {
		return groups[1] + p.Flag(groups[2])
	})
}

// syntax styles authored command syntax: the connective text is the command
// tone, with flags, placeholders and quoted values picked out.
func syntax(text string, p Palette) string {
	var b strings.Builder
	plain := 0 // start of the pending run of un-tokenized text
	for pos := 0; pos <= len(text); {
		loc := syntaxToken.FindStringSubmatchIndex(text[pos:])
		if loc == nil {
			break
		}
		start, end := pos+loc[0], pos+loc[1]
		// Group 5 (a BARE_CONSTANT) stands in for JS's \b…\b, which RE2 lacks:
		// check both edges by hand. A bad TRAILING edge is what a backtracking
		// engine retries — the token's only shorter shapes drop whole "/SEGMENT"
		// groups — so shrink first; only when no shape fits does the scan resume
		// one rune in, exactly where JS would try next.
		if loc[10] != -1 && !wordBounded(text, start, end) {
			cut, ok := shrinkBareConstant(text, start, end)
			if !ok {
				_, size := utf8.DecodeRuneInString(text[start:])
				pos = start + size
				continue
			}
			end = cut
		}
		if start > plain {
			b.WriteString(p.Command(text[plain:start]))
		}
		tok := text[start:end]
		switch {
		case loc[2] != -1 || loc[4] != -1:
			b.WriteString(p.Value(tok))
		case loc[6] != -1:
			b.WriteString(p.Flag(tok))
		default:
			b.WriteString(p.Arg(tok))
		}
		plain, pos = end, end
	}
	if plain < len(text) {
		b.WriteString(p.Command(text[plain:]))
	}
	return b.String()
}

// shrinkBareConstant emulates the backtracking JS does when the trailing \b of a
// BARE_CONSTANT fails. "A/Bs" cannot match whole (the 's' kills the boundary),
// but dropping the "/B" group leaves "A" ending on a '/' — a real boundary — so
// JS paints "A". A bad LEADING edge admits no shape at all.
func shrinkBareConstant(text string, start, end int) (int, bool) {
	if start > 0 && isWordByte(text[start-1]) {
		return 0, false
	}
	slash := strings.LastIndexByte(text[start:end], '/')
	if slash <= 0 {
		return 0, false
	}
	return start + slash, true // text[end] is now '/', never a word byte
}

// wordBounded reports whether text[start:end] is flanked by non-word characters
// (JS \b semantics, word = [0-9A-Za-z_]).
func wordBounded(text string, start, end int) bool {
	if start > 0 && isWordByte(text[start-1]) {
		return false
	}
	if end < len(text) && isWordByte(text[end]) {
		return false
	}
	return true
}

func isWordByte(b byte) bool {
	return b == '_' || (b >= '0' && b <= '9') || (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

func isSpace(b byte) bool { return b == ' ' || b == '\t' }

// replaceAllSubmatch is ReplaceAllStringFunc with the submatches in hand.
func replaceAllSubmatch(re *regexp.Regexp, s string, fn func(groups []string) string) string {
	matches := re.FindAllStringSubmatchIndex(s, -1)
	if matches == nil {
		return s
	}
	var b strings.Builder
	last := 0
	for _, m := range matches {
		groups := make([]string, len(m)/2)
		for i := range groups {
			if m[2*i] >= 0 {
				groups[i] = s[m[2*i]:m[2*i+1]]
			}
		}
		b.WriteString(s[last:m[0]])
		b.WriteString(fn(groups))
		last = m[1]
	}
	b.WriteString(s[last:])
	return b.String()
}

// inferBinary picks the command name that marks an example line: the first word
// of a "name — tagline" title, else the first word after a "usage:" label.
func inferBinary(lines []string) string {
	if len(lines) == 0 {
		return ""
	}
	// A line-0 usage line is a usage line, not a title — the same precedence
	// colorizeLine applies. Reading it as a title would make the binary the
	// literal "usage:" whenever the invocation happens to carry an em dash.
	if dash := strings.Index(lines[0], " — "); dash > 0 && !isUsage(lines[0]) {
		return firstWord(lines[0][:dash])
	}
	for _, line := range lines {
		if isUsage(line) {
			return firstWord(strings.TrimSpace(line[len(usageLabel):]))
		}
	}
	return ""
}

func firstWord(s string) string {
	if i := strings.IndexByte(strings.TrimSpace(s), ' '); i > 0 {
		return strings.TrimSpace(s)[:i]
	}
	return strings.TrimSpace(s)
}

// ColorEnabled reports whether help written to f may be colorized. Unlike the
// colors package's own detector it treats CI as color-OFF: a piped `cmd --help`
// is a byte contract (`export TOKEN=$(cmd user)`), and CI is exactly where that
// piping happens. NO_COLOR and TERM=dumb are the explicit opt-outs. Evaluated
// per call, so a redirected stream is seen correctly.
func ColorEnabled(f *os.File) bool {
	if os.Getenv("NO_COLOR") != "" || os.Getenv("TERM") == "dumb" {
		return false
	}
	return isTerminal(f)
}

// Width returns the column budget for help written to f: 0 off a terminal (no
// reflow — a pipe keeps the authored layout byte for byte, the same contract
// ColorEnabled protects), else COLUMNS when set, else 80. Stdlib only: there is
// no ioctl-free way to ask the terminal, so COLUMNS is the override and 80 the
// floor. Mirrors the TS twin, which reads process.stdout.columns only on a TTY.
func Width(f *os.File) int {
	if !isTerminal(f) {
		return 0
	}
	if n, err := strconv.Atoi(os.Getenv("COLUMNS")); err == nil && n > 0 {
		return n
	}
	return 80
}

func isTerminal(f *os.File) bool {
	if f == nil {
		return false
	}
	fi, err := f.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}

// For returns the Options a CLI should use when writing help to f: the detected
// palette and column budget, with binary as the example-line marker.
func For(f *os.File, binary string) Options {
	return Options{Colors: colors.New(ColorEnabled(f)), Columns: Width(f), Binary: binary}
}
