#!/bin/sh
set -eu
# Only use this against a fresh Compose project created for CI/rehearsal.
# It does not delete volumes; the caller controls disposal of its own project.
docker compose up --build --wait --wait-timeout 240
docker compose exec -T web node --import tsx scripts/container-probe.ts create
docker compose restart web
docker compose up --wait --wait-timeout 240
docker compose exec -T web node --import tsx scripts/container-probe.ts verify
