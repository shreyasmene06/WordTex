FROM rust:1.93-bookworm AS builder
WORKDIR /app
COPY services/math-pipeline/Cargo.toml services/math-pipeline/Cargo.lock* ./
RUN mkdir src && echo "fn main(){}" > src/main.rs && cargo build --release 2>/dev/null || true
RUN rm -rf src
COPY services/math-pipeline/src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/math-pipeline /usr/local/bin/math-pipeline
EXPOSE 50053
USER 1000:1000
ENTRYPOINT ["math-pipeline"]
