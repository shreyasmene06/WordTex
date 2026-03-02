# WordTex Security Configuration
# ================================
# This file documents all security measures and their rationale.

## 1. LaTeX Compilation Sandbox

### Compilation Flags (MANDATORY)
```
-no-shell-escape          # Prevents \write18 command execution
-interaction=nonstopmode  # Prevents interactive prompts
-halt-on-error            # Stops on first error
```

### Environment Variables
```
openout_any=p    # Only allow writing to current directory and its children
openin_any=p     # Only allow reading from current directory and its children
```

### Forbidden LaTeX Commands
The following commands are blocked at the source level before compilation:
- `\write18` — Shell command execution
- `\input{|` — Pipe command execution
- `\immediate\write` — Direct file writing
- `\openout` / `\openin` — Direct file handle manipulation
- `\catcode` — Character category code manipulation (can enable code injection)

### Container Isolation
- **Runtime**: gVisor (runsc) in production, standard containerd in dev
- **Network**: Completely disabled (`network: none`)
- **Filesystem**: Read-only root, writable tmpfs for work directory only
- **Resources**:
  - CPU: 120s max
  - Memory: 2GB max
  - Processes: 50 max
  - Output size: 500MB max

## 2. File Upload Security

### Size Limits
- Maximum upload: 100MB (configurable via MAX_UPLOAD_MB)
- Maximum .docx file: 100MB
- Maximum LaTeX project (zipped): 100MB

### File Validation
- MIME type check against allowlist
- Zip bomb detection (compression ratio > 100:1 triggers rejection)
- ClamAV scan for malware detection (when available)
- File extension validation (.tex, .docx, .zip, .tar.gz only)

### Zip Bomb Detection
```
Max compression ratio: 100:1
Max nested depth: 3
Max total entries: 10000
Max total uncompressed: 500MB
```

## 3. API Security

### Authentication
- JWT tokens (HMAC-SHA256)
- Token expiry: 24 hours
- Refresh token rotation

### Rate Limiting
- Default: 50 requests/second per client
- Burst: 10 requests
- Rate limit headers in response (X-RateLimit-*)

### Input Validation
- All API inputs validated and sanitized
- Maximum request body size enforced at middleware level
- Content-Type validation on all endpoints

## 4. Network Security (Kubernetes)

### Network Policies
- Default deny all ingress/egress
- Per-service allowlists:
  - api-gateway: Ingress from internet, egress to RabbitMQ/Redis
  - orchestrator: Egress to all internal services
  - sir-core: Ingress from orchestrator only, egress to RabbitMQ/Redis
  - latex-engine: Ingress from orchestrator only, NO egress (fully isolated)
  - ooxml-engine: Ingress from orchestrator only
  - math-pipeline: Ingress from sir-core only

### TLS
- All external traffic: TLS 1.3 via Ingress
- Internal gRPC: mTLS in production (via service mesh)

## 5. Secrets Management

### Required Secrets
- `jwt-secret`: JWT signing key (min 256 bits)
- `amqp-url`: RabbitMQ connection string with credentials
- `redis-url`: Redis connection string (with auth in production)

### Storage
- Kubernetes Secrets (encrypted at rest via etcd encryption)
- In production: HashiCorp Vault or AWS Secrets Manager
