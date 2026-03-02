# WordTex

**Enterprise-grade bidirectional document conversion: LaTeX ↔ MS Word ↔ PDF**

Precision-targeted at academic and research workloads with zero tolerance for formatting loss.

## Architecture

WordTex uses an **Event-Driven Microservices Architecture** with a custom **Semantic Intermediate Representation (SIR)** at its core.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         API Gateway (Go)                            │
│                   Auth · Rate Limiting · Routing                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Orchestration Svc   │
                    │  (Go + RabbitMQ)     │
                    └───┬──────┬──────┬───┘
                        │      │      │
          ┌─────────────▼┐ ┌──▼────┐ ┌▼─────────────┐
          │ LaTeX Engine  │ │ SIR   │ │ OOXML Engine  │
          │ (Rust + C)    │ │ Core  │ │ (C# .NET 8)   │
          │               │ │(Rust) │ │               │
          └───────────────┘ └───────┘ └───────────────┘
```

### Services

| Service | Language | Purpose |
|---------|----------|---------|
| `api-gateway` | Go | Auth, rate limiting, request routing |
| `orchestrator` | Go | Conversion state machine, job coordination via RabbitMQ |
| `sir-core` | Rust | Semantic IR: bidirectional AST transformation engine |
| `latex-engine` | Rust + C/C++ | Headless TeX compilation, macro expansion, LaTeX parsing |
| `ooxml-engine` | C# / .NET 8 | OpenXML SDK-based .docx read/write with full spec compliance |
| `math-pipeline` | Rust | LaTeX math → MathML → OMML (and reverse) |
| `web-ui` | TypeScript / Next.js | Interactive web frontend with Monaco editor, real-time telemetry |

### Key Design Decisions

- **Semantic IR (SIR)**: Compiler-frontend approach that *executes* LaTeX macros to build a semantic DOM, avoiding lossy regex/AST shortcuts
- **Round-Trip Anchor Metadata**: Original LaTeX AST embedded as Custom XML Parts in .docx for lossless round-trips
- **Template System**: Publisher `.cls` → `.dotx` mapping for pixel-perfect academic formatting
- **Sandboxed Compilation**: gVisor/Firecracker microVMs for LaTeX execution with zero network access

## Quick Start

```bash
# Development (requires Docker + Docker Compose)
make dev

# Run full test suite
make test

# Build all services
make build

# Deploy to Kubernetes
make deploy
```

## Project Structure

```
wordTex/
├── services/
│   ├── api-gateway/          # Go API gateway
│   ├── orchestrator/         # Go orchestration service
│   ├── sir-core/             # Rust SIR transformation engine
│   ├── latex-engine/         # Rust LaTeX processing service
│   ├── ooxml-engine/         # C# OOXML processing service
│   ├── math-pipeline/        # Rust math conversion pipeline
│   └── web-ui/               # Next.js web frontend (React + TypeScript)
├── proto/                    # Protobuf service definitions
├── pkg/                      # Shared Go packages
├── templates/                # Academic publisher .dotx templates
├── deploy/
│   ├── docker/               # Dockerfiles for each service
│   ├── k8s/                  # Kubernetes manifests
│   └── terraform/            # Infrastructure as Code
├── tests/
│   ├── corpus/               # arXiv test corpus management
│   ├── visual-diff/          # Sub-pixel PDF comparison
│   └── integration/          # End-to-end conversion tests
├── scripts/                  # Build and utility scripts
└── docs/                     # Architecture documentation
```

## License

Proprietary — All rights reserved.
