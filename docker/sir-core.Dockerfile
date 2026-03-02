FROM rust:1.93-bookworm AS builder
WORKDIR /app
COPY services/sir-core/Cargo.toml services/sir-core/Cargo.lock* ./
# Stub out bench so the dependency pre-fetch step doesn't fail on missing bench source
RUN mkdir -p src benches \
    && echo "fn main(){}" > src/main.rs \
    && echo "fn main(){}" > benches/sir_transform.rs \
    && cargo build --release 2>/dev/null || true
RUN rm -rf src benches
COPY services/sir-core/src ./src
COPY services/sir-core/benches ./benches
COPY proto ./proto
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/sir-core /usr/local/bin/sir-core
EXPOSE 8080 50051
USER 1000:1000
ENTRYPOINT ["sir-core"]
