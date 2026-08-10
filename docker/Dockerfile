# ------------------------------------------------------------------------------
# PDFium Stage
# ------------------------------------------------------------------------------

FROM debian:bookworm-slim AS pdfium

ARG TARGETARCH

# Update and install curl and tar
#
# sharing=locked, not the default sharing=shared: this stage and the Rust builder stage
# below mount the *same* unnamed apt caches (the id defaults to the target path), and
# BuildKit runs independent stages in parallel. Two concurrent apt-gets against one
# lists/archives dir race for its lock and one dies with "Could not get lock ... held by
# process 0" -- in whichever stage loses. Locking serializes them while keeping the cache.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y curl tar

# Download and extract the PDFium binaries
RUN set -ex; \
    mkdir -p pdfium; \
    if [ "$TARGETARCH" = "amd64" ]; then \
        curl -sLo pdfium.tgz https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/7763/pdfium-linux-x64.tgz; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
        curl -sLo pdfium.tgz https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/7763/pdfium-linux-arm64.tgz; \
    fi; \
    tar -xzvf pdfium.tgz -C ./pdfium; \
    rm pdfium.tgz

# We need to validate the sha of the libpdfium.so file:
# amd64 -> 727145701ce5bb0344c389071b7aa8f1e15ae81a
# arm64 -> c23942df3dc35f95a7bfa75fc52a480e77b5b0ca
RUN set -ex; \
    if [ "$TARGETARCH" = "amd64" ]; then \
        echo "727145701ce5bb0344c389071b7aa8f1e15ae81a /pdfium/lib/libpdfium.so" | sha1sum -c -; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
        echo "c23942df3dc35f95a7bfa75fc52a480e77b5b0ca /pdfium/lib/libpdfium.so" | sha1sum -c -; \
    else \
        echo "Unsupported architecture: $TARGETARCH"; \
        exit 1; \
    fi

# ------------------------------------------------------------------------------
# Frontend Build Stage
# ------------------------------------------------------------------------------

FROM node:22.14.0-alpine3.21 AS frontend
ARG TARGETARCH

# `ARG`s are per-stage, so this has to be redeclared here even though the cargo stage below also
# takes it: `yarn web build` bakes GIT_REV into the bundle (see apps/web/vite.config.ts) so the
# client can tell whether it is running the same build as the server it is talking to. Both stages
# get their value from the single `--build-arg GIT_REV=...` in .github/workflows/publish-image.yml.
# Unset (a plain local `docker build`) is fine: it becomes an empty rev, and the client skips the
# comparison rather than reporting a bogus mismatch.
ARG GIT_REV
ENV GIT_REV=${GIT_REV}

WORKDIR /app

COPY . .

# We need to install git for yarn to work (we have git dependencies)
#
# Retried because this is the single most fragile instruction in the build: one
# uncached call to a public CDN, which has failed twice in a day on the
# self-hosted runner with "temporary error (try again later)" from
# dl-cdn.alpinelinux.org, failing the whole image publish. A re-run always fixed
# it, which is the definition of worth retrying in place.
#
# The loop's exit status is not trusted -- `command -v` confirms the package
# actually landed, so a silent partial failure cannot masquerade as success.
RUN for attempt in 1 2 3; do \
        apk add --no-cache git && break; \
        echo "apk add git failed (attempt ${attempt}/3), retrying..." >&2; \
        sleep $((attempt * 5)); \
    done; \
    command -v git >/dev/null 2>&1 || { echo "git unavailable after 3 attempts" >&2; exit 1; }

RUN --mount=type=cache,target=/usr/local/yarn/.cache,id=${TARGETARCH} \ 
    # https://github.com/nodejs/docker-node/issues/1335
    yarn config set network-timeout 300000 && \
        YARN_CACHE_FOLDER=/usr/local/yarn/.cache yarn install --frozen-lockfile && \
        yarn web build && \
        mv ./apps/web/dist/ ./build && \
        if [ ! -d "./build" ] || [ ! "$(ls -A ./build)" ]; then exit 1; fi

# ------------------------------------------------------------------------------
# Cargo Build Stage
# ------------------------------------------------------------------------------

FROM rust:1.92-bookworm AS builder

ARG GIT_REV
ARG BUILD_CHANNEL
ARG TARGETARCH

ENV GIT_REV=${GIT_REV}
ENV BUILD_CHANNEL=${BUILD_CHANNEL}

# sharing=locked for the same reason as the pdfium stage above -- these two stages run
# in parallel and share this cache.
#
# Retried for the same reason as the `apk add` in the frontend stage: a transient
# mirror failure here fails the whole publish, and a re-run has always fixed it.
# `apt-get update` is inside the loop deliberately -- a stale or half-fetched
# package index is exactly what makes the subsequent install fail.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    for attempt in 1 2 3; do \
        apt-get update && apt-get install -y \
            build-essential \
            cmake \
            wget \
            git \
            libssl-dev \
            pkg-config \
            curl \
            libsqlite3-dev && break; \
        echo "apt-get failed (attempt ${attempt}/3), retrying..." >&2; \
        sleep $((attempt * 5)); \
    done; \
    dpkg -s build-essential >/dev/null 2>&1 || { echo "build deps unavailable after 3 attempts" >&2; exit 1; }

# Cargo build for longbox
WORKDIR /app

COPY . .


RUN --mount=type=cache,target=/usr/local/cargo/registry,id=${TARGETARCH} \
    --mount=type=cache,target=/app/target,id=${TARGETARCH} \
    ./docker/build_server.sh && \
    cp ./target/release/longbox_server ./longbox_server

# ------------------------------------------------------------------------------
# Final Stage
# ------------------------------------------------------------------------------

FROM gcr.io/distroless/cc-debian12:debug

ARG PORT=10801

LABEL org.opencontainers.image.title="Longbox" \
      org.opencontainers.image.description="A fast, self-hosted, PWA-first comics, manga & digital book server with OPDS support (a fork of Stump)" \
      org.opencontainers.image.source="https://github.com/SaintedRogue/longbox" \
      org.opencontainers.image.url="https://github.com/SaintedRogue/longbox" \
      org.opencontainers.image.documentation="https://github.com/SaintedRogue/longbox#readme" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="SaintedRogue"

RUN [ "/busybox/ln", "-s", "/busybox/sh", "/bin/sh" ]
RUN ln -s /busybox/env /usr/bin/env

# TODO(distroless): Ensure locales aren't messed up
# RUN apt-get update && apt-get install -y locales-all && rm -rf /var/lib/apt/lists/*; \
#     mkdir -p config && mkdir -p data && mkdir -p app

COPY --from=builder /app/longbox_server /app/longbox
COPY --from=pdfium /pdfium /opt/pdfium
COPY --from=frontend /app/build /app/client
COPY --chmod=755 docker/entrypoint.sh /entrypoint.sh

# Default Longbox environment variables
ENV LONGBOX_CONFIG_DIR=/config \
    LONGBOX_CLIENT_DIR=/app/client \
    LONGBOX_PROFILE=release \
    LONGBOX_PORT=${PORT} \
    LONGBOX_IN_DOCKER=true \
    PDFIUM_PATH=/opt/pdfium/lib/libpdfium.so \
    API_VERSION=v1

WORKDIR /app

EXPOSE ${PORT}

ENTRYPOINT ["/entrypoint.sh"]
