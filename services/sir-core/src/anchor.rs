//! Anchor metadata management for lossless round-trip conversion.
//!
//! Handles embedding and extracting anchor data in Custom XML Parts
//! within .docx files, enabling the "Round-Trip Anchor Metadata" strategy.

use crate::error::{SirError, SirResult};
use crate::model::document::AnchorStore;

/// Serialize anchor store to Custom XML Part format for embedding in .docx.
pub fn serialize_anchors(store: &AnchorStore) -> SirResult<String> {
    let json = serde_json::to_string(store)?;

    let mut xml = String::new();
    xml.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#);
    xml.push('\n');
    xml.push_str(r#"<wordtex:anchors xmlns:wordtex="http://wordtex.io/schema/anchors/v1" "#);
    xml.push_str(r#"version="1.0">"#);
    xml.push('\n');

    // Store as base64-encoded JSON in CDATA to avoid XML escaping issues
    let encoded = base64_encode(json.as_bytes());
    xml.push_str(&format!("  <wordtex:data encoding=\"base64\">{}</wordtex:data>\n", encoded));
    xml.push_str("</wordtex:anchors>");

    Ok(xml)
}

/// Deserialize anchor store from Custom XML Part extracted from .docx.
pub fn deserialize_anchors(xml: &str) -> SirResult<AnchorStore> {
    // Extract data element content
    let data_start = xml.find("<wordtex:data")
        .ok_or_else(|| SirError::AnchorMismatch {
            node_id: "N/A".to_string(),
            message: "No anchor data element found".to_string(),
        })?;

    let content_start = xml[data_start..]
        .find('>')
        .map(|i| data_start + i + 1)
        .ok_or_else(|| SirError::AnchorMismatch {
            node_id: "N/A".to_string(),
            message: "Malformed anchor data element".to_string(),
        })?;

    let content_end = xml[content_start..]
        .find("</wordtex:data>")
        .map(|i| content_start + i)
        .ok_or_else(|| SirError::AnchorMismatch {
            node_id: "N/A".to_string(),
            message: "Unclosed anchor data element".to_string(),
        })?;

    let content = &xml[content_start..content_end];

    // Check encoding
    let is_base64 = xml[data_start..content_start].contains("base64");

    let json_str = if is_base64 {
        let decoded = base64_decode(content.trim())?;
        String::from_utf8(decoded).map_err(|e| SirError::AnchorMismatch {
            node_id: "N/A".to_string(),
            message: format!("Invalid UTF-8 in anchor data: {}", e),
        })?
    } else if content.starts_with("<![CDATA[") {
        content
            .strip_prefix("<![CDATA[")
            .and_then(|s| s.strip_suffix("]]>"))
            .unwrap_or(content)
            .to_string()
    } else {
        content.to_string()
    };

    let store: AnchorStore = serde_json::from_str(&json_str)?;
    Ok(store)
}

/// Extract Custom XML Parts from a .docx zip file and find anchor data.
pub fn extract_anchors_from_docx(docx_bytes: &[u8]) -> SirResult<Option<AnchorStore>> {
    // In production, this would use a zip library to:
    // 1. Open the .docx as a zip
    // 2. Look for customXml/item*.xml parts
    // 3. Find the one with our namespace
    // 4. Deserialize it

    // For now, return None (no anchors found)
    Ok(None)
}

/// Inject anchor metadata into an existing .docx file.
pub fn inject_anchors_into_docx(
    docx_bytes: &[u8],
    store: &AnchorStore,
) -> SirResult<Vec<u8>> {
    let anchor_xml = serialize_anchors(store)?;

    // In production, this would:
    // 1. Open the .docx as a zip
    // 2. Add/replace customXml/item1.xml with our anchor data
    // 3. Update [Content_Types].xml to register the custom part
    // 4. Update .rels to create a relationship
    // 5. Re-zip and return

    // Placeholder: return original bytes
    Ok(docx_bytes.to_vec())
}

// ─── Base64 Helpers ─────────────────────────────────────────────

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);

    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };

        let triple = (b0 << 16) | (b1 << 8) | b2;

        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);

        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }

        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }

    result
}

fn base64_decode(data: &str) -> SirResult<Vec<u8>> {
    fn char_to_val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let bytes: Vec<u8> = data.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let mut result = Vec::with_capacity(bytes.len() * 3 / 4);

    for chunk in bytes.chunks(4) {
        if chunk.len() < 2 {
            break;
        }

        let a = char_to_val(chunk[0]).unwrap_or(0) as u32;
        let b = char_to_val(chunk[1]).unwrap_or(0) as u32;
        let c = if chunk.len() > 2 && chunk[2] != b'=' {
            char_to_val(chunk[2]).unwrap_or(0) as u32
        } else {
            0
        };
        let d = if chunk.len() > 3 && chunk[3] != b'=' {
            char_to_val(chunk[3]).unwrap_or(0) as u32
        } else {
            0
        };

        let triple = (a << 18) | (b << 12) | (c << 6) | d;

        result.push(((triple >> 16) & 0xFF) as u8);
        if chunk.len() > 2 && chunk[2] != b'=' {
            result.push(((triple >> 8) & 0xFF) as u8);
        }
        if chunk.len() > 3 && chunk[3] != b'=' {
            result.push((triple & 0xFF) as u8);
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base64_roundtrip() {
        let original = b"Hello, WorldTex! \xc3\xa9\xc3\xa0";
        let encoded = base64_encode(original);
        let decoded = base64_decode(&encoded).unwrap();
        assert_eq!(original.as_slice(), decoded.as_slice());
    }

    #[test]
    fn test_anchor_serialization_roundtrip() {
        let mut store = AnchorStore::new();
        use crate::model::document::AnchorData;
        use crate::model::types::NodeId;

        store.insert(
            NodeId::new(),
            AnchorData {
                latex_source: Some("\\section{Test}".to_string()),
                ooxml_fragment: None,
                content_hash: 12345,
                location: None,
            },
        );

        let xml = serialize_anchors(&store).unwrap();
        let restored = deserialize_anchors(&xml).unwrap();
        assert_eq!(store.anchors.len(), restored.anchors.len());
    }
}
