//! SIR Core service: gRPC server and message queue consumer.

use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Result;
use lapin::{options::*, types::FieldTable, Connection, ConnectionProperties, Channel};
use tokio::sync::RwLock;
use tracing;

use crate::transform::{TransformConfig, TransformPipeline, ConversionDirection};

pub struct SirService {
    redis_url: String,
    amqp_url: String,
    pipeline: Arc<RwLock<TransformPipeline>>,
}

impl SirService {
    pub async fn new(redis_url: &str, amqp_url: &str) -> Result<Self> {
        let config = TransformConfig::default();
        let pipeline = TransformPipeline::new(config);

        Ok(Self {
            redis_url: redis_url.to_string(),
            amqp_url: amqp_url.to_string(),
            pipeline: Arc::new(RwLock::new(pipeline)),
        })
    }

    pub async fn serve_grpc(&self, addr: SocketAddr) -> Result<()> {
        tracing::info!(%addr, "gRPC server would start here");
        // In production: tonic::transport::Server::builder()
        //     .add_service(SirTransformServer::new(self.clone()))
        //     .serve(addr)
        //     .await?;
        tokio::signal::ctrl_c().await?;
        Ok(())
    }

    pub async fn consume_jobs(&self) -> Result<()> {
        tracing::info!(url = %self.amqp_url, "Connecting to RabbitMQ");

        let conn = Connection::connect(&self.amqp_url, ConnectionProperties::default())
            .await
            .map_err(|e| {
                tracing::warn!("Failed to connect to RabbitMQ (will retry): {}", e);
                e
            });

        let conn = match conn {
            Ok(c) => c,
            Err(_) => {
                tracing::warn!("RabbitMQ not available, running in standalone mode");
                // In standalone mode, just wait for shutdown
                tokio::signal::ctrl_c().await?;
                return Ok(());
            }
        };

        let channel = conn.create_channel().await?;

        // Declare the conversion jobs queue
        channel
            .queue_declare(
                "wordtex.sir.jobs",
                QueueDeclareOptions {
                    durable: true,
                    ..Default::default()
                },
                FieldTable::default(),
            )
            .await?;

        let consumer = channel
            .basic_consume(
                "wordtex.sir.jobs",
                "sir-core-worker",
                BasicConsumeOptions::default(),
                FieldTable::default(),
            )
            .await?;

        tracing::info!("Consuming from wordtex.sir.jobs queue");

        use futures_lite::StreamExt;
        let mut consumer = consumer;
        while let Some(delivery) = consumer.next().await {
            match delivery {
                Ok(delivery) => {
                    let data = &delivery.data;
                    tracing::info!(
                        bytes = data.len(),
                        "Received conversion job"
                    );

                    match self.process_job(data).await {
                        Ok(_) => {
                            delivery
                                .ack(BasicAckOptions::default())
                                .await
                                .map_err(|e| tracing::error!("Failed to ack: {}", e))
                                .ok();
                        }
                        Err(e) => {
                            tracing::error!("Job processing failed: {}", e);
                            delivery
                                .nack(BasicNackOptions {
                                    requeue: true,
                                    ..Default::default()
                                })
                                .await
                                .map_err(|e| tracing::error!("Failed to nack: {}", e))
                                .ok();
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("Consumer error: {}", e);
                }
            }
        }

        Ok(())
    }

    async fn process_job(&self, data: &[u8]) -> Result<()> {
        #[derive(serde::Deserialize)]
        struct JobMessage {
            job_id: String,
            direction: String,
            source_data: String,
        }

        let job: JobMessage = serde_json::from_slice(data)?;
        tracing::info!(job_id = %job.job_id, direction = %job.direction, "Processing job");

        let pipeline = self.pipeline.read().await;

        match job.direction.as_str() {
            "latex_to_word" => {
                let sir = pipeline.latex_to_sir(&job.source_data)?;
                let _ooxml = pipeline.sir_to_ooxml(&sir)?;
                tracing::info!(job_id = %job.job_id, "LaTeX → Word conversion complete");
            }
            "word_to_latex" => {
                let sir = pipeline.ooxml_to_sir(job.source_data.as_bytes())?;
                let _latex = pipeline.sir_to_latex(&sir)?;
                tracing::info!(job_id = %job.job_id, "Word → LaTeX conversion complete");
            }
            _ => {
                anyhow::bail!("Unknown conversion direction: {}", job.direction);
            }
        }

        Ok(())
    }
}
