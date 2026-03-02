FROM rust:1.93-bookworm AS builder
WORKDIR /app
COPY services/latex-engine/Cargo.toml services/latex-engine/Cargo.lock* ./
RUN mkdir src && echo "fn main(){}" > src/main.rs && cargo build --release 2>/dev/null || true
RUN rm -rf src
COPY services/latex-engine/src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y \
    ca-certificates \
    texlive-full \
    latexmk \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/latex-engine /usr/local/bin/latex-engine
EXPOSE 50052
USER 1000:1000
ENTRYPOINT ["latex-engine"]
