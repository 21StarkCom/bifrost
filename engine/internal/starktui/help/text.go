package help

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// esc is the byte every ANSI escape sequence opens with.
const esc = 0x1b

// reANSI matches a CSI escape sequence (the only kind the colors package emits),
// so width measurement and wrapping count visible runes, not SGR bytes.
var reANSI = regexp.MustCompile("\x1b\\[[0-9;]*[A-Za-z]")

// visibleWidth returns the printed width of s, ignoring ANSI escapes. Help text
// is ASCII plus a handful of BMP symbols (•, ›, —), all single-width, so a rune
// count is the display width; no East-Asian width table is needed (and none is
// available stdlib-only).
func visibleWidth(s string) int {
	if strings.IndexByte(s, esc) < 0 { // the common case: no escapes to strip
		return utf8.RuneCountInString(s)
	}
	return utf8.RuneCountInString(reANSI.ReplaceAllString(s, ""))
}

// hardChunks splits a single over-long word into width-sized visible chunks,
// carrying ANSI escapes through without counting them.
func hardChunks(word string, width int) []string {
	if width <= 0 || visibleWidth(word) <= width {
		return []string{word}
	}
	var out []string
	var b strings.Builder
	seen := 0
	for i := 0; i < len(word); {
		if word[i] == esc { // only pay for the regex where an escape can start
			if loc := reANSI.FindStringIndex(word[i:]); loc != nil && loc[0] == 0 {
				b.WriteString(word[i : i+loc[1]])
				i += loc[1]
				continue
			}
		}
		r, size := utf8.DecodeRuneInString(word[i:])
		if seen == width {
			out = append(out, b.String())
			b.Reset()
			seen = 0
		}
		b.WriteRune(r)
		seen++
		i += size
	}
	if b.Len() > 0 {
		out = append(out, b.String())
	}
	return out
}

// runs splits s into alternating runs of spaces and non-spaces, so wrapping can
// break on a gap without collapsing the ones it keeps (authored alignment inside
// a line survives a reflow).
func runs(s string) []string {
	var out []string
	start := 0
	for i := 1; i <= len(s); i++ {
		if i == len(s) || (s[i] == ' ') != (s[start] == ' ') {
			out = append(out, s[start:i])
			start = i
		}
	}
	return out
}

// wrapText greedily wraps s to width columns, breaking on spaces and hard-
// breaking any single word that cannot fit. ANSI escapes never consume width; a
// run of spaces inside a line is preserved verbatim, and the run a break lands
// on is dropped (it would otherwise indent the continuation).
func wrapText(s string, width int) string {
	if width <= 0 || visibleWidth(s) <= width {
		return s
	}
	var lines []string
	cur := ""
	curW := 0
	gap := "" // the pending run of spaces, committed only if the next word fits
	push := func() {
		if cur != "" {
			lines = append(lines, cur)
		}
		cur, curW, gap = "", 0, ""
	}
	// place appends word to the current line, hard-breaking it when it cannot fit
	// on a line of its own.
	place := func(word string) {
		chunks := hardChunks(word, width)
		for i, c := range chunks {
			cur, curW = c, visibleWidth(c)
			if i < len(chunks)-1 {
				lines = append(lines, cur)
				cur, curW = "", 0
			}
		}
		gap = ""
	}
	for _, run := range runs(s) {
		if run[0] == ' ' {
			if cur != "" { // a gap at the head of a line is a break artifact
				gap = run
			}
			continue
		}
		w := visibleWidth(run)
		switch {
		case cur == "":
			place(run)
		case curW+visibleWidth(gap)+w <= width:
			cur += gap + run
			curW += visibleWidth(gap) + w
			gap = ""
		default:
			push()
			place(run)
		}
	}
	push()
	if len(lines) == 0 {
		return s
	}
	return strings.Join(lines, "\n")
}

// wrap lays text out with a hanging indent: the first line carries prefix, every
// continuation line is indented to continuation's width. A zero columns budget
// disables wrapping entirely (the authored layout is kept verbatim).
func wrap(text string, columns int, prefix, continuation string) string {
	if columns <= 0 {
		return prefix + text
	}
	if visibleWidth(prefix+text) <= columns {
		return prefix + text
	}
	if visibleWidth(prefix) >= columns {
		return strings.Join(balanceSGR(strings.Split(wrapText(prefix+text, columns), "\n")), "\n")
	}
	indent := visibleWidth(continuation)
	if indent > columns-1 {
		indent = columns - 1
	}
	if indent < 0 {
		indent = 0
	}
	budget := columns - indent
	if budget < 1 {
		budget = 1
	}
	parts := balanceSGR(strings.Split(wrapText(text, budget), "\n"))
	for i := range parts {
		if i == 0 {
			parts[i] = prefix + parts[i]
			continue
		}
		parts[i] = strings.Repeat(" ", indent) + parts[i]
	}
	return strings.Join(parts, "\n")
}

// sgrCloseOf maps the SGR attributes the colors package opens to their closing
// code. Colors (30-37/90-97, 38;2;…) close with 39, backgrounds with 49.
var sgrCloseOf = map[string]string{
	"1": "22", "2": "22", "3": "23", "4": "24", "7": "27", "8": "28", "9": "29",
}

// closeFor returns the code that closes the SGR body, or "" when the body is not
// an opening attribute (a close code, a reset, or something untracked).
func closeFor(body string) string {
	if c, ok := sgrCloseOf[body]; ok {
		return c
	}
	if strings.HasPrefix(body, "38;") {
		return "39"
	}
	if strings.HasPrefix(body, "48;") {
		return "49"
	}
	n, err := strconv.Atoi(body)
	if err != nil {
		return ""
	}
	switch {
	case (n >= 30 && n <= 37) || (n >= 90 && n <= 97):
		return "39"
	case (n >= 40 && n <= 47) || (n >= 100 && n <= 107):
		return "49"
	}
	return ""
}

// sgrResets are the codes that close an attribute rather than open one.
var sgrResets = map[string]bool{
	"22": true, "23": true, "24": true, "27": true, "28": true, "29": true,
	"39": true, "49": true,
}

// sgrOpen returns the SGR sequences still in effect at the end of line.
func sgrOpen(line string) []string {
	if strings.IndexByte(line, esc) < 0 {
		return nil
	}
	var open []string
	for _, loc := range reANSI.FindAllStringIndex(line, -1) {
		seq := line[loc[0]:loc[1]]
		if seq[len(seq)-1] != 'm' { // a cursor move, not a style
			continue
		}
		body := seq[2 : len(seq)-1]
		switch {
		case body == "" || body == "0": // reset clears everything
			open = nil
		case sgrResets[body]:
			kept := open[:0]
			for _, s := range open {
				if closeFor(s[2:len(s)-1]) != body {
					kept = append(kept, s)
				}
			}
			open = kept
		case closeFor(body) != "":
			open = append(open, seq)
		}
	}
	return open
}

// balanceSGR closes every style still open at a line break and reopens it on the
// next line, so a wrapped span never bleeds across the break (and a hanging
// indent stays unpainted). Same rule the colors package applies to a multiline
// string, and the one Bun's wrapAnsi gives the TS twin.
func balanceSGR(lines []string) []string {
	if len(lines) < 2 {
		return lines
	}
	var carry []string
	for i := range lines {
		if len(carry) > 0 {
			lines[i] = strings.Join(carry, "") + lines[i]
		}
		carry = sgrOpen(lines[i])
		if i < len(lines)-1 && len(carry) > 0 {
			var b strings.Builder
			for j := len(carry) - 1; j >= 0; j-- {
				b.WriteString("\x1b[" + closeFor(carry[j][2:len(carry[j])-1]) + "m")
			}
			lines[i] += b.String()
		}
	}
	return lines
}
