#!/usr/bin/env bash
# The app on the Hi.Events dev database, reachable from your phone through ngrok.
#   ./dev-ngrok.sh up -d --build    start
#   ./dev-ngrok.sh logs -f          follow the logs
#   ./dev-ngrok.sh down             stop (the app is then only on http://localhost:3000 again after a normal start)
set -euo pipefail
cd "$(dirname "$0")"
HIEVENTS_DEV_ENV="${HIEVENTS_DEV_ENV:-$HOME/hi.events/docker/development/.env}"
exec docker compose \
  --env-file "$HIEVENTS_DEV_ENV" \
  --env-file .env \
  -f docker-compose.yml \
  -f docker-compose.hievents-dev.yml \
  -f docker-compose.ngrok.yml \
  "$@"
