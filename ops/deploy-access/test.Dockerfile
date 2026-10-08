# syntax=docker/dockerfile:1
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
RUN --mount=type=secret,id=build_ca,mode=0444 \
    export http_proxy="${http_proxy:-${HTTP_PROXY:-}}" https_proxy="${https_proxy:-${HTTPS_PROXY:-}}"; \
    set -eu; \
    if [ -f /run/secrets/build_ca ]; then \
        sed -i 's|http://|https://|g' /etc/apt/sources.list.d/ubuntu.sources; \
        set -- -o Acquire::https::CaInfo=/run/secrets/build_ca; \
    else set --; fi; \
    apt-get "$@" -o Acquire::Retries=2 -o Acquire::https::Timeout=20 update && \
    DEBIAN_FRONTEND=noninteractive apt-get "$@" -o Acquire::Retries=2 -o Acquire::https::Timeout=20 \
        install -y --no-install-recommends python3 sudo openssh-server iproute2 ca-certificates git && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /opt/access
COPY ops/deploy-access/ .
COPY ops/test-release-check.py ops/test-env.py /opt/
CMD ["python3", "-m", "unittest", "discover", "-s", "/opt/access", "-p", "test_*.py", "-v"]
