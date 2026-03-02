//! Full-fidelity table model supporting multirow, multicolumn, cell merges,
//! borders, and complex academic table layouts.

use serde::{Deserialize, Serialize};

use super::document::InlineContent;
use super::style::{Alignment, Color, ParagraphStyle};
use super::types::Dimension;

/// A table with full academic formatting support.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Table {
    /// Caption (typically above table in academic docs).
    pub caption: Option<InlineContent>,

    /// Label for cross-referencing.
    pub label: Option<String>,

    /// Float placement specifier.
    pub placement: Option<String>,

    /// Column specifications.
    pub columns: Vec<ColumnSpec>,

    /// Table header rows (repeat on page break in Word).
    pub header_rows: Vec<TableRow>,

    /// Table body rows.
    pub body_rows: Vec<TableRow>,

    /// Table footer rows.
    pub footer_rows: Vec<TableRow>,

    /// Horizontal rules configuration (booktabs style).
    pub rules: TableRules,

    /// Overall table width.
    pub width: Option<Dimension>,

    /// Whether to use booktabs-style formatting.
    pub booktabs: bool,
}

/// Column specification from LaTeX tabular/table environments.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnSpec {
    pub alignment: ColumnAlignment,
    pub width: Option<Dimension>,
    pub left_border: Option<BorderStyle>,
    pub right_border: Option<BorderStyle>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ColumnAlignment {
    Left,      // l
    Center,    // c
    Right,     // r
    Paragraph(Dimension), // p{width}
    Custom(String),        // >{...}c<{...}
}

/// A table row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableRow {
    pub cells: Vec<TableCell>,
    pub top_rule: Option<RuleStyle>,
    pub bottom_rule: Option<RuleStyle>,
    pub height: Option<Dimension>,
}

/// A table cell with merge support.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableCell {
    pub content: Vec<InlineContent>,
    pub paragraph_style: Option<ParagraphStyle>,

    /// Number of columns this cell spans (1 = normal).
    pub col_span: u32,

    /// Number of rows this cell spans (1 = normal).
    pub row_span: u32,

    /// Whether this is a continuation of a multirow cell above.
    pub is_multirow_continuation: bool,

    /// Cell-level alignment override.
    pub alignment: Option<Alignment>,

    /// Cell background color.
    pub background: Option<Color>,

    /// Individual cell borders.
    pub borders: Option<CellBorders>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CellBorders {
    pub top: Option<BorderStyle>,
    pub bottom: Option<BorderStyle>,
    pub left: Option<BorderStyle>,
    pub right: Option<BorderStyle>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BorderStyle {
    pub width_pt: f64,
    pub color: Option<Color>,
    pub style: BorderLineStyle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BorderLineStyle {
    Solid,
    Dashed,
    Dotted,
    Double,
    None,
}

/// Horizontal rule configuration for tables.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TableRules {
    /// Heavy top rule (booktabs \toprule).
    pub top_rule: Option<RuleStyle>,
    /// Heavy bottom rule (booktabs \bottomrule).
    pub bottom_rule: Option<RuleStyle>,
    /// Mid rules (booktabs \midrule, \cmidrule).
    pub mid_rules: Vec<MidRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleStyle {
    pub width_pt: f64,
    pub color: Option<Color>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MidRule {
    /// Row index after which this rule appears.
    pub after_row: usize,
    /// Column range (start, end) inclusive. None = full width.
    pub col_range: Option<(usize, usize)>,
    /// Trim left/right of cmidrule.
    pub trim: Option<CmidruleTrim>,
    pub style: RuleStyle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CmidruleTrim {
    pub left: bool,
    pub right: bool,
}

impl TableCell {
    pub fn simple(content: InlineContent) -> Self {
        TableCell {
            content: vec![content],
            paragraph_style: None,
            col_span: 1,
            row_span: 1,
            is_multirow_continuation: false,
            alignment: None,
            background: None,
            borders: None,
        }
    }
}
