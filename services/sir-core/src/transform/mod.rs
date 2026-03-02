pub mod latex_to_sir;
pub mod sir_to_latex;
pub mod sir_to_ooxml;
pub mod ooxml_to_sir;

use crate::model::document::SirDocument;
use crate::{SirError, SirResult};

/// Direction of conversion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConversionDirection {
    LatexToWord,
    WordToLatex,
    LatexToPdf,
    WordToPdf,
    RoundTrip,
}

/// Configuration for a transformation pass.
#[derive(Debug, Clone)]
pub struct TransformConfig {
    pub direction: ConversionDirection,
    /// Whether to embed anchor metadata in the output.
    pub embed_anchors: bool,
    /// Whether to preserve raw LaTeX for unsupported constructs.
    pub preserve_raw: bool,
    /// Whether to generate SVG fallbacks for unparseable math.
    pub svg_fallbacks: bool,
    /// Template override (if not inferred from document class).
    pub template_override: Option<String>,
}

impl Default for TransformConfig {
    fn default() -> Self {
        TransformConfig {
            direction: ConversionDirection::LatexToWord,
            embed_anchors: true,
            preserve_raw: true,
            svg_fallbacks: true,
            template_override: None,
        }
    }
}

/// The master transformation pipeline.
pub struct TransformPipeline {
    config: TransformConfig,
}

impl TransformPipeline {
    pub fn new(config: TransformConfig) -> Self {
        Self { config }
    }

    /// Transform LaTeX source into a SIR document.
    pub fn latex_to_sir(&self, latex_source: &str) -> SirResult<SirDocument> {
        let mut parser = latex_to_sir::LatexToSirTransformer::new(&self.config);
        parser.transform(latex_source)
    }

    /// Transform a SIR document into LaTeX source.
    pub fn sir_to_latex(&self, doc: &SirDocument) -> SirResult<String> {
        let emitter = sir_to_latex::SirToLatexEmitter::new(&self.config);
        emitter.emit(doc)
    }

    /// Transform a SIR document into OOXML parts (returned as structured data).
    pub fn sir_to_ooxml(&self, doc: &SirDocument) -> SirResult<sir_to_ooxml::OoxmlOutput> {
        let builder = sir_to_ooxml::SirToOoxmlBuilder::new(&self.config);
        builder.build(doc)
    }

    /// Transform OOXML data into a SIR document.
    pub fn ooxml_to_sir(&self, ooxml: &[u8]) -> SirResult<SirDocument> {
        let parser = ooxml_to_sir::OoxmlToSirParser::new(&self.config);
        parser.parse(ooxml)
    }

    /// Full round-trip: LaTeX → SIR → OOXML → SIR → LaTeX
    /// Returns the round-tripped LaTeX and a diff report.
    pub fn round_trip_latex(&self, latex_source: &str) -> SirResult<(String, Vec<String>)> {
        let sir1 = self.latex_to_sir(latex_source)?;
        let ooxml = self.sir_to_ooxml(&sir1)?;
        let sir2 = self.ooxml_to_sir(&ooxml.document_xml.as_bytes())?;
        let latex_out = self.sir_to_latex(&sir2)?;

        // Compute structural diff
        let changed_nodes = sir1.anchor_store.diff_against(&sir2.anchor_store);
        let diff_report: Vec<String> = changed_nodes
            .iter()
            .map(|id| format!("Node {} was modified during round-trip", id))
            .collect();

        Ok((latex_out, diff_report))
    }
}
