# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first (layer cache optimization)
COPY package*.json ./
COPY tsconfig.json ./

RUN npm ci --only=production

# Copy API source
COPY src/api ./src/api

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Install ts-node for runtime execution (avoids a separate build step in dev)
RUN npm install -g ts-node typescript

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/src ./src

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["ts-node", "--project", "tsconfig.json", "src/api/server.ts"]
