//! Structural diff engine for SIR documents.
//!
//! Used to detect which blocks changed during a round-trip, enabling
//! selective updates rather than wholesale regeneration.

use crate::model::document::*;
use crate::model::types::NodeId;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffReport {
    pub added: Vec<NodeId>,
    pub removed: Vec<NodeId>,
    pub modified: Vec<ModifiedNode>,
    pub unchanged: usize,
    pub total_original: usize,
    pub total_modified: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModifiedNode {
    pub node_id: NodeId,
    pub change_type: ChangeType,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ChangeType {
    ContentModified,
    StyleChanged,
    Reordered,
    StructuralChange,
}

/// Compute a structural diff between two SIR documents.
pub fn diff_documents(original: &SirDocument, modified: &SirDocument) -> DiffReport {
    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut modified_nodes = Vec::new();
    let mut unchanged = 0;

    // Build maps of node IDs → blocks
    let original_map: indexmap::IndexMap<&NodeId, &Block> =
        original.body.iter().map(|b| (&b.id, b)).collect();
    let modified_map: indexmap::IndexMap<&NodeId, &Block> =
        modified.body.iter().map(|b| (&b.id, b)).collect();

    // Find removed and modified blocks
    for (id, orig_block) in &original_map {
        if let Some(mod_block) = modified_map.get(id) {
            if blocks_structurally_equal(orig_block, mod_block) {
                unchanged += 1;
            } else {
                modified_nodes.push(ModifiedNode {
                    node_id: (*id).clone(),
                    change_type: classify_change(orig_block, mod_block),
                    description: describe_change(orig_block, mod_block),
                });
            }
        } else {
            removed.push((*id).clone());
        }
    }

    // Find added blocks
    for id in modified_map.keys() {
        if !original_map.contains_key(id) {
            added.push((*id).clone());
        }
    }

    DiffReport {
        added,
        removed,
        modified: modified_nodes,
        unchanged,
        total_original: original.body.len(),
        total_modified: modified.body.len(),
    }
}

/// Check if two blocks are structurally equivalent (ignoring IDs).
fn blocks_structurally_equal(a: &Block, b: &Block) -> bool {
    // Deep structural comparison using debug representation
    // In production, this would be a proper recursive comparator
    format!("{:?}", a.kind) == format!("{:?}", b.kind)
}

fn classify_change(original: &Block, modified: &Block) -> ChangeType {
    let orig_kind = std::mem::discriminant(&original.kind);
    let mod_kind = std::mem::discriminant(&modified.kind);

    if orig_kind != mod_kind {
        ChangeType::StructuralChange
    } else {
        ChangeType::ContentModified
    }
}

fn describe_change(original: &Block, modified: &Block) -> String {
    match (&original.kind, &modified.kind) {
        (BlockKind::Paragraph { .. }, BlockKind::Paragraph { .. }) => {
            "Paragraph content modified".to_string()
        }
        (BlockKind::Heading { depth: d1, .. }, BlockKind::Heading { depth: d2, .. }) => {
            if d1 != d2 {
                format!("Heading level changed from {} to {}", d1, d2)
            } else {
                "Heading content modified".to_string()
            }
        }
        (BlockKind::MathBlock { .. }, BlockKind::MathBlock { .. }) => {
            "Mathematical content modified".to_string()
        }
        _ => "Block modified".to_string(),
    }
}

/// Apply a selective update: only regenerate blocks that changed.
pub fn apply_selective_update(
    original_tex: &SirDocument,
    modified_ooxml: &SirDocument,
    diff: &DiffReport,
) -> SirDocument {
    let mut result = original_tex.clone();

    // For modified blocks, take the new version
    let modified_map: indexmap::IndexMap<&NodeId, &Block> =
        modified_ooxml.body.iter().map(|b| (&b.id, b)).collect();

    for modified_node in &diff.modified {
        if let Some(new_block) = modified_map.get(&modified_node.node_id) {
            // Find and replace in result
            for block in &mut result.body {
                if block.id == modified_node.node_id {
                    block.kind = new_block.kind.clone();
                    break;
                }
            }
        }
    }

    // Add new blocks
    for added_id in &diff.added {
        if let Some(new_block) = modified_map.get(added_id) {
            result.body.push((*new_block).clone());
        }
    }

    // Remove deleted blocks
    let removed_set: std::collections::HashSet<&NodeId> = diff.removed.iter().collect();
    result.body.retain(|b| !removed_set.contains(&b.id));

    result
}
