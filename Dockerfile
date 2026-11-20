# syntax=docker/dockerfile:1
FROM node:22-slim AS manifests
WORKDIR /app

COPY package*.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY web/package.json ./web/

FROM manifests AS build
RUN npm ci

COPY tsconfig.base.json ./
COPY shared/ ./shared/
COPY server/ ./server/
COPY web/ ./web/
ARG VITE_PAD_DRIVER
RUN npm run build

FROM manifests AS production-dependencies
RUN npm ci --omit=dev --workspace=@e-sign/server

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data

COPY --from=production-dependencies /app/ ./
COPY --from=build /app/server/dist/ ./server/dist/
COPY --from=build /app/web/dist/ ./web/dist/

RUN install -d -o node -g node -m 0700 /data

# Railway монтирует Volume с владельцем root. Node всегда запускается как node.
COPY --chmod=755 <<'EOF' /usr/local/bin/e-sign-entrypoint
#!/bin/sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
    install -d -o node -g node -m 0700 -- "$DATA_DIR"
    exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi

exec "$@"
EOF

USER node
ENTRYPOINT ["/usr/local/bin/e-sign-entrypoint"]
CMD ["node", "server/dist/index.js"]
