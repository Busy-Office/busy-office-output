# Minimal container proving Stage 3's "fresh clone -> serve -> zero
# external services" exit-gate claim (ROADMAP.md). Runtime-only: installs
# `typst` (the one external binary `serve()` actually needs at runtime —
# `pdftotext`/`verapdf` are dev/test tooling for `bo-output diff` and the
# corpus's PDF/A gate, not needed to run the event pipeline). Not yet
# pinned for CI (CLAUDE.md flags this — typst/pdftotext are unpinned
# system binaries); this Dockerfile pins a specific typst release so at
# least the container build is reproducible.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates tar xz-utils \
  && ARCH=$(dpkg --print-architecture) \
  && if [ "$ARCH" = "arm64" ]; then TYPST_ARCH=aarch64-unknown-linux-musl; else TYPST_ARCH=x86_64-unknown-linux-musl; fi \
  && curl -fsSL "https://github.com/typst/typst/releases/download/v0.15.1/typst-${TYPST_ARCH}.tar.xz" -o /tmp/typst.tar.xz \
  && tar -xJf /tmp/typst.tar.xz -C /tmp \
  && mv /tmp/typst-${TYPST_ARCH}/typst /usr/local/bin/typst \
  && chmod +x /usr/local/bin/typst \
  && rm -rf /tmp/typst* \
  && apt-get purge -y curl xz-utils && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/schema/package.json packages/schema/package.json
COPY packages/render-typst/package.json packages/render-typst/package.json
COPY packages/runtime/package.json packages/runtime/package.json
RUN npm ci

COPY . .

ENV PORT=3000
ENV REGISTRY_DB_PATH=/app/data/registry.db
ENV ARCHIVE_DIR=/app/data/archive
ENV OUTBOX_DIR=/app/data/outbox
EXPOSE 3000

CMD ["npx", "tsx", "packages/runtime/src/index.ts"]
