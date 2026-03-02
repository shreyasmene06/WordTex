//! gRPC service implementation for the LaTeX Engine.

use std::net::SocketAddr;
use crate::compiler::{LatexCompiler, TexEngine};
use crate::config::Config;

pub struct LatexEngineService {
    compiler: LatexCompiler,
}

impl LatexEngineService {
    pub async fn new(config: &Config) -> anyhow::Result<Self> {
        Ok(Self {
            compiler: LatexCompiler::new(config),
        })
    }

    pub async fn serve(&self, addr: SocketAddr) -> anyhow::Result<()> {
        tracing::info!(%addr, "LaTeX Engine service ready");
        // In production: serve via tonic gRPC
        tokio::signal::ctrl_c().await?;
        Ok(())
    }

    pub async fn compile(
        &self,
        source: &str,
        engine_name: &str,
        additional_files: &[(String, Vec<u8>)],
    ) -> anyhow::Result<Vec<u8>> {
        let engine = match engine_name {
            "xelatex" => TexEngine::XeLaTeX,
            "lualatex" => TexEngine::LuaLaTeX,
            "pdflatex" => TexEngine::PdfLaTeX,
            _ => TexEngine::XeLaTeX,
        };

        let result = self.compiler.compile_to_pdf(source, engine, additional_files).await?;

        match result.output {
            crate::compiler::CompileOutput::Pdf(data) => Ok(data),
            crate::compiler::CompileOutput::Dvi(data) => Ok(data),
        }
    }
}
