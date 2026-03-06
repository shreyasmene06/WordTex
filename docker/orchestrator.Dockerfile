FROM golang:1.22-bookworm AS builder
WORKDIR /app
COPY services/orchestrator/go.mod services/orchestrator/go.sum* ./
RUN go mod download 2>/dev/null || true
COPY services/orchestrator/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /orchestrator ./cmd/server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      texlive-full \
      latexmk \
      pandoc \
      libreoffice-writer \
      ca-certificates && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder /orchestrator /usr/local/bin/orchestrator
USER nobody:nogroup
ENTRYPOINT ["orchestrator"]
