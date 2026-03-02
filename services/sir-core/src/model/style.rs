//! Style definitions for the SIR model, mapping between LaTeX formatting
//! commands and OOXML run/paragraph properties.

use serde::{Deserialize, Serialize};

/// Character-level (run) styling.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CharacterStyle {
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<UnderlineStyle>,
    pub strikethrough: Option<bool>,
    pub superscript: Option<bool>,
    pub subscript: Option<bool>,
    pub small_caps: Option<bool>,
    pub font_family: Option<String>,
    pub font_size_pt: Option<f64>,
    pub color: Option<Color>,
    pub highlight: Option<Color>,
    pub tracking: Option<f64>,  // Letter spacing in points

    /// Named style ID (for OOXML style references).
    pub named_style: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum UnderlineStyle {
    Single,
    Double,
    Wavy,
    Dotted,
    Dashed,
    None,
}

/// Paragraph-level styling.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ParagraphStyle {
    pub alignment: Option<Alignment>,
    pub indent_first_line_pt: Option<f64>,
    pub indent_left_pt: Option<f64>,
    pub indent_right_pt: Option<f64>,
    pub space_before_pt: Option<f64>,
    pub space_after_pt: Option<f64>,
    pub line_spacing: Option<f64>,
    pub keep_with_next: Option<bool>,
    pub keep_lines_together: Option<bool>,
    pub page_break_before: Option<bool>,

    /// Named paragraph style (e.g., "Heading1", "BodyText").
    pub named_style: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Alignment {
    Left,
    Center,
    Right,
    Justify,
}

/// Color representation supporting various formats.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Color {
    /// RGB hex (e.g., "FF0000" for red).
    Hex(String),
    /// Named color.
    Named(String),
    /// CMYK values (0.0 - 1.0).
    Cmyk { c: f64, m: f64, y: f64, k: f64 },
}

impl Color {
    /// Convert to 6-digit hex string (OOXML format).
    pub fn to_hex(&self) -> String {
        match self {
            Color::Hex(h) => h.clone(),
            Color::Named(name) => named_color_to_hex(name),
            Color::Cmyk { c, m, y, k } => {
                let r = (255.0 * (1.0 - c) * (1.0 - k)) as u8;
                let g = (255.0 * (1.0 - m) * (1.0 - k)) as u8;
                let b = (255.0 * (1.0 - y) * (1.0 - k)) as u8;
                format!("{:02X}{:02X}{:02X}", r, g, b)
            }
        }
    }
}

fn named_color_to_hex(name: &str) -> String {
    match name.to_lowercase().as_str() {
        "black" => "000000",
        "white" => "FFFFFF",
        "red" => "FF0000",
        "green" => "00FF00",
        "blue" => "0000FF",
        "yellow" => "FFFF00",
        "cyan" => "00FFFF",
        "magenta" => "FF00FF",
        "gray" | "grey" => "808080",
        "darkgray" | "darkgrey" => "404040",
        "lightgray" | "lightgrey" => "C0C0C0",
        "orange" => "FF8000",
        "purple" => "800080",
        "brown" => "804000",
        _ => "000000", // Default to black for unknown
    }
    .to_string()
}
