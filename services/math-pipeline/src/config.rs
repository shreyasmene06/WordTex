use anyhow::Result;

#[derive(Debug, Clone)]
pub struct Config {
    pub grpc_port: u16,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Config {
            grpc_port: std::env::var("GRPC_PORT")
                .unwrap_or_else(|_| "50053".to_string())
                .parse()?,
        })
    }
}
