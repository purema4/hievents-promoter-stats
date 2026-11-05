# The demo image: the app, plus demo/ with its fake data and debug bar. Only docker-compose.demo.yml
# builds this. The production Dockerfile copies src and public alone, so none of this can reach it.
FROM oven/bun:1.3.4-alpine

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY demo ./demo

RUN mkdir -p /data && chown bun:bun /data
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 DEMO_MODE=on
VOLUME /data
USER bun
EXPOSE 3000

CMD ["bun", "demo/server.tsx"]
