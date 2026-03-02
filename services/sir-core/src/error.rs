//! Error types for the SIR Core.

use thiserror::Error;

pub type SirResult<T> = Result<T, SirError>;

#[derive(Debug, Error)]
pub enum SirError {
    #[error("LaTeX parsing error at {location}: {message}")]
    LatexParse {
        message: String,
        location: String,
    },

    #[error("OOXML parsing error in part '{part}': {message}")]
    OoxmlParse {
        message: String,
        part: String,
    },

    #[error("Math conversion error: {0}")]
    MathConversion(String),

    #[error("Template not found: {class_name}")]
    TemplateNotFound {
        class_name: String,
    },

    #[error("Anchor metadata mismatch: node {node_id} — {message}")]
    AnchorMismatch {
        node_id: String,
        message: String,
    },

    #[error("Round-trip validation failed: {0}")]
    RoundTripValidation(String),

    #[error("Unsupported feature: {0}")]
    Unsupported(String),

    #[error("Transformation error: {0}")]
    Transform(String),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("XML processing error: {0}")]
    Xml(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Queue error: {0}")]
    Queue(String),

    #[error("Cache error: {0}")]
    Cache(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl SirError {
    /// Returns an HTTP-friendly error code.
    pub fn status_code(&self) -> u16 {
        match self {
            SirError::LatexParse { .. } | SirError::OoxmlParse { .. } => 400,
            SirError::TemplateNotFound { .. } => 404,
            SirError::Unsupported(_) => 422,
            _ => 500,
        }
    }

    /// Returns a machine-readable error type string.
    pub fn error_type(&self) -> &'static str {
        match self {
            SirError::LatexParse { .. } => "LATEX_PARSE_ERROR",
            SirError::OoxmlParse { .. } => "OOXML_PARSE_ERROR",
            SirError::MathConversion(_) => "MATH_CONVERSION_ERROR",
            SirError::TemplateNotFound { .. } => "TEMPLATE_NOT_FOUND",
            SirError::AnchorMismatch { .. } => "ANCHOR_MISMATCH",
            SirError::RoundTripValidation(_) => "ROUND_TRIP_VALIDATION",
            SirError::Unsupported(_) => "UNSUPPORTED_FEATURE",
            SirError::Transform(_) => "TRANSFORM_ERROR",
            SirError::Serialization(_) => "SERIALIZATION_ERROR",
            SirError::Xml(_) => "XML_ERROR",
            SirError::Io(_) => "IO_ERROR",
            SirError::Queue(_) => "QUEUE_ERROR",
            SirError::Cache(_) => "CACHE_ERROR",
            SirError::Internal(_) => "INTERNAL_ERROR",
        }
    }
}
