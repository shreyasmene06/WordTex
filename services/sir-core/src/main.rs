mod config;
mod health;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{routing::get, Router};
use tokio::signal;
use tower_http::compression::CompressionLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use sir_core::service::SirService;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize structured logging
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,sir_core=debug".into()))
        .with(fmt::layer().json())
        .init();

    tracing::info!("Starting SIR Core service");

    let cfg = config::Config::from_env()?;
    let service = Arc::new(SirService::new(&cfg.redis_url, &cfg.amqp_url).await?);

    // gRPC server for internal service mesh
    let grpc_service = service.clone();
    let grpc_handle = tokio::spawn(async move {
        let addr = "[::]:50051".parse().unwrap();
        tracing::info!(%addr, "Starting gRPC server");
        grpc_service.serve_grpc(addr).await
    });

    // HTTP health/metrics server
    let app = Router::new()
        .route("/health", get(health::health_check))
        .route("/ready", get(health::readiness_check))
        .layer(TraceLayer::new_for_http())
        .layer(CompressionLayer::new());

    let http_addr: SocketAddr = format!("0.0.0.0:{}", cfg.http_port).parse()?;
    tracing::info!(%http_addr, "Starting HTTP health server");

    let listener = tokio::net::TcpListener::bind(http_addr).await?;
    let http_handle = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(shutdown_signal())
            .await
    });

    // Start consuming messages from the queue
    let consumer_service = service.clone();
    let consumer_handle = tokio::spawn(async move {
        consumer_service.consume_jobs().await
    });

    tokio::select! {
        r = grpc_handle => { r??; }
        r = http_handle => { r??; }
        r = consumer_handle => { r??; }
    }

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c().await.expect("failed to listen for ctrl+c");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("Shutdown signal received, starting graceful shutdown");
}
