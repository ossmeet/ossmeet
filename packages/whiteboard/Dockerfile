FROM oven/bun:1-alpine@sha256:4de475389889577f346c636f956b42a5c31501b654664e9ae5726f94d7bb5349

RUN apk add --no-cache \
    fontconfig \
    mupdf-tools \
    font-dejavu \
    font-liberation \
    font-freefont \
    font-noto \
    font-noto-bengali \
    font-noto-cjk \
    font-noto-extra \
    font-noto-math \
    && fc-cache -f

RUN addgroup -S -g 10001 appgroup && adduser -S -u 10001 -G appgroup appuser

WORKDIR /app
COPY package.sync-server.json ./package.json
COPY tsconfig.json ./tsconfig.json
RUN bun install --production
COPY src/ ./src/
RUN mkdir -p /data/rooms && chown -R appuser:appgroup /data/rooms /app

USER appuser
WORKDIR /app
EXPOSE 8787
# health check so Docker/compose can detect when the server is ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8787/health || exit 1
CMD ["bun", "src/index.ts"]
