//! Document metadata model.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use super::document::InlineContent;

/// Document-level metadata.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DocumentMetadata {
    pub title: Option<InlineContent>,
    pub authors: Vec<Author>,
    pub date: Option<String>,
    pub r#abstract: Option<Vec<InlineContent>>,
    pub keywords: Vec<String>,
    pub subject: Option<String>,
    pub language: Option<String>,

    /// Arbitrary key-value metadata that doesn't fit standard fields.
    pub custom: IndexMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Author {
    pub name: String,
    pub affiliations: Vec<Affiliation>,
    pub email: Option<String>,
    pub orcid: Option<String>,
    pub corresponding: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Affiliation {
    pub institution: String,
    pub department: Option<String>,
    pub address: Option<String>,
}
