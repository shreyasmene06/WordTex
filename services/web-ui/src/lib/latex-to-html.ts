/**
 * High-fidelity client-side LaTeX → HTML renderer.
 *
 * Uses KaTeX for math typesetting (produces Overleaf-quality rendered equations).
 * Generates a self-contained HTML document that can be loaded into an iframe
 * via a blob URL.  Handles all major LaTeX constructs: title, author, abstract,
 * sections, lists, bold/italic, inline/display math, verbatim, theorems,
 * tables, figures, and cross-references.
 */

import katex from "katex";

// ── Helpers ─────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstMatch(src: string, re: RegExp): string | null {
  const m = re.exec(src);
  return m ? m[1] : null;
}

/** Render a LaTeX math expression to HTML via KaTeX. */
function renderMath(expr: string, displayMode: boolean): string {
  try {
    return katex.renderToString(expr.trim(), {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: true,
      macros: {
        "\\R": "\\mathbb{R}",
        "\\N": "\\mathbb{N}",
        "\\Z": "\\mathbb{Z}",
        "\\C": "\\mathbb{C}",
        "\\Q": "\\mathbb{Q}",
      },
    });
  } catch {
    // Fallback: show raw LaTeX in a styled code block
    return displayMode
      ? `<div class="math-fallback">${escapeHtml(expr)}</div>`
      : `<code class="math-fallback-inline">${escapeHtml(expr)}</code>`;
  }
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
  // \TeX
  s = s.replace(/\\TeX\b\{?\}?/g, "T<sub>E</sub>X");

  // Process inline math $...$ with KaTeX
  s = processInlineMath(s);

  // \textbf{...}
  s = s.replace(/\\textbf\{([^}]*)\}/g, "<strong>$1</strong>");
  // \textit{...}
  s = s.replace(/\\textit\{([^}]*)\}/g, "<em>$1</em>");
  // \emph{...}
  s = s.replace(/\\emph\{([^}]*)\}/g, "<em>$1</em>");
  // \textsc{...}
  s = s.replace(
    /\\textsc\{([^}]*)\}/g,
    '<span style="font-variant:small-caps">$1</span>',
  );
  // \texttt{...}
  s = s.replace(/\\texttt\{([^}]*)\}/g, "<code>$1</code>");
  // \url{...}
  s = s.replace(
    /\\url\{([^}]*)\}/g,
    '<a href="$1" style="color:var(--accent)">$1</a>',
  );
  // \href{url}{text}
  s = s.replace(
    /\\href\{([^}]*)\}\{([^}]*)\}/g,
    '<a href="$1" style="color:var(--accent)">$2</a>',
  );
  // \footnote{...} → superscript
  s = s.replace(
    /\\footnote\{([^}]*)\}/g,
    '<sup style="color:var(--accent);cursor:help" title="$1">†</sup>',
  );

  // Tilde = non-breaking space
  s = s.replace(/~/g, "&nbsp;");
  // Double backslash = line break (in author blocks etc.)
  // s = s.replace(/\\\\/g, "<br/>");
  // Remaining simple commands: strip command, keep braced content
  s = s.replace(/\\[a-zA-Z]+\*?\{([^}]*)\}/g, "$1");
  // Strip remaining bare commands (\and, \centering, etc.)
  s = s.replace(/\\[a-zA-Z]+\*?/g, " ");
  // Remove leftover braces
  s = s.replace(/[{}]/g, "");

  return s;
}

/** Process inline math $...$ using KaTeX. */
function processInlineMath(s: string): string {
  const parts: string[] = [];
  let i = 0;

  while (i < s.length) {
    const dollarIdx = s.indexOf("$", i);
    if (dollarIdx === -1) {
      parts.push(s.slice(i));
      break;
    }

    // Skip escaped dollar signs
    if (dollarIdx > 0 && s[dollarIdx - 1] === "\\") {
      parts.push(s.slice(i, dollarIdx + 1));
      i = dollarIdx + 1;
      continue;
    }

    // Skip $$ (display math handled separately)
    if (s[dollarIdx + 1] === "$") {
      parts.push(s.slice(i, dollarIdx));
      // Find closing $$
      const closeIdx = s.indexOf("$$", dollarIdx + 2);
      if (closeIdx === -1) {
        parts.push(s.slice(dollarIdx));
        break;
      }
      const expr = s.slice(dollarIdx + 2, closeIdx);
      parts.push(renderMath(expr, true));
      i = closeIdx + 2;
      continue;
    }

    // Single $ — find matching closing $
    parts.push(s.slice(i, dollarIdx));
    const closeIdx = s.indexOf("$", dollarIdx + 1);
    if (closeIdx === -1) {
      parts.push(s.slice(dollarIdx));
      break;
    }
    const expr = s.slice(dollarIdx + 1, closeIdx);
    if (expr.length > 0 && !expr.includes("\n")) {
      parts.push(renderMath(expr, false));
    } else {
      parts.push("$" + expr + "$");
    }
    i = closeIdx + 1;
  }

  return parts.join("");
}

// ── Main converter ──────────────────────────────────────────────

export function latexToHtml(source: string): string {
  // ── Extract metadata ──────────────────────────────────────────
  const title =
    firstMatch(source, /\\title\{([^}]*)\}/) ?? "Untitled Document";
  const authorBlock = firstMatch(source, /\\author\{([\s\S]*?)\}/) ?? "";
  const authors: string[] = [];

  // IEEE author blocks
  const nameRe = /\\IEEEauthorblockN\{([^}]*)\}/g;
  let nameMatch: RegExpExecArray | null;
  while ((nameMatch = nameRe.exec(authorBlock)) !== null) {
    authors.push(nameMatch[1]);
  }
  // Affiliation blocks
  const affiliations: string[] = [];
  const affRe = /\\IEEEauthorblockA\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
  let affMatch: RegExpExecArray | null;
  while ((affMatch = affRe.exec(authorBlock)) !== null) {
    affiliations.push(
      affMatch[1]
        .replace(/\\\\/g, ", ")
        .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, "$1")
        .replace(/[{}]/g, "")
        .trim(),
    );
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
    /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/,
  );
  const abstract = abstractMatch ? abstractMatch[1].trim() : "";

  // ── Extract body ──────────────────────────────────────────────
  let body = source;
  const bodyStart = source.indexOf("\\begin{document}");
  if (bodyStart >= 0)
    body = source.slice(bodyStart + "\\begin{document}".length);
  const bodyEnd = body.indexOf("\\end{document}");
  if (bodyEnd >= 0) body = body.slice(0, bodyEnd);

  // ── Build HTML parts ──────────────────────────────────────────
  const parts: string[] = [];

  // Title
  parts.push(`<h1 class="title">${escapeHtml(title)}</h1>`);

  // Authors + affiliations
  if (authors.length > 0) {
    parts.push(`<div class="authors">`);
    for (let a = 0; a < authors.length; a++) {
      parts.push(`<div class="author-block">`);
      parts.push(`<span class="author-name">${escapeHtml(authors[a])}</span>`);
      if (affiliations[a]) {
        parts.push(
          `<span class="author-affil">${escapeHtml(affiliations[a])}</span>`,
        );
      }
      parts.push(`</div>`);
    }
    parts.push(`</div>`);
  }

  // Abstract
  if (abstract) {
    parts.push(`<div class="abstract">`);
    parts.push(`<h2>Abstract</h2>`);
    parts.push(`<p>${formatInline(abstract)}</p>`);
    parts.push(`</div>`);
  }

  // ── Parse body line-by-line ───────────────────────────────────
  const lines = body.split("\n");
  let i = 0;
  let paraLines: string[] = [];
  let sectionCounter = 0;
  let subsectionCounter = 0;
  let equationCounter = 0;
  let theoremCounter = 0;
  let tableCounter = 0;

  function flushPara() {
    const text = paraLines.join(" ").trim();
    paraLines = [];
    if (!text) return;
    parts.push(`<p>${formatInline(text)}</p>`);
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip metadata / boilerplate
    if (
      line === "" ||
      /^\\maketitle/.test(line) ||
      /^\\newtheorem/.test(line) ||
      /^\\bibliographystyle/.test(line) ||
      /^\\begin\{document\}/.test(line) ||
      /^\\end\{document\}/.test(line) ||
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

    // Skip comment lines
    if (line.startsWith("%")) {
      i++;
      continue;
    }

    // Skip bibliography
    if (/^\\bibliography\{/.test(line)) {
      flushPara();
      parts.push(
        `<div class="references"><h2>References</h2><p><em>[Bibliography omitted]</em></p></div>`,
      );
      i++;
      continue;
    }

    // ── Section headings ────────────────────────────────────────
    const secMatch = line.match(/^\\section\*?\{([^}]*)\}/);
    if (secMatch) {
      flushPara();
      const starred = line.includes("\\section*");
      if (!starred) {
        sectionCounter++;
        subsectionCounter = 0;
      }
      const num = starred ? "" : `${sectionCounter}. `;
      parts.push(
        `<h2><span class="sec-num">${num}</span>${formatInline(secMatch[1])}</h2>`,
      );
      i++;
      continue;
    }
    const subsecMatch = line.match(/^\\subsection\*?\{([^}]*)\}/);
    if (subsecMatch) {
      flushPara();
      const starred = line.includes("\\subsection*");
      if (!starred) subsectionCounter++;
      const num = starred ? "" : `${sectionCounter}.${subsectionCounter} `;
      parts.push(
        `<h3><span class="sec-num">${num}</span>${formatInline(subsecMatch[1])}</h3>`,
      );
      i++;
      continue;
    }
    const subsubsecMatch = line.match(/^\\subsubsection\*?\{([^}]*)\}/);
    if (subsubsecMatch) {
      flushPara();
      parts.push(`<h4>${formatInline(subsubsecMatch[1])}</h4>`);
      i++;
      continue;
    }

    // ── Display math environments ───────────────────────────────
    const mathEnvMatch = line.match(
      /^\\begin\{(equation|align|gather|multline|flalign|eqnarray)\*?\}/,
    );
    if (mathEnvMatch || line === "\\[") {
      flushPara();
      const envName = mathEnvMatch
        ? mathEnvMatch[0].replace("\\begin{", "").replace("}", "")
        : null;
      const endPat = envName ? `\\end{${envName}}` : "\\]";

      const mathLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].includes(endPat)) {
        mathLines.push(lines[i]);
        i++;
      }
      i++; // skip \end

      let mathContent = mathLines
        .join("\n")
        .replace(/\\label\{[^}]*\}/g, "")
        .replace(/\\nonumber/g, "")
        .trim();

      // Wrap align/gather etc. in the aligned environment for KaTeX
      if (envName) {
        const baseEnv = envName.replace("*", "");
        if (baseEnv === "align" || baseEnv === "eqnarray") {
          mathContent = `\\begin{aligned}\n${mathContent}\n\\end{aligned}`;
        } else if (baseEnv === "gather") {
          mathContent = `\\begin{gathered}\n${mathContent}\n\\end{gathered}`;
        }
      }

      equationCounter++;
      const isNumbered =
        envName && !envName.endsWith("*") && envName !== "align" && envName !== "gather";
      parts.push(`<div class="equation">`);
      parts.push(renderMath(mathContent, true));
      if (isNumbered) {
        parts.push(`<span class="eq-number">(${equationCounter})</span>`);
      }
      parts.push(`</div>`);
      continue;
    }

    // $$ display math (single-line)
    if (line.startsWith("$$") && line.endsWith("$$") && line.length > 4) {
      flushPara();
      const expr = line.slice(2, -2);
      parts.push(`<div class="equation">${renderMath(expr, true)}</div>`);
      i++;
      continue;
    }
    // Multi-line $$...$$
    if (line === "$$") {
      flushPara();
      const mathLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "$$") {
        mathLines.push(lines[i]);
        i++;
      }
      i++; // skip closing $$
      const expr = mathLines.join("\n").trim();
      parts.push(`<div class="equation">${renderMath(expr, true)}</div>`);
      continue;
    }

    // ── Theorem-like environments ───────────────────────────────
    const thmMatch = line.match(
      /^\\begin\{(theorem|lemma|definition|corollary|proposition|remark|proof|example)\}(?:\[([^\]]*)\])?/,
    );
    if (thmMatch) {
      flushPara();
      const envName = thmMatch[1];
      const optTitle = thmMatch[2] || "";
      const isProof = envName === "proof";

      if (!isProof) theoremCounter++;
      const label =
        envName.charAt(0).toUpperCase() +
        envName.slice(1) +
        (isProof ? "" : ` ${theoremCounter}`) +
        (optTitle ? ` (${optTitle})` : "");

      const contentLines: string[] = [];
      i++;
      const endRe = new RegExp(`^\\\\end\\{${envName}\\}`);
      while (i < lines.length && !endRe.test(lines[i].trim())) {
        contentLines.push(lines[i]);
        i++;
      }
      i++; // skip \end

      // Process content — may contain display math
      const content = contentLines.join("\n");
      const rendered = processBlockContent(content);

      parts.push(`<div class="theorem ${envName}">`);
      parts.push(`<p class="thm-head"><strong>${escapeHtml(label)}.</strong></p>`);
      parts.push(rendered);
      if (isProof) {
        parts.push(`<p class="qed">∎</p>`);
      }
      parts.push(`</div>`);
      continue;
    }

    // ── Verbatim / lstlisting ───────────────────────────────────
    if (/^\\begin\{(verbatim|lstlisting)\}/.test(line)) {
      flushPara();
      const codeLines: string[] = [];
      i++;
      while (
        i < lines.length &&
        !/\\end\{(verbatim|lstlisting)\}/.test(lines[i])
      ) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // skip \end
      parts.push(
        `<pre class="code-block"><code>${codeLines.join("\n")}</code></pre>`,
      );
      continue;
    }

    // ── Figure environment ──────────────────────────────────────
    if (/^\\begin\{figure\}/.test(line)) {
      flushPara();
      let caption = "";
      i++;
      while (i < lines.length && !/^\\end\{figure\}/.test(lines[i].trim())) {
        const fl = lines[i].trim();
        const capMatch = fl.match(/\\caption\{([^}]*)\}/);
        if (capMatch) caption = capMatch[1];
        i++;
      }
      i++; // skip \end{figure}
      parts.push(`<div class="figure">`);
      parts.push(`<div class="figure-placeholder">[Figure]</div>`);
      if (caption) {
        parts.push(
          `<p class="caption"><strong>Figure:</strong> ${formatInline(caption)}</p>`,
        );
      }
      parts.push(`</div>`);
      continue;
    }

    // ── Lists ───────────────────────────────────────────────────
    if (/^\\begin\{(itemize|enumerate)\}/.test(line)) {
      flushPara();
      const listHtml = parseList(lines, i);
      parts.push(listHtml.html);
      i = listHtml.nextIdx;
      continue;
    }

    // ── Table environment ───────────────────────────────────────
    if (/^\\begin\{table\}/.test(line)) {
      flushPara();
      tableCounter++;
      let caption = "";
      const tableRows: string[][] = [];
      i++;
      while (i < lines.length && !/^\\end\{table\}/.test(lines[i].trim())) {
        const tl = lines[i].trim();
        const capMatch = tl.match(/\\caption\{([^}]*)\}/);
        if (capMatch) caption = capMatch[1];

        if (/^\\begin\{tabular\}/.test(tl)) {
          i++;
          while (
            i < lines.length &&
            !/^\\end\{tabular\}/.test(lines[i].trim())
          ) {
            const row = lines[i].trim();
            if (
              row &&
              !/^\\(toprule|midrule|bottomrule|hline|cline|centering)/.test(
                row,
              ) &&
              row !== "\\hline"
            ) {
              const cells = row
                .replace(/\\\\$/, "")
                .replace(/\\\\\s*$/, "")
                .split("&")
                .map((c) => formatInline(c.trim()));
              if (cells.some((c) => c.trim() !== "")) {
                tableRows.push(cells);
              }
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
        parts.push(
          `<p class="caption"><strong>Table ${tableCounter}:</strong> ${formatInline(caption)}</p>`,
        );
      }
      if (tableRows.length > 0) {
        parts.push(`<table>`);
        parts.push(
          `<thead><tr>${tableRows[0].map((c) => `<th>${c}</th>`).join("")}</tr></thead>`,
        );
        parts.push(`<tbody>`);
        for (let r = 1; r < tableRows.length; r++) {
          parts.push(
            `<tr>${tableRows[r].map((c) => `<td>${c}</td>`).join("")}</tr>`,
          );
        }
        parts.push(`</tbody></table>`);
      }
      continue;
    }

    // Skip label-only lines
    if (
      /^\\label\{/.test(line) &&
      line.replace(/\\label\{[^}]*\}/, "").trim() === ""
    ) {
      i++;
      continue;
    }

    // Regular text → accumulate into paragraph
    paraLines.push(line);
    i++;
  }

  flushPara();

  // ── Assemble full HTML document ───────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin="anonymous"/>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.33/dist/katex.min.css"
      crossorigin="anonymous"/>
<link rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,300..900;1,8..60,300..900&display=swap"/>
<style>
${DOCUMENT_CSS}
</style>
</head>
<body>
<article>
${parts.join("\n")}
</article>
</body>
</html>`;
}

// ── List parser (recursive) ─────────────────────────────────────

function parseList(
  lines: string[],
  startIdx: number,
): { html: string; nextIdx: number } {
  const line = lines[startIdx].trim();
  const ordered = /enumerate/.test(line);
  const tag = ordered ? "ol" : "ul";
  const endTag = ordered ? "\\end{enumerate}" : "\\end{itemize}";

  const items: string[] = [];
  let curItem = "";
  let idx = startIdx + 1;

  while (idx < lines.length && !lines[idx].trim().startsWith(endTag)) {
    const l = lines[idx].trim();

    // Nested list
    if (/^\\begin\{(itemize|enumerate)\}/.test(l)) {
      const nested = parseList(lines, idx);
      curItem += " " + nested.html;
      idx = nested.nextIdx;
      continue;
    }

    if (/^\\item/.test(l)) {
      if (curItem) {
        items.push(`  <li>${formatInline(curItem)}</li>`);
      }
      curItem = l.replace(/^\\item\s*(?:\[[^\]]*\])?\s*/, "");
    } else if (l) {
      curItem += " " + l;
    }
    idx++;
  }
  if (curItem) {
    items.push(`  <li>${formatInline(curItem)}</li>`);
  }
  idx++; // skip \end

  return {
    html: `<${tag}>\n${items.join("\n")}\n</${tag}>`,
    nextIdx: idx,
  };
}

// ── Block content processor (for theorem bodies etc.) ───────────

function processBlockContent(content: string): string {
  const parts: string[] = [];
  const blockLines = content.split("\n");
  let idx = 0;
  let paraLines: string[] = [];

  function flushPara() {
    const text = paraLines.join(" ").trim();
    paraLines = [];
    if (!text) return;
    parts.push(`<p>${formatInline(text)}</p>`);
  }

  while (idx < blockLines.length) {
    const line = blockLines[idx].trim();

    if (line === "") {
      flushPara();
      idx++;
      continue;
    }

    // Display math inside theorems
    const mathEnvMatch = line.match(
      /^\\begin\{(equation|align|gather)\*?\}/,
    );
    if (mathEnvMatch || line === "\\[") {
      flushPara();
      const envName = mathEnvMatch
        ? mathEnvMatch[0].replace("\\begin{", "").replace("}", "")
        : null;
      const endPat = envName ? `\\end{${envName}}` : "\\]";
      const mathLines: string[] = [];
      idx++;
      while (idx < blockLines.length && !blockLines[idx].includes(endPat)) {
        mathLines.push(blockLines[idx]);
        idx++;
      }
      idx++;
      let mathContent = mathLines
        .join("\n")
        .replace(/\\label\{[^}]*\}/g, "")
        .trim();
      if (envName) {
        const base = envName.replace("*", "");
        if (base === "align") {
          mathContent = `\\begin{aligned}\n${mathContent}\n\\end{aligned}`;
        }
      }
      parts.push(
        `<div class="equation">${renderMath(mathContent, true)}</div>`,
      );
      continue;
    }

    paraLines.push(line);
    idx++;
  }
  flushPara();
  return parts.join("\n");
}

// ── Document CSS ────────────────────────────────────────────────

const DOCUMENT_CSS = `
  :root {
    --text: #1a1a2e;
    --muted: #6b7280;
    --heading: #1e3a5f;
    --accent: #2563eb;
    --bg: #ffffff;
    --code-bg: #f8f9fa;
    --border: #dee2e6;
    --abstract-bg: #f8fafc;
    --thm-bg: #fefce8;
    --thm-border: #fbbf24;
    --def-bg: #eff6ff;
    --def-border: #3b82f6;
    --proof-bg: #f0fdf4;
    --proof-border: #22c55e;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Source Serif 4', 'Computer Modern Serif', 'Latin Modern Roman', 'Georgia', 'Times New Roman', serif;
    font-size: 10.5pt;
    line-height: 1.6;
    color: var(--text);
    background: var(--bg);
  }
  article {
    max-width: 7in;
    margin: 0.6in auto;
    padding: 0;
  }

  /* Title & Authors */
  h1.title {
    font-size: 20pt;
    text-align: center;
    color: var(--heading);
    margin: 0 0 8pt;
    font-weight: 700;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }
  .authors {
    text-align: center;
    margin-bottom: 20pt;
    display: flex;
    justify-content: center;
    gap: 40pt;
    flex-wrap: wrap;
  }
  .author-block {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .author-name {
    font-weight: 600;
    font-size: 11pt;
  }
  .author-affil {
    font-size: 9pt;
    color: var(--muted);
    font-style: italic;
  }

  /* Abstract */
  .abstract {
    background: var(--abstract-bg);
    border-left: 3px solid var(--accent);
    padding: 12pt 16pt;
    margin-bottom: 18pt;
    border-radius: 0 4px 4px 0;
  }
  .abstract h2 {
    font-size: 10pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    margin-bottom: 4pt;
    color: var(--heading);
    border: none;
    padding: 0;
  }
  .abstract p {
    font-size: 9.5pt;
    line-height: 1.5;
    text-align: justify;
  }

  /* Headings */
  h2 {
    font-size: 14pt;
    color: var(--heading);
    margin: 22pt 0 8pt;
    padding-bottom: 3pt;
    border-bottom: 1.5px solid var(--border);
    font-weight: 700;
  }
  h3 {
    font-size: 12pt;
    color: var(--heading);
    margin: 16pt 0 6pt;
    font-weight: 600;
    font-style: italic;
  }
  h4 {
    font-size: 10.5pt;
    color: var(--heading);
    font-style: italic;
    margin: 10pt 0 4pt;
  }
  .sec-num {
    margin-right: 4pt;
  }

  /* Paragraphs */
  p {
    margin: 0 0 8pt;
    text-align: justify;
    text-indent: 0;
    hyphens: auto;
  }
  strong { font-weight: 700; }
  em { font-style: italic; }

  /* Math */
  .equation {
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 14pt 0;
    position: relative;
    overflow-x: auto;
  }
  .eq-number {
    position: absolute;
    right: 0;
    font-size: 10pt;
    color: var(--text);
  }
  .katex-display {
    margin: 0 !important;
  }
  .katex { font-size: 1.05em; }
  .math-fallback {
    font-family: 'Courier New', monospace;
    font-size: 9.5pt;
    background: var(--code-bg);
    padding: 6pt 12pt;
    border-radius: 3px;
    border: 1px solid var(--border);
    text-align: center;
  }
  .math-fallback-inline {
    font-family: 'Courier New', monospace;
    font-size: 9.5pt;
    background: var(--code-bg);
    padding: 1px 4px;
    border-radius: 2px;
  }

  /* Code */
  .code-block {
    background: #282c34;
    color: #abb2bf;
    border-radius: 6px;
    padding: 12pt 16pt;
    margin: 10pt 0;
    overflow-x: auto;
    font-size: 9pt;
    line-height: 1.55;
  }
  .code-block code {
    font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', 'Courier New', monospace;
  }

  /* Lists */
  ul, ol { margin: 6pt 0 10pt 22pt; }
  li { margin-bottom: 3pt; }

  /* Theorems */
  .theorem {
    border-radius: 4px;
    padding: 10pt 14pt;
    margin: 12pt 0;
  }
  .theorem.theorem, .theorem.lemma, .theorem.corollary, .theorem.proposition {
    background: var(--thm-bg);
    border-left: 3px solid var(--thm-border);
  }
  .theorem.definition, .theorem.example {
    background: var(--def-bg);
    border-left: 3px solid var(--def-border);
  }
  .theorem.proof {
    background: var(--proof-bg);
    border-left: 3px solid var(--proof-border);
  }
  .theorem.remark {
    background: #fefce8;
    border-left: 3px solid #a3a3a3;
  }
  .thm-head {
    margin-bottom: 4pt;
  }
  .qed {
    text-align: right;
    margin-top: 4pt;
    font-size: 12pt;
  }

  /* Tables */
  table {
    width: auto;
    margin: 10pt auto 16pt;
    border-collapse: collapse;
    font-size: 9.5pt;
  }
  th, td {
    padding: 5pt 12pt;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  thead th {
    border-top: 2px solid var(--text);
    border-bottom: 2px solid var(--text);
    font-weight: 700;
    background: transparent;
  }
  tbody tr:last-child td {
    border-bottom: 2px solid var(--text);
  }

  /* Figures */
  .figure {
    margin: 14pt 0;
    text-align: center;
  }
  .figure-placeholder {
    background: var(--code-bg);
    border: 1px dashed var(--border);
    padding: 30pt 20pt;
    color: var(--muted);
    font-style: italic;
    border-radius: 4px;
    margin-bottom: 6pt;
  }
  .caption {
    text-align: center;
    font-size: 9pt;
    color: var(--muted);
    margin-bottom: 6pt;
  }

  /* References */
  .references {
    margin-top: 24pt;
    padding-top: 12pt;
    border-top: 1px solid var(--border);
  }

  sup { font-size: 0.7em; vertical-align: super; }
  sub { font-size: 0.7em; vertical-align: sub; }
`;
