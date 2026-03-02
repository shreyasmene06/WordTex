package engine

import (
	"archive/zip"
	"bytes"
	"fmt"
	"regexp"
	"strings"
)

// ── Parsed document model ───────────────────────────────────────

type elemKind int

const (
	kindParagraph elemKind = iota
	kindSection
	kindSubsection
	kindSubsubsection
	kindMathBlock
	kindItemize
	kindEnumerate
	kindVerbatim
	kindTheorem
	kindTable
)

type fmtRun struct {
	Text   string
	Bold   bool
	Italic bool
	Mono   bool
}

type bodyElem struct {
	Kind  elemKind
	Title string     // for sections / theorem label
	Runs  []fmtRun   // for paragraphs, theorem content
	Items [][]fmtRun // for lists (each item is a slice of runs)
	Lines []string   // for verbatim, math blocks, tables
}

type parsedDoc struct {
	Title    string
	Authors  []string
	Abstract string
	Body     []bodyElem
}

// ── Regex helpers ───────────────────────────────────────────────

var (
	reTitle          = regexp.MustCompile(`\\title\{([^}]*)\}`)
	reAuthorBlock    = regexp.MustCompile(`(?s)\\author\{(.*?)\}`)
	reAuthorName     = regexp.MustCompile(`\\IEEEauthorblockN\{([^}]*)\}`)
	reSection        = regexp.MustCompile(`^\\section\*?\{([^}]*)\}`)
	reSubsection     = regexp.MustCompile(`^\\subsection\*?\{([^}]*)\}`)
	reSubsubsection  = regexp.MustCompile(`^\\subsubsection\*?\{([^}]*)\}`)
	reBold           = regexp.MustCompile(`\\textbf\{([^}]*)\}`)
	reItalic         = regexp.MustCompile(`\\textit\{([^}]*)\}`)
	reEmph           = regexp.MustCompile(`\\emph\{([^}]*)\}`)
	reSmallCaps      = regexp.MustCompile(`\\textsc\{([^}]*)\}`)
	reInlineMath     = regexp.MustCompile(`\$([^$]+)\$`)
	reLabel          = regexp.MustCompile(`\\label\{[^}]*\}`)
	reRef            = regexp.MustCompile(`\\(?:eq)?ref\{[^}]*\}`)
	reCite           = regexp.MustCompile(`\\cite\{[^}]*\}`)
	reCommand        = regexp.MustCompile(`\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^}]*)\}`)
	reLaTeX          = regexp.MustCompile(`\\LaTeX\b\{?\}?`)
	reNewtheorem     = regexp.MustCompile(`^\\newtheorem`)
	reTheoremBegin   = regexp.MustCompile(`^\\begin\{(theorem|lemma|definition|corollary|proposition)\}(?:\[([^\]]*)\])?`)
	reTheoremEnd     = regexp.MustCompile(`^\\end\{(theorem|lemma|definition|corollary|proposition)\}`)
	reTableBegin     = regexp.MustCompile(`^\\begin\{tabular`)
	reTableEnd       = regexp.MustCompile(`^\\end\{tabular\}`)
	reCaption        = regexp.MustCompile(`\\caption\{([^}]*)\}`)
	reMaketitle      = regexp.MustCompile(`^\\maketitle`)
	reBibStyle       = regexp.MustCompile(`^\\bibliographystyle`)
	reBibliography   = regexp.MustCompile(`^\\bibliography`)
)

// ── Parser ──────────────────────────────────────────────────────

func parseLatexDocument(src string) parsedDoc {
	doc := parsedDoc{}

	// Extract title
	if m := reTitle.FindStringSubmatch(src); m != nil {
		doc.Title = cleanInline(m[1])
	}

	// Extract authors
	if m := reAuthorBlock.FindStringSubmatch(src); m != nil {
		names := reAuthorName.FindAllStringSubmatch(m[1], -1)
		for _, n := range names {
			doc.Authors = append(doc.Authors, strings.TrimSpace(n[1]))
		}
		// Fallback: if no \IEEEauthorblockN, just use the raw author text
		if len(doc.Authors) == 0 {
			raw := strings.TrimSpace(m[1])
			raw = regexp.MustCompile(`\\\\`).ReplaceAllString(raw, ", ")
			raw = regexp.MustCompile(`\\[a-zA-Z]+\{([^}]*)\}`).ReplaceAllString(raw, "$1")
			for _, a := range strings.Split(raw, "\\and") {
				a = strings.TrimSpace(a)
				if a != "" {
					doc.Authors = append(doc.Authors, a)
				}
			}
		}
	}

	// Extract abstract
	absRe := regexp.MustCompile(`(?s)\\begin\{abstract\}(.*?)\\end\{abstract\}`)
	if m := absRe.FindStringSubmatch(src); m != nil {
		doc.Abstract = cleanInline(strings.TrimSpace(m[1]))
	}

	// Extract body (between \begin{document} and \end{document})
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

		// Skip known metadata / no-op commands
		if line == "" ||
			reMaketitle.MatchString(line) ||
			reNewtheorem.MatchString(line) ||
			reBibStyle.MatchString(line) ||
			reBibliography.MatchString(line) ||
			strings.HasPrefix(line, `\begin{document}`) ||
			strings.HasPrefix(line, `\end{document}`) ||
			strings.HasPrefix(line, `\begin{abstract}`) ||
			strings.HasPrefix(line, `\end{abstract}`) ||
			strings.HasPrefix(line, `\title{`) ||
			strings.HasPrefix(line, `\author{`) ||
			strings.HasPrefix(line, `\usepackage`) ||
			strings.HasPrefix(line, `\documentclass`) {

			// Check for multi-line commands (author block, etc.)
			if strings.HasPrefix(line, `\author{`) || strings.HasPrefix(line, `\title{`) {
				// Skip until closing brace balanced
				depth := strings.Count(line, "{") - strings.Count(line, "}")
				for depth > 0 && i+1 < len(lines) {
					i++
					line = lines[i]
					depth += strings.Count(line, "{") - strings.Count(line, "}")
				}
			}

			if line == "" {
				flushPara()
			}
			i++
			continue
		}

		// Skip abstract block (already extracted)
		if strings.HasPrefix(line, `\begin{abstract}`) {
			for i < len(lines) && !strings.Contains(lines[i], `\end{abstract}`) {
				i++
			}
			i++
			continue
		}

		// Section headings
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

		// Theorem-like environments
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
			for i < len(lines) && !reTheoremEnd.MatchString(strings.TrimSpace(lines[i])) {
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

		// Verbatim / code
		if strings.HasPrefix(line, `\begin{verbatim}`) {
			flushPara()
			var codeLines []string
			i++
			for i < len(lines) && !strings.Contains(lines[i], `\end{verbatim}`) {
				codeLines = append(codeLines, lines[i])
				i++
			}
			elems = append(elems, bodyElem{Kind: kindVerbatim, Lines: codeLines})
			i++ // skip \end{verbatim}
			continue
		}

		// Math display blocks
		if strings.HasPrefix(line, `\begin{equation}`) ||
			strings.HasPrefix(line, `\begin{align}`) ||
			strings.HasPrefix(line, `\[`) {
			flushPara()
			endPat := `\end{equation}`
			if strings.HasPrefix(line, `\begin{align}`) {
				endPat = `\end{align}`
			} else if strings.HasPrefix(line, `\[`) {
				endPat = `\]`
			}
			var mathLines []string
			i++
			for i < len(lines) && !strings.Contains(lines[i], endPat) {
				mathLines = append(mathLines, strings.TrimSpace(lines[i]))
				i++
			}
			elems = append(elems, bodyElem{Kind: kindMathBlock, Lines: mathLines})
			i++ // skip \end{...}
			continue
		}

		// Lists
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
				// Skip nested list open/close (flatten)
				if strings.HasPrefix(l, `\begin{itemize}`) || strings.HasPrefix(l, `\begin{enumerate}`) ||
					strings.HasPrefix(l, `\end{itemize}`) || strings.HasPrefix(l, `\end{enumerate}`) {
					i++
					continue
				}
				if strings.HasPrefix(l, `\item`) {
					if curItem != "" {
						items = append(items, parseInlineFormatting(cleanInline(curItem)))
					}
					curItem = strings.TrimSpace(strings.TrimPrefix(l, `\item`))
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

		// Table environments
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
				// Collect tabular content
				if reTableBegin.MatchString(tl) {
					i++
					for i < len(lines) && !reTableEnd.MatchString(strings.TrimSpace(lines[i])) {
						row := strings.TrimSpace(lines[i])
						// Skip \toprule, \midrule, \bottomrule, \hline, \cline, \centering
						if row != "" &&
							!strings.HasPrefix(row, `\toprule`) &&
							!strings.HasPrefix(row, `\midrule`) &&
							!strings.HasPrefix(row, `\bottomrule`) &&
							!strings.HasPrefix(row, `\hline`) &&
							!strings.HasPrefix(row, `\cline`) &&
							!strings.HasPrefix(row, `\centering`) &&
							!strings.HasPrefix(row, `\multirow`) &&
							!strings.HasPrefix(row, `\multicolumn`) {
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
			i++ // skip \end{table}
			continue
		}

		// Skip standalone \label lines
		if reLabel.MatchString(line) && len(strings.TrimSpace(reLabel.ReplaceAllString(line, ""))) == 0 {
			i++
			continue
		}

		// Skip comment-only lines
		if strings.HasPrefix(line, "%") {
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

// ── Inline formatting parser ────────────────────────────────────

func parseInlineFormatting(text string) []fmtRun {
	// We tokenize the text by scanning for \textbf{}, \textit{}, \emph{}, $...$
	var runs []fmtRun
	remaining := text

	for remaining != "" {
		// Find the earliest formatting command
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
			bestType = "bold"
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

		if bestType == "" {
			// No more formatting found — rest is plain text
			cleaned := cleanPlain(remaining)
			if cleaned != "" {
				runs = append(runs, fmtRun{Text: cleaned})
			}
			break
		}

		// Add plain text before this match
		if bestIdx > 0 {
			cleaned := cleanPlain(remaining[:bestIdx])
			if cleaned != "" {
				runs = append(runs, fmtRun{Text: cleaned})
			}
		}

		// Add the formatted run
		switch bestType {
		case "bold":
			runs = append(runs, fmtRun{Text: cleanPlain(bestContent), Bold: true})
		case "italic":
			runs = append(runs, fmtRun{Text: cleanPlain(bestContent), Italic: true})
		case "math":
			runs = append(runs, fmtRun{Text: bestContent, Mono: true})
		}

		remaining = remaining[bestIdx+bestLen:]
	}

	return runs
}

// cleanInline strips \label, replaces \ref/\cite, expands \LaTeX, and
// removes leftover single-arg commands while preserving their content.
func cleanInline(s string) string {
	s = reLabel.ReplaceAllString(s, "")
	s = reRef.ReplaceAllString(s, "[ref]")
	s = reCite.ReplaceAllString(s, "[citation]")
	s = reLaTeX.ReplaceAllString(s, "LaTeX")
	s = strings.ReplaceAll(s, `~`, " ")
	s = strings.ReplaceAll(s, `\,`, " ")
	s = strings.ReplaceAll(s, `\;`, " ")
	s = strings.ReplaceAll(s, `\!`, "")
	return strings.TrimSpace(s)
}

// cleanPlain removes remaining LaTeX commands from plain text segments
func cleanPlain(s string) string {
	s = reLabel.ReplaceAllString(s, "")
	s = reRef.ReplaceAllString(s, "[ref]")
	s = reCite.ReplaceAllString(s, "[citation]")
	s = reLaTeX.ReplaceAllString(s, "LaTeX")
	s = strings.ReplaceAll(s, `~`, " ")
	s = strings.ReplaceAll(s, `\,`, " ")
	s = strings.ReplaceAll(s, `\;`, " ")
	s = strings.ReplaceAll(s, `\!`, "")
	// Remove remaining simple commands like \centering, \and, etc.
	s = regexp.MustCompile(`\\[a-zA-Z]+\*?`).ReplaceAllString(s, "")
	// Collapse braces
	s = strings.ReplaceAll(s, "{", "")
	s = strings.ReplaceAll(s, "}", "")
	// Collapse whitespace
	s = regexp.MustCompile(`\s+`).ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

// ── OOXML Builder ───────────────────────────────────────────────

func buildFormattedDocx(doc parsedDoc) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	// [Content_Types].xml
	addZipFileB(zw, "[Content_Types].xml", contentTypesXML)

	// _rels/.rels
	addZipFileB(zw, "_rels/.rels", relsXML)

	// word/_rels/document.xml.rels
	addZipFileB(zw, "word/_rels/document.xml.rels", wordRelsXML)

	// word/styles.xml
	addZipFileB(zw, "word/styles.xml", stylesXML)

	// word/numbering.xml
	addZipFileB(zw, "word/numbering.xml", numberingXML)

	// word/document.xml
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
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
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

	// Abstract
	if doc.Abstract != "" {
		b.WriteString(styledPara("Heading2", []fmtRun{{Text: "Abstract", Italic: true}}))
		runs := parseInlineFormatting(doc.Abstract)
		// Wrap in italic style
		for i := range runs {
			runs[i].Italic = true
		}
		b.WriteString(styledPara("AbstractText", runs))
	}

	// Body elements
	for _, elem := range doc.Body {
		switch elem.Kind {
		case kindSection:
			b.WriteString(styledPara("Heading1", []fmtRun{{Text: elem.Title}}))
		case kindSubsection:
			b.WriteString(styledPara("Heading2", []fmtRun{{Text: elem.Title}}))
		case kindSubsubsection:
			b.WriteString(styledPara("Heading3", []fmtRun{{Text: elem.Title}}))

		case kindParagraph:
			b.WriteString(styledPara("Normal", elem.Runs))

		case kindTheorem:
			// Theorem title in bold, content in italic
			b.WriteString(styledPara("Normal", []fmtRun{{Text: elem.Title + ".", Bold: true}}))
			itRuns := make([]fmtRun, len(elem.Runs))
			copy(itRuns, elem.Runs)
			for i := range itRuns {
				itRuns[i].Italic = true
			}
			b.WriteString(styledPara("Normal", itRuns))

		case kindMathBlock:
			// Render math block as monospaced indented text
			content := strings.Join(elem.Lines, "\n")
			content = cleanPlain(content)
			b.WriteString(styledPara("MathBlock", []fmtRun{{Text: content, Mono: true}}))

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

		case kindTable:
			if elem.Title != "" {
				b.WriteString(styledPara("Normal", []fmtRun{{Text: "Table: " + elem.Title, Bold: true, Italic: true}}))
			}
			b.WriteString(buildOOXMLTable(elem.Lines))
		}
	}

	b.WriteString(`    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"
               w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`)

	return b.String()
}

func styledPara(style string, runs []fmtRun) string {
	var b strings.Builder
	b.WriteString("    <w:p>\n")
	if style != "" && style != "Normal" {
		b.WriteString(fmt.Sprintf("      <w:pPr><w:pStyle w:val=\"%s\"/></w:pPr>\n", style))
	}
	for _, r := range runs {
		b.WriteString("      <w:r>")
		// Run properties
		var rpr []string
		if r.Bold {
			rpr = append(rpr, "<w:b/>")
		}
		if r.Italic {
			rpr = append(rpr, "<w:i/>")
		}
		if r.Mono {
			rpr = append(rpr, `<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>`)
			rpr = append(rpr, `<w:sz w:val="20"/>`)
		}
		if len(rpr) > 0 {
			b.WriteString("<w:rPr>")
			b.WriteString(strings.Join(rpr, ""))
			b.WriteString("</w:rPr>")
		}
		b.WriteString(fmt.Sprintf(`<w:t xml:space="preserve">%s</w:t>`, escapeXML(r.Text)))
		b.WriteString("</w:r>\n")
	}
	b.WriteString("    </w:p>\n")
	return b.String()
}

func listPara(style string, runs []fmtRun) string {
	var b strings.Builder
	b.WriteString("    <w:p>\n")
	b.WriteString(fmt.Sprintf("      <w:pPr><w:pStyle w:val=\"%s\"/></w:pPr>\n", style))
	for _, r := range runs {
		b.WriteString("      <w:r>")
		var rpr []string
		if r.Bold {
			rpr = append(rpr, "<w:b/>")
		}
		if r.Italic {
			rpr = append(rpr, "<w:i/>")
		}
		if len(rpr) > 0 {
			b.WriteString("<w:rPr>")
			b.WriteString(strings.Join(rpr, ""))
			b.WriteString("</w:rPr>")
		}
		b.WriteString(fmt.Sprintf(`<w:t xml:space="preserve">%s</w:t>`, escapeXML(r.Text)))
		b.WriteString("</w:r>\n")
	}
	b.WriteString("    </w:p>\n")
	return b.String()
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
			for _, r := range runs {
				b.WriteString("<w:r>")
				var rpr []string
				if r.Bold {
					rpr = append(rpr, "<w:b/>")
				}
				if r.Italic {
					rpr = append(rpr, "<w:i/>")
				}
				if len(rpr) > 0 {
					b.WriteString("<w:rPr>")
					b.WriteString(strings.Join(rpr, ""))
					b.WriteString("</w:rPr>")
				}
				b.WriteString(fmt.Sprintf(`<w:t xml:space="preserve">%s</w:t>`, escapeXML(r.Text)))
				b.WriteString("</w:r>")
			}
			b.WriteString("</w:p>\n")
			b.WriteString("        </w:tc>\n")
		}
		b.WriteString("      </w:tr>\n")
	}
	b.WriteString("    </w:tbl>\n")
	return b.String()
}

// ── Static OOXML parts ─────────────────────────────────────────

const contentTypesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`

const relsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const wordRelsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`

const stylesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
        <w:sz w:val="22"/>
        <w:szCs w:val="22"/>
        <w:lang w:val="en-US"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="160" w:line="259" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>

  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:after="120" w:line="240" w:lineRule="auto"/>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="48"/>
      <w:szCs w:val="48"/>
      <w:color w:val="1F2937"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Author">
    <w:name w:val="Author"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:after="240"/>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:rPr>
      <w:sz w:val="24"/>
      <w:color w:val="4B5563"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="AbstractText">
    <w:name w:val="Abstract Text"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:left="720" w:right="720"/>
      <w:spacing w:after="240"/>
    </w:pPr>
    <w:rPr>
      <w:i/>
      <w:sz w:val="21"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="360" w:after="120" w:line="240" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="32"/>
      <w:szCs w:val="32"/>
      <w:color w:val="1E3A5F"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="240" w:after="80" w:line="240" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
      <w:color w:val="2B5797"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="200" w:after="60"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:i/>
      <w:sz w:val="24"/>
      <w:szCs w:val="24"/>
      <w:color w:val="3B6FB6"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="MathBlock">
    <w:name w:val="Math Block"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="120" w:after="120"/>
      <w:ind w:left="720"/>
      <w:jc w:val="center"/>
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
      <w:ind w:left="360"/>
      <w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>
      <w:sz w:val="20"/>
      <w:szCs w:val="20"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="ListBullet">
    <w:name w:val="List Bullet"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:numPr>
        <w:numId w:val="1"/>
      </w:numPr>
      <w:ind w:left="720" w:hanging="360"/>
    </w:pPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="ListNumber">
    <w:name w:val="List Number"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:numPr>
        <w:numId w:val="2"/>
      </w:numPr>
      <w:ind w:left="720" w:hanging="360"/>
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

// ── Public entry point ──────────────────────────────────────────

// ConvertLatexToDocx parses a LaTeX source string and produces a
// properly formatted .docx file as a byte slice.
func ConvertLatexToDocx(source string) ([]byte, error) {
	doc := parseLatexDocument(source)
	return buildFormattedDocx(doc)
}
