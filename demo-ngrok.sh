#!/usr/bin/env bash
# The demo at your reserved ngrok address, reachable from anywhere (behind a password).
#   ./demo-ngrok.sh up -d --build --wait    start
#   ./demo-ngrok.sh logs -f demo-ngrok      follow the tunnel
#   ./demo-ngrok.sh down                    stop (then start the demo as usual to have it on 127.0.0.1:3100 again)
set -euo pipefail
cd "$(dirname "$0")"
HIEVENTS_DEV_ENV="${HIEVENTS_DEV_ENV:-$HOME/hi.events/docker/development/.env}"
exec docker compose -p promoterstats-demo \
  --env-file "$HIEVENTS_DEV_ENV" \
  --env-file .env \
  -f docker-compose.demo.yml \
  -f docker-compose.demo-ngrok.yml \
  "$@"
