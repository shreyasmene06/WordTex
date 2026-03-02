/**
 * Lightweight client-side LaTeX → HTML renderer.
 *
 * Produces a self-contained HTML document string that can be loaded
 * into an iframe via a blob URL.  Handles the most common LaTeX
 * constructs: title, author, abstract, sections, lists, bold/italic,
 * inline math, display math, verbatim, theorems, and tables.
 */

// ── Helpers ─────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Extract content of `\command{...}` handling balanced braces. */
function extractBraced(src: string, startIdx: number): string {
  let depth = 0;
  let start = -1;
  for (let i = startIdx; i < src.length; i++) {
    if (src[i] === "{") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i);
    }
  }
  return "";
}

function firstMatch(src: string, re: RegExp): string | null {
  const m = re.exec(src);
  return m ? m[1] : null;
}

// ── Inline formatting ───────────────────────────────────────────

function formatInline(text: string): string {
  let s = text;
  // Remove \label{...}
  s = s.replace(/\\label\{[^}]*\}/g, "");
  // \ref, \eqref → [ref]
  s = s.replace(/\\(?:eq)?ref\{[^}]*\}/g, "<em>[ref]</em>");
  // \cite → [citation]
  s = s.replace(/\\cite\{[^}]*\}/g, "<em>[citation]</em>");
  // \LaTeX
  s = s.replace(/\\LaTeX\b\{?\}?/g, "L<sup>A</sup>T<sub>E</sub>X");
  // \textbf{...}
  s = s.replace(/\\textbf\{([^}]*)\}/g, "<strong>$1</strong>");
  // \textit{...}
  s = s.replace(/\\textit\{([^}]*)\}/g, "<em>$1</em>");
  // \emph{...}
  s = s.replace(/\\emph\{([^}]*)\}/g, "<em>$1</em>");
  // \textsc{...}
  s = s.replace(
    /\\textsc\{([^}]*)\}/g,
    '<span style="font-variant:small-caps">$1</span>'
  );
  // Inline math $...$
  s = s.replace(
    /\$([^$]+)\$/g,
    '<code class="math">$1</code>'
  );
  // Tilde = non-breaking space
  s = s.replace(/~/g, "&nbsp;");
  // Remaining simple commands: strip command, keep braced content
  s = s.replace(/\\[a-zA-Z]+\*?\{([^}]*)\}/g, "$1");
  // Strip remaining bare commands (\and, \centering, etc.)
  s = s.replace(/\\[a-zA-Z]+\*?/g, "");
  // Remove leftover braces
  s = s.replace(/[{}]/g, "");

  return s;
}

// ── Main converter ──────────────────────────────────────────────

export function latexToHtml(source: string): string {
  // Extract metadata
  const title =
    firstMatch(source, /\\title\{([^}]*)\}/) ?? "Untitled Document";
  const authorBlock = firstMatch(source, /\\author\{([\s\S]*?)\}/) ?? "";
  const authors: string[] = [];
  const nameRe = /\\IEEEauthorblockN\{([^}]*)\}/g;
  let nameMatch: RegExpExecArray | null;
  while ((nameMatch = nameRe.exec(authorBlock)) !== null) {
    authors.push(nameMatch[1]);
  }
  if (authors.length === 0 && authorBlock.trim()) {
    // Fallback: split on \and
    for (const a of authorBlock.split(/\\and/)) {
      const clean = a
        .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, "$1")
        .replace(/\\\\/g, ", ")
        .replace(/[{}]/g, "")
        .trim();
      if (clean) authors.push(clean);
    }
  }

  const abstractMatch = source.match(
    /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/
  );
  const abstract = abstractMatch ? abstractMatch[1].trim() : "";

  // Extract body
  let body = source;
  const bodyStart = source.indexOf("\\begin{document}");
  if (bodyStart >= 0) body = source.slice(bodyStart + "\\begin{document}".length);
  const bodyEnd = body.indexOf("\\end{document}");
  if (bodyEnd >= 0) body = body.slice(0, bodyEnd);

  // Build HTML
  const parts: string[] = [];

  // Title + authors
  parts.push(`<h1 class="title">${escapeHtml(title)}</h1>`);
  if (authors.length > 0) {
    parts.push(
      `<p class="authors">${authors.map(escapeHtml).join(" &bull; ")}</p>`
    );
  }

  // Abstract
  if (abstract) {
    parts.push(`<div class="abstract">`);
    parts.push(`<h2>Abstract</h2>`);
    parts.push(`<p>${formatInline(escapeHtml(abstract))}</p>`);
    parts.push(`</div>`);
  }

  // Parse body line-by-line
  const lines = body.split("\n");
  let i = 0;
  let paraLines: string[] = [];

  function flushPara() {
    const text = paraLines.join(" ").trim();
    paraLines = [];
    if (!text) return;
    parts.push(`<p>${formatInline(escapeHtml(text))}</p>`);
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip metadata / no-op
    if (
      line === "" ||
      /^\\maketitle/.test(line) ||
      /^\\newtheorem/.test(line) ||
      /^\\bibliographystyle/.test(line) ||
      /^\\bibliography/.test(line) ||
      /^\\begin\{document\}/.test(line) ||
      /^\\end\{document\}/.test(line) ||
      /^\\begin\{abstract\}/.test(line) ||
      /^\\end\{abstract\}/.test(line) ||
      /^\\usepackage/.test(line) ||
      /^\\documentclass/.test(line)
    ) {
      if (line === "") flushPara();
      // Multi-line title/author: skip until braces balance
      if (/^\\(title|author)\{/.test(line)) {
        let depth =
          (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        while (depth > 0 && i + 1 < lines.length) {
          i++;
          const l = lines[i];
          depth +=
            (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
        }
      }
      i++;
      continue;
    }

    // Skip abstract block (already extracted above)
    if (/^\\begin\{abstract\}/.test(line)) {
      while (i < lines.length && !lines[i].includes("\\end{abstract}")) i++;
      i++;
      continue;
    }

    // Section headings
    const secMatch = line.match(/^\\section\*?\{([^}]*)\}/);
    if (secMatch) {
      flushPara();
      parts.push(`<h2>${formatInline(escapeHtml(secMatch[1]))}</h2>`);
      i++;
      continue;
    }
    const subsecMatch = line.match(/^\\subsection\*?\{([^}]*)\}/);
    if (subsecMatch) {
      flushPara();
      parts.push(`<h3>${formatInline(escapeHtml(subsecMatch[1]))}</h3>`);
      i++;
      continue;
    }
    const subsubsecMatch = line.match(/^\\subsubsection\*?\{([^}]*)\}/);
    if (subsubsecMatch) {
      flushPara();
      parts.push(`<h4>${formatInline(escapeHtml(subsubsecMatch[1]))}</h4>`);
      i++;
      continue;
    }

    // Theorem-like environments
    const thmMatch = line.match(
      /^\\begin\{(theorem|lemma|definition|corollary|proposition)\}(?:\[([^\]]*)\])?/
    );
    if (thmMatch) {
      flushPara();
      const envName = thmMatch[1];
      const optTitle = thmMatch[2] || "";
      const label =
        envName.charAt(0).toUpperCase() +
        envName.slice(1) +
        (optTitle ? ` (${optTitle})` : "");
      const contentLines: string[] = [];
      i++;
      const endRe = new RegExp(`^\\\\end\\{${envName}\\}`);
      while (i < lines.length && !endRe.test(lines[i].trim())) {
        contentLines.push(lines[i].trim());
        i++;
      }
      i++; // skip \end
      const content = contentLines.join(" ");
      parts.push(`<div class="theorem">`);
      parts.push(`<p><strong>${escapeHtml(label)}.</strong> <em>${formatInline(escapeHtml(content))}</em></p>`);
      parts.push(`</div>`);
      continue;
    }

    // Verbatim
    if (/^\\begin\{verbatim\}/.test(line)) {
      flushPara();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].includes("\\end{verbatim}")) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // skip \end
      parts.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
      continue;
    }

    // Display math
    if (
      /^\\begin\{(equation|align)\}/.test(line) ||
      line === "\\["
    ) {
      flushPara();
      const endPat = /^\\begin\{align/.test(line)
        ? "\\end{align}"
        : /^\\begin\{equation/.test(line)
        ? "\\end{equation}"
        : "\\]";
      const mathLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].includes(endPat)) {
        mathLines.push(lines[i].trim());
        i++;
      }
      i++; // skip end
      const mathContent = mathLines
        .join("\n")
        .replace(/\\label\{[^}]*\}/g, "")
        .trim();
      parts.push(`<div class="math-block"><pre>${escapeHtml(mathContent)}</pre></div>`);
      continue;
    }

    // Lists
    if (/^\\begin\{(itemize|enumerate)\}/.test(line)) {
      flushPara();
      const ordered = /enumerate/.test(line);
      const tag = ordered ? "ol" : "ul";
      const endTag = ordered ? "\\end{enumerate}" : "\\end{itemize}";
      parts.push(`<${tag}>`);
      let curItem = "";
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(endTag)) {
        const l = lines[i].trim();
        // Skip nested list markers (flatten)
        if (/^\\begin\{(itemize|enumerate)\}/.test(l) || /^\\end\{(itemize|enumerate)\}/.test(l)) {
          i++;
          continue;
        }
        if (/^\\item/.test(l)) {
          if (curItem) {
            parts.push(`  <li>${formatInline(escapeHtml(curItem))}</li>`);
          }
          curItem = l.replace(/^\\item\s*/, "");
        } else {
          curItem += " " + l;
        }
        i++;
      }
      if (curItem) {
        parts.push(`  <li>${formatInline(escapeHtml(curItem))}</li>`);
      }
      parts.push(`</${tag}>`);
      i++; // skip \end
      continue;
    }

    // Table environment
    if (/^\\begin\{table\}/.test(line)) {
      flushPara();
      let caption = "";
      const tableRows: string[][] = [];
      i++;
      while (i < lines.length && !/^\\end\{table\}/.test(lines[i].trim())) {
        const tl = lines[i].trim();
        const capMatch = tl.match(/\\caption\{([^}]*)\}/);
        if (capMatch) caption = capMatch[1];

        if (/^\\begin\{tabular\}/.test(tl)) {
          i++;
          while (i < lines.length && !/^\\end\{tabular\}/.test(lines[i].trim())) {
            const row = lines[i].trim();
            if (
              row &&
              !/^\\(toprule|midrule|bottomrule|hline|cline|centering)/.test(row) &&
              !/^\\multi(row|column)/.test(row)
            ) {
              const cells = row
                .replace(/\\\\$/, "")
                .split("&")
                .map((c) => formatInline(escapeHtml(c.trim())));
              tableRows.push(cells);
            }
            i++;
          }
          i++; // skip \end{tabular}
          continue;
        }
        i++;
      }
      i++; // skip \end{table}

      if (caption) {
        parts.push(`<p class="caption"><strong>Table:</strong> ${formatInline(escapeHtml(caption))}</p>`);
      }
      if (tableRows.length > 0) {
        parts.push(`<table>`);
        // First row as header
        parts.push(`<thead><tr>${tableRows[0].map((c) => `<th>${c}</th>`).join("")}</tr></thead>`);
        parts.push(`<tbody>`);
        for (let r = 1; r < tableRows.length; r++) {
          parts.push(`<tr>${tableRows[r].map((c) => `<td>${c}</td>`).join("")}</tr>`);
        }
        parts.push(`</tbody></table>`);
      }
      continue;
    }

    // Skip label-only lines
    if (/^\\label\{/.test(line) && line.replace(/\\label\{[^}]*\}/, "").trim() === "") {
      i++;
      continue;
    }

    // Skip comment lines
    if (line.startsWith("%")) {
      i++;
      continue;
    }

    // Regular text
    paraLines.push(line);
    i++;
  }

  flushPara();

  // Wrap in a complete HTML document with embedded styles
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>
  :root {
    --text: #1f2937;
    --muted: #6b7280;
    --heading: #1e3a5f;
    --accent: #2563eb;
    --bg: #ffffff;
    --code-bg: #f3f4f6;
    --border: #e5e7eb;
    --abstract-bg: #f8fafc;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Georgia', 'Times New Roman', serif;
    font-size: 11pt;
    line-height: 1.7;
    color: var(--text);
    background: var(--bg);
    max-width: 7.5in;
    margin: 0.5in auto;
    padding: 0 0.3in;
  }
  h1.title {
    font-size: 22pt;
    text-align: center;
    color: var(--heading);
    margin: 0 0 6pt;
    font-weight: 700;
    line-height: 1.3;
  }
  .authors {
    text-align: center;
    color: var(--muted);
    font-size: 11pt;
    margin-bottom: 18pt;
  }
  .abstract {
    background: var(--abstract-bg);
    border-left: 3px solid var(--accent);
    padding: 12pt 16pt;
    margin-bottom: 18pt;
    border-radius: 0 4px 4px 0;
  }
  .abstract h2 {
    font-size: 11pt;
    font-style: italic;
    font-weight: 700;
    margin-bottom: 6pt;
    color: var(--heading);
  }
  .abstract p { font-style: italic; font-size: 10.5pt; }
  h2 {
    font-size: 16pt;
    color: var(--heading);
    margin: 20pt 0 8pt;
    padding-bottom: 4pt;
    border-bottom: 1px solid var(--border);
  }
  h3 {
    font-size: 13pt;
    color: var(--heading);
    margin: 14pt 0 6pt;
  }
  h4 {
    font-size: 11pt;
    color: var(--heading);
    font-style: italic;
    margin: 10pt 0 4pt;
  }
  p { margin: 0 0 10pt; text-align: justify; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  code.math {
    font-family: 'Cambria Math', 'Cambria', serif;
    font-style: italic;
    background: var(--code-bg);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 10.5pt;
  }
  .math-block {
    text-align: center;
    margin: 12pt 0;
  }
  .math-block pre {
    display: inline-block;
    text-align: left;
    font-family: 'Cambria Math', 'Cambria', serif;
    font-style: italic;
    font-size: 10.5pt;
    background: var(--code-bg);
    padding: 8pt 16pt;
    border-radius: 4px;
    border: 1px solid var(--border);
  }
  pre {
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 10pt 14pt;
    margin: 10pt 0;
    overflow-x: auto;
  }
  pre code {
    font-family: 'Courier New', monospace;
    font-size: 9.5pt;
    line-height: 1.5;
  }
  ul, ol { margin: 6pt 0 10pt 24pt; }
  li { margin-bottom: 4pt; }
  .theorem {
    background: var(--abstract-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 10pt 14pt;
    margin: 10pt 0;
  }
  .caption {
    text-align: center;
    font-size: 10pt;
    color: var(--muted);
    margin-bottom: 6pt;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0 16pt;
    font-size: 10pt;
  }
  th, td {
    border: 1px solid var(--border);
    padding: 6pt 10pt;
    text-align: left;
  }
  th {
    background: var(--code-bg);
    font-weight: 700;
  }
  sup { font-size: 0.7em; vertical-align: super; }
  sub { font-size: 0.7em; vertical-align: sub; }
</style>
</head>
<body>
${parts.join("\n")}
</body>
</html>`;
}
