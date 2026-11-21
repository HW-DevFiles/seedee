#!/bin/sh
set -eu
npm run db:deploy
if [ "${NODE_ENV:-production}" = "development" ]; then
  if [ "${DEMO_ACCOUNT_ENABLED:-false}" = "true" ]; then
    npm run db:seed
  fi
  exec node node_modules/next/dist/bin/next dev --hostname 0.0.0.0
fi
# Instrumentation checks configuration and stored public credentials before ready.
exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0
