//! OOXML → SIR transformation.
//!
//! Parses a .docx file (OpenXML) and constructs a SIR document,
//! extracting anchor metadata if present for round-trip support.

use crate::error::{SirError, SirResult};
use crate::model::document::*;
use crate::model::math::{MathEnvKind, MathEnvironment};
use crate::model::metadata::DocumentMetadata;
use crate::model::style::CharacterStyle;
use crate::model::types::*;
use super::TransformConfig;

/// Parses OOXML data into a SIR document.
pub struct OoxmlToSirParser {
    config: TransformConfig,
}

impl OoxmlToSirParser {
    pub fn new(config: &TransformConfig) -> Self {
        Self {
            config: config.clone(),
        }
    }

    /// Parse raw OOXML bytes (document.xml contents) into a SIR document.
    pub fn parse(&self, data: &[u8]) -> SirResult<SirDocument> {
        let xml_str = std::str::from_utf8(data).map_err(|e| {
            SirError::OoxmlParse {
                message: format!("Invalid UTF-8: {}", e),
                part: "document.xml".to_string(),
            }
        })?;

        let xml_doc = roxmltree::Document::parse(xml_str).map_err(|e| {
            SirError::OoxmlParse {
                message: format!("XML parse error: {}", e),
                part: "document.xml".to_string(),
            }
        })?;

        let mut doc = SirDocument::new("article");
        let root = xml_doc.root_element();

        // Find w:body
        let body = root
            .children()
            .find(|n| n.has_tag_name("body") || n.tag_name().name() == "body");

        if let Some(body) = body {
            self.parse_body(&body, &mut doc)?;
        }

        Ok(doc)
    }

    fn parse_body(
        &self,
        body: &roxmltree::Node,
        doc: &mut SirDocument,
    ) -> SirResult<()> {
        for child in body.children() {
            let tag = child.tag_name().name();
            match tag {
                "p" => {
                    if let Some(block) = self.parse_paragraph(&child)? {
                        doc.body.push(block);
                    }
                }
                "tbl" => {
                    // Table parsing placeholder
                    doc.body.push(Block {
                        id: NodeId::new(),
                        kind: BlockKind::RawLatex {
                            source: "% Table imported from OOXML".to_string(),
                            svg_fallback: None,
                        },
                        source: SourceOrigin::Ooxml {
                            part_uri: "word/document.xml".to_string(),
                            element_id: None,
                        },
                    });
                }
                "sectPr" => {
                    self.parse_section_properties(&child, doc)?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn parse_paragraph(&self, para: &roxmltree::Node) -> SirResult<Option<Block>> {
        let mut style_name: Option<String> = None;
        let mut content: InlineContent = smallvec::SmallVec::new();
        let mut has_math = false;

        for child in para.children() {
            let tag = child.tag_name().name();
            match tag {
                "pPr" => {
                    // Extract paragraph style
                    for prop in child.children() {
                        if prop.tag_name().name() == "pStyle" {
                            style_name = prop.attribute("val")
                                .or_else(|| {
                                    prop.attributes()
                                        .find(|a| a.name() == "val")
                                        .map(|a| a.value())
                                })
                                .map(|s| s.to_string());
                        }
                    }
                }
                "r" => {
                    // Parse run
                    if let Some(inline) = self.parse_run(&child)? {
                        content.push(inline);
                    }
                }
                "oMath" | "oMathPara" => {
                    has_math = true;
                    let math_text = self.extract_math_text(&child);
                    if !math_text.is_empty() {
                        content.push(Inline::InlineMath(math_text));
                    }
                }
                "hyperlink" => {
                    let mut link_content: InlineContent = smallvec::SmallVec::new();
                    for run in child.children() {
                        if let Some(inline) = self.parse_run(&run)? {
                            link_content.push(inline);
                        }
                    }
                    let url = child.attribute("anchor")
                        .or_else(|| {
                            child.attributes()
                                .find(|a| a.name() == "id")
                                .map(|a| a.value())
                        })
                        .unwrap_or("")
                        .to_string();
                    content.push(Inline::Link {
                        url,
                        title: None,
                        content: Box::new(link_content),
                    });
                }
                _ => {}
            }
        }

        if content.is_empty() {
            return Ok(None);
        }

        // Determine block type from style
        let block = if let Some(ref style) = style_name {
            match style.as_str() {
                "Heading1" | "heading1" => Block {
                    id: NodeId::new(),
                    kind: BlockKind::Heading {
                        depth: 1,
                        numbering: HeadingNumbering::Numbered,
                        content,
                        label: None,
                    },
                    source: SourceOrigin::Ooxml {
                        part_uri: "word/document.xml".to_string(),
                        element_id: None,
                    },
                },
                "Heading2" | "heading2" => Block {
                    id: NodeId::new(),
                    kind: BlockKind::Heading {
                        depth: 2,
                        numbering: HeadingNumbering::Numbered,
                        content,
                        label: None,
                    },
                    source: SourceOrigin::Ooxml {
                        part_uri: "word/document.xml".to_string(),
                        element_id: None,
                    },
                },
                "Heading3" | "heading3" => Block {
                    id: NodeId::new(),
                    kind: BlockKind::Heading {
                        depth: 3,
                        numbering: HeadingNumbering::Numbered,
                        content,
                        label: None,
                    },
                    source: SourceOrigin::Ooxml {
                        part_uri: "word/document.xml".to_string(),
                        element_id: None,
                    },
                },
                "Title" => Block {
                    id: NodeId::new(),
                    kind: BlockKind::Heading {
                        depth: 0,
                        numbering: HeadingNumbering::Unnumbered,
                        content,
                        label: None,
                    },
                    source: SourceOrigin::Ooxml {
                        part_uri: "word/document.xml".to_string(),
                        element_id: None,
                    },
                },
                _ => Block {
                    id: NodeId::new(),
                    kind: BlockKind::Paragraph { style: None, content },
                    source: SourceOrigin::Ooxml {
                        part_uri: "word/document.xml".to_string(),
                        element_id: None,
                    },
                },
            }
        } else if has_math {
            // Math block
            let math_source = content
                .iter()
                .filter_map(|i| {
                    if let Inline::InlineMath(m) = i {
                        Some(m.as_str())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");

            Block {
                id: NodeId::new(),
                kind: BlockKind::MathBlock {
                    environment: MathEnvironment::from_latex(
                        MathEnvKind::Equation,
                        math_source,
                    ),
                    label: None,
                },
                source: SourceOrigin::Ooxml {
                    part_uri: "word/document.xml".to_string(),
                    element_id: None,
                },
            }
        } else {
            Block {
                id: NodeId::new(),
                kind: BlockKind::Paragraph { style: None, content },
                source: SourceOrigin::Ooxml {
                    part_uri: "word/document.xml".to_string(),
                    element_id: None,
                },
            }
        };

        Ok(Some(block))
    }

    fn parse_run(&self, run: &roxmltree::Node) -> SirResult<Option<Inline>> {
        let mut text = String::new();
        let mut style = CharacterStyle::default();
        let mut is_break = false;

        for child in run.children() {
            let tag = child.tag_name().name();
            match tag {
                "rPr" => {
                    self.parse_run_properties(&child, &mut style);
                }
                "t" => {
                    if let Some(t) = child.text() {
                        text.push_str(t);
                    }
                }
                "br" => {
                    is_break = true;
                }
                "tab" => {
                    text.push('\t');
                }
                _ => {}
            }
        }

        if is_break {
            return Ok(Some(Inline::LineBreak));
        }

        if text.is_empty() {
            return Ok(None);
        }

        let has_styling = style.bold.is_some()
            || style.italic.is_some()
            || style.small_caps.is_some()
            || style.superscript.is_some()
            || style.subscript.is_some()
            || style.font_family.is_some()
            || style.font_size_pt.is_some();

        if has_styling {
            Ok(Some(Inline::Styled {
                style,
                content: Box::new(smallvec::smallvec![Inline::Text(text)]),
            }))
        } else {
            Ok(Some(Inline::Text(text)))
        }
    }

    fn parse_run_properties(&self, rpr: &roxmltree::Node, style: &mut CharacterStyle) {
        for child in rpr.children() {
            let tag = child.tag_name().name();
            match tag {
                "b" => style.bold = Some(true),
                "i" => style.italic = Some(true),
                "smallCaps" => style.small_caps = Some(true),
                "strike" => style.strikethrough = Some(true),
                "vertAlign" => {
                    if let Some(val) = child.attribute("val") {
                        match val {
                            "superscript" => style.superscript = Some(true),
                            "subscript" => style.subscript = Some(true),
                            _ => {}
                        }
                    }
                }
                "rFonts" => {
                    if let Some(font) = child.attribute("ascii") {
                        style.font_family = Some(font.to_string());
                    }
                }
                "sz" => {
                    if let Some(val) = child.attribute("val") {
                        if let Ok(half_points) = val.parse::<f64>() {
                            style.font_size_pt = Some(half_points / 2.0);
                        }
                    }
                }
                "color" => {
                    if let Some(val) = child.attribute("val") {
                        style.color = Some(crate::model::style::Color::Hex(val.to_string()));
                    }
                }
                _ => {}
            }
        }
    }

    fn extract_math_text(&self, math_node: &roxmltree::Node) -> String {
        let mut result = String::new();
        self.collect_math_text(math_node, &mut result);
        result
    }

    fn collect_math_text(&self, node: &roxmltree::Node, result: &mut String) {
        if node.tag_name().name() == "t" {
            if let Some(text) = node.text() {
                result.push_str(text);
            }
        }
        for child in node.children() {
            self.collect_math_text(&child, result);
        }
    }

    fn parse_section_properties(
        &self,
        sect_pr: &roxmltree::Node,
        doc: &mut SirDocument,
    ) -> SirResult<()> {
        for child in sect_pr.children() {
            let tag = child.tag_name().name();
            match tag {
                "pgSz" => {
                    // Page size in twips
                }
                "pgMar" => {
                    if let Some(top) = child.attribute("top") {
                        if let Ok(v) = top.parse::<f64>() {
                            doc.page_layout.margins.top_mm = v / 56.6929;
                        }
                    }
                    if let Some(bottom) = child.attribute("bottom") {
                        if let Ok(v) = bottom.parse::<f64>() {
                            doc.page_layout.margins.bottom_mm = v / 56.6929;
                        }
                    }
                    if let Some(left) = child.attribute("left") {
                        if let Ok(v) = left.parse::<f64>() {
                            doc.page_layout.margins.left_mm = v / 56.6929;
                        }
                    }
                    if let Some(right) = child.attribute("right") {
                        if let Ok(v) = right.parse::<f64>() {
                            doc.page_layout.margins.right_mm = v / 56.6929;
                        }
                    }
                }
                "cols" => {
                    if let Some(num) = child.attribute("num") {
                        if let Ok(n) = num.parse::<u32>() {
                            if n == 2 {
                                doc.page_layout.columns = ColumnLayout::Double {
                                    column_sep_mm: 12.7, // default
                                };
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }
}
