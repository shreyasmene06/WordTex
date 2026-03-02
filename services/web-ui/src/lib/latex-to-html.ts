/**
 * Generic LaTeX → HTML renderer.
 *
 * Handles ANY LaTeX document generically — not hardcoded to any template or
 * document class. Supports articles, reports, books, resumes, letters, beamer,
 * and custom document classes.
 *
 * Uses KaTeX for math typesetting. Generates a self-contained HTML document
 * for iframe rendering.
 *
 * Pipeline:
 *   1. Extract & expand custom macros (\newcommand, \renewcommand, \def)
 *   2. Extract metadata (title, author, date)
 *   3. Parse body into blocks (sections, envs, paragraphs)
 *   4. Render inline formatting + math via KaTeX
 *   5. Wrap in styled HTML document
 */

import katex from "katex";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render LaTeX math to HTML via KaTeX. */
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
        "\\eps": "\\varepsilon",
        "\\1": "\\mathbb{1}",
      },
    });
  } catch {
    return displayMode
      ? `<div class="math-fallback">${escapeHtml(expr)}</div>`
      : `<code class="math-fallback-inline">${escapeHtml(expr)}</code>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// BRACE & ARGUMENT MATCHING
// ═══════════════════════════════════════════════════════════════

/** Extract a {braced group} starting at `pos`. */
function extractBraceGroup(
  text: string,
  pos: number,
): { content: string; end: number } | null {
  if (pos >= text.length || text[pos] !== "{") return null;
  let depth = 1;
  let i = pos + 1;
  while (i < text.length && depth > 0) {
    if (text[i] === "\\" && i + 1 < text.length) {
      i += 2;
      continue;
    } // skip escaped chars
    if (text[i] === "{") depth++;
    if (text[i] === "}") depth--;
    i++;
  }
  if (depth !== 0) return null;
  return { content: text.slice(pos + 1, i - 1), end: i };
}

/** Extract an [optional argument] starting at `pos`. */
function extractOptionalArg(
  text: string,
  pos: number,
): { content: string; end: number } | null {
  if (pos >= text.length || text[pos] !== "[") return null;
  let depth = 1;
  let i = pos + 1;
  while (i < text.length && depth > 0) {
    if (text[i] === "[") depth++;
    if (text[i] === "]") depth--;
    i++;
  }
  if (depth !== 0) return null;
  return { content: text.slice(pos + 1, i - 1), end: i };
}

/** Extract the main argument of a \command, handling optional args and nested braces. */
function extractCommand(src: string, cmd: string): string | null {
  const idx = src.indexOf("\\" + cmd);
  if (idx === -1) return null;
  let p = idx + cmd.length + 1;
  // Skip whitespace
  while (p < src.length && /\s/.test(src[p])) p++;
  // Skip optional argument [...]
  if (p < src.length && src[p] === "[") {
    const opt = extractOptionalArg(src, p);
    if (opt) p = opt.end;
    while (p < src.length && /\s/.test(src[p])) p++;
  }
  // Extract brace group
  if (p < src.length && src[p] === "{") {
    const group = extractBraceGroup(src, p);
    return group ? group.content : null;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// MACRO EXPANSION
// ═══════════════════════════════════════════════════════════════

interface MacroDef {
  name: string; // without backslash
  nargs: number;
  body: string;
}

/** Parse \newcommand, \renewcommand, \providecommand, \def definitions. */
function parseMacroDefinitions(source: string): {
  macros: Map<string, MacroDef>;
  cleaned: string;
} {
  const macros = new Map<string, MacroDef>();
  const toRemove: { start: number; end: number }[] = [];

  // \newcommand{\name}[nargs]{body} or \newcommand\name[nargs]{body}
  const cmdRe =
    /\\(?:new|renew|provide)command\*?\s*\{?\\([a-zA-Z@]+)\}?\s*(?:\[(\d)\])?\s*(?:\[[^\]]*\])?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = cmdRe.exec(source)) !== null) {
    const name = m[1];
    const nargs = m[2] ? parseInt(m[2]) : 0;
    const bodyStart = m.index + m[0].length - 1;
    const group = extractBraceGroup(source, bodyStart);
    if (group) {
      macros.set(name, { name, nargs, body: group.content });
      toRemove.push({ start: m.index, end: group.end });
    }
  }

  // \def\name{body} (TeX primitive, simple form)
  const defRe = /\\def\\([a-zA-Z@]+)\s*(?:#\d)*\s*\{/g;
  while ((m = defRe.exec(source)) !== null) {
    const name = m[1];
    if (macros.has(name)) continue;
    const bodyStart = m.index + m[0].length - 1;
    const group = extractBraceGroup(source, bodyStart);
    if (group) {
      let maxArg = 0;
      const argRe = /#(\d)/g;
      let am: RegExpExecArray | null;
      while ((am = argRe.exec(group.content)) !== null) {
        maxArg = Math.max(maxArg, parseInt(am[1]));
      }
      macros.set(name, { name, nargs: maxArg, body: group.content });
      toRemove.push({ start: m.index, end: group.end });
    }
  }

  // \DeclareMathOperator{\name}{text}
  const mathOpRe = /\\DeclareMathOperator\*?\{\\([a-zA-Z]+)\}\{([^}]*)\}/g;
  while ((m = mathOpRe.exec(source)) !== null) {
    if (!macros.has(m[1])) {
      macros.set(m[1], {
        name: m[1],
        nargs: 0,
        body: `\\operatorname{${m[2]}}`,
      });
      toRemove.push({ start: m.index, end: m.index + m[0].length });
    }
  }

  // Remove definitions from source (reverse order to preserve indices)
  toRemove.sort((a, b) => b.start - a.start);
  let cleaned = source;
  for (const r of toRemove) {
    cleaned = cleaned.slice(0, r.start) + cleaned.slice(r.end);
  }

  return { macros, cleaned };
}

/** Expand custom macros in text. Multiple passes for nested definitions. */
function expandMacros(text: string, macros: Map<string, MacroDef>): string {
  if (macros.size === 0) return text;

  for (let pass = 0; pass < 10; pass++) {
    let changed = false;

    for (const [name, def] of macros) {
      const pattern = "\\" + name;
      let idx = 0;

      while (true) {
        idx = text.indexOf(pattern, idx);
        if (idx === -1) break;

        // Ensure it's a complete command (not part of a longer name)
        const afterCmd = idx + pattern.length;
        if (afterCmd < text.length && /[a-zA-Z@]/.test(text[afterCmd])) {
          idx = afterCmd;
          continue;
        }

        let replacement = def.body;
        let endIdx = afterCmd;

        if (def.nargs > 0) {
          let valid = true;
          for (let a = 1; a <= def.nargs; a++) {
            while (endIdx < text.length && /[\s\n]/.test(text[endIdx]))
              endIdx++;
            const group = extractBraceGroup(text, endIdx);
            if (group) {
              replacement = replacement.split(`#${a}`).join(group.content);
              endIdx = group.end;
            } else {
              valid = false;
              break;
            }
          }
          if (!valid) {
            idx = afterCmd;
            continue;
          }
        }

        text = text.slice(0, idx) + replacement + text.slice(endIdx);
        changed = true;
        idx += replacement.length;
      }
    }

    if (!changed) break;
  }

  return text;
}

// ═══════════════════════════════════════════════════════════════
// INLINE MATH PROCESSING
// ═══════════════════════════════════════════════════════════════

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

    // Skip $$ (display math handled at block level)
    if (s[dollarIdx + 1] === "$") {
      parts.push(s.slice(i, dollarIdx));
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

// ═══════════════════════════════════════════════════════════════
// DIMENSION CONVERSION
// ═══════════════════════════════════════════════════════════════

const FONT_SIZE_MAP: Record<string, string> = {
  tiny: "6pt",
  scriptsize: "7pt",
  footnotesize: "8pt",
  small: "9pt",
  normalsize: "10.5pt",
  large: "12pt",
  Large: "14pt",
  LARGE: "17pt",
  huge: "20pt",
  Huge: "25pt",
};

/** Convert a LaTeX dimension to CSS. */
function latexDimToCss(dim: string): string {
  dim = dim.trim();
  // \textwidth, \linewidth, \columnwidth → percentage
  if (/\\(?:textwidth|linewidth|columnwidth)/.test(dim)) {
    const frac = dim.match(
      /([\d.]+)\s*\\(?:textwidth|linewidth|columnwidth)/,
    );
    if (frac) return `${parseFloat(frac[1]) * 100}%`;
    return "100%";
  }
  // Standard TeX dimensions
  if (/^-?[\d.]+\s*(pt|em|ex|cm|mm|in|bp|pc|px)$/.test(dim))
    return dim.replace(/\s+/g, "");
  // Bare number → assume pt
  if (/^-?[\d.]+$/.test(dim)) return dim + "pt";
  // fill → 100%
  if (/\\fill/.test(dim)) return "100%";
  return dim;
}

// ═══════════════════════════════════════════════════════════════
// INLINE FORMATTING
// ═══════════════════════════════════════════════════════════════

function formatInline(text: string): string {
  let s = text;

  // ── Remove / convert cross-references ──────────────────────
  s = s.replace(/\\label\{[^}]*\}/g, "");
  s = s.replace(
    /\\(?:eq)?ref\{[^}]*\}/g,
    '<em class="ref">[ref]</em>',
  );
  s = s.replace(
    /\\(?:cite|citep|citet|citeauthor|citeyear|autocite|parencite)\{[^}]*\}/g,
    '<em class="ref">[citation]</em>',
  );

  // ── Special commands ───────────────────────────────────────
  s = s.replace(
    /\\LaTeX\b\{?\}?/g,
    'L<sup style="font-size:0.85em;position:relative;top:-0.15em;margin-left:-0.36em;margin-right:-0.15em">A</sup>T<sub style="font-size:0.85em;position:relative;top:0.15em;margin-left:-0.1em;margin-right:-0.1em">E</sub>X',
  );
  s = s.replace(
    /\\TeX\b\{?\}?/g,
    'T<sub style="font-size:0.85em;position:relative;top:0.15em;margin-left:-0.1em;margin-right:-0.1em">E</sub>X',
  );

  // ── Inline math (KaTeX) — must come before other formatting ─
  s = processInlineMath(s);

  // ── Font size commands ─────────────────────────────────────
  // \large{text} form
  for (const [cmd, size] of Object.entries(FONT_SIZE_MAP)) {
    const re = new RegExp(
      `\\\\${cmd}\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`,
      "g",
    );
    s = s.replace(re, `<span style="font-size:${size}">$1</span>`);
  }
  // {\large text} grouped form
  for (const [cmd, size] of Object.entries(FONT_SIZE_MAP)) {
    const re = new RegExp(`\\{\\\\${cmd}\\s+([^}]*)\\}`, "g");
    s = s.replace(re, `<span style="font-size:${size}">$1</span>`);
  }
  // Bare \large (just strip — affects following text which we can't scope)
  for (const cmd of Object.keys(FONT_SIZE_MAP)) {
    s = s.replace(new RegExp(`\\\\${cmd}\\b`, "g"), "");
  }

  // ── Text formatting commands (new-style) ───────────────────
  s = s.replace(/\\textbf\{((?:[^{}]|\{[^{}]*\})*)\}/g, "<strong>$1</strong>");
  s = s.replace(/\\textit\{((?:[^{}]|\{[^{}]*\})*)\}/g, "<em>$1</em>");
  s = s.replace(/\\emph\{((?:[^{}]|\{[^{}]*\})*)\}/g, "<em>$1</em>");
  s = s.replace(
    /\\textsc\{((?:[^{}]|\{[^{}]*\})*)\}/g,
    '<span style="font-variant:small-caps">$1</span>',
  );
  s = s.replace(/\\texttt\{((?:[^{}]|\{[^{}]*\})*)\}/g, "<code>$1</code>");
  s = s.replace(/\\underline\{((?:[^{}]|\{[^{}]*\})*)\}/g, "<u>$1</u>");
  s = s.replace(
    /\\textsuperscript\{([^}]*)\}/g,
    "<sup>$1</sup>",
  );
  s = s.replace(
    /\\textsubscript\{([^}]*)\}/g,
    "<sub>$1</sub>",
  );

  // ── Old-style font commands: {\bf text}, {\it text} ────────
  s = s.replace(/\{\\bf\s+([^}]*)\}/g, "<strong>$1</strong>");
  s = s.replace(/\{\\bfseries\s+([^}]*)\}/g, "<strong>$1</strong>");
  s = s.replace(/\{\\it\s+([^}]*)\}/g, "<em>$1</em>");
  s = s.replace(/\{\\itshape\s+([^}]*)\}/g, "<em>$1</em>");
  s = s.replace(
    /\{\\sc\s+([^}]*)\}/g,
    '<span style="font-variant:small-caps">$1</span>',
  );
  s = s.replace(
    /\{\\scshape\s+([^}]*)\}/g,
    '<span style="font-variant:small-caps">$1</span>',
  );
  s = s.replace(/\{\\tt\s+([^}]*)\}/g, "<code>$1</code>");
  s = s.replace(
    /\{\\sf\s+([^}]*)\}/g,
    '<span style="font-family:sans-serif">$1</span>',
  );
  s = s.replace(
    /\{\\sffamily\s+([^}]*)\}/g,
    '<span style="font-family:sans-serif">$1</span>',
  );

  // Strip bare old-style font switches
  s = s.replace(
    /\\(?:bf|it|sc|tt|sf|rm|sl|bfseries|itshape|scshape|ttfamily|sffamily|rmfamily|mdseries|upshape)\b/g,
    "",
  );

  // ── Color commands ─────────────────────────────────────────
  s = s.replace(
    /\\textcolor\{([^}]*)\}\{([^}]*)\}/g,
    '<span style="color:$1">$2</span>',
  );
  s = s.replace(
    /\\colorbox\{([^}]*)\}\{([^}]*)\}/g,
    '<span style="background:$1;padding:1px 3px">$2</span>',
  );
  s = s.replace(
    /\\color\{([^}]*)\}/g,
    "",
  ); // bare \color — just strip

  // ── URLs ───────────────────────────────────────────────────
  s = s.replace(
    /\\url\{([^}]*)\}/g,
    '<a href="$1" class="url">$1</a>',
  );
  s = s.replace(
    /\\href\{([^}]*)\}\{([^}]*)\}/g,
    '<a href="$1" class="url">$2</a>',
  );

  // ── Footnotes / thanks ─────────────────────────────────────
  s = s.replace(
    /\\footnote\{((?:[^{}]|\{[^{}]*\})*)\}/g,
    '<sup class="footnote" title="$1">&dagger;</sup>',
  );
  s = s.replace(
    /\\thanks\{((?:[^{}]|\{[^{}]*\})*)\}/g,
    '<sup class="footnote" title="$1">*</sup>',
  );

  // ── Spacing commands ───────────────────────────────────────
  s = s.replace(/\\hfill\b/g, '<span class="hfill"></span>');
  s = s.replace(
    /\\hspace\*?\{([^}]*)\}/g,
    (_, dim: string) =>
      `<span style="display:inline-block;width:${latexDimToCss(dim)}"></span>`,
  );
  s = s.replace(
    /\\qquad\b/g,
    '<span style="display:inline-block;width:2em"></span>',
  );
  s = s.replace(
    /\\quad\b/g,
    '<span style="display:inline-block;width:1em"></span>',
  );
  s = s.replace(
    /\\enspace\b/g,
    '<span style="display:inline-block;width:0.5em"></span>',
  );
  s = s.replace(
    /\\[,;]\s*/g,
    '<span style="display:inline-block;width:0.167em"></span>',
  );

  // ── Inline rule ────────────────────────────────────────────
  s = s.replace(
    /\\rule\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}\s*\{([^}]*)\}/g,
    (_, width: string, height: string) => {
      const w = latexDimToCss(width);
      const h = latexDimToCss(height);
      if (
        /\\(?:textwidth|linewidth|columnwidth)/.test(width) ||
        w === "100%"
      ) {
        return `<hr class="latex-rule" style="border-top-width:${h}"/>`;
      }
      return `<span style="display:inline-block;width:${w};height:${h};background:currentColor;vertical-align:middle"></span>`;
    },
  );

  // ── Non-breaking space & line breaks ───────────────────────
  s = s.replace(/~/g, "&nbsp;");
  // \\ with optional spacing arg → line break
  s = s.replace(/\\\\(?:\[([^\]]*)\])?\s*/g, (_, dim?: string) => {
    if (dim) {
      return `<br/><span style="display:block;height:${latexDimToCss(dim)}"></span>`;
    }
    return "<br/>";
  });
  s = s.replace(/\\newline\b/g, "<br/>");

  // ── \input, \include (strip — we can't resolve files) ──────
  s = s.replace(/\\(?:input|include)\{[^}]*\}/g, "");

  // ── Final cleanup ──────────────────────────────────────────
  // Strip remaining unknown commands but keep their braced content
  s = s.replace(/\\[a-zA-Z]+\*?\{((?:[^{}]|\{[^{}]*\})*)\}/g, "$1");
  // Strip remaining bare commands (but not line breaks we already handled)
  s = s.replace(/\\[a-zA-Z]+\*?/g, "");
  // Remove leftover braces (but preserve content)
  s = s.replace(/[{}]/g, "");
  // Collapse excessive whitespace but preserve single spaces
  s = s.replace(/ {3,}/g, "  ");

  return s.trim();
}

// ═══════════════════════════════════════════════════════════════
// BLOCK-LEVEL HELPERS
// ═══════════════════════════════════════════════════════════════

/** Build an HTML table from parsed rows. */
function buildHtmlTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const parts: string[] = [];
  parts.push("<table>");
  parts.push(
    `<thead><tr>${rows[0].map((c) => `<th>${c}</th>`).join("")}</tr></thead>`,
  );
  if (rows.length > 1) {
    parts.push("<tbody>");
    for (let r = 1; r < rows.length; r++) {
      parts.push(
        `<tr>${rows[r].map((c) => `<td>${c}</td>`).join("")}</tr>`,
      );
    }
    parts.push("</tbody>");
  }
  parts.push("</table>");
  return parts.join("\n");
}

/** Parse a list environment (recursive for nested lists). */
function parseList(
  lines: string[],
  startIdx: number,
): { html: string; nextIdx: number } {
  const line = lines[startIdx].trim();
  const isDescription = /description/.test(line);
  const ordered = /enumerate/.test(line);
  const tag = isDescription ? "dl" : ordered ? "ol" : "ul";
  const endTag = isDescription
    ? "\\end{description}"
    : ordered
      ? "\\end{enumerate}"
      : "\\end{itemize}";

  const items: string[] = [];
  let curItem = "";
  let curLabel = "";
  let idx = startIdx + 1;

  function flushItem() {
    if (!curItem && !curLabel) return;
    if (isDescription) {
      items.push(
        `  <dt>${formatInline(curLabel)}</dt><dd>${formatInline(curItem)}</dd>`,
      );
    } else {
      items.push(`  <li>${formatInline(curItem)}</li>`);
    }
    curItem = "";
    curLabel = "";
  }

  while (idx < lines.length && !lines[idx].trim().startsWith(endTag)) {
    const l = lines[idx].trim();

    // Nested list
    if (/^\\begin\{(itemize|enumerate|description)\}/.test(l)) {
      const nested = parseList(lines, idx);
      curItem += " " + nested.html;
      idx = nested.nextIdx;
      continue;
    }

    if (/^\\item/.test(l)) {
      flushItem();
      // Description label: \item[label] text
      const labelMatch = l.match(/^\\item\s*\[([^\]]*)\]\s*(.*)/);
      if (labelMatch) {
        curLabel = labelMatch[1];
        curItem = labelMatch[2];
      } else {
        curItem = l.replace(/^\\item\s*/, "");
      }
    } else if (l) {
      curItem += " " + l;
    }
    idx++;
  }
  flushItem();
  idx++; // skip \end

  return {
    html: `<${tag}>\n${items.join("\n")}\n</${tag}>`,
    nextIdx: idx,
  };
}

/** Parse tabular rows from lines (shared between table and standalone tabular). */
function parseTabularRows(
  lines: string[],
  startIdx: number,
): { rows: string[][]; nextIdx: number } {
  const rows: string[][] = [];
  let idx = startIdx;
  while (
    idx < lines.length &&
    !/^\\end\{(?:tabular|tabularx|tabulary|longtable|tabu)\}/.test(
      lines[idx].trim(),
    )
  ) {
    const row = lines[idx].trim();
    if (
      row &&
      !/^\\(?:toprule|midrule|bottomrule|hline|cline|centering|arraybackslash)\b/.test(
        row,
      ) &&
      row !== "\\hline"
    ) {
      // Handle multicolumn: \multicolumn{n}{align}{text}
      let processedRow = row;
      processedRow = processedRow.replace(
        /\\multicolumn\{[^}]*\}\{[^}]*\}\{([^}]*)\}/g,
        "$1",
      );
      processedRow = processedRow.replace(
        /\\multirow\{[^}]*\}\{[^}]*\}\{([^}]*)\}/g,
        "$1",
      );
      const cells = processedRow
        .replace(/\\\\[\s]*$/, "")
        .replace(/\\\\\s*$/, "")
        .split("&")
        .map((c) => formatInline(c.trim()));
      if (cells.some((c) => c.trim() !== "")) {
        rows.push(cells);
      }
    }
    idx++;
  }
  idx++; // skip \end{tabular}
  return { rows, nextIdx: idx };
}

/** Process content inside environments (theorems, alignment envs, etc.) */
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
    if (line.startsWith("%")) {
      idx++;
      continue;
    }

    // Display math
    const mathEnvMatch = line.match(
      /^\\begin\{(equation|align|gather|multline)\*?\}/,
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
        .replace(/\\nonumber/g, "")
        .replace(/\\notag/g, "")
        .trim();
      if (envName) {
        const base = envName.replace("*", "");
        if (base === "align" || base === "eqnarray")
          mathContent = `\\begin{aligned}\n${mathContent}\n\\end{aligned}`;
        else if (base === "gather")
          mathContent = `\\begin{gathered}\n${mathContent}\n\\end{gathered}`;
        else if (base === "multline")
          mathContent = `\\begin{gathered}\n${mathContent}\n\\end{gathered}`;
      }
      parts.push(
        `<div class="equation">${renderMath(mathContent, true)}</div>`,
      );
      continue;
    }

    // Lists
    if (/^\\begin\{(itemize|enumerate|description)\}/.test(line)) {
      flushPara();
      const listHtml = parseList(blockLines, idx);
      parts.push(listHtml.html);
      idx = listHtml.nextIdx;
      continue;
    }

    // Spacing
    if (/^\\vspace\*?\{/.test(line)) {
      flushPara();
      const m = line.match(/^\\vspace\*?\{([^}]*)\}/);
      if (m)
        parts.push(`<div style="height:${latexDimToCss(m[1])}"></div>`);
      idx++;
      continue;
    }
    if (/^\\(?:smallskip|medskip|bigskip)\b/.test(line)) {
      flushPara();
      const sizes: Record<string, string> = {
        smallskip: "3pt",
        medskip: "6pt",
        bigskip: "12pt",
      };
      const cmd = line.match(/\\(smallskip|medskip|bigskip)/)?.[1] ?? "medskip";
      parts.push(`<div style="height:${sizes[cmd]}"></div>`);
      idx++;
      continue;
    }

    // Horizontal rules
    if (/^\\(?:hrule|hrulefill)\b/.test(line)) {
      flushPara();
      parts.push('<hr class="latex-rule"/>');
      idx++;
      continue;
    }
    if (/^\\rule/.test(line)) {
      flushPara();
      const m = line.match(
        /\\rule\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}\s*\{([^}]*)\}/,
      );
      if (m) {
        parts.push(
          `<hr class="latex-rule" style="width:${latexDimToCss(m[1])};border-top-width:${latexDimToCss(m[2])}"/>`,
        );
      }
      idx++;
      continue;
    }

    paraLines.push(line);
    idx++;
  }
  flushPara();
  return parts.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// MAIN CONVERTER
// ═══════════════════════════════════════════════════════════════

export function latexToHtml(source: string): string {
  // ── Step 1: Extract & expand macros ────────────────────────
  const { macros, cleaned } = parseMacroDefinitions(source);
  const src = expandMacros(cleaned, macros);

  // ── Step 2: Extract metadata ───────────────────────────────
  const title = extractCommand(src, "title") ?? "";

  // Authors — handle many formats
  const authorBlock = extractCommand(src, "author") ?? "";
  const authors: { name: string; affiliation?: string }[] = [];

  // IEEE format: \IEEEauthorblockN{Name} \IEEEauthorblockA{Affil}
  const ieeeNameRe = /\\IEEEauthorblockN\{([^}]*)\}/g;
  const ieeeAffRe =
    /\\IEEEauthorblockA\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
  const ieeeNames: string[] = [];
  const ieeeAffs: string[] = [];
  let ieeeM: RegExpExecArray | null;
  while ((ieeeM = ieeeNameRe.exec(authorBlock)) !== null)
    ieeeNames.push(ieeeM[1]);
  while ((ieeeM = ieeeAffRe.exec(authorBlock)) !== null) {
    ieeeAffs.push(
      ieeeM[1]
        .replace(/\\\\/g, ", ")
        .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, "$1")
        .replace(/[{}]/g, "")
        .trim(),
    );
  }

  if (ieeeNames.length > 0) {
    for (let a = 0; a < ieeeNames.length; a++) {
      authors.push({ name: ieeeNames[a], affiliation: ieeeAffs[a] });
    }
  } else if (authorBlock.trim()) {
    // General format: split on \and
    for (const a of authorBlock.split(/\\and/)) {
      const cleaned2 = a.replace(/\\thanks\{[^}]*\}/g, "");
      const authorLines = cleaned2.split(/\\\\/);
      const name = authorLines[0]
        ?.replace(/\\[a-zA-Z]+\*?\{([^}]*)\}/g, "$1")
        .replace(/\\[a-zA-Z]+\*?/g, " ")
        .replace(/[{}]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const affil = authorLines
        .slice(1)
        .map((l) =>
          l
            .replace(/\\[a-zA-Z]+\*?\{([^}]*)\}/g, "$1")
            .replace(/\\[a-zA-Z]+\*?/g, " ")
            .replace(/[{}]/g, "")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter(Boolean)
        .join(", ");
      if (name) authors.push({ name, affiliation: affil || undefined });
    }
  }

  // Date
  const dateRaw = extractCommand(src, "date");
  const dateStr =
    dateRaw && dateRaw.trim() !== "\\today" && dateRaw.trim() !== ""
      ? dateRaw.trim()
      : null;

  // Abstract
  const abstractMatch = src.match(
    /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/,
  );
  const abstract = abstractMatch ? abstractMatch[1].trim() : "";

  // ── Step 3: Extract body ───────────────────────────────────
  let body = src;
  const bodyStart = src.indexOf("\\begin{document}");
  if (bodyStart >= 0)
    body = src.slice(bodyStart + "\\begin{document}".length);
  const bodyEnd = body.indexOf("\\end{document}");
  if (bodyEnd >= 0) body = body.slice(0, bodyEnd);

  // ── Step 4: Build HTML parts ───────────────────────────────
  const parts: string[] = [];

  // Title
  if (title) {
    parts.push(`<h1 class="doc-title">${formatInline(title)}</h1>`);
  }

  // Authors
  if (authors.length > 0) {
    parts.push('<div class="authors">');
    for (const a of authors) {
      parts.push('<div class="author-block">');
      parts.push(
        `<span class="author-name">${escapeHtml(a.name)}</span>`,
      );
      if (a.affiliation) {
        parts.push(
          `<span class="author-affil">${escapeHtml(a.affiliation)}</span>`,
        );
      }
      parts.push("</div>");
    }
    parts.push("</div>");
  }

  // Date
  if (dateStr) {
    parts.push(`<div class="doc-date">${formatInline(dateStr)}</div>`);
  }

  // Abstract
  if (abstract) {
    parts.push('<div class="abstract">');
    parts.push('<div class="abstract-title">Abstract</div>');
    parts.push(`<p>${formatInline(abstract)}</p>`);
    parts.push("</div>");
  }

  // ── Step 5: Parse body line-by-line ────────────────────────
  const lines = body.split("\n");
  let i = 0;
  let paraLines: string[] = [];
  let sectionCounter = 0;
  let subsectionCounter = 0;
  let subsubsectionCounter = 0;
  let equationCounter = 0;
  let theoremCounter = 0;
  let tableCounter = 0;
  let figureCounter = 0;
  let noindentNext = false;

  function flushPara() {
    const text = paraLines.join(" ").trim();
    paraLines = [];
    if (!text) return;
    const cls = noindentNext ? ' class="noindent"' : "";
    noindentNext = false;
    // Lines containing \hfill need flex layout
    const hasHfill = text.includes("\\hfill");
    if (hasHfill) {
      parts.push(`<div class="hfill-line"${cls}>${formatInline(text)}</div>`);
    } else {
      parts.push(`<p${cls}>${formatInline(text)}</p>`);
    }
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    // ── Empty line → flush paragraph ─────────────────────────
    if (line === "") {
      flushPara();
      i++;
      continue;
    }

    // ── Skip preamble / metadata commands ────────────────────
    if (
      /^\\(?:maketitle|newtheorem|bibliographystyle|begin\{document\}|end\{document\}|usepackage|RequirePackage|documentclass|pagestyle|thispagestyle|setlength|setcounter|addtolength|geometry|hypersetup|graphicspath|input\{|include\{|pagenumbering|tableofcontents|listoffigures|listoftables|makeatletter|makeatother|AtBeginDocument|AtEndDocument)\b/.test(
        line,
      )
    ) {
      // Skip multi-line title/author/date blocks
      if (/^\\(?:title|author|date)\s*[\[{]/.test(line)) {
        let depth =
          (line.match(/\{/g) || []).length -
          (line.match(/\}/g) || []).length;
        while (depth > 0 && i + 1 < lines.length) {
          i++;
          const l = lines[i];
          depth +=
            (l.match(/\{/g) || []).length -
            (l.match(/\}/g) || []).length;
        }
      }
      i++;
      continue;
    }

    // Skip title/author/date definitions in body
    if (/^\\(?:title|author|date)\s*[\[{]/.test(line)) {
      let depth =
        (line.match(/\{/g) || []).length -
        (line.match(/\}/g) || []).length;
      while (depth > 0 && i + 1 < lines.length) {
        i++;
        depth +=
          (lines[i].match(/\{/g) || []).length -
          (lines[i].match(/\}/g) || []).length;
      }
      i++;
      continue;
    }

    // Skip abstract (already extracted)
    if (/^\\begin\{abstract\}/.test(line)) {
      while (
        i < lines.length &&
        !lines[i].includes("\\end{abstract}")
      )
        i++;
      i++;
      continue;
    }

    // Skip comments
    if (line.startsWith("%")) {
      i++;
      continue;
    }

    // ── \noindent ────────────────────────────────────────────
    if (/^\\noindent\b/.test(line)) {
      noindentNext = true;
      const rest = line.replace(/^\\noindent\s*/, "");
      if (rest) paraLines.push(rest);
      i++;
      continue;
    }

    // ── Page breaks ──────────────────────────────────────────
    if (/^\\(?:newpage|clearpage|pagebreak)\b/.test(line)) {
      flushPara();
      parts.push('<div class="page-break"></div>');
      i++;
      continue;
    }

    // ── Vertical spacing ─────────────────────────────────────
    if (/^\\vspace\*?\{/.test(line)) {
      flushPara();
      const m = line.match(/^\\vspace\*?\{([^}]*)\}/);
      if (m)
        parts.push(
          `<div style="height:${latexDimToCss(m[1])}"></div>`,
        );
      i++;
      continue;
    }
    if (/^\\(?:smallskip|medskip|bigskip)\b/.test(line)) {
      flushPara();
      const sizes: Record<string, string> = {
        smallskip: "3pt",
        medskip: "6pt",
        bigskip: "12pt",
      };
      const cmd =
        line.match(/\\(smallskip|medskip|bigskip)/)?.[1] ?? "medskip";
      parts.push(`<div style="height:${sizes[cmd]}"></div>`);
      i++;
      continue;
    }

    // ── Horizontal rules ─────────────────────────────────────
    if (/^\\(?:hrule|hrulefill)\b/.test(line)) {
      flushPara();
      parts.push('<hr class="latex-rule"/>');
      i++;
      continue;
    }
    if (/^\\rule\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}\s*\{([^}]*)\}/.test(line)) {
      flushPara();
      const m = line.match(
        /^\\rule\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}\s*\{([^}]*)\}/,
      );
      if (m) {
        const width = latexDimToCss(m[2]);
        const height = latexDimToCss(m[3]);
        parts.push(
          `<hr class="latex-rule" style="width:${width};border-top-width:${height}"/>`,
        );
      }
      i++;
      continue;
    }

    // ── Section headings ─────────────────────────────────────
    const secMatch = line.match(
      /^\\section\*?\{((?:[^{}]|\{[^{}]*\})*)\}/,
    );
    if (secMatch) {
      flushPara();
      const starred = line.includes("\\section*");
      if (!starred) {
        sectionCounter++;
        subsectionCounter = 0;
        subsubsectionCounter = 0;
      }
      const num = starred ? "" : `${sectionCounter}. `;
      parts.push(
        `<h2 class="section"><span class="sec-num">${num}</span>${formatInline(secMatch[1])}</h2>`,
      );
      i++;
      continue;
    }
    const subsecMatch = line.match(
      /^\\subsection\*?\{((?:[^{}]|\{[^{}]*\})*)\}/,
    );
    if (subsecMatch) {
      flushPara();
      const starred = line.includes("\\subsection*");
      if (!starred) {
        subsectionCounter++;
        subsubsectionCounter = 0;
      }
      const num = starred
        ? ""
        : `${sectionCounter}.${subsectionCounter} `;
      parts.push(
        `<h3 class="subsection"><span class="sec-num">${num}</span>${formatInline(subsecMatch[1])}</h3>`,
      );
      i++;
      continue;
    }
    const subsubsecMatch = line.match(
      /^\\subsubsection\*?\{((?:[^{}]|\{[^{}]*\})*)\}/,
    );
    if (subsubsecMatch) {
      flushPara();
      const starred = line.includes("\\subsubsection*");
      if (!starred) subsubsectionCounter++;
      const num = starred
        ? ""
        : `${sectionCounter}.${subsectionCounter}.${subsubsectionCounter} `;
      parts.push(
        `<h4 class="subsubsection"><span class="sec-num">${num}</span>${formatInline(subsubsecMatch[1])}</h4>`,
      );
      i++;
      continue;
    }
    // \paragraph{title} — run-in heading
    const paraHeadMatch = line.match(
      /^\\paragraph\*?\{((?:[^{}]|\{[^{}]*\})*)\}\s*(.*)/,
    );
    if (paraHeadMatch) {
      flushPara();
      const title = formatInline(paraHeadMatch[1]);
      const rest = paraHeadMatch[2]?.trim();
      if (rest) {
        // Run-in: heading and text on same line
        parts.push(
          `<p class="paragraph-head"><strong>${title}.</strong> ${formatInline(rest)}</p>`,
        );
      } else {
        parts.push(
          `<p class="paragraph-head"><strong>${title}.</strong></p>`,
        );
      }
      i++;
      continue;
    }
    // \subparagraph{title}
    const subparaMatch = line.match(
      /^\\subparagraph\*?\{((?:[^{}]|\{[^{}]*\})*)\}/,
    );
    if (subparaMatch) {
      flushPara();
      parts.push(
        `<p class="subparagraph-head"><em>${formatInline(subparaMatch[1])}.</em></p>`,
      );
      i++;
      continue;
    }

    // ── Display math environments ────────────────────────────
    const mathEnvMatch = line.match(
      /^\\begin\{(equation|align|gather|multline|flalign|eqnarray|displaymath)\*?\}/,
    );
    if (mathEnvMatch || line === "\\[") {
      flushPara();
      const envName = mathEnvMatch
        ? mathEnvMatch[0].replace("\\begin{", "").replace("}", "")
        : null;
      const endPat = envName ? `\\end{${envName}}` : "\\]";

      // Check if opening and closing are on the same line
      const restOfLine = envName
        ? line.slice(line.indexOf("}") + 1).trim()
        : line.slice(2).trim();

      if (restOfLine && restOfLine.includes(endPat)) {
        const expr = restOfLine.replace(endPat, "").trim();
        if (expr) {
          parts.push(
            `<div class="equation">${renderMath(expr, true)}</div>`,
          );
        }
        i++;
        continue;
      }

      const mathLines: string[] = [];
      if (restOfLine) mathLines.push(restOfLine);
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
        .replace(/\\notag/g, "")
        .trim();

      if (envName) {
        const baseEnv = envName.replace("*", "");
        if (
          baseEnv === "align" ||
          baseEnv === "eqnarray" ||
          baseEnv === "flalign"
        ) {
          mathContent = `\\begin{aligned}\n${mathContent}\n\\end{aligned}`;
        } else if (baseEnv === "gather") {
          mathContent = `\\begin{gathered}\n${mathContent}\n\\end{gathered}`;
        } else if (baseEnv === "multline") {
          mathContent = `\\begin{gathered}\n${mathContent}\n\\end{gathered}`;
        }
      }

      equationCounter++;
      const isNumbered =
        envName &&
        !envName.endsWith("*") &&
        !["align", "gather"].includes(envName);
      parts.push('<div class="equation">');
      parts.push(renderMath(mathContent, true));
      if (isNumbered) {
        parts.push(
          `<span class="eq-number">(${equationCounter})</span>`,
        );
      }
      parts.push("</div>");
      continue;
    }

    // $$ display math (single-line)
    if (line.startsWith("$$") && line.endsWith("$$") && line.length > 4) {
      flushPara();
      const expr = line.slice(2, -2);
      parts.push(
        `<div class="equation">${renderMath(expr, true)}</div>`,
      );
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
      i++;
      const expr = mathLines.join("\n").trim();
      parts.push(
        `<div class="equation">${renderMath(expr, true)}</div>`,
      );
      continue;
    }

    // ── Alignment environments ───────────────────────────────
    const alignEnvMatch = line.match(
      /^\\begin\{(center|flushleft|flushright|quote|quotation|verse)\}/,
    );
    if (alignEnvMatch) {
      flushPara();
      const envName = alignEnvMatch[1];
      const endPat = `\\end{${envName}}`;
      const contentLines: string[] = [];
      i++;
      while (
        i < lines.length &&
        !lines[i].trim().startsWith(endPat)
      ) {
        contentLines.push(lines[i]);
        i++;
      }
      i++;

      const alignMap: Record<string, string> = {
        center: "text-align:center",
        flushleft: "text-align:left",
        flushright: "text-align:right",
        quote: "margin:0.5em 2em;font-style:italic",
        quotation: "margin:0.5em 2em;text-indent:1.5em",
        verse: "margin:0.5em 2em;white-space:pre-line",
      };
      const style = alignMap[envName] || "";
      const content = processBlockContent(contentLines.join("\n"));
      parts.push(`<div style="${style}">${content}</div>`);
      continue;
    }

    // ── Minipage ─────────────────────────────────────────────
    if (/^\\begin\{minipage\}/.test(line)) {
      flushPara();
      const minipages: { width: string; content: string }[] = [];

      // Collect consecutive minipages into a flex row
      while (i < lines.length && /^\\begin\{minipage\}/.test(lines[i].trim())) {
        const mpLine = lines[i].trim();
        const mpWidthMatch = mpLine.match(
          /\\begin\{minipage\}(?:\[[^\]]*\])?\{([^}]*)\}/,
        );
        const width = mpWidthMatch
          ? latexDimToCss(mpWidthMatch[1])
          : "50%";
        const contentLines: string[] = [];
        i++;
        while (
          i < lines.length &&
          !lines[i].trim().startsWith("\\end{minipage}")
        ) {
          contentLines.push(lines[i]);
          i++;
        }
        i++; // skip \end{minipage}
        const content = processBlockContent(contentLines.join("\n"));
        minipages.push({ width, content });

        // Skip whitespace/empty lines between adjacent minipages
        while (i < lines.length && lines[i].trim() === "") i++;
      }

      if (minipages.length > 1) {
        // Multiple minipages → flex row
        parts.push('<div class="minipage-row">');
        for (const mp of minipages) {
          parts.push(`<div class="minipage" style="width:${mp.width}">${mp.content}</div>`);
        }
        parts.push('</div>');
      } else if (minipages.length === 1) {
        parts.push(
          `<div class="minipage" style="width:${minipages[0].width}">${minipages[0].content}</div>`,
        );
      }
      continue;
    }

    // ── Theorem-like environments ────────────────────────────
    const thmMatch = line.match(
      /^\\begin\{(theorem|lemma|definition|corollary|proposition|remark|proof|example|claim|conjecture|observation|note|fact|assumption)\}(?:\[([^\]]*)\])?/,
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
      i++;

      const content = processBlockContent(contentLines.join("\n"));
      parts.push(`<div class="theorem ${envName}">`);
      parts.push(
        `<p class="thm-head"><strong>${escapeHtml(label)}.</strong></p>`,
      );
      parts.push(content);
      if (isProof)
        parts.push('<p class="qed">&#8718;</p>');
      parts.push("</div>");
      continue;
    }

    // ── Verbatim / lstlisting / minted ───────────────────────
    if (/^\\begin\{(verbatim|lstlisting|minted)\}/.test(line)) {
      flushPara();
      const envNameMatch = line.match(
        /^\\begin\{(verbatim|lstlisting|minted)\}/,
      );
      const envName = envNameMatch?.[1] || "verbatim";
      const codeLines: string[] = [];
      i++;
      while (
        i < lines.length &&
        !new RegExp(`\\\\end\\{${envName}\\}`).test(lines[i])
      ) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++;
      parts.push(
        `<pre class="code-block"><code>${codeLines.join("\n")}</code></pre>`,
      );
      continue;
    }

    // ── Figure environment ───────────────────────────────────
    if (/^\\begin\{figure\}/.test(line)) {
      flushPara();
      figureCounter++;
      let caption = "";
      const figContent: string[] = [];
      i++;
      while (
        i < lines.length &&
        !/^\\end\{figure\}/.test(lines[i].trim())
      ) {
        const fl = lines[i].trim();
        const capMatch = fl.match(
          /\\caption\{((?:[^{}]|\{[^{}]*\})*)\}/,
        );
        if (capMatch) caption = capMatch[1];
        const imgMatch = fl.match(
          /\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}/,
        );
        if (imgMatch)
          figContent.push(
            `<div class="figure-placeholder">[Figure: ${escapeHtml(imgMatch[1])}]</div>`,
          );
        i++;
      }
      i++;
      parts.push('<div class="figure">');
      if (figContent.length > 0) {
        parts.push(figContent.join("\n"));
      } else {
        parts.push(
          '<div class="figure-placeholder">[Figure]</div>',
        );
      }
      if (caption) {
        parts.push(
          `<p class="caption"><strong>Figure ${figureCounter}:</strong> ${formatInline(caption)}</p>`,
        );
      }
      parts.push("</div>");
      continue;
    }

    // ── Lists ────────────────────────────────────────────────
    if (/^\\begin\{(itemize|enumerate|description)\}/.test(line)) {
      flushPara();
      const listHtml = parseList(lines, i);
      parts.push(listHtml.html);
      i = listHtml.nextIdx;
      continue;
    }

    // ── Table environment ────────────────────────────────────
    if (/^\\begin\{table\}/.test(line)) {
      flushPara();
      tableCounter++;
      let caption = "";
      let tableRows: string[][] = [];
      i++;
      while (
        i < lines.length &&
        !/^\\end\{table\}/.test(lines[i].trim())
      ) {
        const tl = lines[i].trim();
        const capMatch = tl.match(
          /\\caption\{((?:[^{}]|\{[^{}]*\})*)\}/,
        );
        if (capMatch) caption = capMatch[1];

        if (
          /^\\begin\{(?:tabular|tabularx|tabulary|longtable|tabu)\}/.test(
            tl,
          )
        ) {
          i++;
          const result = parseTabularRows(lines, i);
          tableRows = result.rows;
          i = result.nextIdx;
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
        parts.push(buildHtmlTable(tableRows));
      }
      continue;
    }

    // ── Standalone tabular ───────────────────────────────────
    if (
      /^\\begin\{(?:tabular|tabularx|tabulary|longtable|tabu)\}/.test(
        line,
      )
    ) {
      flushPara();
      i++;
      const result = parseTabularRows(lines, i);
      i = result.nextIdx;
      if (result.rows.length > 0) {
        parts.push(buildHtmlTable(result.rows));
      }
      continue;
    }

    // ── Tabbing environment ──────────────────────────────────
    if (/^\\begin\{tabbing\}/.test(line)) {
      flushPara();
      i++;
      while (
        i < lines.length &&
        !/^\\end\{tabbing\}/.test(lines[i].trim())
      ) {
        const row = lines[i].trim();
        if (row && !row.startsWith("%")) {
          const cleaned2 = row
            .replace(/\\[=>+<'`]/g, "  ")
            .replace(/\\\\.*$/, "")
            .trim();
          if (cleaned2)
            parts.push(
              `<p class="tabbing">${formatInline(cleaned2)}</p>`,
            );
        }
        i++;
      }
      i++;
      continue;
    }

    // ── Bibliography ─────────────────────────────────────────
    if (
      /^\\bibliography\{/.test(line) ||
      /^\\begin\{thebibliography\}/.test(line)
    ) {
      flushPara();
      if (/^\\begin\{thebibliography\}/.test(line)) {
        const bibItems: string[] = [];
        i++;
        while (
          i < lines.length &&
          !/^\\end\{thebibliography\}/.test(lines[i].trim())
        ) {
          const bl = lines[i].trim();
          if (/^\\bibitem/.test(bl)) {
            bibItems.push(
              bl.replace(/^\\bibitem(?:\[[^\]]*\])?\{[^}]*\}\s*/, ""),
            );
          }
          i++;
        }
        i++;
        parts.push('<div class="references"><h2>References</h2>');
        if (bibItems.length > 0) {
          parts.push('<ol class="bib-list">');
          for (const item of bibItems) {
            parts.push(`<li>${formatInline(item)}</li>`);
          }
          parts.push("</ol>");
        }
        parts.push("</div>");
      } else {
        parts.push(
          '<div class="references"><h2>References</h2><p><em>[Bibliography]</em></p></div>',
        );
        i++;
      }
      continue;
    }

    // ── Generic unknown environment (catch-all) ──────────────
    if (/^\\begin\{([^}]+)\}/.test(line)) {
      const envMatch = line.match(/^\\begin\{([^}]+)\}/);
      if (envMatch) {
        const envName = envMatch[1];
        flushPara();
        const contentLines: string[] = [];
        i++;
        const endRe = new RegExp(
          `^\\\\end\\{${envName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`,
        );
        while (i < lines.length && !endRe.test(lines[i].trim())) {
          contentLines.push(lines[i]);
          i++;
        }
        i++;
        const content = processBlockContent(
          contentLines.join("\n"),
        );
        if (content.trim()) {
          parts.push(
            `<div class="env-${envName}">${content}</div>`,
          );
        }
        continue;
      }
    }

    // ── Skip label-only lines ────────────────────────────────
    if (
      /^\\label\{/.test(line) &&
      line.replace(/\\label\{[^}]*\}/, "").trim() === ""
    ) {
      i++;
      continue;
    }

    // ── Skip \newtheorem definitions ─────────────────────────
    if (/^\\newtheorem/.test(line)) {
      i++;
      continue;
    }

    // ── Handle standalone \centering ─────────────────────────
    if (/^\\centering\b/.test(line)) {
      i++;
      continue;
    }

    // ── Handle standalone \rule in body ──────────────────────
    if (/^\\rule/.test(line)) {
      flushPara();
      const m = line.match(
        /\\rule\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}\s*\{([^}]*)\}/,
      );
      if (m) {
        const width = latexDimToCss(m[1]);
        const height = latexDimToCss(m[2]);
        parts.push(
          `<hr class="latex-rule" style="width:${width};border-top-width:${height}"/>`,
        );
      }
      i++;
      continue;
    }

    // ── Regular text → accumulate into paragraph ─────────────
    paraLines.push(line);
    i++;
  }

  flushPara();

  // ── Assemble HTML document ─────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin="anonymous"/>
<link rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/katex@0.16.33/dist/katex.min.css"
      crossorigin="anonymous"/>
<link rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,300..900;1,8..60,300..900&family=Inter:wght@300..900&display=swap"/>
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

// ═══════════════════════════════════════════════════════════════
// DOCUMENT CSS
// ═══════════════════════════════════════════════════════════════

const DOCUMENT_CSS = `
  :root {
    --text: #1a1a2e;
    --muted: #6b7280;
    --heading: #111827;
    --accent: #2563eb;
    --bg: #ffffff;
    --code-bg: #f8f9fa;
    --border: #d1d5db;
    --abstract-bg: #f9fafb;
    --thm-bg: #fefce8;
    --thm-border: #f59e0b;
    --def-bg: #eff6ff;
    --def-border: #3b82f6;
    --proof-bg: #f0fdf4;
    --proof-border: #22c55e;
    --rule-color: #374151;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Source Serif 4', 'Computer Modern Serif', 'Latin Modern Roman',
                 Georgia, 'Times New Roman', serif;
    font-size: 10.5pt;
    line-height: 1.35;
    color: var(--text);
    background: var(--bg);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    font-feature-settings: 'kern' 1, 'liga' 1;
  }

  article {
    max-width: 7in;
    margin: 0.6in auto;
    padding: 0 0.1in;
  }

  /* ── Title & Authors ──────────────────────────── */
  h1.doc-title {
    font-size: 17pt;
    text-align: center;
    color: var(--heading);
    margin: 0 0 4pt;
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: -0.01em;
  }
  .authors {
    text-align: center;
    margin-bottom: 10pt;
    display: flex;
    justify-content: center;
    gap: 24pt;
    flex-wrap: wrap;
  }
  .author-block {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .author-name { font-weight: 600; font-size: 10.5pt; }
  .author-affil { font-size: 8.5pt; color: var(--muted); font-style: italic; margin-top: 1pt; }
  .doc-date {
    text-align: center;
    font-size: 9.5pt;
    color: var(--muted);
    margin-bottom: 10pt;
  }

  /* ── Abstract ─────────────────────────────────── */
  .abstract {
    background: var(--abstract-bg);
    border-left: 2.5px solid var(--accent);
    padding: 8pt 12pt;
    margin: 6pt 2em 12pt;
    border-radius: 0 3px 3px 0;
  }
  .abstract-title {
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
    margin-bottom: 2pt;
    color: var(--heading);
  }
  .abstract p {
    font-size: 9pt;
    line-height: 1.4;
    text-align: justify;
    margin: 0;
  }

  /* ── Headings ─────────────────────────────────── */
  h2.section {
    font-size: 13pt;
    color: var(--heading);
    margin: 16pt 0 4pt;
    padding-bottom: 1.5pt;
    border-bottom: 1px solid var(--border);
    font-weight: 700;
    line-height: 1.25;
  }
  h3.subsection {
    font-size: 11pt;
    color: var(--heading);
    margin: 10pt 0 3pt;
    font-weight: 600;
    line-height: 1.3;
  }
  h4.subsubsection {
    font-size: 10pt;
    color: var(--heading);
    font-style: italic;
    margin: 8pt 0 2pt;
    font-weight: 600;
    line-height: 1.3;
  }
  .sec-num { margin-right: 3pt; }
  .paragraph-head { margin: 6pt 0 1pt; }
  .subparagraph-head { margin: 4pt 0 1pt; font-size: 9.5pt; }

  /* ── Paragraphs ───────────────────────────────── */
  p {
    margin: 0 0 4pt;
    text-align: justify;
    hyphens: auto;
    line-height: 1.35;
    orphans: 2;
    widows: 2;
  }
  p + p {
    text-indent: 0;
  }
  p.noindent { text-indent: 0 !important; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  u { text-decoration: underline; text-underline-offset: 2px; }

  /* ── Flex lines (for \\hfill) ──────────────────── */
  .hfill-line {
    display: flex;
    align-items: baseline;
    gap: 3pt;
    margin: 0 0 4pt;
    line-height: 1.35;
  }
  .hfill { flex: 1; }

  /* ── Math ──────────────────────────────────────── */
  .equation {
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 8pt 0;
    position: relative;
    overflow-x: auto;
  }
  .eq-number {
    position: absolute;
    right: 0;
    font-size: 9.5pt;
    color: var(--text);
  }
  .katex-display { margin: 0 !important; }
  .katex { font-size: 1.02em; }
  .math-fallback {
    font-family: 'Courier New', monospace;
    font-size: 9pt;
    background: var(--code-bg);
    padding: 4pt 10pt;
    border-radius: 3px;
    border: 1px solid var(--border);
    text-align: center;
  }
  .math-fallback-inline {
    font-family: 'Courier New', monospace;
    font-size: 9pt;
    background: var(--code-bg);
    padding: 0.5px 3px;
    border-radius: 2px;
  }

  /* ── Code ──────────────────────────────────────── */
  .code-block {
    background: #1e1e2e;
    color: #cdd6f4;
    border-radius: 4px;
    padding: 8pt 12pt;
    margin: 6pt 0;
    overflow-x: auto;
    font-size: 8.5pt;
    line-height: 1.45;
  }
  .code-block code {
    font-family: 'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace;
  }
  code {
    font-family: 'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace;
    font-size: 0.88em;
    background: var(--code-bg);
    padding: 0.5px 3px;
    border-radius: 2px;
  }

  /* ── Lists ─────────────────────────────────────── */
  ul, ol { margin: 2pt 0 6pt 18pt; }
  li { margin-bottom: 1.5pt; line-height: 1.35; }
  li > p { margin-bottom: 1pt; }
  dl { margin: 2pt 0 6pt 0; }
  dt { font-weight: 700; margin-top: 3pt; }
  dd { margin-left: 18pt; margin-bottom: 1.5pt; }

  /* ── Theorems ──────────────────────────────────── */
  .theorem {
    border-radius: 3px;
    padding: 6pt 10pt;
    margin: 8pt 0;
  }
  .theorem.theorem, .theorem.lemma, .theorem.corollary,
  .theorem.proposition, .theorem.claim, .theorem.conjecture {
    background: var(--thm-bg);
    border-left: 2.5px solid var(--thm-border);
  }
  .theorem.definition, .theorem.example, .theorem.assumption {
    background: var(--def-bg);
    border-left: 2.5px solid var(--def-border);
  }
  .theorem.proof {
    background: var(--proof-bg);
    border-left: 2.5px solid var(--proof-border);
  }
  .theorem.remark, .theorem.note, .theorem.observation, .theorem.fact {
    background: #f5f5f5;
    border-left: 2.5px solid #9ca3af;
  }
  .thm-head { margin-bottom: 2pt; }
  .qed { text-align: right; margin-top: 2pt; font-size: 11pt; }

  /* ── Tables ────────────────────────────────────── */
  table {
    width: auto;
    margin: 6pt auto 10pt;
    border-collapse: collapse;
    font-size: 9pt;
  }
  th, td {
    padding: 3pt 8pt;
    text-align: left;
    border-bottom: 0.5pt solid var(--border);
  }
  thead th {
    border-top: 1.5pt solid var(--heading);
    border-bottom: 1.5pt solid var(--heading);
    font-weight: 700;
    font-size: 9pt;
  }
  tbody tr:last-child td {
    border-bottom: 1.5pt solid var(--heading);
  }
  .caption {
    text-align: center;
    font-size: 8.5pt;
    color: var(--muted);
    margin-bottom: 3pt;
  }

  /* ── Figures ───────────────────────────────────── */
  .figure {
    margin: 10pt 0;
    text-align: center;
  }
  .figure-placeholder {
    background: var(--code-bg);
    border: 1px dashed var(--border);
    padding: 20pt 14pt;
    color: var(--muted);
    font-style: italic;
    border-radius: 3px;
    margin-bottom: 3pt;
  }

  /* ── Horizontal rules ──────────────────────────── */
  hr.latex-rule {
    border: none;
    border-top: 0.4pt solid var(--rule-color);
    margin: 4pt 0;
  }

  /* ── References ────────────────────────────────── */
  .references {
    margin-top: 16pt;
    padding-top: 8pt;
    border-top: 1px solid var(--border);
  }
  .references h2 { border-bottom: none; font-size: 12pt; margin-bottom: 4pt; }
  .bib-list { font-size: 9pt; }
  .bib-list li { margin-bottom: 3pt; }
  .ref { font-style: italic; color: var(--accent); }

  /* ── Footnotes & URLs ──────────────────────────── */
  .footnote {
    font-size: 0.7em;
    vertical-align: super;
    color: var(--accent);
    cursor: help;
  }
  .url {
    color: var(--accent);
    text-decoration: none;
    word-break: break-all;
  }
  .url:hover { text-decoration: underline; }

  /* ── Minipage ──────────────────────────────────── */
  .minipage-row {
    display: flex;
    gap: 6pt;
    align-items: flex-start;
    margin: 2pt 0;
  }
  .minipage {
    display: inline-block;
    vertical-align: top;
    padding: 0 3pt;
  }
  .minipage-row > .minipage {
    display: block;
    flex-shrink: 0;
  }

  /* ── Page break ────────────────────────────────── */
  .page-break {
    border-bottom: 1px dashed var(--border);
    margin: 16pt 0;
  }

  /* ── Tabbing ───────────────────────────────────── */
  .tabbing {
    margin: 0;
    font-family: inherit;
    white-space: pre-wrap;
  }

  /* ── Misc ──────────────────────────────────────── */
  sup { font-size: 0.75em; vertical-align: super; }
  sub { font-size: 0.75em; vertical-align: sub; }

  /* ── Print / page-like appearance ──────────────── */
  @media print {
    body { font-size: 10pt; }
    article { margin: 0; max-width: none; padding: 0; }
    .page-break { page-break-after: always; border: none; margin: 0; }
  }
`;
