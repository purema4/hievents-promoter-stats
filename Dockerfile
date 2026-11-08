FROM oven/bun:1.3.4-alpine

# Pick up Alpine security fixes released after the base image was built. CI passes the day, so this layer
# is not reused from its build cache for more than a day (a cached upgrade misses newer fixes).
ARG SECURITY_REFRESH=manual
RUN echo "security refresh: ${SECURITY_REFRESH}" && apk upgrade --no-cache

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY tsconfig.json ./
COPY src ./src
COPY public ./public

RUN mkdir -p /data && chown bun:bun /data
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
VOLUME /data
USER bun
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["bun", "src/index.tsx"]
