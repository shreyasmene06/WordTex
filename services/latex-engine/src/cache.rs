//! Compilation cache for pre-compiled preambles and frequently used outputs.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Manages cached compiled artifacts.
pub struct CompilationCache {
    cache_dir: PathBuf,
    /// In-memory index of cached preamble hashes.
    preamble_index: Arc<RwLock<HashMap<String, CacheEntry>>>,
}

#[derive(Debug, Clone)]
struct CacheEntry {
    fmt_path: PathBuf,
    created_at: std::time::SystemTime,
    size_bytes: u64,
    hit_count: u64,
}

impl CompilationCache {
    pub fn new(cache_dir: &str) -> Self {
        Self {
            cache_dir: PathBuf::from(cache_dir),
            preamble_index: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn get_fmt(&self, preamble_hash: &str) -> Option<PathBuf> {
        let index = self.preamble_index.read().await;
        index.get(preamble_hash).map(|e| e.fmt_path.clone())
    }

    pub async fn store_fmt(&self, preamble_hash: &str, fmt_path: &Path) {
        let size = tokio::fs::metadata(fmt_path)
            .await
            .map(|m| m.len())
            .unwrap_or(0);

        let entry = CacheEntry {
            fmt_path: fmt_path.to_path_buf(),
            created_at: std::time::SystemTime::now(),
            size_bytes: size,
            hit_count: 0,
        };

        let mut index = self.preamble_index.write().await;
        index.insert(preamble_hash.to_string(), entry);
    }

    pub async fn evict_old_entries(&self, max_age_secs: u64) {
        let now = std::time::SystemTime::now();
        let mut index = self.preamble_index.write().await;

        index.retain(|_, entry| {
            if let Ok(age) = now.duration_since(entry.created_at) {
                age.as_secs() < max_age_secs
            } else {
                false
            }
        });
    }

    pub async fn total_cache_size(&self) -> u64 {
        let index = self.preamble_index.read().await;
        index.values().map(|e| e.size_bytes).sum()
    }
}
