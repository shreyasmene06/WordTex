//! Unified conversion pipeline: LaTeX → MathML → OMML and reverse.

use crate::latex_to_mathml;
use crate::mathml_to_omml;
use crate::omml_to_mathml;
use crate::mathml_to_latex;

/// Result of a math conversion.
#[derive(Debug, Clone)]
pub struct MathConversionResult {
    /// The LaTeX source.
    pub latex: String,
    /// The MathML representation.
    pub mathml: String,
    /// The OMML representation.
    pub omml: String,
    /// Whether this is a display equation.
    pub is_display: bool,
}

/// Convert LaTeX math to both MathML and OMML.
pub fn latex_to_all(latex: &str, display: bool) -> MathConversionResult {
    let mathml_output = latex_to_mathml::latex_to_mathml(latex, display);
    let omml = mathml_to_omml::mathml_to_omml(&mathml_output.mathml);

    MathConversionResult {
        latex: latex.to_string(),
        mathml: mathml_output.mathml,
        omml,
        is_display: display,
    }
}

/// Convert OMML to both MathML and LaTeX.
pub fn omml_to_all(omml: &str) -> MathConversionResult {
    let mathml = omml_to_mathml::omml_to_mathml(omml);
    let latex = mathml_to_latex::mathml_to_latex(&mathml);

    MathConversionResult {
        latex,
        mathml,
        omml: omml.to_string(),
        is_display: true,
    }
}

/// Convert MathML to both LaTeX and OMML.
pub fn mathml_to_all(mathml: &str) -> MathConversionResult {
    let latex = mathml_to_latex::mathml_to_latex(mathml);
    let omml = mathml_to_omml::mathml_to_omml(mathml);

    MathConversionResult {
        latex,
        mathml: mathml.to_string(),
        omml,
        is_display: true,
    }
}

/// Validate round-trip fidelity: LaTeX → MathML → LaTeX.
pub fn validate_roundtrip(latex: &str) -> RoundtripResult {
    let mathml_output = latex_to_mathml::latex_to_mathml(latex, false);
    let recovered = mathml_to_latex::mathml_to_latex(&mathml_output.mathml);

    let normalized_original = normalize_latex(latex);
    let normalized_recovered = normalize_latex(&recovered);

    RoundtripResult {
        original: latex.to_string(),
        intermediate_mathml: mathml_output.mathml,
        recovered,
        is_equivalent: normalized_original == normalized_recovered,
    }
}

#[derive(Debug)]
pub struct RoundtripResult {
    pub original: String,
    pub intermediate_mathml: String,
    pub recovered: String,
    pub is_equivalent: bool,
}

fn normalize_latex(latex: &str) -> String {
    latex
        .replace(' ', "")
        .replace("\\left", "")
        .replace("\\right", "")
        .replace("{", "")
        .replace("}", "")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_latex_to_all() {
        let result = latex_to_all("\\frac{a}{b}", true);
        assert!(!result.mathml.is_empty());
        assert!(!result.omml.is_empty());
        assert!(result.is_display);
    }

    #[test]
    fn test_roundtrip_simple() {
        let result = validate_roundtrip("x^{2}");
        // The round trip may not be perfect but should produce valid output
        assert!(!result.intermediate_mathml.is_empty());
        assert!(!result.recovered.is_empty());
    }
}
