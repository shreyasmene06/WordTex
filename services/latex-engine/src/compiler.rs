//! LaTeX compiler wrapper.
//!
//! Manages headless TeX compilation using xelatex/lualatex with latexmk
//! for cross-reference resolution, caching of pre-compiled preambles,
//! and structured error reporting.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use sha2::{Sha256, Digest};
use tempfile::TempDir;
use thiserror::Error;
use tokio::process::Command;
use tokio::time::timeout;

use crate::config::Config;

#[derive(Debug, Error)]
pub enum CompilerError {
    #[error("LaTeX compilation failed: {message}")]
    CompilationFailed { message: String, log: String },

    #[error("Compilation timed out after {seconds}s")]
    Timeout { seconds: u64 },

    #[error("Security violation: {0}")]
    SecurityViolation(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Missing TeX distribution at {0}")]
    MissingDistribution(String),
}

pub type CompilerResult<T> = Result<T, CompilerError>;

/// Supported TeX engines.
#[derive(Debug, Clone, Copy)]
pub enum TexEngine {
    XeLaTeX,
    LuaLaTeX,
    PdfLaTeX,
}

impl TexEngine {
    pub fn binary_name(&self) -> &str {
        match self {
            TexEngine::XeLaTeX => "xelatex",
            TexEngine::LuaLaTeX => "lualatex",
            TexEngine::PdfLaTeX => "pdflatex",
        }
    }
}

/// Output format of the compilation.
#[derive(Debug, Clone)]
pub enum CompileOutput {
    Pdf(Vec<u8>),
    Dvi(Vec<u8>),
}

/// Result of a compilation attempt.
#[derive(Debug)]
pub struct CompileResult {
    pub output: CompileOutput,
    pub log: String,
    pub warnings: Vec<String>,
    pub pages: u32,
    pub duration_ms: u64,
}

/// The LaTeX compiler.
pub struct LatexCompiler {
    config: Config,
}

impl LatexCompiler {
    pub fn new(config: &Config) -> Self {
        Self {
            config: config.clone(),
        }
    }

    /// Compile LaTeX source to PDF.
    pub async fn compile_to_pdf(
        &self,
        source: &str,
        engine: TexEngine,
        additional_files: &[(String, Vec<u8>)],
    ) -> CompilerResult<CompileResult> {
        let start = std::time::Instant::now();

        // Security check
        self.security_check(source)?;

        // Create isolated temp directory
        let work_dir = TempDir::new()?;
        let tex_file = work_dir.path().join("document.tex");

        // Write source file
        tokio::fs::write(&tex_file, source).await?;

        // Write additional files
        for (name, data) in additional_files {
            let path = work_dir.path().join(name);
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::write(&path, data).await?;
        }

        // Check for cached fmt (pre-compiled preamble)
        let preamble_hash = self.hash_preamble(source);
        let fmt_path = PathBuf::from(&self.config.cache_dir)
            .join(format!("{}.fmt", preamble_hash));

        // Build compilation command
        let mut cmd = self.build_command(engine, &tex_file, work_dir.path());

        // Use cached format if available
        if fmt_path.exists() {
            cmd.arg(&format!("-fmt={}", fmt_path.display()));
        }

        // Execute with timeout
        let timeout_duration = Duration::from_secs(self.config.max_compile_time_secs);

        // Run latexmk for automatic cross-reference resolution
        let result = timeout(timeout_duration, self.run_latexmk(engine, &tex_file, work_dir.path()))
            .await
            .map_err(|_| CompilerError::Timeout {
                seconds: self.config.max_compile_time_secs,
            })??;

        // Read output PDF
        let pdf_path = work_dir.path().join("document.pdf");
        let pdf_data = tokio::fs::read(&pdf_path).await.map_err(|_| {
            CompilerError::CompilationFailed {
                message: "PDF file not produced".to_string(),
                log: result.clone(),
            }
        })?;

        // Parse warnings from log
        let warnings = self.extract_warnings(&result);

        let duration_ms = start.elapsed().as_millis() as u64;

        Ok(CompileResult {
            output: CompileOutput::Pdf(pdf_data),
            log: result,
            warnings,
            pages: 0, // TODO: Parse from log
            duration_ms,
        })
    }

    /// Pre-compile a preamble to a .fmt file for caching.
    pub async fn precompile_preamble(
        &self,
        preamble: &str,
        engine: TexEngine,
    ) -> CompilerResult<PathBuf> {
        let hash = self.hash_preamble(preamble);
        let fmt_path = PathBuf::from(&self.config.cache_dir)
            .join(format!("{}.fmt", hash));

        if fmt_path.exists() {
            return Ok(fmt_path);
        }

        let work_dir = TempDir::new()?;
        let tex_file = work_dir.path().join("preamble.tex");

        // Write preamble with \dump at the end
        let content = format!("{}\n\\dump", preamble);
        tokio::fs::write(&tex_file, content).await?;

        let mut cmd = Command::new(engine.binary_name());
        cmd.arg("-ini")
            .arg("-interaction=nonstopmode")
            .arg(&format!("-output-directory={}", work_dir.path().display()))
            .arg(tex_file.to_str().unwrap())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let output = cmd.output().await?;

        if output.status.success() {
            let src_fmt = work_dir.path().join("preamble.fmt");
            if src_fmt.exists() {
                tokio::fs::create_dir_all(&self.config.cache_dir).await?;
                tokio::fs::copy(&src_fmt, &fmt_path).await?;
                return Ok(fmt_path);
            }
        }

        Err(CompilerError::CompilationFailed {
            message: "Preamble pre-compilation failed".to_string(),
            log: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }

    async fn run_latexmk(
        &self,
        engine: TexEngine,
        tex_file: &Path,
        work_dir: &Path,
    ) -> CompilerResult<String> {
        let engine_flag = match engine {
            TexEngine::XeLaTeX => "-xelatex",
            TexEngine::LuaLaTeX => "-lualatex",
            TexEngine::PdfLaTeX => "-pdf",
        };

        let mut cmd = Command::new("latexmk");
        cmd.arg(engine_flag)
            .arg("-interaction=nonstopmode")
            .arg("-halt-on-error")
            .arg(&format!("-output-directory={}", work_dir.display()));

        // Security flags
        if !self.config.shell_escape {
            cmd.arg("-no-shell-escape");
        }

        cmd.arg(tex_file.to_str().unwrap())
            .current_dir(work_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("openout_any", "p")
            .env("openin_any", "p");

        let output = cmd.output().await?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let log = format!("{}\n{}", stdout, stderr);

        if !output.status.success() {
            return Err(CompilerError::CompilationFailed {
                message: format!("latexmk exited with status {}", output.status),
                log,
            });
        }

        Ok(log)
    }

    fn build_command(&self, engine: TexEngine, tex_file: &Path, work_dir: &Path) -> Command {
        let mut cmd = Command::new(engine.binary_name());
        cmd.arg("-interaction=nonstopmode")
            .arg("-halt-on-error")
            .arg(&format!("-output-directory={}", work_dir.display()))
            .arg(tex_file.to_str().unwrap())
            .current_dir(work_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Security environment
        cmd.env("openout_any", "p");
        cmd.env("openin_any", "p");

        if !self.config.shell_escape {
            cmd.arg("-no-shell-escape");
        }

        cmd
    }

    /// Security check: scan for dangerous commands.
    fn security_check(&self, source: &str) -> CompilerResult<()> {
        let dangerous_patterns = [
            "\\write18",
            "\\input{|",
            "\\immediate\\write",
            "\\openout",
            "\\openin",
            "\\catcode",
            "\\csname",  // Can be used for code injection
        ];

        // Only check in sandboxed mode — in unsandboxed dev, warn but allow
        if self.config.sandbox_enabled {
            for pattern in &dangerous_patterns {
                if source.contains(pattern) {
                    return Err(CompilerError::SecurityViolation(
                        format!("Forbidden command detected: {}", pattern),
                    ));
                }
            }
        }

        Ok(())
    }

    fn hash_preamble(&self, source: &str) -> String {
        // Extract preamble (everything before \begin{document})
        let preamble = if let Some(pos) = source.find("\\begin{document}") {
            &source[..pos]
        } else {
            source
        };

        let mut hasher = Sha256::new();
        hasher.update(preamble.as_bytes());
        hex::encode(hasher.finalize())
    }

    fn extract_warnings(&self, log: &str) -> Vec<String> {
        log.lines()
            .filter(|line| {
                line.contains("Warning") || line.contains("Underfull") || line.contains("Overfull")
            })
            .map(|s| s.trim().to_string())
            .collect()
    }
}
