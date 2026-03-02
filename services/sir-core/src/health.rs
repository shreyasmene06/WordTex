use axum::{http::StatusCode, Json};
use serde::Serialize;

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub service: &'static str,
    pub version: &'static str,
}

pub async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "sir-core",
        version: env!("CARGO_PKG_VERSION"),
    })
}

pub async fn readiness_check() -> StatusCode {
    // TODO: Check Redis + RabbitMQ connectivity
    StatusCode::OK
}
