  .PHONY: all build test dev deploy clean lint proto

# ─── Configuration ───────────────────────────────────────────────
REGISTRY    ?= ghcr.io/wordtex
VERSION     ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
GO_SERVICES := api-gateway orchestrator
RUST_SERVICES := sir-core latex-engine math-pipeline
DOTNET_SERVICES := ooxml-engine
NODE_SERVICES := web-ui

# ─── Top-Level Targets ──────────────────────────────────────────
all: lint build test

build: build-go build-rust build-dotnet
	@echo "✓ All services built successfully"

test: test-go test-rust test-dotnet test-integration
	@echo "✓ All tests passed"

lint: lint-go lint-rust lint-dotnet
	@echo "✓ All lints passed"

# ─── Go Services ─────────────────────────────────────────────────
build-go:
	@for svc in $(GO_SERVICES); do \
		echo "Building $$svc..."; \
		cd services/$$svc && go build -ldflags "-X main.Version=$(VERSION)" -o ../../bin/$$svc ./cmd/... && cd ../..; \
	done

test-go:
	@for svc in $(GO_SERVICES); do \
		echo "Testing $$svc..."; \
		cd services/$$svc && go test -race -cover ./... && cd ../..; \
	done

lint-go:
	@for svc in $(GO_SERVICES); do \
		cd services/$$svc && golangci-lint run ./... && cd ../..; \
	done

# ─── Rust Services ──────────────────────────────────────────────
build-rust:
	@for svc in $(RUST_SERVICES); do \
		echo "Building $$svc..."; \
		cd services/$$svc && cargo build --release && cd ../..; \
	done

test-rust:
	@for svc in $(RUST_SERVICES); do \
		echo "Testing $$svc..."; \
		cd services/$$svc && cargo test --release && cd ../..; \
	done

lint-rust:
	@for svc in $(RUST_SERVICES); do \
		cd services/$$svc && cargo clippy -- -D warnings && cd ../..; \
	done

# ─── .NET Services ──────────────────────────────────────────────
build-dotnet:
	@for svc in $(DOTNET_SERVICES); do \
		echo "Building $$svc..."; \
		cd services/$$svc && dotnet build -c Release && cd ../..; \
	done

test-dotnet:
	@for svc in $(DOTNET_SERVICES); do \
		echo "Testing $$svc..."; \
		cd services/$$svc && dotnet test -c Release && cd ../..; \
	done

lint-dotnet:
	@for svc in $(DOTNET_SERVICES); do \
		cd services/$$svc && dotnet format --verify-no-changes && cd ../..; \
	done

# ─── Node.js Services ────────────────────────────────────────────
build-node:
	@for svc in $(NODE_SERVICES); do \
		echo "Building $$svc..."; \
		cd services/$$svc && npm run build && cd ../..; \
	done

test-node:
	@for svc in $(NODE_SERVICES); do \
		echo "Testing $$svc..."; \
		cd services/$$svc && npm test && cd ../..; \
	done

lint-node:
	@for svc in $(NODE_SERVICES); do \
		cd services/$$svc && npm run lint && cd ../..; \
	done

dev-ui:
	cd services/web-ui && npm run dev

# ─── Protobuf ────────────────────────────────────────────────────
proto:
	@echo "Generating protobuf stubs..."
	buf generate proto/

# ─── Docker ──────────────────────────────────────────────────────
docker-build:
	@for svc in $(GO_SERVICES) $(RUST_SERVICES) $(DOTNET_SERVICES); do \
		echo "Building Docker image for $$svc..."; \
		docker build -t $(REGISTRY)/$$svc:$(VERSION) -f deploy/docker/$$svc.Dockerfile .; \
	done

docker-push:
	@for svc in $(GO_SERVICES) $(RUST_SERVICES) $(DOTNET_SERVICES); do \
		docker push $(REGISTRY)/$$svc:$(VERSION); \
	done

# ─── Development ─────────────────────────────────────────────────
dev:
	docker compose up --build

dev-down:
	docker compose down -v

dev-backend:
	docker compose up --build rabbitmq redis api-gateway orchestrator sir-core latex-engine ooxml-engine math-pipeline

# ─── Kubernetes ──────────────────────────────────────────────────
deploy:
	kubectl apply -k deploy/k8s/overlays/production/

deploy-staging:
	kubectl apply -k deploy/k8s/overlays/staging/

# ─── Integration Tests ──────────────────────────────────────────
test-integration:
	cd tests && go test -v -tags=integration -timeout 30m ./...

test-visual-diff:
	cd tests/visual-diff && python3 -m pytest -v --timeout=600

test-corpus:
	cd tests/corpus && python3 run_corpus_tests.py --limit 100

# ─── Utility ─────────────────────────────────────────────────────
clean:
	rm -rf bin/
	@for svc in $(RUST_SERVICES); do cd services/$$svc && cargo clean && cd ../..; done
	@for svc in $(DOTNET_SERVICES); do cd services/$$svc && dotnet clean && cd ../..; done

fmt:
	@for svc in $(GO_SERVICES); do cd services/$$svc && gofmt -w . && cd ../..; done
	@for svc in $(RUST_SERVICES); do cd services/$$svc && cargo fmt && cd ../..; done
	@for svc in $(DOTNET_SERVICES); do cd services/$$svc && dotnet format && cd ../..; done
