//! Sandbox configuration for secure LaTeX compilation.
//!
//! Uses Linux namespaces and seccomp (via container runtimes like gVisor)
//! to isolate the TeX compilation process.

use serde::{Deserialize, Serialize};

/// Sandbox policy for LaTeX compilation containers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxPolicy {
    /// Maximum CPU time in seconds.
    pub max_cpu_secs: u64,
    /// Maximum memory in bytes.
    pub max_memory_bytes: u64,
    /// Maximum output file size in bytes.
    pub max_output_bytes: u64,
    /// Maximum number of processes.
    pub max_processes: u32,
    /// Whether network access is allowed (should always be false).
    pub network_enabled: bool,
    /// Allowed filesystem paths (read-only).
    pub readonly_paths: Vec<String>,
    /// Writable paths (work directory only).
    pub writable_paths: Vec<String>,
    /// Blocked syscalls.
    pub blocked_syscalls: Vec<String>,
}

impl Default for SandboxPolicy {
    fn default() -> Self {
        SandboxPolicy {
            max_cpu_secs: 120,
            max_memory_bytes: 2 * 1024 * 1024 * 1024, // 2GB
            max_output_bytes: 500 * 1024 * 1024,        // 500MB
            max_processes: 50,
            network_enabled: false,
            readonly_paths: vec![
                "/usr/local/texlive".to_string(),
                "/usr/share/fonts".to_string(),
            ],
            writable_paths: vec![
                "/tmp".to_string(),
            ],
            blocked_syscalls: vec![
                "execve".to_string(),  // Block spawning of child processes beyond TeX
                "socket".to_string(),  // Block network sockets
                "connect".to_string(),
                "bind".to_string(),
                "listen".to_string(),
                "accept".to_string(),
                "sendto".to_string(),
                "recvfrom".to_string(),
                "ptrace".to_string(),
                "mount".to_string(),
                "umount".to_string(),
                "pivot_root".to_string(),
            ],
        }
    }
}

/// Generate a seccomp profile JSON for the sandbox.
pub fn generate_seccomp_profile(policy: &SandboxPolicy) -> String {
    serde_json::json!({
        "defaultAction": "SCMP_ACT_ALLOW",
        "syscalls": policy.blocked_syscalls.iter().map(|sc| {
            serde_json::json!({
                "names": [sc],
                "action": "SCMP_ACT_ERRNO",
                "errnoRet": 1
            })
        }).collect::<Vec<_>>()
    })
    .to_string()
}

/// Generate a gVisor runsc configuration snippet.
pub fn generate_gvisor_config(policy: &SandboxPolicy) -> String {
    format!(
        r#"{{
    "network": "none",
    "overlay": true,
    "strace": false,
    "debug": false,
    "rlimits": {{
        "RLIMIT_CPU": {{"cur": {max_cpu}, "max": {max_cpu}}},
        "RLIMIT_AS": {{"cur": {max_mem}, "max": {max_mem}}},
        "RLIMIT_FSIZE": {{"cur": {max_out}, "max": {max_out}}},
        "RLIMIT_NPROC": {{"cur": {max_procs}, "max": {max_procs}}}
    }}
}}"#,
        max_cpu = policy.max_cpu_secs,
        max_mem = policy.max_memory_bytes,
        max_out = policy.max_output_bytes,
        max_procs = policy.max_processes,
    )
}
