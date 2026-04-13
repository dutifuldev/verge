#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be set for integration tests" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=./lib/temp-db.sh
source "$repo_root/scripts/lib/temp-db.sh"

create_temp_database
trap drop_temp_database EXIT

export DATABASE_URL="$VERGE_TEST_DATABASE_URL"
export VERGE_INTEGRATION_DATABASE_URL="${VERGE_INTEGRATION_DATABASE_URL:-$VERGE_TEST_DATABASE_URL}"
export GITHUB_WEBHOOK_SECRET="${GITHUB_WEBHOOK_SECRET:-integration-secret}"
export VERGE_RUN_DB_INTEGRATION=1

pnpm db:migrate
pnpm test
