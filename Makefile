GO ?= go
# A host CA bundle is opt-in; Docker images otherwise use their own trust stores.
COMPOSE = docker compose --env-file .env -f ops/compose.yaml $(if $(BUILD_CA_PATH),-f ops/compose.ca.yaml)
.PHONY: env install build db-up bootstrap migrate seed run check check-db up down
env:
	python3 ops/dev-env.py
install:
	npm --prefix api ci
	npm --prefix apps/web ci
build:
	npm --prefix api run bundle
	npm --prefix apps/web run build
	$(GO) build -mod=readonly -trimpath -o bin/api ./cmd/api
	$(GO) build -mod=readonly -trimpath -o bin/db ./cmd/db
	$(GO) build -mod=readonly -trimpath -o bin/access-bootstrap ./cmd/access-bootstrap
	$(GO) build -mod=readonly -trimpath -o bin/platform-bootstrap ./cmd/platform-bootstrap
	$(GO) build -mod=readonly -trimpath -o bin/platform-recovery ./cmd/platform-recovery
db-up: env
	$(COMPOSE) up -d --wait db
bootstrap:
	@set -a; . ./.env; set +a; ./bin/db bootstrap-local
migrate:
	@set -a; . ./.env; set +a; ./bin/db migrate
seed:
	@set -a; . ./.env; set +a; ./bin/db seed-synthetic
run:
	@set -a; . ./.env; set +a; ./bin/api
check:
	$(GO) test -race ./...
	$(GO) vet ./...
	npm --prefix api run check
	cd api && npm run check:routes
check-db:
	JUDEOS_GO=$(GO) python3 ops/check-db.py
up: env
	$(COMPOSE) build bootstrap
	$(COMPOSE) up -d api
down:
	$(COMPOSE) down
