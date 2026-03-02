//! SIR → LaTeX emission.
//!
//! Reconstructs LaTeX source from a SIR document, utilizing anchor metadata
//! to restore original formatting where possible.

use crate::error::SirResult;
use crate::model::document::*;
use crate::model::math::MathEnvKind;
use crate::model::style::CharacterStyle;
use super::TransformConfig;

/// Emits LaTeX source from a SIR document.
pub struct SirToLatexEmitter {
    config: TransformConfig,
    output: String,
    indent: usize,
}

impl SirToLatexEmitter {
    pub fn new(config: &TransformConfig) -> Self {
        Self {
            config: config.clone(),
            output: String::with_capacity(65536),
            indent: 0,
        }
    }

    pub fn emit(&self, doc: &SirDocument) -> SirResult<String> {
        let mut emitter = SirToLatexEmitter::new(&self.config);
        emitter.emit_document(doc)?;
        Ok(emitter.output)
    }

    fn emit_document(&mut self, doc: &SirDocument) -> SirResult<()> {
        // Emit document class
        self.emit_documentclass(&doc.template);

        // Emit packages
        for pkg in &doc.preamble.packages {
            self.emit_package(pkg);
        }
        self.newline();

        // Emit custom commands
        for cmd in &doc.preamble.custom_commands {
            self.write_line(&cmd.raw_source);
        }

        // Emit custom environments
        for env in &doc.preamble.custom_environments {
            self.write_line(&env.raw_source);
        }

        // Emit raw preamble lines
        for line in &doc.preamble.raw_lines {
            self.write_line(line);
        }
        self.newline();

        // Begin document
        self.write_line("\\begin{document}");
        self.newline();

        // Emit metadata (title, author, date, maketitle)
        self.emit_metadata(&doc.metadata);

        // Emit body blocks
        for block in &doc.body {
            self.emit_block(block, &doc.anchor_store)?;
            self.newline();
        }

        // Emit bibliography
        if let Some(bib) = &doc.bibliography {
            self.emit_bibliography(bib);
        }

        // Emit appendices
        if !doc.appendices.is_empty() {
            self.write_line("\\appendix");
            for appendix in &doc.appendices {
                self.emit_appendix(appendix, &doc.anchor_store)?;
            }
        }

        self.newline();
        self.write_line("\\end{document}");

        Ok(())
    }

    fn emit_documentclass(&mut self, template: &TemplateBinding) {
        if template.class_options.is_empty() {
            self.write_line(&format!("\\documentclass{{{}}}", template.latex_class));
        } else {
            self.write_line(&format!(
                "\\documentclass[{}]{{{}}}",
                template.class_options.join(", "),
                template.latex_class
            ));
        }
    }

    fn emit_package(&mut self, pkg: &PackageImport) {
        if pkg.options.is_empty() {
            self.write_line(&format!("\\usepackage{{{}}}", pkg.name));
        } else {
            self.write_line(&format!(
                "\\usepackage[{}]{{{}}}",
                pkg.options.join(", "),
                pkg.name
            ));
        }
    }

    fn emit_metadata(&mut self, meta: &crate::model::metadata::DocumentMetadata) {
        if let Some(title) = &meta.title {
            self.write(&format!("\\title{{"));
            self.emit_inline_content(title);
            self.write_line("}");
        }

        for author in &meta.authors {
            self.write_line(&format!("\\author{{{}}}", author.name));
        }

        if let Some(date) = &meta.date {
            self.write_line(&format!("\\date{{{}}}", date));
        }

        if meta.title.is_some() || !meta.authors.is_empty() {
            self.write_line("\\maketitle");
            self.newline();
        }

        if let Some(abstract_paragraphs) = &meta.r#abstract {
            self.write_line("\\begin{abstract}");
            for para in abstract_paragraphs {
                self.emit_inline_content(para);
                self.newline();
            }
            self.write_line("\\end{abstract}");
            self.newline();
        }
    }

    fn emit_block(&mut self, block: &Block, anchors: &AnchorStore) -> SirResult<()> {
        // Check if we can restore from anchor metadata
        if self.config.embed_anchors {
            if let Some(anchor) = anchors.get(&block.id) {
                if let Some(ref original) = anchor.latex_source {
                    // If this block wasn't modified, emit the original source
                    // This is a simplified check; production uses content hash comparison
                    if original.len() < 200 {
                        // Only for small blocks; large ones use the SIR
                    }
                }
            }
        }

        match &block.kind {
            BlockKind::Heading { depth, numbering, content, label } => {
                let cmd = match depth {
                    0 => "chapter",
                    1 => "section",
                    2 => "subsection",
                    3 => "subsubsection",
                    4 => "paragraph",
                    _ => "subparagraph",
                };
                let star = match numbering {
                    HeadingNumbering::Unnumbered => "*",
                    _ => "",
                };
                self.write(&format!("\\{}{}{{", cmd, star));
                self.emit_inline_content(content);
                self.write("}");
                if let Some(label) = label {
                    self.write(&format!("\\label{{{}}}", label));
                }
                self.newline();
            }

            BlockKind::Paragraph { content, .. } => {
                self.emit_inline_content(content);
                self.newline();
            }

            BlockKind::MathBlock { environment, label } => {
                self.write_line(&format!("\\begin{{{}}}", environment.env_name()));
                // Use original LaTeX source when available
                self.write_line(&environment.latex_source);
                if let Some(label) = label {
                    self.write_line(&format!("\\label{{{}}}", label));
                }
                self.write_line(&format!("\\end{{{}}}", environment.env_name()));
            }

            BlockKind::Figure(fig) => {
                let placement = self.float_placement_str(&fig.placement);
                self.write_line(&format!("\\begin{{figure}}[{}]", placement));
                self.write_line("\\centering");
                match &fig.content {
                    FigureContent::Single(src) => {
                        if let ImageSource::File(path) = src {
                            self.write_line(&format!("\\includegraphics{{{}}}", path));
                        }
                    }
                    FigureContent::SubFigures(subs) => {
                        for sub in subs {
                            self.write_line("\\begin{subfigure}");
                            if let ImageSource::File(path) = &sub.source {
                                self.write_line(&format!("\\includegraphics{{{}}}", path));
                            }
                            if let Some(cap) = &sub.caption {
                                self.write("\\caption{");
                                self.emit_inline_content(cap);
                                self.write_line("}");
                            }
                            self.write_line("\\end{subfigure}");
                        }
                    }
                }
                if let Some(caption) = &fig.caption {
                    self.write("\\caption{");
                    self.emit_inline_content(caption);
                    self.write_line("}");
                }
                if let Some(label) = &fig.label {
                    self.write_line(&format!("\\label{{{}}}", label));
                }
                self.write_line("\\end{figure}");
            }

            BlockKind::List(list) => {
                let env = match &list.kind {
                    ListKind::Ordered { .. } => "enumerate",
                    ListKind::Unordered { .. } => "itemize",
                    ListKind::Description => "description",
                };
                self.write_line(&format!("\\begin{{{}}}", env));
                for item in &list.items {
                    self.write("\\item ");
                    for sub_block in &item.content {
                        self.emit_block(sub_block, anchors)?;
                    }
                }
                self.write_line(&format!("\\end{{{}}}", env));
            }

            BlockKind::TheoremLike { kind, name, content, label } => {
                let env_name = match kind {
                    TheoremKind::Theorem => "theorem",
                    TheoremKind::Lemma => "lemma",
                    TheoremKind::Corollary => "corollary",
                    TheoremKind::Proposition => "proposition",
                    TheoremKind::Definition => "definition",
                    TheoremKind::Example => "example",
                    TheoremKind::Remark => "remark",
                    TheoremKind::Proof => "proof",
                    TheoremKind::Custom(n) => n,
                };
                if let Some(name) = name {
                    self.write(&format!("\\begin{{{}}}[", env_name));
                    self.emit_inline_content(name);
                    self.write_line("]");
                } else {
                    self.write_line(&format!("\\begin{{{}}}", env_name));
                }
                if let Some(label) = label {
                    self.write_line(&format!("\\label{{{}}}", label));
                }
                for sub_block in content {
                    self.emit_block(sub_block, anchors)?;
                }
                self.write_line(&format!("\\end{{{}}}", env_name));
            }

            BlockKind::CodeBlock { language, caption, content, label } => {
                if let Some(lang) = language {
                    self.write_line(&format!("\\begin{{minted}}{{{}}}", lang));
                } else {
                    self.write_line("\\begin{verbatim}");
                }
                self.write_line(content);
                if language.is_some() {
                    self.write_line("\\end{minted}");
                } else {
                    self.write_line("\\end{verbatim}");
                }
            }

            BlockKind::BlockQuote { content, attribution } => {
                self.write_line("\\begin{quote}");
                for sub_block in content {
                    self.emit_block(sub_block, anchors)?;
                }
                self.write_line("\\end{quote}");
            }

            BlockKind::RawLatex { source, .. } => {
                self.write_line(source);
            }

            BlockKind::HorizontalRule => {
                self.write_line("\\noindent\\rule{\\textwidth}{0.4pt}");
            }

            BlockKind::PageBreak => {
                self.write_line("\\newpage");
            }

            BlockKind::FloatBarrier => {
                self.write_line("\\FloatBarrier");
            }

            BlockKind::Algorithm { caption, content, label } => {
                self.write_line("\\begin{algorithm}");
                if let Some(caption) = caption {
                    self.write("\\caption{");
                    self.emit_inline_content(caption);
                    self.write_line("}");
                }
                if let Some(label) = label {
                    self.write_line(&format!("\\label{{{}}}", label));
                }
                match content {
                    AlgorithmContent::Raw(src) => self.write_line(src),
                    AlgorithmContent::Pseudocode(lines) => {
                        self.write_line("\\begin{algorithmic}");
                        for line in lines {
                            self.emit_algorithm_line(line);
                        }
                        self.write_line("\\end{algorithmic}");
                    }
                }
                self.write_line("\\end{algorithm}");
            }

            BlockKind::FootnoteDefinition { id, content } => {
                // Footnotes are typically inline in LaTeX; this is a fallback
                self.write(&format!("\\footnotetext[{}]{{", id));
                for sub_block in content {
                    self.emit_block(sub_block, anchors)?;
                }
                self.write_line("}");
            }

            BlockKind::TableBlock(table) => {
                // TODO: Full table emission
                self.write_line("% TABLE (placeholder)");
            }
        }

        Ok(())
    }

    fn emit_inline_content(&mut self, content: &InlineContent) {
        for inline in content {
            match inline {
                Inline::Text(text) => self.write(text),
                Inline::Styled { style, content } => {
                    let (open, close) = self.style_commands(style);
                    self.write(&open);
                    self.emit_inline_content(content);
                    self.write(&close);
                }
                Inline::InlineMath(math) => {
                    self.write(&format!("${}$", math));
                }
                Inline::Reference(Reference::CrossRef { label, kind }) => {
                    let cmd = match kind {
                        RefKind::Standard => "ref",
                        RefKind::Equation => "eqref",
                        RefKind::Page => "pageref",
                        RefKind::Name => "nameref",
                        RefKind::Auto => "autoref",
                        RefKind::Clever => "cref",
                    };
                    self.write(&format!("\\{}{{{}}}", cmd, label));
                }
                Inline::Reference(Reference::Citation(cite)) => {
                    self.write(&format!("\\cite{{{}}}", cite.keys.join(", ")));
                }
                Inline::Link { url, content, .. } => {
                    self.write("\\href{");
                    self.write(url);
                    self.write("}{");
                    self.emit_inline_content(content);
                    self.write("}");
                }
                Inline::Image { source, .. } => {
                    if let ImageSource::File(path) = source {
                        self.write(&format!("\\includegraphics{{{}}}", path));
                    }
                }
                Inline::FootnoteRef(id) => {
                    self.write(&format!("\\footnotemark[{}]", id));
                }
                Inline::LineBreak => self.write("\\\\"),
                Inline::NonBreakingSpace => self.write("~"),
                Inline::SpecialChar(ch) => {
                    let s = match ch {
                        SpecialCharacter::EnDash => "--",
                        SpecialCharacter::EmDash => "---",
                        SpecialCharacter::Ellipsis => "\\ldots",
                        SpecialCharacter::LeftQuote => "`",
                        SpecialCharacter::RightQuote => "'",
                        SpecialCharacter::LeftDoubleQuote => "``",
                        SpecialCharacter::RightDoubleQuote => "''",
                        SpecialCharacter::Copyright => "\\copyright",
                        SpecialCharacter::Trademark => "\\texttrademark",
                        SpecialCharacter::Registered => "\\textregistered",
                        SpecialCharacter::Degree => "\\degree",
                        SpecialCharacter::Custom(s) => s,
                    };
                    self.write(s);
                }
                Inline::RawLatexInline(raw) => self.write(raw),
            }
        }
    }

    fn style_commands(&self, style: &CharacterStyle) -> (String, String) {
        if style.bold == Some(true) {
            return ("\\textbf{".to_string(), "}".to_string());
        }
        if style.italic == Some(true) {
            return ("\\emph{".to_string(), "}".to_string());
        }
        if style.small_caps == Some(true) {
            return ("\\textsc{".to_string(), "}".to_string());
        }
        if style.superscript == Some(true) {
            return ("\\textsuperscript{".to_string(), "}".to_string());
        }
        if style.subscript == Some(true) {
            return ("\\textsubscript{".to_string(), "}".to_string());
        }
        ("".to_string(), "".to_string())
    }

    fn float_placement_str<'a>(&self, placement: &'a FloatPlacement) -> &'a str {
        match placement {
            FloatPlacement::Here => "h",
            FloatPlacement::Top => "t",
            FloatPlacement::Bottom => "b",
            FloatPlacement::Page => "p",
            FloatPlacement::ForceHere => "H",
            FloatPlacement::HereTop => "ht",
            FloatPlacement::HereTopBottom => "htb",
            FloatPlacement::HereTopBottomPage => "htbp",
            FloatPlacement::Custom(s) => s,
        }
    }

    fn emit_algorithm_line(&mut self, line: &AlgorithmLine) {
        let indent_str = "  ".repeat(line.indent as usize);
        match &line.kind {
            AlgorithmLineKind::Statement(content) => {
                self.write(&format!("{}\\State ", indent_str));
                self.emit_inline_content(content);
                self.newline();
            }
            AlgorithmLineKind::If { condition } => {
                self.write(&format!("{}\\If{{", indent_str));
                self.emit_inline_content(condition);
                self.write_line("}");
            }
            AlgorithmLineKind::ElseIf { condition } => {
                self.write(&format!("{}\\ElsIf{{", indent_str));
                self.emit_inline_content(condition);
                self.write_line("}");
            }
            AlgorithmLineKind::Else => self.write_line(&format!("{}\\Else", indent_str)),
            AlgorithmLineKind::EndIf => self.write_line(&format!("{}\\EndIf", indent_str)),
            AlgorithmLineKind::For { condition } => {
                self.write(&format!("{}\\For{{", indent_str));
                self.emit_inline_content(condition);
                self.write_line("}");
            }
            AlgorithmLineKind::EndFor => self.write_line(&format!("{}\\EndFor", indent_str)),
            AlgorithmLineKind::While { condition } => {
                self.write(&format!("{}\\While{{", indent_str));
                self.emit_inline_content(condition);
                self.write_line("}");
            }
            AlgorithmLineKind::EndWhile => self.write_line(&format!("{}\\EndWhile", indent_str)),
            AlgorithmLineKind::Return(content) => {
                self.write(&format!("{}\\Return ", indent_str));
                self.emit_inline_content(content);
                self.newline();
            }
            AlgorithmLineKind::Comment(text) => {
                self.write_line(&format!("{}\\Comment{{{}}}", indent_str, text));
            }
        }
    }

    fn emit_bibliography(&mut self, bib: &Bibliography) {
        if let Some(raw) = &bib.raw_bib {
            self.write_line(raw);
        } else {
            self.write_line(&format!("\\bibliographystyle{{{}}}", bib.style));
            self.write_line("\\bibliography{references}");
        }
    }

    fn emit_appendix(&mut self, appendix: &Appendix, anchors: &AnchorStore) -> SirResult<()> {
        self.write("\\section{");
        self.emit_inline_content(&appendix.title);
        self.write_line("}");
        if let Some(label) = &appendix.label {
            self.write_line(&format!("\\label{{{}}}", label));
        }
        for block in &appendix.content {
            self.emit_block(block, anchors)?;
        }
        Ok(())
    }

    // ─── Output Helpers ─────────────────────────────────────────

    fn write(&mut self, s: &str) {
        self.output.push_str(s);
    }

    fn write_line(&mut self, s: &str) {
        self.output.push_str(s);
        self.output.push('\n');
    }

    fn newline(&mut self) {
        self.output.push('\n');
    }
}
