mod config;

use std::net::SocketAddr;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use math_pipeline::{
    latex_to_mathml, mathml_to_latex, mathml_to_omml, omml_to_mathml,
    pipeline,
};

// Since we don't have tonic-build generated code, we implement an Axum-based
// JSON API that mirrors the gRPC service contract defined in service.proto.
// In production, replace with tonic-build generated server stubs.

use axum::{
    extract::Json,
    routing::post,
    Router,
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct MathConvertRequest {
    input: String,
    input_format: String,
}

#[derive(Serialize)]
struct MathConvertResponse {
    output: String,
    output_format: String,
    warnings: Vec<String>,
}

#[derive(Deserialize)]
struct FullMathConvertRequest {
    input: String,
    direction: String, // "latex_to_omml", "omml_to_latex", "latex_to_mathml", "mathml_to_latex"
}

#[derive(Serialize)]
struct FullMathConvertResponse {
    latex: String,
    mathml: String,
    omml: String,
    warnings: Vec<String>,
}

#[derive(Deserialize)]
struct RoundTripRequest {
    original_latex: String,
}

#[derive(Serialize)]
struct RoundTripResponse {
    is_equivalent: bool,
    original_latex: String,
    roundtrip_latex: String,
    intermediate_mathml: String,
    similarity_score: f64,
    differences: Vec<String>,
}

async fn convert_single(Json(req): Json<MathConvertRequest>) -> Json<MathConvertResponse> {
    let (output, output_format) = match req.input_format.as_str() {
        "latex" => {
            let result = latex_to_mathml::latex_to_mathml(&req.input, true);
            (result.mathml, "mathml".to_string())
        }
        "mathml_to_omml" => {
            let omml = mathml_to_omml::mathml_to_omml(&req.input);
            (omml, "omml".to_string())
        }
        "omml" => {
            let mathml = omml_to_mathml::omml_to_mathml(&req.input);
            (mathml, "mathml".to_string())
        }
        "mathml_to_latex" => {
            let latex = mathml_to_latex::mathml_to_latex(&req.input);
            (latex, "latex".to_string())
        }
        _ => ("unsupported format".to_string(), "error".to_string()),
    };

    Json(MathConvertResponse {
        output,
        output_format,
        warnings: vec![],
    })
}

async fn convert_full(Json(req): Json<FullMathConvertRequest>) -> Json<FullMathConvertResponse> {
    let result = match req.direction.as_str() {
        "latex_to_omml" | "latex_to_mathml" => pipeline::latex_to_all(&req.input, true),
        "omml_to_latex" => pipeline::omml_to_all(&req.input),
        "mathml_to_latex" => pipeline::mathml_to_all(&req.input),
        _ => pipeline::latex_to_all(&req.input, true),
    };

    Json(FullMathConvertResponse {
        latex: result.latex,
        mathml: result.mathml,
        omml: result.omml,
        warnings: vec![],
    })
}

async fn validate_roundtrip(Json(req): Json<RoundTripRequest>) -> Json<RoundTripResponse> {
    let result = pipeline::validate_roundtrip(&req.original_latex);

    let similarity = if result.is_equivalent { 1.0 } else { 0.5 };

    Json(RoundTripResponse {
        is_equivalent: result.is_equivalent,
        original_latex: result.original.clone(),
        roundtrip_latex: result.recovered,
        intermediate_mathml: result.intermediate_mathml,
        similarity_score: similarity,
        differences: if result.is_equivalent {
            vec![]
        } else {
            vec![format!("Original and round-tripped LaTeX differ")]
        },
    })
}

async fn health() -> &'static str {
    "ok"
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,math_pipeline=debug".into()))
        .with(fmt::layer().json())
        .init();

    tracing::info!("Starting Math Pipeline Service");

    let cfg = config::Config::from_env()?;
    let addr: SocketAddr = format!("0.0.0.0:{}", cfg.grpc_port).parse()?;

    let app = Router::new()
        .route("/health", axum::routing::get(health))
        .route("/api/v1/convert", post(convert_single))
        .route("/api/v1/convert/full", post(convert_full))
        .route("/api/v1/validate/roundtrip", post(validate_roundtrip));

    tracing::info!(%addr, "Math Pipeline service listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
