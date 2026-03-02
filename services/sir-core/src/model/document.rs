//! Core SIR Document Model
//!
//! The Semantic Intermediate Representation (SIR) captures the full semantic
//! and typographic structure of a document in a format-agnostic way, supporting
//! lossless bidirectional transformation between LaTeX and OOXML.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use smallvec::SmallVec;
use uuid::Uuid;

use super::math::MathEnvironment;
use super::metadata::DocumentMetadata;
use super::style::{CharacterStyle, ParagraphStyle};
use super::table::Table;
use super::types::*;

/// The top-level SIR document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SirDocument {
    /// Unique document identifier for tracking through the pipeline.
    pub id: Uuid,

    /// Document-level metadata (title, authors, abstract, etc.).
    pub metadata: DocumentMetadata,

    /// Document class / template binding.
    pub template: TemplateBinding,

    /// Custom preamble commands (\newcommand, \usepackage, etc.).
    /// Preserved verbatim for round-trip fidelity.
    pub preamble: Preamble,

    /// Page layout constraints.
    pub page_layout: PageLayout,

    /// The ordered sequence of top-level document blocks.
    pub body: Vec<Block>,

    /// Bibliography data (BibTeX entries, citation style).
    pub bibliography: Option<Bibliography>,

    /// Appendices, treated as separate block sequences.
    pub appendices: Vec<Appendix>,

    /// Round-trip anchor metadata: maps SIR node IDs to original source fragments.
    pub anchor_store: AnchorStore,
}

/// Binds to a specific academic template / document class.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateBinding {
    /// LaTeX document class name (e.g., "IEEEtran", "acmart").
    pub latex_class: String,

    /// Class options (e.g., ["conference", "letterpaper"]).
    pub class_options: Vec<String>,

    /// Corresponding Word template file (.dotx) identifier.
    pub dotx_template: Option<String>,
}

/// LaTeX preamble preservation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preamble {
    /// Package imports with options.
    pub packages: Vec<PackageImport>,

    /// Custom command definitions (\newcommand, \renewcommand, \DeclareMathOperator).
    pub custom_commands: Vec<CustomCommand>,

    /// Custom environment definitions (\newenvironment, \newtheorem).
    pub custom_environments: Vec<CustomEnvironment>,

    /// Raw preamble lines that couldn't be semantically parsed.
    pub raw_lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageImport {
    pub name: String,
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomCommand {
    pub name: String,
    pub num_args: u8,
    pub optional_default: Option<String>,
    pub definition: String,
    pub raw_source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomEnvironment {
    pub name: String,
    pub num_args: u8,
    pub begin_def: String,
    pub end_def: String,
    pub raw_source: String,
}

/// Page geometry and layout constraints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageLayout {
    pub paper_size: PaperSize,
    pub margins: Margins,
    pub columns: ColumnLayout,
    pub header_footer: Option<HeaderFooter>,
    pub line_spacing: LineSpacing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PaperSize {
    Letter,
    A4,
    Custom { width_mm: f64, height_mm: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Margins {
    pub top_mm: f64,
    pub bottom_mm: f64,
    pub left_mm: f64,
    pub right_mm: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ColumnLayout {
    Single,
    Double { column_sep_mm: f64 },
    Custom { count: u32, sep_mm: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeaderFooter {
    pub header_left: Option<InlineContent>,
    pub header_center: Option<InlineContent>,
    pub header_right: Option<InlineContent>,
    pub footer_left: Option<InlineContent>,
    pub footer_center: Option<InlineContent>,
    pub footer_right: Option<InlineContent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LineSpacing {
    Single,
    OneAndHalf,
    Double,
    Custom(f64),
}

// ─── Block-Level Elements ───────────────────────────────────────

/// A block-level element in the document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Block {
    /// Unique ID for anchor metadata tracking.
    pub id: NodeId,

    /// The block content.
    pub kind: BlockKind,

    /// Source origin tracking.
    pub source: SourceOrigin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BlockKind {
    /// Section heading (depth 0 = \chapter, 1 = \section, etc.).
    Heading {
        depth: u8,
        numbering: HeadingNumbering,
        content: InlineContent,
        label: Option<String>,
    },

    /// A paragraph: sequence of inline elements.
    Paragraph {
        style: Option<ParagraphStyle>,
        content: InlineContent,
    },

    /// Mathematical display environment.
    MathBlock {
        environment: MathEnvironment,
        label: Option<String>,
    },

    /// Table with full multirow/multicolumn support.
    TableBlock(Table),

    /// Figure with caption, placement, and subfigures.
    Figure(Figure),

    /// Ordered or unordered list.
    List(List),

    /// Code listing / verbatim block.
    CodeBlock {
        language: Option<String>,
        caption: Option<InlineContent>,
        content: String,
        label: Option<String>,
    },

    /// Theorem-like environment (theorem, lemma, proof, definition, etc.).
    TheoremLike {
        kind: TheoremKind,
        name: Option<InlineContent>,
        content: Vec<Block>,
        label: Option<String>,
    },

    /// Block quotation.
    BlockQuote {
        content: Vec<Block>,
        attribution: Option<InlineContent>,
    },

    /// Algorithm / pseudocode environment.
    Algorithm {
        caption: Option<InlineContent>,
        content: AlgorithmContent,
        label: Option<String>,
    },

    /// Footnote that was promoted to block level for processing.
    FootnoteDefinition {
        id: String,
        content: Vec<Block>,
    },

    /// Raw LaTeX that couldn't be semantically parsed — preserved verbatim.
    RawLatex {
        source: String,
        /// SVG fallback rendering for Word embedding.
        svg_fallback: Option<Vec<u8>>,
    },

    /// Horizontal rule / separator.
    HorizontalRule,

    /// Page break.
    PageBreak,

    /// Float barrier (\FloatBarrier).
    FloatBarrier,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HeadingNumbering {
    Numbered,
    Unnumbered,
    /// Specific override (e.g., "3.2.1").
    Custom(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TheoremKind {
    Theorem,
    Lemma,
    Corollary,
    Proposition,
    Definition,
    Example,
    Remark,
    Proof,
    Custom(String),
}

// ─── Inline Content ─────────────────────────────────────────────

/// Inline content is a sequence of inline elements, optimized with SmallVec
/// for the common case of short paragraphs.
pub type InlineContent = SmallVec<[Inline; 8]>;

/// An inline element within a paragraph or heading.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Inline {
    /// Plain text run.
    Text(String),

    /// Styled text run.
    Styled {
        style: CharacterStyle,
        content: Box<InlineContent>,
    },

    /// Inline math ($...$).
    InlineMath(String),

    /// Cross-reference (\ref, \eqref, \cite).
    Reference(Reference),

    /// Hyperlink.
    Link {
        url: String,
        title: Option<String>,
        content: Box<InlineContent>,
    },

    /// Inline image.
    Image {
        source: ImageSource,
        alt_text: Option<String>,
        width: Option<Dimension>,
        height: Option<Dimension>,
    },

    /// Footnote reference.
    FootnoteRef(String),

    /// Line break (\\).
    LineBreak,

    /// Non-breaking space (~).
    NonBreakingSpace,

    /// En-dash, em-dash, ellipsis, etc.
    SpecialChar(SpecialCharacter),

    /// Raw LaTeX inline command preserved verbatim.
    RawLatexInline(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SpecialCharacter {
    EnDash,
    EmDash,
    Ellipsis,
    LeftQuote,
    RightQuote,
    LeftDoubleQuote,
    RightDoubleQuote,
    Copyright,
    Registered,
    Trademark,
    Degree,
    Custom(String),
}

// ─── Figures ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Figure {
    pub placement: FloatPlacement,
    pub content: FigureContent,
    pub caption: Option<InlineContent>,
    pub label: Option<String>,
    pub width: Option<Dimension>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FigureContent {
    Single(ImageSource),
    SubFigures(Vec<SubFigure>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubFigure {
    pub source: ImageSource,
    pub caption: Option<InlineContent>,
    pub label: Option<String>,
    pub width: Dimension,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ImageSource {
    /// Path relative to the document root.
    File(String),
    /// Base64-encoded embedded image.
    Embedded { data: Vec<u8>, mime_type: String },
    /// URL.
    Url(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FloatPlacement {
    Here,           // [h]
    Top,            // [t]
    Bottom,         // [b]
    Page,           // [p]
    ForceHere,      // [H]
    HereTop,        // [ht]
    HereTopBottom,  // [htb]
    HereTopBottomPage, // [htbp]
    Custom(String),
}

// ─── Lists ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct List {
    pub kind: ListKind,
    pub items: Vec<ListItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ListKind {
    Ordered { start: Option<u32>, style: Option<String> },
    Unordered { marker: Option<String> },
    Description,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListItem {
    pub label: Option<InlineContent>,
    pub content: Vec<Block>,
}

// ─── References & Citations ─────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Reference {
    CrossRef { label: String, kind: RefKind },
    Citation(Citation),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RefKind {
    Standard,  // \ref
    Equation,  // \eqref
    Page,      // \pageref
    Name,      // \nameref
    Auto,      // \autoref
    Clever,    // \cref
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub keys: Vec<String>,
    pub style: CitationStyle,
    pub prenote: Option<String>,
    pub postnote: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CitationStyle {
    Numeric,     // \cite
    AuthorYear,  // \citep, \citet
    Footnote,
    Custom(String),
}

// ─── Bibliography ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bibliography {
    pub style: String,
    pub entries: Vec<BibEntry>,
    pub raw_bib: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BibEntry {
    pub key: String,
    pub entry_type: String,
    pub fields: IndexMap<String, String>,
}

// ─── Appendices ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Appendix {
    pub title: InlineContent,
    pub label: Option<String>,
    pub content: Vec<Block>,
}

// ─── Algorithm ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AlgorithmContent {
    /// Pseudocode lines.
    Pseudocode(Vec<AlgorithmLine>),
    /// Raw algorithmic environment source.
    Raw(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlgorithmLine {
    pub indent: u8,
    pub kind: AlgorithmLineKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AlgorithmLineKind {
    Statement(InlineContent),
    If { condition: InlineContent },
    ElseIf { condition: InlineContent },
    Else,
    EndIf,
    For { condition: InlineContent },
    EndFor,
    While { condition: InlineContent },
    EndWhile,
    Return(InlineContent),
    Comment(String),
}

// ─── Anchor Metadata Store ──────────────────────────────────────

/// Stores the original source mapping for every SIR node, enabling
/// lossless round-trip conversion via the "Anchor Metadata" strategy.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AnchorStore {
    /// Map from SIR node ID to its original source representation.
    pub anchors: IndexMap<NodeId, AnchorData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnchorData {
    /// Original raw LaTeX source for this node.
    pub latex_source: Option<String>,

    /// Original OOXML fragment (as XML string) for this node.
    pub ooxml_fragment: Option<String>,

    /// Hash of the content at time of anchoring, for change detection.
    pub content_hash: u64,

    /// Source file and line range.
    pub location: Option<SourceLocation>,
}

impl AnchorStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, node_id: NodeId, data: AnchorData) {
        self.anchors.insert(node_id, data);
    }

    pub fn get(&self, node_id: &NodeId) -> Option<&AnchorData> {
        self.anchors.get(node_id)
    }

    /// Returns node IDs whose content has changed since anchoring.
    pub fn diff_against(&self, other: &AnchorStore) -> Vec<NodeId> {
        let mut changed = Vec::new();
        for (id, data) in &self.anchors {
            match other.anchors.get(id) {
                Some(other_data) if other_data.content_hash != data.content_hash => {
                    changed.push(id.clone());
                }
                None => {
                    changed.push(id.clone());
                }
                _ => {}
            }
        }
        changed
    }
}

impl SirDocument {
    /// Create a new empty SIR document.
    pub fn new(template_class: &str) -> Self {
        SirDocument {
            id: Uuid::new_v4(),
            metadata: DocumentMetadata::default(),
            template: TemplateBinding {
                latex_class: template_class.to_string(),
                class_options: Vec::new(),
                dotx_template: None,
            },
            preamble: Preamble {
                packages: Vec::new(),
                custom_commands: Vec::new(),
                custom_environments: Vec::new(),
                raw_lines: Vec::new(),
            },
            page_layout: PageLayout {
                paper_size: PaperSize::Letter,
                margins: Margins {
                    top_mm: 25.4,
                    bottom_mm: 25.4,
                    left_mm: 25.4,
                    right_mm: 25.4,
                },
                columns: ColumnLayout::Single,
                header_footer: None,
                line_spacing: LineSpacing::Single,
            },
            body: Vec::new(),
            bibliography: None,
            appendices: Vec::new(),
            anchor_store: AnchorStore::new(),
        }
    }

    /// Add a block to the document body and return its node ID.
    pub fn push_block(&mut self, kind: BlockKind, source: SourceOrigin) -> NodeId {
        let id = NodeId::new();
        self.body.push(Block {
            id: id.clone(),
            kind,
            source,
        });
        id
    }
}
