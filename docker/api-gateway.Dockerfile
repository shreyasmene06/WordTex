FROM golang:1.22-bookworm AS builder
WORKDIR /app
COPY services/api-gateway/go.mod services/api-gateway/go.sum* ./
RUN go mod download 2>/dev/null || true
COPY services/api-gateway/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /api-gateway ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /api-gateway /usr/local/bin/api-gateway
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["api-gateway"]
