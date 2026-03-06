package engine

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// CompileLatexToPDF compiles LaTeX source to PDF using the specified engine.
// It writes the source and any additional files (e.g., .cls, .sty, images)
// to a temp directory, runs the engine (with two passes for cross-references),
// reads back the resulting PDF, and cleans up.
func CompileLatexToPDF(ctx context.Context, source []byte, engine string, additionalFiles []FileAttachment) ([]byte, error) {
	if engine == "" {
		engine = "pdflatex"
	}

	// Validate engine name to prevent command injection
	switch engine {
	case "pdflatex", "xelatex", "lualatex":
		// OK
	default:
		return nil, fmt.Errorf("unsupported PDF engine: %s", engine)
	}

	// Verify the engine binary exists
	if _, err := exec.LookPath(engine); err != nil {
		return nil, fmt.Errorf("LaTeX engine %q not found in PATH: %w", engine, err)
	}

	// Create a temp working directory
	tmpDir, err := os.MkdirTemp("", "wordtex-latex-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	// Write the .tex source file
	texPath := filepath.Join(tmpDir, "document.tex")
	if err := os.WriteFile(texPath, source, 0644); err != nil {
		return nil, fmt.Errorf("failed to write .tex file: %w", err)
	}

	// Write additional files (.cls, .sty, .bib, images, etc.)
	for _, af := range additionalFiles {
		// Sanitize filename — keep only the base name to prevent path traversal
		baseName := filepath.Base(af.Filename)
		if baseName == "." || baseName == "/" {
			continue
		}
		afPath := filepath.Join(tmpDir, baseName)
		if err := os.WriteFile(afPath, af.Data, 0644); err != nil {
			return nil, fmt.Errorf("failed to write additional file %q: %w", baseName, err)
		}
	}

	// Run the engine twice (first pass for references, second for resolution)
	for pass := 1; pass <= 2; pass++ {
		args := []string{
			"-interaction=nonstopmode",
			"-halt-on-error",
			"-output-directory=" + tmpDir,
			texPath,
		}

		// Use a per-pass timeout (60s each)
		passCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
		cmd := exec.CommandContext(passCtx, engine, args...)
		cmd.Dir = tmpDir

		// Capture output for error diagnostics
		output, err := cmd.CombinedOutput()
		cancel()

		if err != nil {
			// Extract the most useful error lines from LaTeX log
			errMsg := extractLatexError(string(output))
			if errMsg == "" {
				errMsg = fmt.Sprintf("pass %d failed: %v", pass, err)
			}
			return nil, fmt.Errorf("LaTeX compilation error (pass %d): %s", pass, errMsg)
		}
	}

	// Read the output PDF
	pdfPath := filepath.Join(tmpDir, "document.pdf")
	pdfData, err := os.ReadFile(pdfPath)
	if err != nil {
		return nil, fmt.Errorf("PDF output not found after compilation: %w", err)
	}

	if len(pdfData) == 0 {
		return nil, fmt.Errorf("LaTeX engine produced an empty PDF")
	}

	return pdfData, nil
}

// extractLatexError pulls the first meaningful error lines from LaTeX log
// output, including context lines that show the offending command and line.
func extractLatexError(log string) string {
	lines := strings.Split(log, "\n")
	var errors []string
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "!") {
			// Grab the "!" line plus up to 3 following context lines
			// (usually "l.NN \command..." or the offending input)
			errBlock := line
			for j := 1; j <= 3 && i+j < len(lines); j++ {
				ctx := strings.TrimSpace(lines[i+j])
				if ctx == "" || strings.HasPrefix(ctx, "!") {
					break
				}
				errBlock += " | " + ctx
			}
			errors = append(errors, errBlock)
			if len(errors) >= 3 {
				break
			}
		}
	}
	if len(errors) > 0 {
		return strings.Join(errors, "; ")
	}

	// Fallback: look for "Fatal error" or common error patterns
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "Fatal error") ||
			strings.Contains(line, "Emergency stop") {
			return line
		}
	}
	return ""
}
