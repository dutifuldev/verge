#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be set for integration tests" >&2
  exit 1
fi

export VERGE_INTEGRATION_DATABASE_URL="${VERGE_INTEGRATION_DATABASE_URL:-$DATABASE_URL}"
export GITHUB_WEBHOOK_SECRET="${GITHUB_WEBHOOK_SECRET:-integration-secret}"
export VERGE_RUN_DB_INTEGRATION=1

pnpm db:migrate
pnpm test
