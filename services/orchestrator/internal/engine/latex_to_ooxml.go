package engine

import (
	"archive/zip"
	"bytes"
	"fmt"
	"regexp"
	"strings"
)

// ═══════════════════════════════════════════════════════════════
// Parsed document model — generic, not tied to any template
// ═══════════════════════════════════════════════════════════════

type elemKind int

const (
	kindParagraph elemKind = iota
	kindSection
	kindSubsection
	kindSubsubsection
	kindParagraphHead // \paragraph{...}
	kindMathBlock
	kindItemize
	kindEnumerate
	kindDescription
	kindVerbatim
	kindTheorem
	kindTable
	kindHRule       // horizontal rule
	kindCenter      // centered block
	kindFlushLeft   // left-aligned block
	kindFlushRight  // right-aligned block
	kindQuote       // quote/quotation
	kindMinipage    // minipage
	kindPageBreak   // \newpage / \clearpage
	kindVSpace      // vertical spacing
	kindFigure      // figure environment
)

type fmtRun struct {
	Text      string
	Bold      bool
	Italic    bool
	Mono      bool
	SmallCaps bool
	FontSize  int // in half-points (0 = default)
	Underline bool
	IsMath    bool // inline math — render as OMML
}

type descItem struct {
	Label []fmtRun
	Body  []fmtRun
}

type bodyElem struct {
	Kind      elemKind
	Title     string       // for sections, theorems, figures
	Runs      []fmtRun     // for paragraphs, theorem content
	Items     [][]fmtRun   // for itemize/enumerate
	DescItems []descItem   // for description lists
	Lines     []string     // for verbatim, math blocks, tables
	Children  []bodyElem   // for nested content (center, minipage, etc.)
	Width     string       // for minipage width, hrule width
	Height    string       // for hrule height, vspace
}

type parsedDoc struct {
	Title    string
	Authors  []string
	Date     string
	Abstract string
	Body     []bodyElem
}

// ═══════════════════════════════════════════════════════════════
// Regex helpers
// ═══════════════════════════════════════════════════════════════

var (
	reSection       = regexp.MustCompile(`^\\section\*?\{((?:[^{}]|\{[^{}]*\})*)\}`)
	reSubsection    = regexp.MustCompile(`^\\subsection\*?\{((?:[^{}]|\{[^{}]*\})*)\}`)
	reSubsubsection = regexp.MustCompile(`^\\subsubsection\*?\{((?:[^{}]|\{[^{}]*\})*)\}`)
	reParagraphCmd  = regexp.MustCompile(`^\\paragraph\*?\{((?:[^{}]|\{[^{}]*\})*)\}`)
	reBold          = regexp.MustCompile(`\\textbf\{((?:[^{}]|\{[^{}]*\})*)\}`)
	reItalic        = regexp.MustCompile(`\\textit\{((?:[^{}]|\{[^{}]*\})*)\}`)
	reEmph          = regexp.MustCompile(`\\emph\{((?:[^{}]|\{[^{}]*\})*)\}`)
	reSmallCaps     = regexp.MustCompile(`\\textsc\{((?:[^{}]|\{[^{}]*\})*)\}`)
	reUnderline     = regexp.MustCompile(`\\underline\{((?:[^{}]|\{[^{}]*\})*)\}`)
	reTexttt        = regexp.MustCompile(`\\texttt\{((?:[^{}]|\{[^{}]*\})*)\}`)
	reInlineMath    = regexp.MustCompile(`\$([^$]+)\$`)
	reLabel         = regexp.MustCompile(`\\label\{[^}]*\}`)
	reRef           = regexp.MustCompile(`\\(?:eq)?ref\{[^}]*\}`)
	reCite          = regexp.MustCompile(`\\(?:cite|citep|citet)\{[^}]*\}`)
	reLaTeX         = regexp.MustCompile(`\\LaTeX\b\{?\}?`)
	reNewtheorem    = regexp.MustCompile(`^\\newtheorem`)
	reTheoremBegin  = regexp.MustCompile(`^\\begin\{(theorem|lemma|definition|corollary|proposition|remark|proof|example|claim|conjecture)\}(?:\[([^\]]*)\])?`)
	reTableBegin    = regexp.MustCompile(`^\\begin\{(?:tabular|tabularx|tabulary|longtable)\}`)
	reTableEnd      = regexp.MustCompile(`^\\end\{(?:tabular|tabularx|tabulary|longtable)\}`)
	reCaption       = regexp.MustCompile(`\\caption\{((?:[^{}]|\{[^{}]*\})*)\}`)
	reMaketitle     = regexp.MustCompile(`^\\maketitle`)
	reBibStyle      = regexp.MustCompile(`^\\bibliographystyle`)
	reBibliography  = regexp.MustCompile(`^\\bibliography`)
	reVSpace        = regexp.MustCompile(`^\\vspace\*?\{([^}]*)\}`)
	reRule          = regexp.MustCompile(`^\\rule\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}\s*\{([^}]*)\}`)
	reNewCommand    = regexp.MustCompile(`\\(?:new|renew|provide)command\*?\s*\{?\\([a-zA-Z@]+)\}?\s*(?:\[(\d)\])?\s*(?:\[[^\]]*\])?\s*\{`)
	reDef           = regexp.MustCompile(`\\def\\([a-zA-Z@]+)\s*(?:#\d)*\s*\{`)
)

// ═══════════════════════════════════════════════════════════════
// Macro expansion
// ═══════════════════════════════════════════════════════════════

type macroDef struct {
	name  string
	nargs int
	body  string
}

// extractBraceGroup returns the content between balanced braces starting at pos.
func extractBraceGroupGo(text string, pos int) (string, int, bool) {
	if pos >= len(text) || text[pos] != '{' {
		return "", pos, false
	}
	depth := 1
	i := pos + 1
	for i < len(text) && depth > 0 {
		if text[i] == '\\' && i+1 < len(text) {
			i += 2
			continue
		}
		if text[i] == '{' {
			depth++
		}
		if text[i] == '}' {
			depth--
		}
		i++
	}
	if depth != 0 {
		return "", pos, false
	}
	return text[pos+1 : i-1], i, true
}

func parseMacros(source string) (map[string]*macroDef, string) {
	macros := make(map[string]*macroDef)
	type removal struct{ start, end int }
	var removals []removal

	// \newcommand / \renewcommand / \providecommand
	for _, loc := range reNewCommand.FindAllStringIndex(source, -1) {
		m := reNewCommand.FindStringSubmatch(source[loc[0]:])
		if m == nil {
			continue
		}
		name := m[1]
		nargs := 0
		if m[2] != "" {
			fmt.Sscanf(m[2], "%d", &nargs)
		}
		bodyStart := loc[0] + len(m[0]) - 1
		body, end, ok := extractBraceGroupGo(source, bodyStart)
		if ok {
			macros[name] = &macroDef{name: name, nargs: nargs, body: body}
			removals = append(removals, removal{loc[0], end})
		}
	}

	// \def\name{body}
	for _, loc := range reDef.FindAllStringIndex(source, -1) {
		m := reDef.FindStringSubmatch(source[loc[0]:])
		if m == nil {
			continue
		}
		name := m[1]
		if _, exists := macros[name]; exists {
			continue
		}
		bodyStart := loc[0] + len(m[0]) - 1
		body, end, ok := extractBraceGroupGo(source, bodyStart)
		if ok {
			maxArg := 0
			for _, am := range regexp.MustCompile(`#(\d)`).FindAllStringSubmatch(body, -1) {
				var n int
				fmt.Sscanf(am[1], "%d", &n)
				if n > maxArg {
					maxArg = n
				}
			}
			macros[name] = &macroDef{name: name, nargs: maxArg, body: body}
			removals = append(removals, removal{loc[0], end})
		}
	}

	// Remove definitions from source (reverse order)
	cleaned := source
	for i := len(removals) - 1; i >= 0; i-- {
		r := removals[i]
		if r.start < len(cleaned) && r.end <= len(cleaned) {
			cleaned = cleaned[:r.start] + cleaned[r.end:]
		}
	}

	return macros, cleaned
}

func expandMacrosGo(text string, macros map[string]*macroDef) string {
	if len(macros) == 0 {
		return text
	}

	for pass := 0; pass < 10; pass++ {
		changed := false
		for name, def := range macros {
			pattern := "\\" + name
			idx := 0
			for {
				loc := strings.Index(text[idx:], pattern)
				if loc == -1 {
					break
				}
				absIdx := idx + loc
				afterCmd := absIdx + len(pattern)
				// Ensure complete command (next char not a letter)
				if afterCmd < len(text) && isLetter(text[afterCmd]) {
					idx = afterCmd
					continue
				}

				replacement := def.body
				endIdx := afterCmd

				if def.nargs > 0 {
					valid := true
					for a := 1; a <= def.nargs; a++ {
						// Skip whitespace
						for endIdx < len(text) && (text[endIdx] == ' ' || text[endIdx] == '\n' || text[endIdx] == '\t') {
							endIdx++
						}
						content, newEnd, ok := extractBraceGroupGo(text, endIdx)
						if ok {
							replacement = strings.ReplaceAll(replacement, fmt.Sprintf("#%d", a), content)
							endIdx = newEnd
						} else {
							valid = false
							break
						}
					}
					if !valid {
						idx = afterCmd
						continue
					}
				}

				text = text[:absIdx] + replacement + text[endIdx:]
				changed = true
				idx = absIdx + len(replacement)
			}
		}
		if !changed {
			break
		}
	}
	return text
}

func isLetter(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || b == '@'
}

// ═══════════════════════════════════════════════════════════════
// Parser
// ═══════════════════════════════════════════════════════════════

func parseLatexDocument(src string) parsedDoc {
	doc := parsedDoc{}

	// Expand macros
	macros, src := parseMacros(src)
	src = expandMacrosGo(src, macros)

	// Extract title (with nested brace support)
	if idx := strings.Index(src, `\title`); idx >= 0 {
		p := idx + len(`\title`)
		// Skip whitespace and optional args
		for p < len(src) && (src[p] == ' ' || src[p] == '\n') {
			p++
		}
		if p < len(src) && src[p] == '[' {
			d := 1
			p++
			for p < len(src) && d > 0 {
				if src[p] == '[' {
					d++
				}
				if src[p] == ']' {
					d--
				}
				p++
			}
			for p < len(src) && (src[p] == ' ' || src[p] == '\n') {
				p++
			}
		}
		if content, _, ok := extractBraceGroupGo(src, p); ok {
			doc.Title = cleanInline(content)
		}
	}

	// Extract authors (generic)
	if idx := strings.Index(src, `\author`); idx >= 0 {
		p := idx + len(`\author`)
		for p < len(src) && (src[p] == ' ' || src[p] == '\n') {
			p++
		}
		if content, _, ok := extractBraceGroupGo(src, p); ok {
			// Try IEEE format first
			ieeeNameRe := regexp.MustCompile(`\\IEEEauthorblockN\{([^}]*)\}`)
			names := ieeeNameRe.FindAllStringSubmatch(content, -1)
			if len(names) > 0 {
				for _, n := range names {
					doc.Authors = append(doc.Authors, strings.TrimSpace(n[1]))
				}
			} else {
				// General format: split on \and
				for _, a := range strings.Split(content, `\and`) {
					cleaned := a
					// Remove \thanks{...}
					cleaned = regexp.MustCompile(`\\thanks\{[^}]*\}`).ReplaceAllString(cleaned, "")
					// Get first line as name (split on \\)
					authorLines := regexp.MustCompile(`\\\\`).Split(cleaned, -1)
					name := authorLines[0]
					name = regexp.MustCompile(`\\[a-zA-Z]+\*?\{([^}]*)\}`).ReplaceAllString(name, "$1")
					name = regexp.MustCompile(`\\[a-zA-Z]+\*?`).ReplaceAllString(name, " ")
					name = strings.NewReplacer("{", "", "}", "").Replace(name)
					name = strings.Join(strings.Fields(name), " ")
					if name != "" {
						doc.Authors = append(doc.Authors, name)
					}
				}
			}
		}
	}

	// Extract date
	if idx := strings.Index(src, `\date{`); idx >= 0 {
		p := idx + len(`\date`)
		if content, _, ok := extractBraceGroupGo(src, p); ok {
			content = strings.TrimSpace(content)
			if content != `\today` && content != "" {
				doc.Date = cleanInline(content)
			}
		}
	}

	// Extract abstract
	absRe := regexp.MustCompile(`(?s)\\begin\{abstract\}(.*?)\\end\{abstract\}`)
	if m := absRe.FindStringSubmatch(src); m != nil {
		doc.Abstract = cleanInline(strings.TrimSpace(m[1]))
	}

	// Extract body
	body := src
	if idx := strings.Index(src, `\begin{document}`); idx >= 0 {
		body = src[idx+len(`\begin{document}`):]
	}
	if idx := strings.Index(body, `\end{document}`); idx >= 0 {
		body = body[:idx]
	}

	doc.Body = parseBody(body)
	return doc
}

func parseBody(body string) []bodyElem {
	lines := strings.Split(body, "\n")
	var elems []bodyElem
	var paraLines []string

	flushPara := func() {
		text := strings.TrimSpace(strings.Join(paraLines, " "))
		paraLines = nil
		if text == "" {
			return
		}
		elems = append(elems, bodyElem{
			Kind: kindParagraph,
			Runs: parseInlineFormatting(text),
		})
	}

	i := 0
	for i < len(lines) {
		line := strings.TrimSpace(lines[i])

		// ── Empty line → flush paragraph ─────────────────────
		if line == "" {
			flushPara()
			i++
			continue
		}

		// ── Skip abstract block (already extracted by parseMeta) ─
		if strings.HasPrefix(line, `\begin{abstract}`) {
			for i < len(lines) && !strings.Contains(lines[i], `\end{abstract}`) {
				i++
			}
			i++ // skip \end{abstract} line
			continue
		}

		// ── Skip multi-line \title{...}, \author{...}, \date{...} ──
		if strings.HasPrefix(line, `\title{`) || strings.HasPrefix(line, `\title `) ||
			strings.HasPrefix(line, `\author{`) || strings.HasPrefix(line, `\author `) ||
			strings.HasPrefix(line, `\date{`) || strings.HasPrefix(line, `\date `) {
			depth := strings.Count(line, "{") - strings.Count(line, "}")
			for depth > 0 && i+1 < len(lines) {
				i++
				line = lines[i]
				depth += strings.Count(line, "{") - strings.Count(line, "}")
			}
			i++
			continue
		}

		// ── Skip preamble/metadata/no-op commands ────────────
		if reMaketitle.MatchString(line) ||
			reNewtheorem.MatchString(line) ||
			reBibStyle.MatchString(line) ||
			strings.HasPrefix(line, `\begin{document}`) ||
			strings.HasPrefix(line, `\end{document}`) ||
			strings.HasPrefix(line, `\usepackage`) ||
			strings.HasPrefix(line, `\RequirePackage`) ||
			strings.HasPrefix(line, `\documentclass`) ||
			strings.HasPrefix(line, `\pagestyle`) ||
			strings.HasPrefix(line, `\thispagestyle`) ||
			strings.HasPrefix(line, `\setlength`) ||
			strings.HasPrefix(line, `\setcounter`) ||
			strings.HasPrefix(line, `\addtolength`) ||
			strings.HasPrefix(line, `\geometry`) ||
			strings.HasPrefix(line, `\hypersetup`) ||
			strings.HasPrefix(line, `\graphicspath`) ||
			strings.HasPrefix(line, `\pagenumbering`) ||
			strings.HasPrefix(line, `\tableofcontents`) ||
			strings.HasPrefix(line, `\makeatletter`) ||
			strings.HasPrefix(line, `\makeatother`) ||
			strings.HasPrefix(line, `\input{`) ||
			strings.HasPrefix(line, `\include{`) {
			i++
			continue
		}

		// Skip comments
		if strings.HasPrefix(line, "%") {
			i++
			continue
		}

		// ── \noindent → keep text, strip command ─────────────
		if strings.HasPrefix(line, `\noindent`) {
			rest := strings.TrimSpace(strings.TrimPrefix(line, `\noindent`))
			if rest != "" {
				paraLines = append(paraLines, rest)
			}
			i++
			continue
		}

		// ── Page breaks ──────────────────────────────────────
		if strings.HasPrefix(line, `\newpage`) || strings.HasPrefix(line, `\clearpage`) || strings.HasPrefix(line, `\pagebreak`) {
			flushPara()
			elems = append(elems, bodyElem{Kind: kindPageBreak})
			i++
			continue
		}

		// ── Vertical spacing ─────────────────────────────────
		if m := reVSpace.FindStringSubmatch(line); m != nil {
			flushPara()
			elems = append(elems, bodyElem{Kind: kindVSpace, Height: m[1]})
			i++
			continue
		}
		if strings.HasPrefix(line, `\smallskip`) || strings.HasPrefix(line, `\medskip`) || strings.HasPrefix(line, `\bigskip`) {
			flushPara()
			sizes := map[string]string{"\\smallskip": "3pt", "\\medskip": "6pt", "\\bigskip": "12pt"}
			for cmd, sz := range sizes {
				if strings.HasPrefix(line, cmd) {
					elems = append(elems, bodyElem{Kind: kindVSpace, Height: sz})
					break
				}
			}
			i++
			continue
		}

		// ── Horizontal rules ─────────────────────────────────
		if strings.HasPrefix(line, `\hrule`) || strings.HasPrefix(line, `\hrulefill`) {
			flushPara()
			elems = append(elems, bodyElem{Kind: kindHRule, Width: "100%", Height: "0.4pt"})
			i++
			continue
		}
		if m := reRule.FindStringSubmatch(line); m != nil {
			flushPara()
			elems = append(elems, bodyElem{Kind: kindHRule, Width: m[1], Height: m[2]})
			i++
			continue
		}

		// ── Section headings ─────────────────────────────────
		if m := reSection.FindStringSubmatch(line); m != nil {
			flushPara()
			elems = append(elems, bodyElem{Kind: kindSection, Title: cleanInline(m[1])})
			i++
			continue
		}
		if m := reSubsection.FindStringSubmatch(line); m != nil {
			flushPara()
			elems = append(elems, bodyElem{Kind: kindSubsection, Title: cleanInline(m[1])})
			i++
			continue
		}
		if m := reSubsubsection.FindStringSubmatch(line); m != nil {
			flushPara()
			elems = append(elems, bodyElem{Kind: kindSubsubsection, Title: cleanInline(m[1])})
			i++
			continue
		}
		if m := reParagraphCmd.FindStringSubmatch(line); m != nil {
			flushPara()
			elems = append(elems, bodyElem{Kind: kindParagraphHead, Title: cleanInline(m[1])})
			i++
			continue
		}

		// ── Theorem-like environments ────────────────────────
		if m := reTheoremBegin.FindStringSubmatch(line); m != nil {
			flushPara()
			envName := m[1]
			optTitle := ""
			if len(m) > 2 {
				optTitle = m[2]
			}
			label := strings.Title(envName)
			if optTitle != "" {
				label += " (" + optTitle + ")"
			}
			var content []string
			i++
			endRe := regexp.MustCompile(`^\\end\{` + envName + `\}`)
			for i < len(lines) && !endRe.MatchString(strings.TrimSpace(lines[i])) {
				content = append(content, strings.TrimSpace(lines[i]))
				i++
			}
			text := cleanInline(strings.Join(content, " "))
			elems = append(elems, bodyElem{
				Kind:  kindTheorem,
				Title: label,
				Runs:  parseInlineFormatting(text),
			})
			i++ // skip \end{...}
			continue
		}

		// ── Verbatim / lstlisting / minted ───────────────────
		if strings.HasPrefix(line, `\begin{verbatim}`) || strings.HasPrefix(line, `\begin{lstlisting}`) || strings.HasPrefix(line, `\begin{minted}`) {
			flushPara()
			envName := "verbatim"
			if strings.Contains(line, "lstlisting") {
				envName = "lstlisting"
			} else if strings.Contains(line, "minted") {
				envName = "minted"
			}
			var codeLines []string
			i++
			for i < len(lines) && !strings.Contains(lines[i], `\end{`+envName+`}`) {
				codeLines = append(codeLines, lines[i])
				i++
			}
			elems = append(elems, bodyElem{Kind: kindVerbatim, Lines: codeLines})
			i++
			continue
		}

		// ── Math display blocks ──────────────────────────────
		if strings.HasPrefix(line, `\begin{equation}`) ||
			strings.HasPrefix(line, `\begin{align}`) ||
			strings.HasPrefix(line, `\begin{gather}`) ||
			strings.HasPrefix(line, `\begin{multline}`) ||
			strings.HasPrefix(line, `\begin{displaymath}`) ||
			strings.HasPrefix(line, `\[`) {
			flushPara()
			endPat := `\end{equation}`
			if strings.HasPrefix(line, `\begin{align}`) {
				endPat = `\end{align}`
			} else if strings.HasPrefix(line, `\begin{gather}`) {
				endPat = `\end{gather}`
			} else if strings.HasPrefix(line, `\begin{multline}`) {
				endPat = `\end{multline}`
			} else if strings.HasPrefix(line, `\begin{displaymath}`) {
				endPat = `\end{displaymath}`
			} else if strings.HasPrefix(line, `\[`) {
				endPat = `\]`
			}
			// Handle starred variants
			if strings.Contains(line, "*}") {
				endPat = strings.Replace(endPat, "}", "*}", 1)
			}
			var mathLines []string
			i++
			for i < len(lines) && !strings.Contains(lines[i], endPat) {
				mathLines = append(mathLines, strings.TrimSpace(lines[i]))
				i++
			}
			elems = append(elems, bodyElem{Kind: kindMathBlock, Lines: mathLines})
			i++
			continue
		}

		// ── Alignment environments ───────────────────────────
		if strings.HasPrefix(line, `\begin{center}`) {
			flushPara()
			var contentLines []string
			i++
			for i < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[i]), `\end{center}`) {
				contentLines = append(contentLines, lines[i])
				i++
			}
			i++
			children := parseBody(strings.Join(contentLines, "\n"))
			elems = append(elems, bodyElem{Kind: kindCenter, Children: children})
			continue
		}
		if strings.HasPrefix(line, `\begin{flushleft}`) {
			flushPara()
			var contentLines []string
			i++
			for i < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[i]), `\end{flushleft}`) {
				contentLines = append(contentLines, lines[i])
				i++
			}
			i++
			children := parseBody(strings.Join(contentLines, "\n"))
			elems = append(elems, bodyElem{Kind: kindFlushLeft, Children: children})
			continue
		}
		if strings.HasPrefix(line, `\begin{flushright}`) {
			flushPara()
			var contentLines []string
			i++
			for i < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[i]), `\end{flushright}`) {
				contentLines = append(contentLines, lines[i])
				i++
			}
			i++
			children := parseBody(strings.Join(contentLines, "\n"))
			elems = append(elems, bodyElem{Kind: kindFlushRight, Children: children})
			continue
		}
		if strings.HasPrefix(line, `\begin{quote}`) || strings.HasPrefix(line, `\begin{quotation}`) {
			flushPara()
			envName := "quote"
			if strings.Contains(line, "quotation") {
				envName = "quotation"
			}
			var contentLines []string
			i++
			for i < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[i]), `\end{`+envName+`}`) {
				contentLines = append(contentLines, lines[i])
				i++
			}
			i++
			children := parseBody(strings.Join(contentLines, "\n"))
			elems = append(elems, bodyElem{Kind: kindQuote, Children: children})
			continue
		}

		// ── Minipage ─────────────────────────────────────────
		if strings.HasPrefix(line, `\begin{minipage}`) {
			flushPara()
			widthRe := regexp.MustCompile(`\begin\{minipage\}(?:\[[^\]]*\])?\{([^}]*)\}`)
			width := "50%"
			if m := widthRe.FindStringSubmatch(line); m != nil {
				width = m[1]
			}
			var contentLines []string
			i++
			for i < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[i]), `\end{minipage}`) {
				contentLines = append(contentLines, lines[i])
				i++
			}
			i++
			children := parseBody(strings.Join(contentLines, "\n"))
			elems = append(elems, bodyElem{Kind: kindMinipage, Children: children, Width: width})
			continue
		}

		// ── Lists ────────────────────────────────────────────
		if strings.HasPrefix(line, `\begin{itemize}`) || strings.HasPrefix(line, `\begin{enumerate}`) {
			flushPara()
			ordered := strings.HasPrefix(line, `\begin{enumerate}`)
			endTag := `\end{itemize}`
			if ordered {
				endTag = `\end{enumerate}`
			}
			var items [][]fmtRun
			var curItem string
			i++
			for i < len(lines) {
				l := strings.TrimSpace(lines[i])
				if strings.HasPrefix(l, endTag) {
					break
				}
				// Skip nested list markers (flatten)
				if strings.HasPrefix(l, `\begin{itemize}`) || strings.HasPrefix(l, `\begin{enumerate}`) ||
					strings.HasPrefix(l, `\end{itemize}`) || strings.HasPrefix(l, `\end{enumerate}`) {
					i++
					continue
				}
				if strings.HasPrefix(l, `\item`) {
					if curItem != "" {
						items = append(items, parseInlineFormatting(cleanInline(curItem)))
					}
					rest := strings.TrimSpace(l[len(`\item`):])
					// Remove optional label [...] for itemize/enumerate
					if len(rest) > 0 && rest[0] == '[' {
						if closeBracket := strings.Index(rest, "]"); closeBracket >= 0 {
							rest = strings.TrimSpace(rest[closeBracket+1:])
						}
					}
					curItem = rest
				} else {
					curItem += " " + l
				}
				i++
			}
			if curItem != "" {
				items = append(items, parseInlineFormatting(cleanInline(curItem)))
			}

			kind := kindItemize
			if ordered {
				kind = kindEnumerate
			}
			elems = append(elems, bodyElem{Kind: kind, Items: items})
			i++ // skip \end{...}
			continue
		}

		// ── Description list ─────────────────────────────────
		if strings.HasPrefix(line, `\begin{description}`) {
			flushPara()
			var descItems []descItem
			var curLabel, curBody string
			i++
			for i < len(lines) {
				l := strings.TrimSpace(lines[i])
				if strings.HasPrefix(l, `\end{description}`) {
					break
				}
				if strings.HasPrefix(l, `\item`) {
					if curLabel != "" || curBody != "" {
						descItems = append(descItems, descItem{
							Label: parseInlineFormatting(cleanInline(curLabel)),
							Body:  parseInlineFormatting(cleanInline(curBody)),
						})
					}
					// Extract [label]
					rest := strings.TrimSpace(l[len(`\item`):])
					curLabel = ""
					curBody = ""
					if len(rest) > 0 && rest[0] == '[' {
						if closeBracket := strings.Index(rest, "]"); closeBracket >= 0 {
							curLabel = rest[1:closeBracket]
							curBody = strings.TrimSpace(rest[closeBracket+1:])
						}
					} else {
						curBody = rest
					}
				} else {
					curBody += " " + l
				}
				i++
			}
			if curLabel != "" || curBody != "" {
				descItems = append(descItems, descItem{
					Label: parseInlineFormatting(cleanInline(curLabel)),
					Body:  parseInlineFormatting(cleanInline(curBody)),
				})
			}
			elems = append(elems, bodyElem{Kind: kindDescription, DescItems: descItems})
			i++
			continue
		}

		// ── Table environments ────────────────────────────────
		if strings.HasPrefix(line, `\begin{table}`) {
			flushPara()
			var tableLines []string
			caption := ""
			i++
			for i < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[i]), `\end{table}`) {
				tl := strings.TrimSpace(lines[i])
				if m := reCaption.FindStringSubmatch(tl); m != nil {
					caption = cleanInline(m[1])
				}
				if reTableBegin.MatchString(tl) {
					i++
					for i < len(lines) && !reTableEnd.MatchString(strings.TrimSpace(lines[i])) {
						row := strings.TrimSpace(lines[i])
						if row != "" && !isTableDecorator(row) {
							// Handle multicolumn/multirow
							row = regexp.MustCompile(`\\multicolumn\{[^}]*\}\{[^}]*\}\{([^}]*)\}`).ReplaceAllString(row, "$1")
							row = regexp.MustCompile(`\\multirow\{[^}]*\}\{[^}]*\}\{([^}]*)\}`).ReplaceAllString(row, "$1")
							tableLines = append(tableLines, row)
						}
						i++
					}
					i++ // skip \end{tabular}
					continue
				}
				i++
			}
			elem := bodyElem{Kind: kindTable, Lines: tableLines}
			if caption != "" {
				elem.Title = caption
			}
			elems = append(elems, elem)
			i++
			continue
		}

		// ── Standalone tabular ───────────────────────────────
		if reTableBegin.MatchString(line) {
			flushPara()
			var tableLines []string
			i++
			for i < len(lines) && !reTableEnd.MatchString(strings.TrimSpace(lines[i])) {
				row := strings.TrimSpace(lines[i])
				if row != "" && !isTableDecorator(row) {
					row = regexp.MustCompile(`\\multicolumn\{[^}]*\}\{[^}]*\}\{([^}]*)\}`).ReplaceAllString(row, "$1")
					row = regexp.MustCompile(`\\multirow\{[^}]*\}\{[^}]*\}\{([^}]*)\}`).ReplaceAllString(row, "$1")
					tableLines = append(tableLines, row)
				}
				i++
			}
			elems = append(elems, bodyElem{Kind: kindTable, Lines: tableLines})
			i++
			continue
		}

		// ── Figure environment ────────────────────────────────
		if strings.HasPrefix(line, `\begin{figure}`) {
			flushPara()
			caption := ""
			i++
			for i < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[i]), `\end{figure}`) {
				tl := strings.TrimSpace(lines[i])
				if m := reCaption.FindStringSubmatch(tl); m != nil {
					caption = cleanInline(m[1])
				}
				i++
			}
			i++
			elems = append(elems, bodyElem{Kind: kindFigure, Title: caption})
			continue
		}

		// ── Bibliography ─────────────────────────────────────
		if reBibliography.MatchString(line) || strings.HasPrefix(line, `\begin{thebibliography}`) {
			flushPara()
			if strings.HasPrefix(line, `\begin{thebibliography}`) {
				var bibItems []string
				i++
				for i < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[i]), `\end{thebibliography}`) {
					bl := strings.TrimSpace(lines[i])
					if strings.HasPrefix(bl, `\bibitem`) {
						content := regexp.MustCompile(`^\\bibitem(?:\[[^\]]*\])?\{[^}]*\}\s*`).ReplaceAllString(bl, "")
						bibItems = append(bibItems, content)
					}
					i++
				}
				i++
				// Add bibliography as section + list
				elems = append(elems, bodyElem{Kind: kindSection, Title: "References"})
				var items [][]fmtRun
				for _, item := range bibItems {
					items = append(items, parseInlineFormatting(cleanInline(item)))
				}
				if len(items) > 0 {
					elems = append(elems, bodyElem{Kind: kindEnumerate, Items: items})
				}
			} else {
				elems = append(elems, bodyElem{Kind: kindSection, Title: "References"})
				i++
			}
			continue
		}

		// ── Generic unknown environment ──────────────────────
		if strings.HasPrefix(line, `\begin{`) {
			envNameRe := regexp.MustCompile(`^\\begin\{([^}]+)\}`)
			if m := envNameRe.FindStringSubmatch(line); m != nil {
				envName := m[1]
				flushPara()
				var contentLines []string
				i++
				endRe := regexp.MustCompile(`^\\end\{` + regexp.QuoteMeta(envName) + `\}`)
				for i < len(lines) && !endRe.MatchString(strings.TrimSpace(lines[i])) {
					contentLines = append(contentLines, lines[i])
					i++
				}
				i++
				// Parse content as regular body
				children := parseBody(strings.Join(contentLines, "\n"))
				for _, ch := range children {
					elems = append(elems, ch)
				}
				continue
			}
		}

		// Skip label-only lines
		if reLabel.MatchString(line) && len(strings.TrimSpace(reLabel.ReplaceAllString(line, ""))) == 0 {
			i++
			continue
		}

		// Skip \centering
		if strings.HasPrefix(line, `\centering`) {
			i++
			continue
		}

		// Handle standalone \rule in paragraph context
		if strings.HasPrefix(line, `\rule`) {
			flushPara()
			if m := reRule.FindStringSubmatch(line); m != nil {
				elems = append(elems, bodyElem{Kind: kindHRule, Width: m[1], Height: m[2]})
			}
			i++
			continue
		}

		// Regular text → accumulate into paragraph
		paraLines = append(paraLines, line)
		i++
	}

	flushPara()
	return elems
}

func isTableDecorator(row string) bool {
	return strings.HasPrefix(row, `\toprule`) ||
		strings.HasPrefix(row, `\midrule`) ||
		strings.HasPrefix(row, `\bottomrule`) ||
		strings.HasPrefix(row, `\hline`) ||
		strings.HasPrefix(row, `\cline`) ||
		strings.HasPrefix(row, `\centering`) ||
		row == `\hline`
}

// ═══════════════════════════════════════════════════════════════
// Inline formatting parser
// ═══════════════════════════════════════════════════════════════

func parseInlineFormatting(text string) []fmtRun {
	var runs []fmtRun
	remaining := text

	for remaining != "" {
		bestIdx := len(remaining)
		bestType := ""
		bestContent := ""
		bestLen := 0

		// \textbf{...}
		if loc := reBold.FindStringIndex(remaining); loc != nil && loc[0] < bestIdx {
			m := reBold.FindStringSubmatch(remaining)
			bestIdx = loc[0]
			bestType = "bold"
			bestContent = m[1]
			bestLen = loc[1] - loc[0]
		}
		// \textit{...}
		if loc := reItalic.FindStringIndex(remaining); loc != nil && loc[0] < bestIdx {
			m := reItalic.FindStringSubmatch(remaining)
			bestIdx = loc[0]
			bestType = "italic"
			bestContent = m[1]
			bestLen = loc[1] - loc[0]
		}
		// \emph{...}
		if loc := reEmph.FindStringIndex(remaining); loc != nil && loc[0] < bestIdx {
			m := reEmph.FindStringSubmatch(remaining)
			bestIdx = loc[0]
			bestType = "italic"
			bestContent = m[1]
			bestLen = loc[1] - loc[0]
		}
		// \textsc{...}
		if loc := reSmallCaps.FindStringIndex(remaining); loc != nil && loc[0] < bestIdx {
			m := reSmallCaps.FindStringSubmatch(remaining)
			bestIdx = loc[0]
			bestType = "smallcaps"
			bestContent = m[1]
			bestLen = loc[1] - loc[0]
		}
		// \underline{...}
		if loc := reUnderline.FindStringIndex(remaining); loc != nil && loc[0] < bestIdx {
			m := reUnderline.FindStringSubmatch(remaining)
			bestIdx = loc[0]
			bestType = "underline"
			bestContent = m[1]
			bestLen = loc[1] - loc[0]
		}
		// \texttt{...}
		if loc := reTexttt.FindStringIndex(remaining); loc != nil && loc[0] < bestIdx {
			m := reTexttt.FindStringSubmatch(remaining)
			bestIdx = loc[0]
			bestType = "mono"
			bestContent = m[1]
			bestLen = loc[1] - loc[0]
		}
		// $...$
		if loc := reInlineMath.FindStringIndex(remaining); loc != nil && loc[0] < bestIdx {
			m := reInlineMath.FindStringSubmatch(remaining)
			bestIdx = loc[0]
			bestType = "math"
			bestContent = m[1]
			bestLen = loc[1] - loc[0]
		}
		// Old-style {\bf text}
		oldBfRe := regexp.MustCompile(`\{\\bf\s+([^}]*)\}`)
		if loc := oldBfRe.FindStringIndex(remaining); loc != nil && loc[0] < bestIdx {
			m := oldBfRe.FindStringSubmatch(remaining)
			bestIdx = loc[0]
			bestType = "bold"
			bestContent = m[1]
			bestLen = loc[1] - loc[0]
		}
		// Old-style {\it text}
		oldItRe := regexp.MustCompile(`\{\\it\s+([^}]*)\}`)
		if loc := oldItRe.FindStringIndex(remaining); loc != nil && loc[0] < bestIdx {
			m := oldItRe.FindStringSubmatch(remaining)
			bestIdx = loc[0]
			bestType = "italic"
			bestContent = m[1]
			bestLen = loc[1] - loc[0]
		}

		if bestType == "" {
			cleaned := cleanPlain(remaining)
			if cleaned != "" {
				runs = append(runs, fmtRun{Text: cleaned})
			}
			break
		}

		if bestIdx > 0 {
			cleaned := cleanPlain(remaining[:bestIdx])
			if cleaned != "" {
				runs = append(runs, fmtRun{Text: cleaned})
			}
		}

		switch bestType {
		case "bold":
			runs = append(runs, fmtRun{Text: cleanPlain(bestContent), Bold: true})
		case "italic":
			runs = append(runs, fmtRun{Text: cleanPlain(bestContent), Italic: true})
		case "smallcaps":
			runs = append(runs, fmtRun{Text: cleanPlain(bestContent), SmallCaps: true})
		case "underline":
			runs = append(runs, fmtRun{Text: cleanPlain(bestContent), Underline: true})
		case "mono":
			runs = append(runs, fmtRun{Text: cleanPlain(bestContent), Mono: true})
		case "math":
			runs = append(runs, fmtRun{Text: bestContent, Mono: true, IsMath: true})
		}

		remaining = remaining[bestIdx+bestLen:]
	}

	return runs
}

func cleanInline(s string) string {
	s = reLabel.ReplaceAllString(s, "")
	s = reRef.ReplaceAllString(s, "[ref]")
	s = reCite.ReplaceAllString(s, "[citation]")
	s = reLaTeX.ReplaceAllString(s, "LaTeX")
	s = strings.ReplaceAll(s, `~`, " ")
	s = strings.ReplaceAll(s, `\,`, " ")
	s = strings.ReplaceAll(s, `\;`, " ")
	s = strings.ReplaceAll(s, `\!`, "")
	s = strings.ReplaceAll(s, `\hfill`, " ")
	s = strings.ReplaceAll(s, `\quad`, " ")
	s = strings.ReplaceAll(s, `\qquad`, "  ")
	s = regexp.MustCompile(`\\hspace\*?\{[^}]*\}`).ReplaceAllString(s, " ")
	s = regexp.MustCompile(`\\vspace\*?\{[^}]*\}`).ReplaceAllString(s, "")
	// Remove \\[dim] and bare \\
	s = regexp.MustCompile(`\\\\(?:\[[^\]]*\])?`).ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

func cleanPlain(s string) string {
	s = reLabel.ReplaceAllString(s, "")
	s = reRef.ReplaceAllString(s, "[ref]")
	s = reCite.ReplaceAllString(s, "[citation]")
	s = reLaTeX.ReplaceAllString(s, "LaTeX")
	s = strings.ReplaceAll(s, `~`, " ")
	s = strings.ReplaceAll(s, `\,`, " ")
	s = strings.ReplaceAll(s, `\;`, " ")
	s = strings.ReplaceAll(s, `\!`, "")
	s = strings.ReplaceAll(s, `\hfill`, " ")
	// Remove remaining simple commands
	s = regexp.MustCompile(`\\[a-zA-Z]+\*?`).ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "{", "")
	s = strings.ReplaceAll(s, "}", "")
	s = regexp.MustCompile(`\s+`).ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

// escapeXML is defined in orchestrator.go

// ═══════════════════════════════════════════════════════════════
// OOXML Builder
// ═══════════════════════════════════════════════════════════════

func buildFormattedDocx(doc parsedDoc) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	addZipFileB(zw, "[Content_Types].xml", contentTypesXML)
	addZipFileB(zw, "_rels/.rels", relsXML)
	addZipFileB(zw, "word/_rels/document.xml.rels", wordRelsXML)
	addZipFileB(zw, "word/styles.xml", stylesXML)
	addZipFileB(zw, "word/numbering.xml", numberingXML)
	addZipFileB(zw, "word/settings.xml", settingsXML)

	documentXML := buildDocumentXML(doc)
	addZipFileB(zw, "word/document.xml", documentXML)

	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func addZipFileB(zw *zip.Writer, name, content string) {
	w, _ := zw.Create(name)
	w.Write([]byte(content))
}

func buildDocumentXML(doc parsedDoc) string {
	var b strings.Builder

	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:body>
`)

	// Title
	if doc.Title != "" {
		b.WriteString(styledPara("Title", []fmtRun{{Text: doc.Title}}))
	}

	// Authors
	if len(doc.Authors) > 0 {
		b.WriteString(styledPara("Author", []fmtRun{{Text: strings.Join(doc.Authors, "  •  ")}}))
	}

	// Date
	if doc.Date != "" {
		b.WriteString(styledPara("Date", []fmtRun{{Text: doc.Date}}))
	}

	// Abstract
	if doc.Abstract != "" {
		b.WriteString(styledPara("Heading2", []fmtRun{{Text: "Abstract", Italic: true}}))
		runs := parseInlineFormatting(doc.Abstract)
		for i := range runs {
			runs[i].Italic = true
		}
		b.WriteString(styledPara("AbstractText", runs))
	}

	// Body elements
	renderElements(&b, doc.Body, "left")

	b.WriteString(`    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"
               w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`)

	return b.String()
}

func renderElements(b *strings.Builder, elems []bodyElem, alignment string) {
	for _, elem := range elems {
		switch elem.Kind {
		case kindSection:
			b.WriteString(styledPara("Heading1", []fmtRun{{Text: elem.Title}}))
		case kindSubsection:
			b.WriteString(styledPara("Heading2", []fmtRun{{Text: elem.Title}}))
		case kindSubsubsection:
			b.WriteString(styledPara("Heading3", []fmtRun{{Text: elem.Title}}))
		case kindParagraphHead:
			b.WriteString(styledPara("Normal", []fmtRun{{Text: elem.Title + ".", Bold: true}}))

		case kindParagraph:
			if alignment == "center" {
				b.WriteString(centeredPara(elem.Runs))
			} else if alignment == "right" {
				b.WriteString(rightPara(elem.Runs))
			} else {
				b.WriteString(styledPara("Normal", elem.Runs))
			}

		case kindTheorem:
			b.WriteString(styledPara("Normal", []fmtRun{{Text: elem.Title + ".", Bold: true}}))
			itRuns := make([]fmtRun, len(elem.Runs))
			copy(itRuns, elem.Runs)
			for i := range itRuns {
				itRuns[i].Italic = true
			}
			b.WriteString(styledPara("Normal", itRuns))

		case kindMathBlock:
			content := strings.Join(elem.Lines, " ")
			content = strings.TrimSpace(content)
			// Remove \label{...} and alignment characters
			content = reLabel.ReplaceAllString(content, "")
			content = strings.ReplaceAll(content, "\\nonumber", "")
			content = strings.ReplaceAll(content, "\\notag", "")
			// Generate OMML math
			b.WriteString(buildOmmlMathParagraph(content))

		case kindVerbatim:
			for _, ln := range elem.Lines {
				b.WriteString(styledPara("CodeBlock", []fmtRun{{Text: ln, Mono: true}}))
			}

		case kindItemize:
			for _, item := range elem.Items {
				b.WriteString(listPara("ListBullet", item))
			}
		case kindEnumerate:
			for _, item := range elem.Items {
				b.WriteString(listPara("ListNumber", item))
			}
		case kindDescription:
			for _, di := range elem.DescItems {
				// Label in bold, body in normal
				labelRuns := make([]fmtRun, len(di.Label))
				copy(labelRuns, di.Label)
				for i := range labelRuns {
					labelRuns[i].Bold = true
				}
				combined := append(labelRuns, fmtRun{Text: " "})
				combined = append(combined, di.Body...)
				b.WriteString(styledPara("Normal", combined))
			}

		case kindTable:
			if elem.Title != "" {
				b.WriteString(styledPara("Normal", []fmtRun{{Text: "Table: " + elem.Title, Bold: true, Italic: true}}))
			}
			b.WriteString(buildOOXMLTable(elem.Lines))

		case kindHRule:
			b.WriteString(hrulePara())

		case kindCenter:
			renderElements(b, elem.Children, "center")
		case kindFlushLeft:
			renderElements(b, elem.Children, "left")
		case kindFlushRight:
			renderElements(b, elem.Children, "right")
		case kindQuote:
			for _, ch := range elem.Children {
				if ch.Kind == kindParagraph {
					b.WriteString(quotePara(ch.Runs))
				} else {
					renderElements(b, []bodyElem{ch}, "left")
				}
			}
		case kindMinipage:
			renderElements(b, elem.Children, alignment)

		case kindPageBreak:
			b.WriteString(pageBreakPara())

		case kindVSpace:
			b.WriteString(spacingPara(elem.Height))

		case kindFigure:
			caption := "[Figure]"
			if elem.Title != "" {
				caption = "Figure: " + elem.Title
			}
			b.WriteString(centeredPara([]fmtRun{{Text: caption, Italic: true}}))
		}
	}
}

// ═══════════════════════════════════════════════════════════════
// Paragraph builders
// ═══════════════════════════════════════════════════════════════

func styledPara(style string, runs []fmtRun) string {
	var b strings.Builder
	b.WriteString("    <w:p>\n")
	if style != "" && style != "Normal" {
		b.WriteString(fmt.Sprintf("      <w:pPr><w:pStyle w:val=\"%s\"/></w:pPr>\n", style))
	}
	writeRuns(&b, runs)
	b.WriteString("    </w:p>\n")
	return b.String()
}

func centeredPara(runs []fmtRun) string {
	var b strings.Builder
	b.WriteString("    <w:p>\n")
	b.WriteString("      <w:pPr><w:jc w:val=\"center\"/></w:pPr>\n")
	writeRuns(&b, runs)
	b.WriteString("    </w:p>\n")
	return b.String()
}

func rightPara(runs []fmtRun) string {
	var b strings.Builder
	b.WriteString("    <w:p>\n")
	b.WriteString("      <w:pPr><w:jc w:val=\"right\"/></w:pPr>\n")
	writeRuns(&b, runs)
	b.WriteString("    </w:p>\n")
	return b.String()
}

func quotePara(runs []fmtRun) string {
	var b strings.Builder
	b.WriteString("    <w:p>\n")
	b.WriteString("      <w:pPr><w:ind w:left=\"720\" w:right=\"720\"/></w:pPr>\n")
	for i := range runs {
		runs[i].Italic = true
	}
	writeRuns(&b, runs)
	b.WriteString("    </w:p>\n")
	return b.String()
}

func listPara(style string, runs []fmtRun) string {
	var b strings.Builder
	b.WriteString("    <w:p>\n")
	b.WriteString(fmt.Sprintf("      <w:pPr><w:pStyle w:val=\"%s\"/></w:pPr>\n", style))
	writeRuns(&b, runs)
	b.WriteString("    </w:p>\n")
	return b.String()
}

func hrulePara() string {
	var b strings.Builder
	b.WriteString("    <w:p>\n")
	b.WriteString("      <w:pPr>\n")
	b.WriteString("        <w:pBdr>\n")
	b.WriteString("          <w:bottom w:val=\"single\" w:sz=\"6\" w:space=\"1\" w:color=\"374151\"/>\n")
	b.WriteString("        </w:pBdr>\n")
	b.WriteString("        <w:spacing w:before=\"60\" w:after=\"60\"/>\n")
	b.WriteString("      </w:pPr>\n")
	b.WriteString("    </w:p>\n")
	return b.String()
}

func pageBreakPara() string {
	var b strings.Builder
	b.WriteString("    <w:p>\n")
	b.WriteString("      <w:r>\n")
	b.WriteString("        <w:br w:type=\"page\"/>\n")
	b.WriteString("      </w:r>\n")
	b.WriteString("    </w:p>\n")
	return b.String()
}

func spacingPara(height string) string {
	// Convert LaTeX dimension to twips (1pt = 20 twips)
	twips := 120 // default 6pt
	if strings.HasSuffix(height, "pt") {
		var pts float64
		fmt.Sscanf(height, "%fpt", &pts)
		twips = int(pts * 20)
	} else if strings.HasSuffix(height, "em") {
		var ems float64
		fmt.Sscanf(height, "%fem", &ems)
		twips = int(ems * 220)
	}
	var b strings.Builder
	b.WriteString("    <w:p>\n")
	b.WriteString(fmt.Sprintf("      <w:pPr><w:spacing w:before=\"%d\" w:after=\"0\"/></w:pPr>\n", twips))
	b.WriteString("    </w:p>\n")
	return b.String()
}

func writeRuns(b *strings.Builder, runs []fmtRun) {
	for _, r := range runs {
		// Inline math → emit OMML inline
		if r.IsMath {
			b.WriteString(buildOmmlInlineMath(r.Text))
			continue
		}

		b.WriteString("      <w:r>")
		var rpr []string
		if r.Bold {
			rpr = append(rpr, "<w:b/>")
		}
		if r.Italic {
			rpr = append(rpr, "<w:i/>")
		}
		if r.Underline {
			rpr = append(rpr, `<w:u w:val="single"/>`)
		}
		if r.SmallCaps {
			rpr = append(rpr, "<w:smallCaps/>")
		}
		if r.Mono {
			rpr = append(rpr, `<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>`)
			rpr = append(rpr, `<w:sz w:val="20"/>`)
		}
		if r.FontSize > 0 {
			rpr = append(rpr, fmt.Sprintf(`<w:sz w:val="%d"/>`, r.FontSize))
			rpr = append(rpr, fmt.Sprintf(`<w:szCs w:val="%d"/>`, r.FontSize))
		}
		if len(rpr) > 0 {
			b.WriteString("<w:rPr>")
			b.WriteString(strings.Join(rpr, ""))
			b.WriteString("</w:rPr>")
		}
		b.WriteString(fmt.Sprintf(`<w:t xml:space="preserve">%s</w:t>`, escapeXML(r.Text)))
		b.WriteString("</w:r>\n")
	}
}

func buildOOXMLTable(rows []string) string {
	var b strings.Builder
	b.WriteString("    <w:tbl>\n")
	b.WriteString(`      <w:tblPr>
        <w:tblStyle w:val="TableGrid"/>
        <w:tblW w:w="0" w:type="auto"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
          <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
          <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
          <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
          <w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>
          <w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        </w:tblBorders>
        <w:tblLook w:val="04A0"/>
      </w:tblPr>
`)

	for _, row := range rows {
		row = strings.TrimSpace(row)
		row = strings.TrimSuffix(row, `\\`)
		row = strings.TrimSpace(row)
		if row == "" {
			continue
		}
		cells := strings.Split(row, "&")
		b.WriteString("      <w:tr>\n")
		for _, cell := range cells {
			cell = strings.TrimSpace(cell)
			cell = cleanInline(cell)
			runs := parseInlineFormatting(cell)
			b.WriteString("        <w:tc>\n")
			b.WriteString("          <w:p>")
			writeRuns(&b, runs)
			b.WriteString("</w:p>\n")
			b.WriteString("        </w:tc>\n")
		}
		b.WriteString("      </w:tr>\n")
	}
	b.WriteString("    </w:tbl>\n")
	return b.String()
}

// ═══════════════════════════════════════════════════════════════
// OMML Math generation (LaTeX → Office Math XML)
// ═══════════════════════════════════════════════════════════════

// Greek letters and common LaTeX symbols → Unicode
var latexToUnicode = map[string]string{
	`\alpha`: "\u03B1", `\beta`: "\u03B2", `\gamma`: "\u03B3", `\delta`: "\u03B4",
	`\epsilon`: "\u03F5", `\varepsilon`: "\u03B5", `\zeta`: "\u03B6", `\eta`: "\u03B7",
	`\theta`: "\u03B8", `\vartheta`: "\u03D1", `\iota`: "\u03B9", `\kappa`: "\u03BA",
	`\lambda`: "\u03BB", `\mu`: "\u03BC", `\nu`: "\u03BD", `\xi`: "\u03BE",
	`\pi`: "\u03C0", `\varpi`: "\u03D6", `\rho`: "\u03C1", `\varrho`: "\u03F1",
	`\sigma`: "\u03C3", `\varsigma`: "\u03C2", `\tau`: "\u03C4", `\upsilon`: "\u03C5",
	`\phi`: "\u03D5", `\varphi`: "\u03C6", `\chi`: "\u03C7", `\psi`: "\u03C8",
	`\omega`: "\u03C9",
	`\Gamma`: "\u0393", `\Delta`: "\u0394", `\Theta`: "\u0398", `\Lambda`: "\u039B",
	`\Xi`: "\u039E", `\Pi`: "\u03A0", `\Sigma`: "\u03A3", `\Upsilon`: "\u03A5",
	`\Phi`: "\u03A6", `\Psi`: "\u03A8", `\Omega`: "\u03A9",
	`\infty`: "\u221E", `\nabla`: "\u2207", `\partial`: "\u2202",
	`\forall`: "\u2200", `\exists`: "\u2203", `\nexists`: "\u2204",
	`\emptyset`: "\u2205", `\varnothing`: "\u2205",
	`\in`: "\u2208", `\notin`: "\u2209", `\ni`: "\u220B",
	`\subset`: "\u2282", `\supset`: "\u2283", `\subseteq`: "\u2286", `\supseteq`: "\u2287",
	`\cup`: "\u222A", `\cap`: "\u2229",
	`\pm`: "\u00B1", `\mp`: "\u2213", `\times`: "\u00D7", `\div`: "\u00F7",
	`\cdot`: "\u22C5", `\circ`: "\u2218", `\bullet`: "\u2022",
	`\leq`: "\u2264", `\geq`: "\u2265", `\neq`: "\u2260", `\approx`: "\u2248",
	`\equiv`: "\u2261", `\sim`: "\u223C", `\simeq`: "\u2243", `\cong`: "\u2245",
	`\propto`: "\u221D", `\ll`: "\u226A", `\gg`: "\u226B",
	`\to`: "\u2192", `\rightarrow`: "\u2192", `\leftarrow`: "\u2190",
	`\Rightarrow`: "\u21D2", `\Leftarrow`: "\u21D0", `\Leftrightarrow`: "\u21D4",
	`\mapsto`: "\u21A6",
	`\langle`: "\u27E8", `\rangle`: "\u27E9",
	`\ldots`: "\u2026", `\cdots`: "\u22EF", `\vdots`: "\u22EE", `\ddots`: "\u22F1",
	`\quad`: "\u2003", `\qquad`: "\u2003\u2003",
	`\,`: "\u2009", `\;`: "\u2005", `\!`: "",
	`\neg`: "\u00AC", `\wedge`: "\u2227", `\vee`: "\u2228",
	`\oplus`: "\u2295", `\otimes`: "\u2297",
	`\hat`: "\u0302", `\bar`: "\u0304", `\dot`: "\u0307", `\ddot`: "\u0308",
	`\tilde`: "\u0303", `\vec`: "\u20D7",
}

// latexToOmml converts a LaTeX math string to OMML (Office Math Markup Language).
// It handles fractions, subscripts, superscripts, square roots, Greek letters,
// and common operators.
func latexToOmml(latex string) string {
	latex = strings.TrimSpace(latex)
	if latex == "" {
		return ""
	}

	var b strings.Builder
	parseOmmlExpr(&b, latex)
	return b.String()
}

func parseOmmlExpr(b *strings.Builder, expr string) {
	i := 0
	for i < len(expr) {
		// Skip whitespace
		if expr[i] == ' ' || expr[i] == '\t' || expr[i] == '\n' {
			i++
			continue
		}

		// Handle alignment characters from align environments
		if expr[i] == '&' {
			i++
			continue
		}

		// Line breaks in multi-line math → ignore them
		if i+1 < len(expr) && expr[i] == '\\' && expr[i+1] == '\\' {
			i += 2
			// Skip optional [dim]
			if i < len(expr) && expr[i] == '[' {
				for i < len(expr) && expr[i] != ']' {
					i++
				}
				if i < len(expr) {
					i++
				}
			}
			continue
		}

		// \frac{num}{den}
		if strings.HasPrefix(expr[i:], `\frac`) {
			i += 5
			num, end1, ok1 := extractBraceGroupGo(expr, skipWS(expr, i))
			if ok1 {
				den, end2, ok2 := extractBraceGroupGo(expr, skipWS(expr, end1))
				if ok2 {
					b.WriteString("<m:f><m:num>")
					parseOmmlExpr(b, num)
					b.WriteString("</m:num><m:den>")
					parseOmmlExpr(b, den)
					b.WriteString("</m:den></m:f>")
					i = end2
					continue
				}
			}
		}

		// \sqrt[n]{x} or \sqrt{x}
		if strings.HasPrefix(expr[i:], `\sqrt`) {
			i += 5
			p := skipWS(expr, i)
			degree := ""
			if p < len(expr) && expr[p] == '[' {
				end := strings.Index(expr[p:], "]")
				if end >= 0 {
					degree = expr[p+1 : p+end]
					p = p + end + 1
				}
			}
			content, end, ok := extractBraceGroupGo(expr, skipWS(expr, p))
			if ok {
				if degree != "" {
					b.WriteString("<m:rad><m:radPr><m:degHide m:val=\"0\"/></m:radPr><m:deg>")
					parseOmmlExpr(b, degree)
					b.WriteString("</m:deg><m:e>")
				} else {
					b.WriteString("<m:rad><m:radPr><m:degHide m:val=\"1\"/></m:radPr><m:deg/><m:e>")
				}
				parseOmmlExpr(b, content)
				b.WriteString("</m:e></m:rad>")
				i = end
				continue
			}
		}

		// \sum, \prod, \int — nary operators
		naryOps := map[string]string{
			`\sum`: "\u2211", `\prod`: "\u220F", `\int`: "\u222B",
			`\oint`: "\u222E", `\bigcup`: "\u22C3", `\bigcap`: "\u22C2",
			`\coprod`: "\u2210", `\bigoplus`: "\u2A01", `\bigotimes`: "\u2A02",
			`\iint`: "\u222C", `\iiint`: "\u222D",
		}
		matched := false
		for cmd, chr := range naryOps {
			if strings.HasPrefix(expr[i:], cmd) {
				afterCmd := i + len(cmd)
				// Check for subscript/superscript limits
				sub, sup := "", ""
				p := skipWS(expr, afterCmd)
				if p < len(expr) && expr[p] == '_' {
					content, end, ok := extractBraceOrChar(expr, p+1)
					if ok {
						sub = content
						p = end
					}
				}
				p = skipWS(expr, p)
				if p < len(expr) && expr[p] == '^' {
					content, end, ok := extractBraceOrChar(expr, p+1)
					if ok {
						sup = content
						p = end
					}
				}
				b.WriteString(fmt.Sprintf(`<m:nary><m:naryPr><m:chr m:val="%s"/></m:naryPr>`, chr))
				b.WriteString("<m:sub>")
				if sub != "" {
					parseOmmlExpr(b, sub)
				}
				b.WriteString("</m:sub><m:sup>")
				if sup != "" {
					parseOmmlExpr(b, sup)
				}
				b.WriteString("</m:sup><m:e>")
				// Parse the rest of the expression as the nary body
				// (until end or next nary or close brace)
				remaining := strings.TrimSpace(expr[p:])
				parseOmmlExpr(b, remaining)
				b.WriteString("</m:e></m:nary>")
				i = len(expr)
				matched = true
				break
			}
		}
		if matched {
			continue
		}

		// \left( ... \right) — delimiter math
		if strings.HasPrefix(expr[i:], `\left`) {
			p := i + 5
			if p < len(expr) {
				openDelim := string(expr[p])
				p++
				// Find matching \right
				depth := 1
				start := p
				for p < len(expr) {
					if strings.HasPrefix(expr[p:], `\left`) {
						depth++
						p += 5
					} else if strings.HasPrefix(expr[p:], `\right`) {
						depth--
						if depth == 0 {
							innerContent := expr[start:p]
							p += 6 // skip \right
							closeDelim := ""
							if p < len(expr) {
								closeDelim = string(expr[p])
								p++
							}
							openC := delimChar(openDelim)
							closeC := delimChar(closeDelim)
							b.WriteString(fmt.Sprintf(`<m:d><m:dPr><m:begChr m:val="%s"/><m:endChr m:val="%s"/></m:dPr><m:e>`, openC, closeC))
							parseOmmlExpr(b, innerContent)
							b.WriteString("</m:e></m:d>")
							i = p
							goto nextChar
						}
						p += 6
					} else {
						p++
					}
				}
			}
		}

		// \text{...} or \mathrm{...} — regular text inside math
		if strings.HasPrefix(expr[i:], `\text{`) || strings.HasPrefix(expr[i:], `\mathrm{`) ||
			strings.HasPrefix(expr[i:], `\textrm{`) || strings.HasPrefix(expr[i:], `\mbox{`) {
			cmdEnd := strings.Index(expr[i:], "{")
			content, end, ok := extractBraceGroupGo(expr, i+cmdEnd)
			if ok {
				b.WriteString(fmt.Sprintf(`<m:r><m:rPr><m:nor/></m:rPr><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t>%s</m:t></m:r>`, escapeXML(content)))
				i = end
				continue
			}
		}

		// \mathbf{...} — bold math
		if strings.HasPrefix(expr[i:], `\mathbf{`) || strings.HasPrefix(expr[i:], `\boldsymbol{`) || strings.HasPrefix(expr[i:], `\bm{`) {
			cmdEnd := strings.Index(expr[i:], "{")
			content, end, ok := extractBraceGroupGo(expr, i+cmdEnd)
			if ok {
				b.WriteString(fmt.Sprintf(`<m:r><m:rPr><m:sty m:val="b"/></m:rPr><m:t>%s</m:t></m:r>`, escapeXML(replaceGreek(content))))
				i = end
				continue
			}
		}

		// Subscript/superscript: x_a, x^b, x_a^b
		if i+1 < len(expr) && expr[i] == '\\' {
			// This is a command — check if followed by sub/superscript
			cmdEnd := i + 1
			for cmdEnd < len(expr) && isLetter(expr[cmdEnd]) {
				cmdEnd++
			}
			cmd := expr[i:cmdEnd]

			// Check for known symbol + sub/super
			if sym, ok := latexToUnicode[cmd]; ok {
				p := skipWS(expr, cmdEnd)
				hasSub := p < len(expr) && expr[p] == '_'
				hasSup := p < len(expr) && expr[p] == '^'
				if !hasSub && !hasSup {
					b.WriteString(fmt.Sprintf(`<m:r><m:t>%s</m:t></m:r>`, sym))
					i = cmdEnd
					continue
				}
			}
		}

		// Handle _ and ^ (subscripts and superscripts)
		if i > 0 && (expr[i] == '_' || expr[i] == '^') {
			// Already part of a previous element, skip
		}
		if expr[i] == '_' || expr[i] == '^' {
			i++
			continue
		}

		// Text characters with possible sub/superscripts
		if expr[i] != '\\' && expr[i] != '{' && expr[i] != '}' {
			ch := string(expr[i])
			p := i + 1

			// Check for sub/superscript
			sub, sup := "", ""
			if p < len(expr) && expr[p] == '_' {
				content, end, ok := extractBraceOrChar(expr, p+1)
				if ok {
					sub = content
					p = end
				}
			}
			if p < len(expr) && expr[p] == '^' {
				content, end, ok := extractBraceOrChar(expr, p+1)
				if ok {
					sup = content
					p = end
				}
			}
			// Check for sub after sup
			if sub == "" && p < len(expr) && expr[p] == '_' {
				content, end, ok := extractBraceOrChar(expr, p+1)
				if ok {
					sub = content
					p = end
				}
			}

			if sub != "" || sup != "" {
				if sub != "" && sup != "" {
					b.WriteString("<m:sSubSup><m:e>")
					b.WriteString(fmt.Sprintf(`<m:r><m:t>%s</m:t></m:r>`, escapeXML(ch)))
					b.WriteString("</m:e><m:sub>")
					parseOmmlExpr(b, sub)
					b.WriteString("</m:sub><m:sup>")
					parseOmmlExpr(b, sup)
					b.WriteString("</m:sup></m:sSubSup>")
				} else if sub != "" {
					b.WriteString("<m:sSub><m:e>")
					b.WriteString(fmt.Sprintf(`<m:r><m:t>%s</m:t></m:r>`, escapeXML(ch)))
					b.WriteString("</m:e><m:sub>")
					parseOmmlExpr(b, sub)
					b.WriteString("</m:sub></m:sSub>")
				} else {
					b.WriteString("<m:sSup><m:e>")
					b.WriteString(fmt.Sprintf(`<m:r><m:t>%s</m:t></m:r>`, escapeXML(ch)))
					b.WriteString("</m:e><m:sup>")
					parseOmmlExpr(b, sup)
					b.WriteString("</m:sup></m:sSup>")
				}
				i = p
				continue
			}

			b.WriteString(fmt.Sprintf(`<m:r><m:t>%s</m:t></m:r>`, escapeXML(ch)))
			i = p
			continue
		}

		// LaTeX command
		if expr[i] == '\\' {
			cmdEnd := i + 1
			for cmdEnd < len(expr) && isLetter(expr[cmdEnd]) {
				cmdEnd++
			}
			if cmdEnd == i+1 && cmdEnd < len(expr) {
				// Single special char like \\ \, \; etc.
				cmdEnd++
			}
			cmd := expr[i:cmdEnd]

			// Known symbol?
			if sym, ok := latexToUnicode[cmd]; ok {
				p := skipWS(expr, cmdEnd)

				// Check for sub/superscript after symbol
				sub, sup := "", ""
				if p < len(expr) && expr[p] == '_' {
					content, end, ok := extractBraceOrChar(expr, p+1)
					if ok {
						sub = content
						p = end
					}
				}
				p2 := skipWS(expr, p)
				if p2 < len(expr) && expr[p2] == '^' {
					content, end, ok := extractBraceOrChar(expr, p2+1)
					if ok {
						sup = content
						p = end
					}
				}

				if sub != "" || sup != "" {
					if sub != "" && sup != "" {
						b.WriteString("<m:sSubSup><m:e>")
						b.WriteString(fmt.Sprintf(`<m:r><m:t>%s</m:t></m:r>`, sym))
						b.WriteString("</m:e><m:sub>")
						parseOmmlExpr(b, sub)
						b.WriteString("</m:sub><m:sup>")
						parseOmmlExpr(b, sup)
						b.WriteString("</m:sup></m:sSubSup>")
					} else if sub != "" {
						b.WriteString("<m:sSub><m:e>")
						b.WriteString(fmt.Sprintf(`<m:r><m:t>%s</m:t></m:r>`, sym))
						b.WriteString("</m:e><m:sub>")
						parseOmmlExpr(b, sub)
						b.WriteString("</m:sub></m:sSub>")
					} else {
						b.WriteString("<m:sSup><m:e>")
						b.WriteString(fmt.Sprintf(`<m:r><m:t>%s</m:t></m:r>`, sym))
						b.WriteString("</m:e><m:sup>")
						parseOmmlExpr(b, sup)
						b.WriteString("</m:sup></m:sSup>")
					}
					i = p
					continue
				}

				b.WriteString(fmt.Sprintf(`<m:r><m:t>%s</m:t></m:r>`, sym))
				i = cmdEnd
				continue
			}

			// Accents: \hat{x}, \bar{x}, etc.
			accents := map[string]string{
				`\hat`: "\u0302", `\check`: "\u030C", `\tilde`: "\u0303",
				`\acute`: "\u0301", `\grave`: "\u0300", `\dot`: "\u0307",
				`\ddot`: "\u0308", `\breve`: "\u0306", `\bar`: "\u0304",
				`\vec`: "\u20D7", `\widehat`: "\u0302", `\widetilde`: "\u0303",
				`\overline`: "\u0305",
			}
			if accent, ok := accents[cmd]; ok {
				content, end, ok := extractBraceGroupGo(expr, skipWS(expr, cmdEnd))
				if ok {
					b.WriteString(fmt.Sprintf(`<m:acc><m:accPr><m:chr m:val="%s"/></m:accPr><m:e>`, accent))
					parseOmmlExpr(b, content)
					b.WriteString("</m:e></m:acc>")
					i = end
					continue
				}
			}

			// Unknown command — render as text
			cmdName := strings.TrimPrefix(cmd, "\\")
			b.WriteString(fmt.Sprintf(`<m:r><m:t>%s</m:t></m:r>`, escapeXML(cmdName)))
			i = cmdEnd
			continue
		}

		// Braces — content group
		if expr[i] == '{' {
			content, end, ok := extractBraceGroupGo(expr, i)
			if ok {
				parseOmmlExpr(b, content)
				i = end
				continue
			}
		}

		i++
		continue

	nextChar:
	}
}

func skipWS(s string, i int) int {
	for i < len(s) && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n') {
		i++
	}
	return i
}

func extractBraceOrChar(expr string, pos int) (string, int, bool) {
	pos = skipWS(expr, pos)
	if pos >= len(expr) {
		return "", pos, false
	}
	if expr[pos] == '{' {
		return extractBraceGroupGo(expr, pos)
	}
	// Single character
	if expr[pos] == '\\' {
		// Command
		end := pos + 1
		for end < len(expr) && isLetter(expr[end]) {
			end++
		}
		if end == pos+1 && end < len(expr) {
			end++
		}
		return expr[pos:end], end, true
	}
	return string(expr[pos]), pos + 1, true
}

func delimChar(s string) string {
	switch s {
	case "(":
		return "("
	case ")":
		return ")"
	case "[":
		return "["
	case "]":
		return "]"
	case "\\{", "{":
		return "{"
	case "\\}", "}":
		return "}"
	case "|":
		return "|"
	case ".", "":
		return "" // invisible delimiter
	default:
		return s
	}
}

func replaceGreek(s string) string {
	result := s
	for cmd, uni := range latexToUnicode {
		result = strings.ReplaceAll(result, cmd, uni)
	}
	return result
}

// buildOmmlMathParagraph wraps LaTeX math content in a display math paragraph.
func buildOmmlMathParagraph(latex string) string {
	var b strings.Builder
	b.WriteString("    <w:p>\n")
	b.WriteString("      <w:pPr><w:jc w:val=\"center\"/></w:pPr>\n")
	b.WriteString("      <m:oMathPara><m:oMath>\n")
	b.WriteString(latexToOmml(latex))
	b.WriteString("\n      </m:oMath></m:oMathPara>\n")
	b.WriteString("    </w:p>\n")
	return b.String()
}

// buildOmmlInlineMath wraps LaTeX math content in an inline OMML element.
func buildOmmlInlineMath(latex string) string {
	var b strings.Builder
	b.WriteString("<m:oMath>")
	b.WriteString(latexToOmml(latex))
	b.WriteString("</m:oMath>")
	return b.String()
}

// ═══════════════════════════════════════════════════════════════
// Static OOXML parts
// ═══════════════════════════════════════════════════════════════

const contentTypesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>`

const relsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const wordRelsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>`

const stylesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
        <w:sz w:val="24"/>
        <w:szCs w:val="24"/>
        <w:lang w:val="en-US"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="0" w:line="240" w:lineRule="auto"/>
        <w:jc w:val="both"/>
        <w:ind w:firstLine="360"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>

  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:after="120"/>
    </w:pPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="240" w:after="120" w:line="240" w:lineRule="auto"/>
      <w:jc w:val="center"/>
      <w:ind w:firstLine="0"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="34"/>
      <w:szCs w:val="34"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Author">
    <w:name w:val="Author"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:after="60"/>
      <w:jc w:val="center"/>
      <w:ind w:firstLine="0"/>
    </w:pPr>
    <w:rPr>
      <w:sz w:val="24"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Date">
    <w:name w:val="Date"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:after="200"/>
      <w:jc w:val="center"/>
      <w:ind w:firstLine="0"/>
    </w:pPr>
    <w:rPr>
      <w:sz w:val="24"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="AbstractText">
    <w:name w:val="Abstract Text"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:left="720" w:right="720" w:firstLine="0"/>
      <w:spacing w:after="200"/>
    </w:pPr>
    <w:rPr>
      <w:sz w:val="20"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="360" w:after="120" w:line="240" w:lineRule="auto"/>
      <w:ind w:firstLine="0"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="240" w:after="80" w:line="240" w:lineRule="auto"/>
      <w:ind w:firstLine="0"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="26"/>
      <w:szCs w:val="26"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="200" w:after="60"/>
      <w:ind w:firstLine="0"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:i/>
      <w:sz w:val="24"/>
      <w:szCs w:val="24"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="MathBlock">
    <w:name w:val="Math Block"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="120" w:after="120"/>
      <w:jc w:val="center"/>
      <w:ind w:firstLine="0"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>
      <w:i/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="CodeBlock">
    <w:name w:val="Code Block"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>
      <w:ind w:left="360" w:firstLine="0"/>
      <w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>
      <w:sz w:val="18"/>
      <w:szCs w:val="18"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="ListBullet">
    <w:name w:val="List Bullet"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:numPr>
        <w:numId w:val="1"/>
      </w:numPr>
      <w:ind w:left="720" w:hanging="360" w:firstLineChars="0" w:firstLine="0"/>
    </w:pPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="ListNumber">
    <w:name w:val="List Number"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:numPr>
        <w:numId w:val="2"/>
      </w:numPr>
      <w:ind w:left="720" w:hanging="360" w:firstLineChars="0" w:firstLine="0"/>
    </w:pPr>
  </w:style>

  <w:style w:type="table" w:styleId="TableGrid">
    <w:name w:val="Table Grid"/>
    <w:tblPr>
      <w:tblBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        <w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>
      </w:tblBorders>
    </w:tblPr>
  </w:style>
</w:styles>`

const numberingXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="&#x2022;"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="0"/>
  </w:num>
  <w:num w:numId="2">
    <w:abstractNumId w:val="1"/>
  </w:num>
</w:numbering>`

const settingsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <m:mathPr>
    <m:mathFont m:val="Cambria Math"/>
    <m:brkBin m:val="before"/>
    <m:brkBinSub m:val="--"/>
    <m:smallFrac m:val="0"/>
    <m:dispDef/>
    <m:lMargin m:val="0"/>
    <m:rMargin m:val="0"/>
    <m:defJc m:val="centerGroup"/>
    <m:wrapIndent m:val="1440"/>
    <m:intLim m:val="subSup"/>
    <m:naryLim m:val="undOvr"/>
  </m:mathPr>
  <w:defaultTabStop w:val="720"/>
  <w:characterSpacingControl w:val="doNotCompress"/>
</w:settings>`

// ═══════════════════════════════════════════════════════════════
// Public entry point
// ═══════════════════════════════════════════════════════════════

// ConvertLatexToDocx parses a LaTeX source string and produces a
// properly formatted .docx file as a byte slice.
func ConvertLatexToDocx(source string) ([]byte, error) {
	doc := parseLatexDocument(source)
	return buildFormattedDocx(doc)
}
