//! Shared types used throughout the SIR model.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Unique identifier for SIR nodes, used for anchor metadata tracking.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct NodeId(pub Uuid);

impl NodeId {
    pub fn new() -> Self {
        NodeId(Uuid::new_v4())
    }
}

impl Default for NodeId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for NodeId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Physical dimension with unit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Dimension {
    /// Millimeters (absolute).
    Mm(f64),
    /// Points (1pt = 1/72 inch).
    Pt(f64),
    /// Centimeters.
    Cm(f64),
    /// Inches.
    In(f64),
    /// Relative to text width (0.0 - 1.0).
    TextWidth(f64),
    /// Relative to line width.
    LineWidth(f64),
    /// Relative to column width.
    ColumnWidth(f64),
    /// Em units.
    Em(f64),
    /// Ex units.
    Ex(f64),
    /// Pixels (for screen rendering).
    Px(f64),
}

impl Dimension {
    /// Convert to millimeters (approximate for relative units).
    pub fn to_mm(&self, context_width_mm: f64) -> f64 {
        match self {
            Dimension::Mm(v) => *v,
            Dimension::Pt(v) => v * 0.352778,
            Dimension::Cm(v) => v * 10.0,
            Dimension::In(v) => v * 25.4,
            Dimension::TextWidth(v) => v * context_width_mm,
            Dimension::LineWidth(v) => v * context_width_mm,
            Dimension::ColumnWidth(v) => v * context_width_mm,
            Dimension::Em(v) => v * 4.233, // Approximate: 1em ≈ 12pt ≈ 4.233mm
            Dimension::Ex(v) => v * 1.94,  // Approximate
            Dimension::Px(v) => v * 0.264583, // 96 DPI
        }
    }

    /// Convert to EMUs (English Metric Units) for OOXML. 1 EMU = 1/914400 inch.
    pub fn to_emu(&self, context_width_mm: f64) -> i64 {
        let mm = self.to_mm(context_width_mm);
        (mm * 36000.0) as i64
    }

    /// Convert to half-points for OOXML font sizes.
    pub fn to_half_points(&self, _context_width_mm: f64) -> u32 {
        match self {
            Dimension::Pt(v) => (v * 2.0) as u32,
            other => {
                let mm = other.to_mm(170.0); // default text width
                let pt = mm / 0.352778;
                (pt * 2.0) as u32
            }
        }
    }
}

/// Tracks the origin of a SIR node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SourceOrigin {
    /// From a LaTeX source file.
    Latex(SourceLocation),
    /// From an OOXML document.
    Ooxml { part_uri: String, element_id: Option<String> },
    /// Generated during transformation.
    Synthetic,
}

/// File location reference.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceLocation {
    pub file: String,
    pub line_start: u32,
    pub line_end: u32,
    pub col_start: u32,
    pub col_end: u32,
}
