mod compiler;
mod config;
mod sandbox;
mod cache;
mod service;

use std::net::SocketAddr;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,latex_engine=debug".into()))
        .with(fmt::layer().json())
        .init();

    tracing::info!("Starting LaTeX Engine Service");

    let cfg = config::Config::from_env()?;
    let svc = service::LatexEngineService::new(&cfg).await?;

    let addr: SocketAddr = format!("0.0.0.0:{}", cfg.grpc_port).parse()?;
    tracing::info!(%addr, "LaTeX Engine gRPC server starting");

    svc.serve(addr).await?;

    Ok(())
}
