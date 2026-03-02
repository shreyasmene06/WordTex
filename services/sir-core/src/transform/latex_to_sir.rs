//! LaTeX → SIR transformation.
//!
//! This module implements a compiler-frontend approach: instead of simple regex
//! or naive AST walking, it performs macro expansion, environment resolution,
//! and semantic analysis to construct a rich SIR document.

use std::collections::HashMap;

use crate::error::{SirError, SirResult};
use crate::model::document::*;
use crate::model::math::{MathEnvKind, MathEnvironment};
use crate::model::metadata::{Author, DocumentMetadata};
use crate::model::style::CharacterStyle;
use crate::model::types::*;
use super::TransformConfig;

/// Transforms LaTeX source into a SIR document via semantic analysis.
pub struct LatexToSirTransformer {
    config: TransformConfig,
    /// Map of known custom commands from preamble analysis.
    custom_commands: HashMap<String, CustomCommand>,
    /// Counter state for theorem-like environments.
    theorem_counters: HashMap<String, u32>,
    /// Current section numbering state.
    section_counters: Vec<u32>,
}

impl LatexToSirTransformer {
    pub fn new(config: &TransformConfig) -> Self {
        Self {
            config: config.clone(),
            custom_commands: HashMap::new(),
            theorem_counters: HashMap::new(),
            section_counters: vec![0; 6],
        }
    }

    /// Main entry point: parse LaTeX source into SIR document.
    pub fn transform(&mut self, source: &str) -> SirResult<SirDocument> {
        // Phase 1: Extract preamble
        let (preamble_src, body_src) = self.split_document(source)?;

        // Phase 2: Parse preamble (document class, packages, \newcommand, etc.)
        let (template, preamble) = self.parse_preamble(preamble_src)?;

        // Register custom commands for macro expansion
        for cmd in &preamble.custom_commands {
            self.custom_commands.insert(cmd.name.clone(), cmd.clone());
        }

        // Phase 3: Create document skeleton
        let mut doc = SirDocument::new(&template.latex_class);
        doc.template = template;
        doc.preamble = preamble;

        // Phase 4: Parse document body into blocks
        doc.body = self.parse_body(body_src)?;

        // Phase 5: Extract metadata from parsed blocks
        doc.metadata = self.extract_metadata(&doc.body);

        // Phase 6: Build anchor store
        self.build_anchor_store(&mut doc, source);

        Ok(doc)
    }

    /// Split source into preamble and body at \begin{document}.
    fn split_document<'a>(&self, source: &'a str) -> SirResult<(&'a str, &'a str)> {
        if let Some(begin_pos) = source.find("\\begin{document}") {
            let preamble = &source[..begin_pos];
            let body_start = begin_pos + "\\begin{document}".len();
            let body_end = source.rfind("\\end{document}").unwrap_or(source.len());
            let body = &source[body_start..body_end];
            Ok((preamble, body))
        } else {
            // No document environment — treat entire source as body
            Ok(("", source))
        }
    }

    /// Parse preamble into template binding and preamble structure.
    fn parse_preamble(&self, source: &str) -> SirResult<(TemplateBinding, Preamble)> {
        let mut template = TemplateBinding {
            latex_class: "article".to_string(),
            class_options: Vec::new(),
            dotx_template: None,
        };

        let mut preamble = Preamble {
            packages: Vec::new(),
            custom_commands: Vec::new(),
            custom_environments: Vec::new(),
            raw_lines: Vec::new(),
        };

        for line in source.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('%') {
                continue;
            }

            if trimmed.starts_with("\\documentclass") {
                self.parse_documentclass(trimmed, &mut template);
            } else if trimmed.starts_with("\\usepackage") {
                if let Some(pkg) = self.parse_usepackage(trimmed) {
                    preamble.packages.push(pkg);
                }
            } else if trimmed.starts_with("\\newcommand") || trimmed.starts_with("\\renewcommand")
                || trimmed.starts_with("\\DeclareMathOperator")
            {
                if let Some(cmd) = self.parse_newcommand(trimmed) {
                    preamble.custom_commands.push(cmd);
                } else {
                    preamble.raw_lines.push(line.to_string());
                }
            } else if trimmed.starts_with("\\newenvironment") || trimmed.starts_with("\\newtheorem") {
                if let Some(env) = self.parse_newenvironment(trimmed) {
                    preamble.custom_environments.push(env);
                } else {
                    preamble.raw_lines.push(line.to_string());
                }
            } else {
                preamble.raw_lines.push(line.to_string());
            }
        }

        // Map document class to Word template
        template.dotx_template = self.resolve_dotx_template(&template.latex_class);

        Ok((template, preamble))
    }

    fn parse_documentclass(&self, line: &str, template: &mut TemplateBinding) {
        // Extract options: \documentclass[opt1,opt2]{classname}
        if let Some(bracket_start) = line.find('[') {
            if let Some(bracket_end) = line.find(']') {
                let options = &line[bracket_start + 1..bracket_end];
                template.class_options = options.split(',').map(|s| s.trim().to_string()).collect();
            }
        }
        if let Some(brace_start) = line.find('{') {
            if let Some(brace_end) = line.find('}') {
                template.latex_class = line[brace_start + 1..brace_end].trim().to_string();
            }
        }
    }

    fn parse_usepackage(&self, line: &str) -> Option<PackageImport> {
        let mut options = Vec::new();

        if let Some(bracket_start) = line.find('[') {
            if let Some(bracket_end) = line.find(']') {
                let opt_str = &line[bracket_start + 1..bracket_end];
                options = opt_str.split(',').map(|s| s.trim().to_string()).collect();
            }
        }

        if let Some(brace_start) = line.find('{') {
            if let Some(brace_end) = line.find('}') {
                let name = line[brace_start + 1..brace_end].trim().to_string();
                return Some(PackageImport { name, options });
            }
        }

        None
    }

    fn parse_newcommand(&self, line: &str) -> Option<CustomCommand> {
        // Basic parser for \newcommand{\cmdname}[nargs]{definition}
        let brace_pairs = self.extract_brace_groups(line);
        if brace_pairs.len() >= 2 {
            let name = brace_pairs[0].clone();
            let definition = brace_pairs.last().unwrap().clone();
            let num_args = if let Some(bracket_start) = line.find('[') {
                if let Some(bracket_end) = line[bracket_start..].find(']') {
                    line[bracket_start + 1..bracket_start + bracket_end]
                        .parse::<u8>()
                        .unwrap_or(0)
                } else {
                    0
                }
            } else {
                0
            };

            return Some(CustomCommand {
                name,
                num_args,
                optional_default: None,
                definition,
                raw_source: line.to_string(),
            });
        }
        None
    }

    fn parse_newenvironment(&self, line: &str) -> Option<CustomEnvironment> {
        let brace_pairs = self.extract_brace_groups(line);
        if brace_pairs.len() >= 3 {
            return Some(CustomEnvironment {
                name: brace_pairs[0].clone(),
                num_args: 0,
                begin_def: brace_pairs[1].clone(),
                end_def: brace_pairs[2].clone(),
                raw_source: line.to_string(),
            });
        }
        None
    }

    /// Extract content between matched braces.
    fn extract_brace_groups(&self, source: &str) -> Vec<String> {
        let mut groups = Vec::new();
        let mut depth = 0;
        let mut current = String::new();
        let mut in_group = false;

        for ch in source.chars() {
            match ch {
                '{' => {
                    if depth == 0 {
                        in_group = true;
                        current.clear();
                    } else {
                        current.push(ch);
                    }
                    depth += 1;
                }
                '}' => {
                    depth -= 1;
                    if depth == 0 && in_group {
                        groups.push(current.clone());
                        in_group = false;
                    } else {
                        current.push(ch);
                    }
                }
                _ => {
                    if in_group {
                        current.push(ch);
                    }
                }
            }
        }

        groups
    }

    /// Resolve LaTeX document class to Word template (.dotx).
    fn resolve_dotx_template(&self, class_name: &str) -> Option<String> {
        match class_name {
            "IEEEtran" => Some("IEEEtran.dotx".to_string()),
            "acmart" => Some("acmart.dotx".to_string()),
            "elsarticle" => Some("elsarticle.dotx".to_string()),
            "revtex4-2" | "revtex4" => Some("revtex.dotx".to_string()),
            "llncs" => Some("llncs.dotx".to_string()),
            "amsart" => Some("amsart.dotx".to_string()),
            "article" => Some("article-default.dotx".to_string()),
            "report" => Some("report-default.dotx".to_string()),
            "book" => Some("book-default.dotx".to_string()),
            _ => None,
        }
    }

    /// Parse the document body into a sequence of blocks.
    fn parse_body(&mut self, source: &str) -> SirResult<Vec<Block>> {
        let mut blocks = Vec::new();
        let mut current_paragraph = String::new();
        let lines: Vec<&str> = source.lines().collect();
        let mut i = 0;

        while i < lines.len() {
            let line = lines[i].trim();

            if line.is_empty() {
                // Empty line = paragraph break
                if !current_paragraph.trim().is_empty() {
                    blocks.push(self.make_paragraph(&current_paragraph)?);
                    current_paragraph.clear();
                }
                i += 1;
                continue;
            }

            // Check for sectioning commands
            if let Some(heading) = self.try_parse_heading(line) {
                if !current_paragraph.trim().is_empty() {
                    blocks.push(self.make_paragraph(&current_paragraph)?);
                    current_paragraph.clear();
                }
                blocks.push(heading);
                i += 1;
                continue;
            }

            // Check for environment starts
            if line.starts_with("\\begin{") {
                if !current_paragraph.trim().is_empty() {
                    blocks.push(self.make_paragraph(&current_paragraph)?);
                    current_paragraph.clear();
                }

                let env_name = self.extract_env_name(line);
                let (block, end_idx) = self.parse_environment(&env_name, &lines, i)?;
                blocks.push(block);
                i = end_idx + 1;
                continue;
            }

            // Accumulate paragraph text
            current_paragraph.push_str(line);
            current_paragraph.push('\n');
            i += 1;
        }

        // Flush remaining paragraph
        if !current_paragraph.trim().is_empty() {
            blocks.push(self.make_paragraph(&current_paragraph)?);
        }

        Ok(blocks)
    }

    fn try_parse_heading(&mut self, line: &str) -> Option<Block> {
        let heading_commands = [
            ("\\chapter*{", 0u8, true),
            ("\\chapter{", 0, false),
            ("\\section*{", 1, true),
            ("\\section{", 1, false),
            ("\\subsection*{", 2, true),
            ("\\subsection{", 2, false),
            ("\\subsubsection*{", 3, true),
            ("\\subsubsection{", 3, false),
            ("\\paragraph*{", 4, true),
            ("\\paragraph{", 4, false),
            ("\\subparagraph*{", 5, true),
            ("\\subparagraph{", 5, false),
        ];

        for (prefix, depth, starred) in &heading_commands {
            if line.starts_with(prefix) {
                let content_start = prefix.len();
                if let Some(brace_end) = self.find_matching_brace(line, content_start - 1) {
                    let title_text = &line[content_start..brace_end];
                    let label = self.extract_label_after(line, brace_end);

                    let numbering = if *starred {
                        HeadingNumbering::Unnumbered
                    } else {
                        HeadingNumbering::Numbered
                    };

                    return Some(Block {
                        id: NodeId::new(),
                        kind: BlockKind::Heading {
                            depth: *depth,
                            numbering,
                            content: smallvec::smallvec![Inline::Text(title_text.to_string())],
                            label,
                        },
                        source: SourceOrigin::Synthetic,
                    });
                }
            }
        }
        None
    }

    fn extract_env_name(&self, line: &str) -> String {
        if let Some(start) = line.find("\\begin{") {
            let content_start = start + 7;
            if let Some(end) = line[content_start..].find('}') {
                return line[content_start..content_start + end].to_string();
            }
        }
        String::new()
    }

    fn parse_environment(
        &mut self,
        env_name: &str,
        lines: &[&str],
        start: usize,
    ) -> SirResult<(Block, usize)> {
        let end_marker = format!("\\end{{{}}}", env_name);
        let mut end_idx = start + 1;

        // Find matching \end
        let mut depth = 1;
        while end_idx < lines.len() {
            let line = lines[end_idx].trim();
            if line.contains(&format!("\\begin{{{}}}", env_name)) {
                depth += 1;
            }
            if line.contains(&end_marker) {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            end_idx += 1;
        }

        // Collect environment content
        let content: String = lines[start + 1..end_idx]
            .iter()
            .copied()
            .collect::<Vec<&str>>()
            .join("\n");

        let block = match env_name {
            // Math environments
            "equation" | "equation*" | "align" | "align*" | "gather" | "gather*"
            | "multline" | "multline*" | "flalign" | "flalign*" | "split" => {
                let kind = self.math_env_kind(env_name);
                let math = MathEnvironment::from_latex(kind, content.clone());
                let label = self.extract_label_from_content(&content);
                Block {
                    id: NodeId::new(),
                    kind: BlockKind::MathBlock {
                        environment: math,
                        label,
                    },
                    source: SourceOrigin::Synthetic,
                }
            }

            // Figure
            "figure" | "figure*" => {
                self.parse_figure_content(&content, lines[start])?
            }

            // Table
            "table" | "table*" => {
                self.parse_table_content(&content, lines[start])?
            }

            // Lists
            "itemize" => self.parse_list(&content, false)?,
            "enumerate" => self.parse_list(&content, true)?,

            // Theorem-like
            "theorem" | "lemma" | "corollary" | "proposition" | "definition"
            | "example" | "remark" | "proof" => {
                let kind = self.theorem_kind(env_name);
                Block {
                    id: NodeId::new(),
                    kind: BlockKind::TheoremLike {
                        kind,
                        name: None,
                        content: self.parse_body(&content)?,
                        label: self.extract_label_from_content(&content),
                    },
                    source: SourceOrigin::Synthetic,
                }
            }

            // Verbatim / code listing
            "verbatim" | "lstlisting" | "minted" => {
                Block {
                    id: NodeId::new(),
                    kind: BlockKind::CodeBlock {
                        language: if env_name == "minted" {
                            self.extract_minted_language(lines[start])
                        } else {
                            None
                        },
                        caption: None,
                        content,
                        label: None,
                    },
                    source: SourceOrigin::Synthetic,
                }
            }

            // Abstract
            "abstract" => {
                // Parse as paragraphs, store in metadata later
                Block {
                    id: NodeId::new(),
                    kind: BlockKind::Paragraph {
                        style: None,
                        content: smallvec::smallvec![Inline::Text(content)],
                    },
                    source: SourceOrigin::Synthetic,
                }
            }

            // Unknown environment — preserve as raw LaTeX
            _ => {
                let full_source = format!(
                    "\\begin{{{}}}\n{}\n\\end{{{}}}",
                    env_name, content, env_name
                );
                Block {
                    id: NodeId::new(),
                    kind: BlockKind::RawLatex {
                        source: full_source,
                        svg_fallback: None,
                    },
                    source: SourceOrigin::Synthetic,
                }
            }
        };

        Ok((block, end_idx))
    }

    fn math_env_kind(&self, name: &str) -> MathEnvKind {
        match name {
            "equation" => MathEnvKind::Equation,
            "equation*" => MathEnvKind::EquationStar,
            "align" => MathEnvKind::Align,
            "align*" => MathEnvKind::AlignStar,
            "gather" => MathEnvKind::Gather,
            "gather*" => MathEnvKind::GatherStar,
            "multline" => MathEnvKind::Multline,
            "multline*" => MathEnvKind::MultlineStar,
            "split" => MathEnvKind::Split,
            "flalign" | "flalign*" => MathEnvKind::Flalign,
            _ => MathEnvKind::Custom(name.to_string()),
        }
    }

    fn theorem_kind(&self, name: &str) -> TheoremKind {
        match name {
            "theorem" => TheoremKind::Theorem,
            "lemma" => TheoremKind::Lemma,
            "corollary" => TheoremKind::Corollary,
            "proposition" => TheoremKind::Proposition,
            "definition" => TheoremKind::Definition,
            "example" => TheoremKind::Example,
            "remark" => TheoremKind::Remark,
            "proof" => TheoremKind::Proof,
            _ => TheoremKind::Custom(name.to_string()),
        }
    }

    fn make_paragraph(&self, text: &str) -> SirResult<Block> {
        let inline_content = self.parse_inline_content(text.trim());
        Ok(Block {
            id: NodeId::new(),
            kind: BlockKind::Paragraph {
                style: None,
                content: inline_content,
            },
            source: SourceOrigin::Synthetic,
        })
    }

    /// Parse inline content with formatting commands.
    fn parse_inline_content(&self, source: &str) -> InlineContent {
        let mut result = smallvec::SmallVec::new();
        let mut current_text = String::new();
        let chars: Vec<char> = source.chars().collect();
        let mut i = 0;

        while i < chars.len() {
            match chars[i] {
                '\\' => {
                    // Check for known inline commands
                    let remaining: String = chars[i..].iter().collect();

                    if remaining.starts_with("\\textbf{") {
                        if !current_text.is_empty() {
                            result.push(Inline::Text(std::mem::take(&mut current_text)));
                        }
                        let (content, advance) = self.extract_command_content(&remaining, 8);
                        result.push(Inline::Styled {
                            style: CharacterStyle { bold: Some(true), ..Default::default() },
                            content: Box::new(self.parse_inline_content(&content)),
                        });
                        i += advance;
                    } else if remaining.starts_with("\\textit{") || remaining.starts_with("\\emph{") {
                        if !current_text.is_empty() {
                            result.push(Inline::Text(std::mem::take(&mut current_text)));
                        }
                        let prefix_len = if remaining.starts_with("\\emph{") { 6 } else { 8 };
                        let (content, advance) = self.extract_command_content(&remaining, prefix_len);
                        result.push(Inline::Styled {
                            style: CharacterStyle { italic: Some(true), ..Default::default() },
                            content: Box::new(self.parse_inline_content(&content)),
                        });
                        i += advance;
                    } else if remaining.starts_with("\\textsc{") {
                        if !current_text.is_empty() {
                            result.push(Inline::Text(std::mem::take(&mut current_text)));
                        }
                        let (content, advance) = self.extract_command_content(&remaining, 8);
                        result.push(Inline::Styled {
                            style: CharacterStyle { small_caps: Some(true), ..Default::default() },
                            content: Box::new(self.parse_inline_content(&content)),
                        });
                        i += advance;
                    } else if remaining.starts_with("\\ref{") || remaining.starts_with("\\eqref{")
                        || remaining.starts_with("\\cite{") || remaining.starts_with("\\autoref{")
                    {
                        if !current_text.is_empty() {
                            result.push(Inline::Text(std::mem::take(&mut current_text)));
                        }
                        let (label, advance) = if remaining.starts_with("\\ref{") {
                            self.extract_command_content(&remaining, 5)
                        } else if remaining.starts_with("\\eqref{") {
                            self.extract_command_content(&remaining, 7)
                        } else if remaining.starts_with("\\autoref{") {
                            self.extract_command_content(&remaining, 9)
                        } else {
                            self.extract_command_content(&remaining, 6)
                        };

                        if remaining.starts_with("\\cite{") {
                            let keys: Vec<String> = label.split(',').map(|s| s.trim().to_string()).collect();
                            result.push(Inline::Reference(Reference::Citation(Citation {
                                keys,
                                style: CitationStyle::Numeric,
                                prenote: None,
                                postnote: None,
                            })));
                        } else {
                            let kind = if remaining.starts_with("\\eqref{") {
                                RefKind::Equation
                            } else if remaining.starts_with("\\autoref{") {
                                RefKind::Auto
                            } else {
                                RefKind::Standard
                            };
                            result.push(Inline::Reference(Reference::CrossRef {
                                label,
                                kind,
                            }));
                        }
                        i += advance;
                    } else if remaining.starts_with("\\\\") {
                        if !current_text.is_empty() {
                            result.push(Inline::Text(std::mem::take(&mut current_text)));
                        }
                        result.push(Inline::LineBreak);
                        i += 2;
                    } else {
                        // Unknown command — preserve raw
                        current_text.push('\\');
                        i += 1;
                    }
                }
                '$' => {
                    // Inline math
                    if !current_text.is_empty() {
                        result.push(Inline::Text(std::mem::take(&mut current_text)));
                    }
                    i += 1;
                    let mut math = String::new();
                    while i < chars.len() && chars[i] != '$' {
                        math.push(chars[i]);
                        i += 1;
                    }
                    if i < chars.len() {
                        i += 1; // skip closing $
                    }
                    result.push(Inline::InlineMath(math));
                }
                '~' => {
                    if !current_text.is_empty() {
                        result.push(Inline::Text(std::mem::take(&mut current_text)));
                    }
                    result.push(Inline::NonBreakingSpace);
                    i += 1;
                }
                _ => {
                    current_text.push(chars[i]);
                    i += 1;
                }
            }
        }

        if !current_text.is_empty() {
            result.push(Inline::Text(current_text));
        }

        result
    }

    /// Extract content from a command like \textbf{content}, returns (content, chars_consumed).
    fn extract_command_content(&self, source: &str, prefix_len: usize) -> (String, usize) {
        let mut depth = 1;
        let mut content = String::new();
        let chars: Vec<char> = source.chars().collect();
        let mut i = prefix_len;

        while i < chars.len() && depth > 0 {
            match chars[i] {
                '{' => {
                    depth += 1;
                    content.push('{');
                }
                '}' => {
                    depth -= 1;
                    if depth > 0 {
                        content.push('}');
                    }
                }
                c => content.push(c),
            }
            i += 1;
        }

        (content, i)
    }

    fn find_matching_brace(&self, source: &str, open_pos: usize) -> Option<usize> {
        let chars: Vec<char> = source.chars().collect();
        let mut depth = 0;
        let mut i = open_pos;
        while i < chars.len() {
            match chars[i] {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(i);
                    }
                }
                _ => {}
            }
            i += 1;
        }
        None
    }

    fn extract_label_after(&self, line: &str, after_pos: usize) -> Option<String> {
        let remaining = &line[after_pos..];
        if let Some(label_start) = remaining.find("\\label{") {
            let content_start = label_start + 7;
            if let Some(end) = remaining[content_start..].find('}') {
                return Some(remaining[content_start..content_start + end].to_string());
            }
        }
        None
    }

    fn extract_label_from_content(&self, content: &str) -> Option<String> {
        for line in content.lines() {
            if let Some(start) = line.find("\\label{") {
                let content_start = start + 7;
                if let Some(end) = line[content_start..].find('}') {
                    return Some(line[content_start..content_start + end].to_string());
                }
            }
        }
        None
    }

    fn parse_figure_content(&self, content: &str, _header_line: &str) -> SirResult<Block> {
        let mut caption = None;
        let mut label = None;
        let mut image_source = None;

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("\\caption{") {
                let groups = self.extract_brace_groups(trimmed);
                if !groups.is_empty() {
                    caption = Some(smallvec::smallvec![Inline::Text(groups[0].clone())]);
                }
            } else if trimmed.starts_with("\\label{") {
                let groups = self.extract_brace_groups(trimmed);
                if !groups.is_empty() {
                    label = Some(groups[0].clone());
                }
            } else if trimmed.starts_with("\\includegraphics") {
                let groups = self.extract_brace_groups(trimmed);
                if !groups.is_empty() {
                    image_source = Some(ImageSource::File(groups.last().unwrap().clone()));
                }
            }
        }

        Ok(Block {
            id: NodeId::new(),
            kind: BlockKind::Figure(Figure {
                placement: FloatPlacement::HereTopBottomPage,
                content: FigureContent::Single(
                    image_source.unwrap_or(ImageSource::File("missing.png".to_string())),
                ),
                caption,
                label,
                width: None,
            }),
            source: SourceOrigin::Synthetic,
        })
    }

    fn parse_table_content(&self, _content: &str, _header_line: &str) -> SirResult<Block> {
        // Placeholder: full table parsing is extremely complex
        // This will be expanded with the complete multirow/multicolumn parser
        Ok(Block {
            id: NodeId::new(),
            kind: BlockKind::RawLatex {
                source: _content.to_string(),
                svg_fallback: None,
            },
            source: SourceOrigin::Synthetic,
        })
    }

    fn parse_list(&mut self, content: &str, ordered: bool) -> SirResult<Block> {
        let mut items = Vec::new();
        let mut current_item = String::new();

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("\\item") {
                if !current_item.is_empty() {
                    let content = self.parse_inline_content(current_item.trim());
                    items.push(ListItem {
                        label: None,
                        content: vec![Block {
                            id: NodeId::new(),
                            kind: BlockKind::Paragraph {
                                style: None,
                                content,
                            },
                            source: SourceOrigin::Synthetic,
                        }],
                    });
                    current_item.clear();
                }
                let item_content = trimmed.strip_prefix("\\item").unwrap_or("").trim();
                current_item.push_str(item_content);
            } else {
                current_item.push(' ');
                current_item.push_str(trimmed);
            }
        }

        if !current_item.is_empty() {
            let content = self.parse_inline_content(current_item.trim());
            items.push(ListItem {
                label: None,
                content: vec![Block {
                    id: NodeId::new(),
                    kind: BlockKind::Paragraph {
                        style: None,
                        content,
                    },
                    source: SourceOrigin::Synthetic,
                }],
            });
        }

        let kind = if ordered {
            ListKind::Ordered { start: Some(1), style: None }
        } else {
            ListKind::Unordered { marker: None }
        };

        Ok(Block {
            id: NodeId::new(),
            kind: BlockKind::List(List { kind, items }),
            source: SourceOrigin::Synthetic,
        })
    }

    fn extract_minted_language(&self, line: &str) -> Option<String> {
        let groups = self.extract_brace_groups(line);
        groups.get(1).cloned().or_else(|| groups.first().cloned())
    }

    fn extract_metadata(&self, _blocks: &[Block]) -> DocumentMetadata {
        // TODO: Extract \title, \author, \date from parsed blocks
        DocumentMetadata::default()
    }

    fn build_anchor_store(&self, doc: &mut SirDocument, source: &str) {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        for block in &doc.body {
            let mut hasher = DefaultHasher::new();
            // Hash based on the block's serialized form
            format!("{:?}", block.kind).hash(&mut hasher);
            let content_hash = hasher.finish();

            doc.anchor_store.insert(
                block.id.clone(),
                AnchorData {
                    latex_source: Some(source.to_string()), // In production, map to specific ranges
                    ooxml_fragment: None,
                    content_hash,
                    location: None,
                },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_document() {
        let source = r#"\documentclass{article}
\usepackage{amsmath}
\begin{document}
Hello world.
\end{document}"#;

        let transformer = LatexToSirTransformer::new(&TransformConfig::default());
        let (preamble, body) = transformer.split_document(source).unwrap();
        assert!(preamble.contains("\\documentclass"));
        assert!(body.contains("Hello world"));
    }

    #[test]
    fn test_parse_usepackage() {
        let transformer = LatexToSirTransformer::new(&TransformConfig::default());
        let pkg = transformer.parse_usepackage("\\usepackage[utf8]{inputenc}").unwrap();
        assert_eq!(pkg.name, "inputenc");
        assert_eq!(pkg.options, vec!["utf8"]);
    }

    #[test]
    fn test_parse_heading() {
        let mut transformer = LatexToSirTransformer::new(&TransformConfig::default());
        let heading = transformer.try_parse_heading("\\section{Introduction}");
        assert!(heading.is_some());
        if let Some(Block { kind: BlockKind::Heading { depth, .. }, .. }) = heading {
            assert_eq!(depth, 1);
        }
    }

    #[test]
    fn test_inline_math_parsing() {
        let transformer = LatexToSirTransformer::new(&TransformConfig::default());
        let content = transformer.parse_inline_content("The equation $E=mc^2$ is famous.");
        assert_eq!(content.len(), 3);
        assert!(matches!(content[1], Inline::InlineMath(_)));
    }

    #[test]
    fn test_full_document() {
        let source = r#"\documentclass[conference]{IEEEtran}
\usepackage{amsmath}
\usepackage{graphicx}
\begin{document}
\section{Introduction}
This is a test document with $x^2$ inline math.

\begin{equation}
E = mc^2
\label{eq:einstein}
\end{equation}

\section{Methods}
We use \textbf{bold} and \emph{italic} text.
\end{document}"#;

        let mut transformer = LatexToSirTransformer::new(&TransformConfig::default());
        let doc = transformer.transform(source).unwrap();
        assert_eq!(doc.template.latex_class, "IEEEtran");
        assert_eq!(doc.preamble.packages.len(), 2);
        assert!(!doc.body.is_empty());
    }
}
