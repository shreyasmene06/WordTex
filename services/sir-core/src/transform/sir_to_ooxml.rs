//! SIR → OOXML transformation.
//!
//! Generates a complete .docx file structure from a SIR document,
//! using native OpenXML constructs and embedding anchor metadata
//! as Custom XML Parts for lossless round-trip support.

use crate::error::SirResult;
use crate::model::document::*;
use crate::model::style::{Alignment, CharacterStyle};
use super::TransformConfig;

/// The output of an OOXML generation pass.
#[derive(Debug, Clone)]
pub struct OoxmlOutput {
    /// The main document.xml content.
    pub document_xml: String,
    /// Content types XML.
    pub content_types_xml: String,
    /// Relationships XML.
    pub rels_xml: String,
    /// Custom XML part containing anchor metadata.
    pub anchor_xml: Option<String>,
    /// Styles XML.
    pub styles_xml: String,
    /// Numbering XML (for lists, heading numbering).
    pub numbering_xml: Option<String>,
    /// Header XMLs.
    pub headers: Vec<(String, String)>,
    /// Footer XMLs.
    pub footers: Vec<(String, String)>,
    /// Embedded images as (path, bytes).
    pub images: Vec<(String, Vec<u8>)>,
}

/// Builds OOXML output from a SIR document.
pub struct SirToOoxmlBuilder {
    config: TransformConfig,
    xml: String,
    relationship_counter: u32,
    relationships: Vec<(String, String, String)>,
}

impl SirToOoxmlBuilder {
    pub fn new(config: &TransformConfig) -> Self {
        Self {
            config: config.clone(),
            xml: String::with_capacity(131072),
            relationship_counter: 1,
            relationships: Vec::new(),
        }
    }

    pub fn build(&self, doc: &SirDocument) -> SirResult<OoxmlOutput> {
        let mut builder = SirToOoxmlBuilder::new(&self.config);
        let document_xml = builder.build_document_xml(doc)?;
        let styles_xml = builder.build_styles_xml(doc)?;
        let content_types_xml = builder.build_content_types();
        let rels_xml = builder.build_relationships();
        let anchor_xml = if self.config.embed_anchors {
            Some(builder.build_anchor_xml(doc)?)
        } else {
            None
        };

        Ok(OoxmlOutput {
            document_xml,
            content_types_xml,
            rels_xml,
            anchor_xml,
            styles_xml,
            numbering_xml: None,
            headers: Vec::new(),
            footers: Vec::new(),
            images: Vec::new(),
        })
    }

    fn build_document_xml(&mut self, doc: &SirDocument) -> SirResult<String> {
        let mut xml = String::with_capacity(65536);

        xml.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#);
        xml.push('\n');
        xml.push_str(r#"<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" "#);
        xml.push_str(r#"xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" "#);
        xml.push_str(r#"xmlns:o="urn:schemas-microsoft-com:office:office" "#);
        xml.push_str(r#"xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" "#);
        xml.push_str(r#"xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" "#);
        xml.push_str(r#"xmlns:v="urn:schemas-microsoft-com:vml" "#);
        xml.push_str(r#"xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" "#);
        xml.push_str(r#"xmlns:w10="urn:schemas-microsoft-com:office:word" "#);
        xml.push_str(r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" "#);
        xml.push_str(r#"xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" "#);
        xml.push_str(r#"xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" "#);
        xml.push_str(r#"xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" "#);
        xml.push_str(r#"xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" "#);
        xml.push_str(r#"xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" "#);
        xml.push_str(r#"mc:Ignorable="w14 wp14">"#);
        xml.push('\n');

        xml.push_str("  <w:body>\n");

        // Emit metadata (title, authors)
        if let Some(title) = &doc.metadata.title {
            xml.push_str("    <w:p>\n");
            xml.push_str("      <w:pPr><w:pStyle w:val=\"Title\"/></w:pPr>\n");
            self.emit_inline_run(&mut xml, title, 6);
            xml.push_str("    </w:p>\n");
        }

        for author in &doc.metadata.authors {
            xml.push_str("    <w:p>\n");
            xml.push_str("      <w:pPr><w:pStyle w:val=\"Author\"/></w:pPr>\n");
            xml.push_str(&format!(
                "      <w:r><w:t>{}</w:t></w:r>\n",
                self.escape_xml(&author.name)
            ));
            xml.push_str("    </w:p>\n");
        }

        // Emit body blocks
        for block in &doc.body {
            self.emit_block_xml(&mut xml, block, 4)?;
        }

        // Section properties (page layout)
        xml.push_str("    <w:sectPr>\n");
        xml.push_str(&format!(
            "      <w:pgSz w:w=\"{}\" w:h=\"{}\"/>\n",
            self.mm_to_twips(215.9),  // Letter width
            self.mm_to_twips(279.4),  // Letter height
        ));
        xml.push_str(&format!(
            "      <w:pgMar w:top=\"{}\" w:right=\"{}\" w:bottom=\"{}\" w:left=\"{}\"/>\n",
            self.mm_to_twips(doc.page_layout.margins.top_mm),
            self.mm_to_twips(doc.page_layout.margins.right_mm),
            self.mm_to_twips(doc.page_layout.margins.bottom_mm),
            self.mm_to_twips(doc.page_layout.margins.left_mm),
        ));
        match &doc.page_layout.columns {
            ColumnLayout::Double { column_sep_mm } => {
                xml.push_str(&format!(
                    "      <w:cols w:num=\"2\" w:space=\"{}\"/>\n",
                    self.mm_to_twips(*column_sep_mm)
                ));
            }
            ColumnLayout::Custom { count, sep_mm } => {
                xml.push_str(&format!(
                    "      <w:cols w:num=\"{}\" w:space=\"{}\"/>\n",
                    count,
                    self.mm_to_twips(*sep_mm)
                ));
            }
            _ => {}
        }
        xml.push_str("    </w:sectPr>\n");

        xml.push_str("  </w:body>\n");
        xml.push_str("</w:document>");

        Ok(xml)
    }

    fn emit_block_xml(&mut self, xml: &mut String, block: &Block, indent: usize) -> SirResult<()> {
        let pad = " ".repeat(indent);

        match &block.kind {
            BlockKind::Heading { depth, numbering, content, label } => {
                let style_name = match depth {
                    0 => "Heading1",
                    1 => "Heading1",
                    2 => "Heading2",
                    3 => "Heading3",
                    4 => "Heading4",
                    _ => "Heading5",
                };
                xml.push_str(&format!("{}<w:p>\n", pad));
                xml.push_str(&format!("{}  <w:pPr><w:pStyle w:val=\"{}\"/></w:pPr>\n", pad, style_name));

                // Emit bookmark for label (cross-reference target)
                if let Some(label) = label {
                    let bookmark_id = self.next_relationship_id();
                    xml.push_str(&format!(
                        "{}  <w:bookmarkStart w:id=\"{}\" w:name=\"{}\"/>\n",
                        pad, bookmark_id, self.escape_xml(label)
                    ));
                    self.emit_inline_run(xml, content, indent + 2);
                    xml.push_str(&format!(
                        "{}  <w:bookmarkEnd w:id=\"{}\"/>\n",
                        pad, bookmark_id
                    ));
                } else {
                    self.emit_inline_run(xml, content, indent + 2);
                }

                xml.push_str(&format!("{}</w:p>\n", pad));
            }

            BlockKind::Paragraph { style, content } => {
                xml.push_str(&format!("{}<w:p>\n", pad));
                if let Some(style) = style {
                    xml.push_str(&format!("{}  <w:pPr>", pad));
                    self.emit_paragraph_props(xml, style);
                    xml.push_str("</w:pPr>\n");
                }
                self.emit_inline_run(xml, content, indent + 2);
                xml.push_str(&format!("{}</w:p>\n", pad));
            }

            BlockKind::MathBlock { environment, label } => {
                xml.push_str(&format!("{}<w:p>\n", pad));
                xml.push_str(&format!("{}  <w:pPr><w:jc w:val=\"center\"/></w:pPr>\n", pad));

                // Emit OMML math
                if let Some(omml) = &environment.omml {
                    xml.push_str(omml);
                } else {
                    // Generate placeholder OMML with the raw LaTeX as alt text
                    xml.push_str(&format!("{}  <m:oMathPara>\n", pad));
                    xml.push_str(&format!("{}    <m:oMathParaPr>\n", pad));
                    xml.push_str(&format!("{}      <m:jc m:val=\"center\"/>\n", pad));
                    xml.push_str(&format!("{}    </m:oMathParaPr>\n", pad));
                    xml.push_str(&format!("{}    <m:oMath>\n", pad));
                    xml.push_str(&format!(
                        "{}      <m:r><m:rPr><m:sty m:val=\"p\"/></m:rPr><m:t>{}</m:t></m:r>\n",
                        pad,
                        self.escape_xml(&environment.latex_source)
                    ));
                    xml.push_str(&format!("{}    </m:oMath>\n", pad));
                    xml.push_str(&format!("{}  </m:oMathPara>\n", pad));
                }

                xml.push_str(&format!("{}</w:p>\n", pad));
            }

            BlockKind::List(list) => {
                for (idx, item) in list.items.iter().enumerate() {
                    for sub_block in &item.content {
                        xml.push_str(&format!("{}<w:p>\n", pad));
                        xml.push_str(&format!("{}  <w:pPr>\n", pad));
                        xml.push_str(&format!("{}    <w:pStyle w:val=\"ListParagraph\"/>\n", pad));
                        xml.push_str(&format!("{}    <w:numPr>\n", pad));
                        xml.push_str(&format!("{}      <w:ilvl w:val=\"0\"/>\n", pad));
                        let num_id = match &list.kind {
                            ListKind::Ordered { .. } => 1,
                            _ => 2,
                        };
                        xml.push_str(&format!("{}      <w:numId w:val=\"{}\"/>\n", pad, num_id));
                        xml.push_str(&format!("{}    </w:numPr>\n", pad));
                        xml.push_str(&format!("{}  </w:pPr>\n", pad));
                        if let BlockKind::Paragraph { content, .. } = &sub_block.kind {
                            self.emit_inline_run(xml, content, indent + 2);
                        }
                        xml.push_str(&format!("{}</w:p>\n", pad));
                    }
                }
            }

            BlockKind::CodeBlock { content, language, .. } => {
                // Emit as monospaced paragraph
                for line in content.lines() {
                    xml.push_str(&format!("{}<w:p>\n", pad));
                    xml.push_str(&format!("{}  <w:pPr><w:pStyle w:val=\"Code\"/></w:pPr>\n", pad));
                    xml.push_str(&format!(
                        "{}  <w:r><w:rPr><w:rFonts w:ascii=\"Courier New\" w:hAnsi=\"Courier New\"/></w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r>\n",
                        pad,
                        self.escape_xml(line)
                    ));
                    xml.push_str(&format!("{}</w:p>\n", pad));
                }
            }

            BlockKind::TheoremLike { kind, name, content, label } => {
                // Emit theorem header
                let type_name = format!("{:?}", kind);
                xml.push_str(&format!("{}<w:p>\n", pad));
                xml.push_str(&format!("{}  <w:pPr><w:pStyle w:val=\"TheoremHeader\"/></w:pPr>\n", pad));
                xml.push_str(&format!(
                    "{}  <w:r><w:rPr><w:b/></w:rPr><w:t>{}.</w:t></w:r>\n",
                    pad, type_name
                ));
                if let Some(name) = name {
                    xml.push_str(&format!("{}  <w:r><w:t> (", pad));
                    xml.push_str(")</w:t></w:r>\n");
                }
                xml.push_str(&format!("{}</w:p>\n", pad));

                // Emit theorem content
                for sub_block in content {
                    self.emit_block_xml(xml, sub_block, indent)?;
                }
            }

            BlockKind::RawLatex { source, svg_fallback } => {
                // Embed as hidden text with SVG fallback
                xml.push_str(&format!("{}<w:p>\n", pad));
                xml.push_str(&format!(
                    "{}  <w:r><w:rPr><w:vanish/></w:rPr><w:t>{}</w:t></w:r>\n",
                    pad,
                    self.escape_xml(source)
                ));
                xml.push_str(&format!("{}</w:p>\n", pad));
            }

            BlockKind::PageBreak => {
                xml.push_str(&format!("{}<w:p>\n", pad));
                xml.push_str(&format!("{}  <w:r><w:br w:type=\"page\"/></w:r>\n", pad));
                xml.push_str(&format!("{}</w:p>\n", pad));
            }

            BlockKind::HorizontalRule => {
                xml.push_str(&format!("{}<w:p>\n", pad));
                xml.push_str(&format!("{}  <w:pPr><w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:space=\"1\"/></w:pBdr></w:pPr>\n", pad));
                xml.push_str(&format!("{}</w:p>\n", pad));
            }

            _ => {
                // Fallback: emit as plain paragraph
                xml.push_str(&format!("{}<w:p>\n", pad));
                xml.push_str(&format!(
                    "{}  <w:r><w:t>[Unsupported block type]</w:t></w:r>\n", pad
                ));
                xml.push_str(&format!("{}</w:p>\n", pad));
            }
        }

        Ok(())
    }

    fn emit_inline_run(&self, xml: &mut String, content: &InlineContent, indent: usize) {
        let pad = " ".repeat(indent);

        for inline in content {
            match inline {
                Inline::Text(text) => {
                    xml.push_str(&format!(
                        "{}<w:r><w:t xml:space=\"preserve\">{}</w:t></w:r>\n",
                        pad,
                        self.escape_xml(text)
                    ));
                }
                Inline::Styled { style, content } => {
                    // Open run with properties
                    xml.push_str(&format!("{}<w:r>\n", pad));
                    xml.push_str(&format!("{}  <w:rPr>", pad));
                    self.emit_run_props(xml, style);
                    xml.push_str("</w:rPr>\n");

                    // Flatten styled content into text
                    let text = self.flatten_inline_text(content);
                    xml.push_str(&format!(
                        "{}  <w:t xml:space=\"preserve\">{}</w:t>\n",
                        pad,
                        self.escape_xml(&text)
                    ));
                    xml.push_str(&format!("{}</w:r>\n", pad));
                }
                Inline::InlineMath(math) => {
                    // Inline OMML
                    xml.push_str(&format!("{}<m:oMath>\n", pad));
                    xml.push_str(&format!(
                        "{}  <m:r><m:rPr><m:sty m:val=\"p\"/></m:rPr><m:t>{}</m:t></m:r>\n",
                        pad,
                        self.escape_xml(math)
                    ));
                    xml.push_str(&format!("{}</m:oMath>\n", pad));
                }
                Inline::NonBreakingSpace => {
                    xml.push_str(&format!(
                        "{}<w:r><w:t xml:space=\"preserve\"> </w:t></w:r>\n", pad
                    ));
                }
                Inline::LineBreak => {
                    xml.push_str(&format!("{}<w:r><w:br/></w:r>\n", pad));
                }
                Inline::Reference(Reference::CrossRef { label, .. }) => {
                    xml.push_str(&format!(
                        "{}<w:r><w:fldChar w:fldCharType=\"begin\"/></w:r>\n", pad
                    ));
                    xml.push_str(&format!(
                        "{}<w:r><w:instrText> REF {} \\h </w:instrText></w:r>\n",
                        pad,
                        self.escape_xml(label)
                    ));
                    xml.push_str(&format!(
                        "{}<w:r><w:fldChar w:fldCharType=\"separate\"/></w:r>\n", pad
                    ));
                    xml.push_str(&format!(
                        "{}<w:r><w:t>[{}]</w:t></w:r>\n",
                        pad,
                        self.escape_xml(label)
                    ));
                    xml.push_str(&format!(
                        "{}<w:r><w:fldChar w:fldCharType=\"end\"/></w:r>\n", pad
                    ));
                }
                _ => {
                    let text = format!("{:?}", inline);
                    xml.push_str(&format!(
                        "{}<w:r><w:t>{}</w:t></w:r>\n",
                        pad,
                        self.escape_xml(&text)
                    ));
                }
            }
        }
    }

    fn emit_run_props(&self, xml: &mut String, style: &CharacterStyle) {
        if style.bold == Some(true) {
            xml.push_str("<w:b/>");
        }
        if style.italic == Some(true) {
            xml.push_str("<w:i/>");
        }
        if style.small_caps == Some(true) {
            xml.push_str("<w:smallCaps/>");
        }
        if style.superscript == Some(true) {
            xml.push_str("<w:vertAlign w:val=\"superscript\"/>");
        }
        if style.subscript == Some(true) {
            xml.push_str("<w:vertAlign w:val=\"subscript\"/>");
        }
        if style.strikethrough == Some(true) {
            xml.push_str("<w:strike/>");
        }
        if let Some(font) = &style.font_family {
            xml.push_str(&format!(
                "<w:rFonts w:ascii=\"{}\" w:hAnsi=\"{}\"/>",
                self.escape_xml(font),
                self.escape_xml(font)
            ));
        }
        if let Some(size_pt) = style.font_size_pt {
            let half_points = (size_pt * 2.0) as u32;
            xml.push_str(&format!("<w:sz w:val=\"{}\"/>", half_points));
        }
        if let Some(color) = &style.color {
            xml.push_str(&format!("<w:color w:val=\"{}\"/>", color.to_hex()));
        }
    }

    fn emit_paragraph_props(&self, xml: &mut String, style: &crate::model::style::ParagraphStyle) {
        if let Some(alignment) = &style.alignment {
            let val = match alignment {
                Alignment::Left => "left",
                Alignment::Center => "center",
                Alignment::Right => "right",
                Alignment::Justify => "both",
            };
            xml.push_str(&format!("<w:jc w:val=\"{}\"/>", val));
        }
        if style.space_before_pt.is_some() || style.space_after_pt.is_some() {
            xml.push_str("<w:spacing");
            if let Some(before) = style.space_before_pt {
                xml.push_str(&format!(" w:before=\"{}\"", (before * 20.0) as u32));
            }
            if let Some(after) = style.space_after_pt {
                xml.push_str(&format!(" w:after=\"{}\"", (after * 20.0) as u32));
            }
            xml.push_str("/>");
        }
    }

    fn flatten_inline_text(&self, content: &InlineContent) -> String {
        let mut result = String::new();
        for inline in content {
            match inline {
                Inline::Text(text) => result.push_str(text),
                Inline::Styled { content, .. } => {
                    result.push_str(&self.flatten_inline_text(content));
                }
                Inline::InlineMath(math) => {
                    result.push_str(math);
                }
                Inline::NonBreakingSpace => result.push(' '),
                _ => {}
            }
        }
        result
    }

    fn build_styles_xml(&self, doc: &SirDocument) -> SirResult<String> {
        let mut xml = String::new();
        xml.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#);
        xml.push('\n');
        xml.push_str(r#"<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">"#);
        xml.push('\n');

        // Default styles
        let default_styles = vec![
            ("Normal", "paragraph", "Normal", ""),
            ("Heading1", "paragraph", "heading 1", "<w:pPr><w:spacing w:before=\"240\" w:after=\"120\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"32\"/></w:rPr>"),
            ("Heading2", "paragraph", "heading 2", "<w:pPr><w:spacing w:before=\"200\" w:after=\"100\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"28\"/></w:rPr>"),
            ("Heading3", "paragraph", "heading 3", "<w:pPr><w:spacing w:before=\"160\" w:after=\"80\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"24\"/></w:rPr>"),
            ("Title", "paragraph", "Title", "<w:pPr><w:jc w:val=\"center\"/><w:spacing w:after=\"200\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"48\"/></w:rPr>"),
            ("Author", "paragraph", "Author", "<w:pPr><w:jc w:val=\"center\"/></w:pPr><w:rPr><w:sz w:val=\"24\"/></w:rPr>"),
            ("Code", "paragraph", "Code", "<w:rPr><w:rFonts w:ascii=\"Courier New\" w:hAnsi=\"Courier New\"/><w:sz w:val=\"20\"/></w:rPr>"),
            ("ListParagraph", "paragraph", "List Paragraph", "<w:pPr><w:ind w:left=\"720\"/></w:pPr>"),
        ];

        for (id, kind, name, props) in default_styles {
            xml.push_str(&format!(
                "  <w:style w:type=\"{}\" w:styleId=\"{}\">\n    <w:name w:val=\"{}\"/>\n    {}\n  </w:style>\n",
                kind, id, name, props
            ));
        }

        xml.push_str("</w:styles>");
        Ok(xml)
    }

    fn build_content_types(&self) -> String {
        let mut xml = String::new();
        xml.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#);
        xml.push('\n');
        xml.push_str(r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">"#);
        xml.push('\n');
        xml.push_str(r#"  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>"#);
        xml.push('\n');
        xml.push_str(r#"  <Default Extension="xml" ContentType="application/xml"/>"#);
        xml.push('\n');
        xml.push_str(r#"  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>"#);
        xml.push('\n');
        xml.push_str(r#"  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>"#);
        xml.push('\n');
        xml.push_str("</Types>");
        xml
    }

    fn build_relationships(&self) -> String {
        let mut xml = String::new();
        xml.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#);
        xml.push('\n');
        xml.push_str(r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#);
        xml.push('\n');
        xml.push_str(r#"  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>"#);
        xml.push('\n');
        xml.push_str("</Relationships>");
        xml
    }

    fn build_anchor_xml(&self, doc: &SirDocument) -> SirResult<String> {
        let json = serde_json::to_string_pretty(&doc.anchor_store)?;
        let mut xml = String::new();
        xml.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#);
        xml.push('\n');
        xml.push_str(r#"<wordtex:anchors xmlns:wordtex="http://wordtex.io/schema/anchors/v1">"#);
        xml.push('\n');
        xml.push_str(&format!("  <wordtex:data><![CDATA[{}]]></wordtex:data>\n", json));
        xml.push_str("</wordtex:anchors>");
        Ok(xml)
    }

    fn escape_xml(&self, s: &str) -> String {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    }

    fn mm_to_twips(&self, mm: f64) -> u32 {
        (mm * 56.6929) as u32  // 1mm = 56.6929 twips
    }

    fn next_relationship_id(&mut self) -> u32 {
        self.relationship_counter += 1;
        self.relationship_counter
    }
}
