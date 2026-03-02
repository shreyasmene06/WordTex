use anyhow::Result;

#[derive(Debug, Clone)]
pub struct Config {
    pub grpc_port: u16,
    pub texlive_path: String,
    pub cache_dir: String,
    pub sandbox_enabled: bool,
    pub max_compile_time_secs: u64,
    pub max_memory_mb: u64,
    pub shell_escape: bool,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Config {
            grpc_port: std::env::var("GRPC_PORT")
                .unwrap_or_else(|_| "50052".to_string())
                .parse()?,
            texlive_path: std::env::var("TEXLIVE_PATH")
                .unwrap_or_else(|_| "/usr/local/texlive".to_string()),
            cache_dir: std::env::var("CACHE_DIR")
                .unwrap_or_else(|_| "/tmp/wordtex-latex-cache".to_string()),
            sandbox_enabled: std::env::var("SANDBOX_ENABLED")
                .unwrap_or_else(|_| "true".to_string())
                .parse()?,
            max_compile_time_secs: std::env::var("MAX_COMPILE_TIME_SECS")
                .unwrap_or_else(|_| "120".to_string())
                .parse()?,
            max_memory_mb: std::env::var("MAX_MEMORY_MB")
                .unwrap_or_else(|_| "2048".to_string())
                .parse()?,
            shell_escape: false, // NEVER enable in production
        })
    }
}
