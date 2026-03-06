package engine

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// ConvertLatexToDocxPandoc converts LaTeX source to a high-fidelity .docx file.
//
// Strategy (in priority order):
//  1. LaTeX → DOCX via pandoc (with preprocessing + reference doc + Lua filter)
//  2. LaTeX → DOCX via built-in Go converter (basic fallback)
//
// The LaTeX source is preprocessed to simplify resume-specific constructs
// (like tabular date layouts, \hfill, \titlerule, etc.) into forms that
// pandoc handles well.  A reference .docx sets fonts/margins/spacing to match
// the original LaTeX template, and a Lua filter flattens layout tables.
func ConvertLatexToDocxPandoc(ctx context.Context, source []byte, additionalFiles []FileAttachment) ([]byte, error) {
	// Pandoc path with preprocessing
	if docx, err := convertViaPandoc(ctx, source, additionalFiles); err == nil {
		return docx, nil
	}

	// Last resort: built-in Go converter
	return ConvertLatexToDocx(string(source))
}

// convertViaHTML converts LaTeX → HTML via make4ht then HTML → DOCX via pandoc.
// make4ht is part of texlive and runs the actual TeX engine, so it preserves
// all formatting decisions (margins, spacing, font sizes, etc.) in the HTML+CSS
// output. pandoc then converts that styled HTML into DOCX with much better
// fidelity than it gets from parsing raw LaTeX.
func convertViaHTML(ctx context.Context, source []byte, additionalFiles []FileAttachment) ([]byte, error) {
	// Check that make4ht is available (part of texlive-full)
	make4htBin, err := exec.LookPath("make4ht")
	if err != nil {
		return nil, fmt.Errorf("make4ht not found: %w", err)
	}

	pandocBin, err := findPandoc()
	if err != nil {
		return nil, err
	}

	tmpDir, err := os.MkdirTemp("", "wordtex-html2docx-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	texPath := filepath.Join(tmpDir, "document.tex")
	if err := os.WriteFile(texPath, source, 0644); err != nil {
		return nil, fmt.Errorf("failed to write .tex: %w", err)
	}

	// Write additional files (.cls, .sty, .bib, images, etc.)
	for _, af := range additionalFiles {
		baseName := filepath.Base(af.Filename)
		if baseName == "." || baseName == "/" {
			continue
		}
		afPath := filepath.Join(tmpDir, baseName)
		if err := os.WriteFile(afPath, af.Data, 0644); err != nil {
			return nil, fmt.Errorf("failed to write additional file %q: %w", baseName, err)
		}
	}

	// Create a make4ht config that produces clean HTML with inline CSS
	// This ensures styling is embedded rather than in external .css
	mk4Config := filepath.Join(tmpDir, "config.cfg")
	cfgContent := `\Preamble{xhtml,css-in,NoFonts,charset=utf-8}
\begin{document}
\EndPreamble`
	os.WriteFile(mk4Config, []byte(cfgContent), 0644)

	// Step 1: LaTeX → HTML via make4ht (runs through TeX engine)
	cmdCtx1, cancel1 := context.WithTimeout(ctx, 120*time.Second)
	defer cancel1()

	cmd1 := exec.CommandContext(cmdCtx1, make4htBin,
		"-u",           // UTF-8 output
		"-f", "html5",  // HTML5 format
		"-c", mk4Config,
		"document.tex",
	)
	cmd1.Dir = tmpDir
	out1, err := cmd1.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("make4ht failed: %s (%w)", strings.TrimSpace(string(out1)), err)
	}

	htmlPath := filepath.Join(tmpDir, "document.html")
	if _, err := os.Stat(htmlPath); err != nil {
		return nil, fmt.Errorf("make4ht did not produce HTML output")
	}

	// Read the HTML and inline the CSS if it's external
	htmlData, err := os.ReadFile(htmlPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read HTML: %w", err)
	}

	// Check for CSS file and inline it
	cssPath := filepath.Join(tmpDir, "document.css")
	if cssData, err := os.ReadFile(cssPath); err == nil && len(cssData) > 0 {
		// Insert CSS as <style> in <head>
		cssTag := fmt.Sprintf("<style type=\"text/css\">\n%s\n</style>\n</head>", string(cssData))
		htmlStr := strings.Replace(string(htmlData), "</head>", cssTag, 1)
		htmlData = []byte(htmlStr)
		// Write back the modified HTML
		os.WriteFile(htmlPath, htmlData, 0644)
	}

	// Step 2: HTML → DOCX via pandoc
	docxPath := filepath.Join(tmpDir, "document.docx")

	// Generate reference doc for consistent styling
	refDocPath := filepath.Join(tmpDir, "reference.docx")
	if err := generateReferenceDoc(refDocPath, string(source)); err != nil {
		refDocPath = ""
	}

	args := []string{
		"--from=html",
		"--to=docx",
		"--output=" + docxPath,
		"--standalone",
	}

	if refDocPath != "" {
		args = append(args, "--reference-doc="+refDocPath)
	}

	args = append(args, htmlPath)

	cmdCtx2, cancel2 := context.WithTimeout(ctx, 60*time.Second)
	defer cancel2()

	cmd2 := exec.CommandContext(cmdCtx2, pandocBin, args...)
	cmd2.Dir = tmpDir
	out2, err := cmd2.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("pandoc HTML→DOCX failed: %s (%w)", strings.TrimSpace(string(out2)), err)
	}

	docxData, err := os.ReadFile(docxPath)
	if err != nil {
		return nil, fmt.Errorf("DOCX not found after pandoc HTML→DOCX: %w", err)
	}

	if len(docxData) == 0 {
		return nil, fmt.Errorf("pandoc produced empty DOCX from HTML")
	}

	// Strip any residual table borders
	docxData, _ = stripTableBorders(docxData)

	return docxData, nil
}

// convertViaPDF compiles LaTeX→PDF then converts PDF→DOCX via LibreOffice.
// This produces a DOCX that is visually identical to the PDF preview.
func convertViaPDF(ctx context.Context, source []byte, additionalFiles []FileAttachment) ([]byte, error) {
	// Check that LibreOffice is available
	soffice, err := findLibreOffice()
	if err != nil {
		return nil, err
	}

	// Detect the best LaTeX engine for this source
	engine := detectLatexEngine(string(source))

	// Compile LaTeX → PDF (reuses the same compiler as the preview)
	pdfData, err := CompileLatexToPDF(ctx, source, engine, additionalFiles)
	if err != nil {
		// Try fallback engines
		for _, fb := range []string{"pdflatex", "xelatex", "lualatex"} {
			if fb == engine {
				continue
			}
			pdfData, err = CompileLatexToPDF(ctx, source, fb, additionalFiles)
			if err == nil {
				break
			}
		}
		if err != nil {
			return nil, fmt.Errorf("LaTeX compilation for DOCX failed: %w", err)
		}
	}

	// Write PDF to temp dir
	tmpDir, err := os.MkdirTemp("", "wordtex-pdf2docx-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	pdfPath := filepath.Join(tmpDir, "document.pdf")
	if err := os.WriteFile(pdfPath, pdfData, 0644); err != nil {
		return nil, fmt.Errorf("failed to write PDF: %w", err)
	}

	// Convert PDF → DOCX using LibreOffice headless
	cmdCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, soffice,
		"--headless",
		"--convert-to", "docx",
		"--outdir", tmpDir,
		pdfPath,
	)
	cmd.Dir = tmpDir
	// LibreOffice needs a writable HOME for its profile
	cmd.Env = append(os.Environ(), "HOME="+tmpDir)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("LibreOffice conversion failed: %s (%w)", strings.TrimSpace(string(output)), err)
	}

	docxPath := filepath.Join(tmpDir, "document.docx")
	docxData, err := os.ReadFile(docxPath)
	if err != nil {
		return nil, fmt.Errorf("DOCX output not found after LibreOffice: %w", err)
	}

	if len(docxData) == 0 {
		return nil, fmt.Errorf("LibreOffice produced an empty DOCX")
	}

	return docxData, nil
}

// convertViaPandoc converts LaTeX→DOCX using pandoc with reference doc styling.
// It preprocesses the LaTeX source to simplify resume-specific constructs.
func convertViaPandoc(ctx context.Context, source []byte, additionalFiles []FileAttachment) ([]byte, error) {
	pandocBin, err := findPandoc()
	if err != nil {
		return nil, err
	}

	tmpDir, err := os.MkdirTemp("", "wordtex-docx-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	// Preprocess the LaTeX to simplify constructs pandoc handles poorly
	processed := preprocessLatexForPandoc(string(source))

	texPath := filepath.Join(tmpDir, "document.tex")
	docxPath := filepath.Join(tmpDir, "document.docx")

	if err := os.WriteFile(texPath, []byte(processed), 0644); err != nil {
		return nil, fmt.Errorf("failed to write .tex file: %w", err)
	}

	// Write additional files (.cls, .sty, .bib, images, etc.)
	for _, af := range additionalFiles {
		baseName := filepath.Base(af.Filename)
		if baseName == "." || baseName == "/" {
			continue
		}
		afPath := filepath.Join(tmpDir, baseName)
		if err := os.WriteFile(afPath, af.Data, 0644); err != nil {
			return nil, fmt.Errorf("failed to write additional file %q: %w", baseName, err)
		}
	}

	// Generate reference doc for pandoc style matching
	refDocPath := filepath.Join(tmpDir, "reference.docx")
	if err := generateReferenceDoc(refDocPath, string(source)); err != nil {
		refDocPath = ""
	}

	args := []string{
		"--from=latex",
		"--to=docx",
		"--output=" + docxPath,
		"--standalone",
		"--resource-path=" + tmpDir,
	}

	// Lua filter to flatten layout tables and handle formatting
	luaFilter := filepath.Join(tmpDir, "docx-filter.lua")
	if err := os.WriteFile(luaFilter, []byte(docxLuaFilter), 0644); err == nil {
		args = append(args, "--lua-filter="+luaFilter)
	}

	if refDocPath != "" {
		args = append(args, "--reference-doc="+refDocPath)
	}

	args = append(args, texPath)

	cmdCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, pandocBin, args...)
	cmd.Dir = tmpDir

	output, err := cmd.CombinedOutput()
	if err != nil {
		errMsg := strings.TrimSpace(string(output))
		if errMsg == "" {
			errMsg = err.Error()
		}
		return nil, fmt.Errorf("pandoc conversion failed: %s", errMsg)
	}

	docxData, err := os.ReadFile(docxPath)
	if err != nil {
		return nil, fmt.Errorf("docx output not found after pandoc: %w", err)
	}

	if len(docxData) == 0 {
		return nil, fmt.Errorf("pandoc produced an empty .docx file")
	}

	// Post-process DOCX XML for pixel-perfect formatting
	docxData = postProcessDocx(docxData)

	return docxData, nil
}

// stripTableBorders opens a .docx ZIP, removes <w:tblBorders> and
// <w:tcBorders> elements from word/document.xml (and any header/footer
// parts), and returns the modified ZIP bytes.  This is the most reliable
// way to ensure layout-tabulars from LaTeX don't render with ugly grid
// lines in Word.
func stripTableBorders(docxData []byte) ([]byte, error) {
	// Regex patterns to strip border elements from OOXML
	reTblBorders := regexp.MustCompile(`(?s)<w:tblBorders>.*?</w:tblBorders>`)
	reTcBorders := regexp.MustCompile(`(?s)<w:tcBorders>.*?</w:tcBorders>`)
	// Also strip border settings from individual table cells
	reInsideBorders := regexp.MustCompile(`(?s)<w:insideH[^/]*/?>|<w:insideV[^/]*/?>`)

	zr, err := zip.NewReader(bytes.NewReader(docxData), int64(len(docxData)))
	if err != nil {
		return docxData, err
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			return docxData, err
		}

		var content bytes.Buffer
		content.ReadFrom(rc)
		rc.Close()

		data := content.Bytes()

		// Process XML parts that may contain table markup
		name := strings.ToLower(f.Name)
		if strings.HasPrefix(name, "word/") && strings.HasSuffix(name, ".xml") {
			s := string(data)
			s = reTblBorders.ReplaceAllString(s, "")
			s = reTcBorders.ReplaceAllString(s, "")
			s = reInsideBorders.ReplaceAllString(s, "")
			data = []byte(s)
		}

		w, err := zw.Create(f.Name)
		if err != nil {
			return docxData, err
		}
		w.Write(data)
	}

	if err := zw.Close(); err != nil {
		return docxData, err
	}

	return buf.Bytes(), nil
}

// findPandoc returns the path to the pandoc binary, checking several
// common locations beyond just $PATH.
func findPandoc() (string, error) {
	// 1. Standard PATH lookup
	if p, err := exec.LookPath("pandoc"); err == nil {
		return p, nil
	}

	// 2. Common user-local locations (e.g. installed via curl to ~/.local/bin)
	home, _ := os.UserHomeDir()
	candidates := []string{
		filepath.Join(home, ".local", "bin", "pandoc"),
		"/usr/local/bin/pandoc",
		"/usr/bin/pandoc",
	}
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && !info.IsDir() {
			return c, nil
		}
	}

	return "", fmt.Errorf("pandoc not found")
}

// findLibreOffice returns the path to the LibreOffice soffice binary.
func findLibreOffice() (string, error) {
	for _, name := range []string{"soffice", "libreoffice"} {
		if p, err := exec.LookPath(name); err == nil {
			return p, nil
		}
	}
	candidates := []string{
		"/usr/bin/soffice",
		"/usr/bin/libreoffice",
		"/usr/local/bin/soffice",
		"/usr/lib/libreoffice/program/soffice",
	}
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && !info.IsDir() {
			return c, nil
		}
	}
	return "", fmt.Errorf("LibreOffice not found")
}

// hasNumberedSections returns true if the source uses \section (without *)
// which means LaTeX will auto-number them.
func hasNumberedSections(source string) bool {
	lines := strings.Split(source, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, `\section{`) || strings.HasPrefix(trimmed, `\subsection{`) {
			return true
		}
	}
	return false
}

// detectDocumentClass returns the document class from the LaTeX source.
func detectDocumentClass(source string) string {
	re := regexp.MustCompile(`\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}`)
	if m := re.FindStringSubmatch(source); m != nil {
		return strings.TrimSpace(m[1])
	}
	return "article"
}

// templateStyle defines style parameters for the reference .docx.
type templateStyle struct {
	bodyFont     string
	headingFont  string
	bodySize     int // half-points
	h1Size       int
	h2Size       int
	h3Size       int
	titleSize    int
	lineSpacing  int // 240 = single, 360 = 1.5, 480 = double
	marginTop    int // twips
	marginBottom int
	marginLeft   int
	marginRight  int
	columnCount  int
	justified    bool
}

// detectGeometryMargins parses \usepackage[...]{geometry} or \geometry{...}
// and sets the corresponding margins in twips (1 inch = 1440 twips).
func detectGeometryMargins(source string, style *templateStyle) {
	// Match \usepackage[...]{geometry} or \geometry{...}
	reGeom := regexp.MustCompile(`(?:` +
		`\\usepackage\[([^\]]+)\]\{geometry\}` +
		`|` +
		`\\geometry\{([^}]+)\}` +
		`)`)
	m := reGeom.FindStringSubmatch(source)
	if m == nil {
		return
	}
	opts := m[1]
	if opts == "" {
		opts = m[2]
	}

	// Parse dimension values like "0.5in", "1cm", "10mm", "72pt"
	parseDim := func(s string) int {
		s = strings.TrimSpace(s)
		var val float64
		var unit string
		fmt.Sscanf(s, "%f", &val)
		// Extract unit
		for _, u := range []string{"in", "cm", "mm", "pt", "em"} {
			if strings.HasSuffix(s, u) {
				unit = u
				break
			}
		}
		switch unit {
		case "in":
			return int(val * 1440)
		case "cm":
			return int(val * 567) // 1cm ≈ 567 twips
		case "mm":
			return int(val * 56.7)
		case "pt":
			return int(val * 20) // 1pt = 20 twips
		case "em":
			return int(val * 240) // approximate
		default:
			if val > 0 {
				return int(val * 1440) // assume inches
			}
			return 0
		}
	}

	// Parse key=value pairs
	parts := strings.Split(opts, ",")
	for _, p := range parts {
		kv := strings.SplitN(strings.TrimSpace(p), "=", 2)
		if len(kv) != 2 {
			continue
		}
		key := strings.TrimSpace(kv[0])
		dimTwips := parseDim(kv[1])
		if dimTwips <= 0 {
			continue
		}
		switch key {
		case "margin":
			style.marginTop = dimTwips
			style.marginBottom = dimTwips
			style.marginLeft = dimTwips
			style.marginRight = dimTwips
		case "top", "tmargin":
			style.marginTop = dimTwips
		case "bottom", "bmargin":
			style.marginBottom = dimTwips
		case "left", "lmargin":
			style.marginLeft = dimTwips
		case "right", "rmargin":
			style.marginRight = dimTwips
		case "hmargin":
			style.marginLeft = dimTwips
			style.marginRight = dimTwips
		case "vmargin":
			style.marginTop = dimTwips
			style.marginBottom = dimTwips
		}
	}
}

// generateReferenceDoc creates a pandoc reference .docx with styles that
// match the detected LaTeX template. This ensures the DOCX output looks
// as close to the PDF as possible regarding fonts, sizes, and spacing.
func generateReferenceDoc(path string, source string) error {
	docClass := detectDocumentClass(source)

	style := templateStyle{
		bodyFont:     "Times New Roman",
		headingFont:  "Times New Roman",
		bodySize:     24,  // 12pt
		h1Size:       28,  // 14pt
		h2Size:       26,  // 13pt
		h3Size:       24,  // 12pt
		titleSize:    34,  // 17pt
		lineSpacing:  240, // single
		marginTop:    1440,
		marginBottom: 1440,
		marginLeft:   1440,
		marginRight:  1440,
		columnCount:  1,
		justified:    true,
	}

	// Try to detect margins from \usepackage[...]{geometry}
	detectGeometryMargins(source, &style)

	switch docClass {
	case "IEEEtran":
		style.bodyFont = "Times New Roman"
		style.headingFont = "Times New Roman"
		style.bodySize = 20     // 10pt
		style.h1Size = 20       // 10pt bold small caps
		style.h2Size = 20       // 10pt italic
		style.h3Size = 20       // 10pt italic
		style.titleSize = 48    // 24pt
		style.lineSpacing = 240 // single
		style.marginTop = 1080  // 0.75in
		style.marginBottom = 1080
		style.marginLeft = 1008 // 0.7in
		style.marginRight = 1008
		style.columnCount = 2
	case "acmart":
		style.bodyFont = "Linux Libertine"
		style.headingFont = "Linux Libertine"
		style.bodySize = 20
		style.h1Size = 24
		style.h2Size = 22
		style.titleSize = 36
		style.lineSpacing = 240
		style.columnCount = 2
	case "elsarticle":
		style.bodyFont = "Times New Roman"
		style.headingFont = "Times New Roman"
		style.bodySize = 24
		style.h1Size = 28
		style.h2Size = 26
		style.titleSize = 34
		style.lineSpacing = 480 // double
	case "revtex4-2", "revtex4":
		style.bodyFont = "Times New Roman"
		style.headingFont = "Times New Roman"
		style.bodySize = 20
		style.h1Size = 24
		style.h2Size = 22
		style.titleSize = 28
		style.lineSpacing = 240
		style.columnCount = 2
	case "llncs":
		style.bodyFont = "Times New Roman"
		style.headingFont = "Times New Roman"
		style.bodySize = 20
		style.h1Size = 28
		style.h2Size = 24
		style.titleSize = 34
		style.lineSpacing = 240
	}

	jcVal := "left"
	if style.justified {
		jcVal = "both"
	}

	// Build the reference DOCX
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	ct := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`
	addRefZipFile(zw, "[Content_Types].xml", ct)

	rels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
	addRefZipFile(zw, "_rels/.rels", rels)

	docRels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
	addRefZipFile(zw, "word/_rels/document.xml.rels", docRels)

	colsXML := ""
	if style.columnCount > 1 {
		colsXML = fmt.Sprintf(`<w:cols w:num="%d" w:space="720"/>`, style.columnCount)
	}

	doc := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Heading 1</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Heading 2</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>Heading 3</w:t></w:r></w:p>
    <w:p><w:r><w:t>Body text.</w:t></w:r></w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="%d" w:right="%d" w:bottom="%d" w:left="%d"
               w:header="720" w:footer="720" w:gutter="0"/>
      %s
    </w:sectPr>
  </w:body>
</w:document>`, style.marginTop, style.marginRight, style.marginBottom, style.marginLeft, colsXML)
	addRefZipFile(zw, "word/document.xml", doc)

	styles := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="%s" w:hAnsi="%s" w:cs="%s"/>
        <w:sz w:val="%d"/>
        <w:szCs w:val="%d"/>
        <w:lang w:val="en-US"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="40" w:line="%d" w:lineRule="auto"/>
        <w:jc w:val="%s"/>
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
      <w:rFonts w:ascii="%s" w:hAnsi="%s"/>
      <w:b/>
      <w:sz w:val="%d"/>
      <w:szCs w:val="%d"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="200" w:after="40" w:line="240" w:lineRule="auto"/>
      <w:pBdr>
        <w:bottom w:val="single" w:sz="4" w:space="1" w:color="000000"/>
      </w:pBdr>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="%s" w:hAnsi="%s"/>
      <w:b/>
      <w:caps/>
      <w:sz w:val="%d"/>
      <w:szCs w:val="%d"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="160" w:after="40" w:line="240" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="%s" w:hAnsi="%s"/>
      <w:b/>
      <w:sz w:val="%d"/>
      <w:szCs w:val="%d"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="160" w:after="60"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="%s" w:hAnsi="%s"/>
      <w:b/>
      <w:i/>
      <w:sz w:val="%d"/>
      <w:szCs w:val="%d"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Author">
    <w:name w:val="Author"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:after="60"/>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:rPr>
      <w:sz w:val="%d"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="AbstractTitle">
    <w:name w:val="Abstract Title"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="200" w:after="80"/>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:i/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="AbstractText">
    <w:name w:val="Abstract Text"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:left="720" w:right="720"/>
      <w:spacing w:after="200"/>
    </w:pPr>
    <w:rPr>
      <w:i/>
      <w:sz w:val="%d"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="BlockText">
    <w:name w:val="Block Text"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:left="720" w:right="720"/>
      <w:spacing w:after="120"/>
    </w:pPr>
    <w:rPr>
      <w:i/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="SourceCode">
    <w:name w:val="Source Code"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>
      <w:ind w:left="360"/>
      <w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>
      <w:sz w:val="18"/>
      <w:szCs w:val="18"/>
    </w:rPr>
  </w:style>

  <w:style w:type="character" w:styleId="VerbatimChar">
    <w:name w:val="Verbatim Char"/>
    <w:rPr>
      <w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>
      <w:sz w:val="18"/>
      <w:szCs w:val="18"/>
    </w:rPr>
  </w:style>

  <w:style w:type="table" w:styleId="TableGrid" w:default="1">
    <w:name w:val="Table Grid"/>
    <w:basedOn w:val="TableNormal"/>
    <w:tblPr>
      <w:tblBorders>
        <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
      </w:tblBorders>
      <w:tblCellMar>
        <w:top w:w="0" w:type="dxa"/>
        <w:left w:w="0" w:type="dxa"/>
        <w:bottom w:w="0" w:type="dxa"/>
        <w:right w:w="0" w:type="dxa"/>
      </w:tblCellMar>
    </w:tblPr>
  </w:style>

  <w:style w:type="table" w:styleId="TableNormal">
    <w:name w:val="Normal Table"/>
    <w:semiHidden/>
    <w:tblPr>
      <w:tblInd w:w="0" w:type="dxa"/>
      <w:tblCellMar>
        <w:top w:w="0" w:type="dxa"/>
        <w:left w:w="0" w:type="dxa"/>
        <w:bottom w:w="0" w:type="dxa"/>
        <w:right w:w="0" w:type="dxa"/>
      </w:tblCellMar>
    </w:tblPr>
  </w:style>
</w:styles>`,
		style.bodyFont, style.bodyFont, style.bodyFont, style.bodySize, style.bodySize,
		style.lineSpacing, jcVal,
		style.headingFont, style.headingFont, style.titleSize, style.titleSize,
		style.headingFont, style.headingFont, style.h1Size, style.h1Size,
		style.headingFont, style.headingFont, style.h2Size, style.h2Size,
		style.headingFont, style.headingFont, style.h3Size, style.h3Size,
		style.bodySize,
		style.bodySize-2,
	)
	addRefZipFile(zw, "word/styles.xml", styles)

	if err := zw.Close(); err != nil {
		return err
	}
	return os.WriteFile(path, buf.Bytes(), 0644)
}

func addRefZipFile(zw *zip.Writer, name, content string) {
	w, _ := zw.Create(name)
	w.Write([]byte(content))
}

// preprocessLatexForPandoc simplifies LaTeX constructs that pandoc handles
// poorly.  This runs before pandoc sees the source, converting resume-specific
// patterns into simpler LaTeX that pandoc can parse correctly.
func preprocessLatexForPandoc(source string) string {
	s := source

	// 1. Convert \section{} to \section*{} to prevent numbering
	//    (pandoc adds numbers for \section but not \section*)
	s = regexp.MustCompile(`\\section\{`).ReplaceAllString(s, `\section*{`)
	s = regexp.MustCompile(`\\subsection\{`).ReplaceAllString(s, `\subsection*{`)
	s = regexp.MustCompile(`\\subsubsection\{`).ReplaceAllString(s, `\subsubsection*{`)
	// Avoid double-starring: \section**{ → \section*{
	s = strings.ReplaceAll(s, `\section**{`, `\section*{`)
	s = strings.ReplaceAll(s, `\subsection**{`, `\subsection*{`)
	s = strings.ReplaceAll(s, `\subsubsection**{`, `\subsubsection*{`)

	// 2. Remove \titlerule, \vspace, \smallskip, \medskip, \bigskip
	//    These are vertical spacing/rules that don't translate to DOCX well.
	//    The heading bottom border in the reference doc handles \titlerule.
	s = regexp.MustCompile(`\\titlerule\s*`).ReplaceAllString(s, "")
	s = regexp.MustCompile(`\\vspace\*?\{[^}]*\}`).ReplaceAllString(s, "")

	// 3. Replace \hfill with a long space (pandoc ignores \hfill)
	s = strings.ReplaceAll(s, `\hfill`, "\t\t")

	// 4. Handle resume-style tabular* date layouts:
	//    \begin{tabular*}{\textwidth}{l @{\extracolsep{\fill}} r}
	//    \textbf{Project Name} & Date \\
	//    \end{tabular*}
	//    Convert these to simpler text with tab separation
	reTabular := regexp.MustCompile(`(?s)\\begin\{tabular\*?\}[^\n]*\n(.*?)\\end\{tabular\*?\}`)
	s = reTabular.ReplaceAllStringFunc(s, func(match string) string {
		// Extract the body between begin/end
		innerRe := regexp.MustCompile(`(?s)\\begin\{tabular\*?\}[^\n]*\n(.*?)\\end\{tabular\*?\}`)
		m := innerRe.FindStringSubmatch(match)
		if len(m) < 2 {
			return match
		}
		body := m[1]
		// Split rows by \\
		rows := strings.Split(body, `\\`)
		var result []string
		for _, row := range rows {
			row = strings.TrimSpace(row)
			if row == "" || row == `\hline` {
				continue
			}
			// Replace & with tab-like separator
			row = strings.ReplaceAll(row, "&", "\\hfill ")
			result = append(result, row)
		}
		return strings.Join(result, "\n\n")
	})

	// 5. Remove \pdfglyphtounicode and similar pdfTeX-only primitives
	//    that pandoc doesn't understand
	s = regexp.MustCompile(`\\pdfglyphtounicode\{[^}]*\}\{[^}]*\}`).ReplaceAllString(s, "")
	s = regexp.MustCompile(`\\pdfsuppresswarningpagegroup[= ]?\d*`).ReplaceAllString(s, "")
	s = regexp.MustCompile(`\\pdfcompresslevel[= ]?\d*`).ReplaceAllString(s, "")

	// 6. Remove \input{glyphtounicode} 
	s = regexp.MustCompile(`\\input\{glyphtounicode\}`).ReplaceAllString(s, "")

	// 7. Convert \textbf{...} \hfill Date patterns to paragraph form
	//    This handles inline date patterns like: \textbf{Name} \hfill Jul 2025
	//    (already partly handled by \hfill → tab replacement above)

	// 8. Remove \resumeSubHeadingListStart/End and similar custom commands
	//    from common resume templates
	for _, cmd := range []string{
		`\resumeSubHeadingListStart`, `\resumeSubHeadingListEnd`,
		`\resumeItemListStart`, `\resumeItemListEnd`,
		`\resumeSubhead`, `\setlength{\footskip}`,
	} {
		s = strings.ReplaceAll(s, cmd, "")
	}
	s = regexp.MustCompile(`\\setlength\{[^}]*\}\{[^}]*\}`).ReplaceAllString(s, "")

	// 9. Clean up multiple blank lines
	s = regexp.MustCompile(`\n{3,}`).ReplaceAllString(s, "\n\n")

	return s
}

// postProcessDocx applies post-processing to the generated DOCX to fix
// formatting issues: strips table borders, fixes spacing, etc.
func postProcessDocx(docxData []byte) []byte {
	// Strip table borders
	result, err := stripTableBorders(docxData)
	if err != nil {
		return docxData
	}
	return result
}

// docxLuaFilter is a pandoc Lua filter that:
// 1. Flattens tables into flowing paragraphs (layout tables from resumes)
// 2. Removes section numbering
// 3. Handles HorizontalRule as thin line
const docxLuaFilter = `
local function inlines_from_blocks(blocks)
  local result = pandoc.List()
  for _, b in ipairs(blocks) do
    if b.t == "Para" or b.t == "Plain" then
      if #result > 0 then result:insert(pandoc.Space()) end
      result:extend(b.content)
    elseif b.t == "Header" then
      if #result > 0 then result:insert(pandoc.Space()) end
      result:extend(b.content)
    elseif b.t == "LineBlock" then
      for _, line in ipairs(b.content) do
        if #result > 0 then result:insert(pandoc.Space()) end
        result:extend(line)
      end
    end
  end
  return result
end

function Table(el)
  local out = pandoc.List()

  -- Collect all rows from head + bodies
  local all_rows = pandoc.List()
  if el.head and el.head.rows then
    for _, row in ipairs(el.head.rows) do
      all_rows:insert(row)
    end
  end
  for _, body in ipairs(el.bodies) do
    if body.head then
      for _, row in ipairs(body.head) do
        all_rows:insert(row)
      end
    end
    for _, row in ipairs(body.body) do
      all_rows:insert(row)
    end
  end

  for _, row in ipairs(all_rows) do
    local cells_text = pandoc.List()
    local sub_blocks = pandoc.List()

    for _, cell in ipairs(row.cells) do
      local cell_inlines = inlines_from_blocks(cell.contents)
      if #cell_inlines > 0 then
        cells_text:insert(cell_inlines)
      end
      -- Collect sub-lists to emit after the row
      for _, b in ipairs(cell.contents) do
        if b.t == "BulletList" or b.t == "OrderedList" then
          sub_blocks:insert(b)
        end
      end
    end

    -- Build row paragraph: join cells with wide spacing
    if #cells_text > 0 then
      local row_inlines = pandoc.List()
      for i, cell_il in ipairs(cells_text) do
        if i > 1 then
          -- Use multiple spaces + tab to separate columns
          row_inlines:insert(pandoc.Space())
          row_inlines:insert(pandoc.Space())
          row_inlines:insert(pandoc.Space())
          row_inlines:insert(pandoc.Space())
          row_inlines:insert(pandoc.Space())
          row_inlines:insert(pandoc.Space())
          row_inlines:insert(pandoc.Space())
          row_inlines:insert(pandoc.Space())
        end
        row_inlines:extend(cell_il)
      end
      out:insert(pandoc.Para(row_inlines))
    end

    -- Emit sub-blocks (bullet lists etc.)
    for _, b in ipairs(sub_blocks) do
      out:insert(b)
    end
  end

  if #out == 0 then
    return pandoc.Null()
  end
  return out
end

-- Remove section numbering: strip the number prefix from headers
function Header(el)
  -- pandoc auto-numbers sections; we want unnumbered headings
  el.classes:insert("unnumbered")
  return el
end

-- Convert HorizontalRule to an empty paragraph (the heading style has bottom border)
function HorizontalRule()
  return pandoc.Para({})
end
`
