#!/usr/bin/env bash

set -euo pipefail

create_temp_database() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL must be set before creating a temp database" >&2
    exit 1
  fi

  local maintenance_url="$DATABASE_URL"
  local db_name="verge_test_${USER:-user}_$(date +%s)_$RANDOM"
  local db_url

  db_url="$(
    node -e '
      const url = new URL(process.argv[1]);
      url.pathname = `/${process.argv[2]}`;
      process.stdout.write(url.toString());
    ' "$maintenance_url" "$db_name"
  )"

  psql "$maintenance_url" -v ON_ERROR_STOP=1 -c "drop database if exists \"$db_name\" with (force)" >/dev/null 2>&1 || true
  psql "$maintenance_url" -v ON_ERROR_STOP=1 -c "create database \"$db_name\"" >/dev/null

  export VERGE_TEST_DATABASE_NAME="$db_name"
  export VERGE_TEST_DATABASE_URL="$db_url"
  export VERGE_TEST_MAINTENANCE_URL="$maintenance_url"
}

drop_temp_database() {
  if [[ -z "${VERGE_TEST_DATABASE_NAME:-}" || -z "${VERGE_TEST_MAINTENANCE_URL:-}" ]]; then
    return
  fi

  psql "$VERGE_TEST_MAINTENANCE_URL" \
    -v ON_ERROR_STOP=1 \
    -c "drop database if exists \"$VERGE_TEST_DATABASE_NAME\" with (force)" \
    >/dev/null 2>&1 || true
}
