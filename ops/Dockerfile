# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS frontend
WORKDIR /src
COPY api/package*.json api/
COPY apps/web/package*.json apps/web/
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm --prefix api ci --strict-ssl=true && \
    npm --prefix apps/web ci --strict-ssl=true
COPY api api
COPY apps/web apps/web
COPY design-system/tokens.css design-system/tokens.css
RUN npm --prefix api run bundle && npm --prefix apps/web run build

FROM golang:1.27.1-bookworm@sha256:8d48e12ec56735e9358640898b9d9b9fcca110612ed8a5567438c0a1baa24e66 AS backend
WORKDIR /src
COPY go.mod go.sum ./
COPY cmd cmd
COPY internal internal
COPY db db
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export SSL_CERT_FILE=/run/secrets/build_ca; fi; \
    CGO_ENABLED=0 go build -mod=readonly -trimpath -o /out/api ./cmd/api && \
    CGO_ENABLED=0 go build -mod=readonly -trimpath -o /out/db ./cmd/db && \
    CGO_ENABLED=0 go build -mod=readonly -trimpath -o /out/access-bootstrap ./cmd/access-bootstrap && \
    CGO_ENABLED=0 go build -mod=readonly -trimpath -o /out/platform-bootstrap ./cmd/platform-bootstrap && \
    CGO_ENABLED=0 go build -mod=readonly -trimpath -o /out/platform-recovery ./cmd/platform-recovery

FROM scratch
WORKDIR /app
COPY --from=backend /out/ /app/
COPY --from=frontend /src/apps/web/dist /app/web
COPY --from=frontend /src/api/dist/runtime-openapi.json /app/contract/runtime-openapi.json
COPY --from=frontend /src/api/dist/swagger /app/contract/swagger
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/app/api"]
