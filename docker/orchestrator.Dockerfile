FROM golang:1.22-bookworm AS builder
WORKDIR /app
COPY services/orchestrator/go.mod services/orchestrator/go.sum* ./
RUN go mod download 2>/dev/null || true
COPY services/orchestrator/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /orchestrator ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /orchestrator /usr/local/bin/orchestrator
USER nonroot:nonroot
ENTRYPOINT ["orchestrator"]
