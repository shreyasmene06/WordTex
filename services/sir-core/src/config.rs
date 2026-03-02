use anyhow::Result;

#[derive(Debug, Clone)]
pub struct Config {
    pub http_port: u16,
    pub grpc_port: u16,
    pub redis_url: String,
    pub amqp_url: String,
    pub log_level: String,
    pub worker_concurrency: usize,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Config {
            http_port: std::env::var("HTTP_PORT")
                .unwrap_or_else(|_| "8080".to_string())
                .parse()?,
            grpc_port: std::env::var("GRPC_PORT")
                .unwrap_or_else(|_| "50051".to_string())
                .parse()?,
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            amqp_url: std::env::var("AMQP_URL")
                .unwrap_or_else(|_| "amqp://guest:guest@localhost:5672/%2f".to_string()),
            log_level: std::env::var("LOG_LEVEL")
                .unwrap_or_else(|_| "info".to_string()),
            worker_concurrency: std::env::var("WORKER_CONCURRENCY")
                .unwrap_or_else(|_| "4".to_string())
                .parse()?,
        })
    }
}
