//! Mathematical environment representations in SIR.

use serde::{Deserialize, Serialize};

/// A mathematical environment containing one or more equations or expressions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MathEnvironment {
    /// The type of math environment.
    pub kind: MathEnvKind,

    /// The raw LaTeX source of the math content (always preserved).
    pub latex_source: String,

    /// MathML representation (canonical intermediate form).
    pub mathml: Option<String>,

    /// Office Math Markup Language (for Word).
    pub omml: Option<String>,

    /// Whether this equation is numbered.
    pub numbered: bool,

    /// Equation number override (if any).
    pub number_override: Option<String>,
}

/// The specific type of math environment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum MathEnvKind {
    /// Standard display equation: \[ ... \] or equation
    Equation,
    /// equation* (unnumbered)
    EquationStar,
    /// align environment (numbered)
    Align,
    /// align* (unnumbered)
    AlignStar,
    /// gather environment
    Gather,
    /// gather*
    GatherStar,
    /// multline
    Multline,
    /// multline*
    MultlineStar,
    /// split (used inside equation)
    Split,
    /// cases
    Cases,
    /// array
    Array,
    /// matrix environments
    Matrix(MatrixKind),
    /// flalign
    Flalign,
    /// alignat{n}
    Alignat { columns: u32 },
    /// subequations wrapper
    SubEquations { children: Vec<MathEnvironment> },
    /// Custom / unknown environment (preserved verbatim)
    Custom(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum MatrixKind {
    Plain,    // matrix
    Parens,   // pmatrix
    Brackets, // bmatrix
    Braces,   // Bmatrix
    Vbar,     // vmatrix
    DoubleVbar, // Vmatrix
    Small,    // smallmatrix
}

impl MathEnvironment {
    /// Create a new math environment from LaTeX source.
    pub fn from_latex(kind: MathEnvKind, source: String) -> Self {
        let numbered = matches!(
            kind,
            MathEnvKind::Equation
                | MathEnvKind::Align
                | MathEnvKind::Gather
                | MathEnvKind::Multline
                | MathEnvKind::Flalign
                | MathEnvKind::Alignat { .. }
        );

        MathEnvironment {
            kind,
            latex_source: source,
            mathml: None,
            omml: None,
            numbered,
            number_override: None,
        }
    }

    /// Returns the LaTeX environment name for this math block.
    pub fn env_name(&self) -> &str {
        match &self.kind {
            MathEnvKind::Equation => "equation",
            MathEnvKind::EquationStar => "equation*",
            MathEnvKind::Align => "align",
            MathEnvKind::AlignStar => "align*",
            MathEnvKind::Gather => "gather",
            MathEnvKind::GatherStar => "gather*",
            MathEnvKind::Multline => "multline",
            MathEnvKind::MultlineStar => "multline*",
            MathEnvKind::Split => "split",
            MathEnvKind::Cases => "cases",
            MathEnvKind::Array => "array",
            MathEnvKind::Matrix(kind) => match kind {
                MatrixKind::Plain => "matrix",
                MatrixKind::Parens => "pmatrix",
                MatrixKind::Brackets => "bmatrix",
                MatrixKind::Braces => "Bmatrix",
                MatrixKind::Vbar => "vmatrix",
                MatrixKind::DoubleVbar => "Vmatrix",
                MatrixKind::Small => "smallmatrix",
            },
            MathEnvKind::Flalign => "flalign",
            MathEnvKind::Alignat { .. } => "alignat",
            MathEnvKind::SubEquations { .. } => "subequations",
            MathEnvKind::Custom(name) => name,
        }
    }
}
