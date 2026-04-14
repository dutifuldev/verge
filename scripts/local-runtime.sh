#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_dir="${VERGE_LOCAL_RUNTIME_DIR:-$HOME/.local/share/verge-local}"
storage_root="${VERGE_LOCAL_STORAGE_ROOT:-$runtime_dir/artifacts}"
db_container="${VERGE_LOCAL_DB_CONTAINER:-verge-local-postgres}"
db_volume="${VERGE_LOCAL_DB_VOLUME:-verge-local-postgres-data}"
db_port="${VERGE_LOCAL_DB_PORT:-55432}"
db_user="${VERGE_LOCAL_DB_USER:-verge}"
db_password="${VERGE_LOCAL_DB_PASSWORD:-verge}"
db_name="${VERGE_LOCAL_DB_NAME:-verge}"
api_port="${VERGE_LOCAL_API_PORT:-8787}"
web_port="${VERGE_LOCAL_WEB_PORT:-4173}"
api_url="http://127.0.0.1:${api_port}"
web_url="http://127.0.0.1:${web_port}"
verge_testbed_path_default="$HOME/repos/verge-testbed/verge.config.ts"
config_paths="${VERGE_CONFIG_PATHS:-$repo_root/verge.config.ts}"

if [[ -f "$verge_testbed_path_default" && "$config_paths" != *"$verge_testbed_path_default"* ]]; then
  config_paths="$config_paths,$verge_testbed_path_default"
fi

generate_secret() {
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))'
}

ensure_runtime_files() {
  mkdir -p "$runtime_dir" "$storage_root"

  if [[ ! -f "$runtime_dir/webhook_secret.txt" ]]; then
    generate_secret >"$runtime_dir/webhook_secret.txt"
  fi

  cat >"$runtime_dir/toolchain.env" <<EOF
PATH=$PATH
EOF

  cat >"$runtime_dir/verge.env" <<EOF
DATABASE_URL=postgres://${db_user}:${db_password}@127.0.0.1:${db_port}/${db_name}
GITHUB_WEBHOOK_SECRET=$(<"$runtime_dir/webhook_secret.txt")
VERGE_ALLOWED_ORIGINS=http://127.0.0.1:${web_port},http://localhost:${web_port},http://isengard.taild0946b.ts.net:${web_port}
VERGE_STORAGE_ROOT=${storage_root}
VERGE_API_URL=${api_url}
VERGE_CONFIG_PATHS=${config_paths}
HOST=127.0.0.1
PORT=${api_port}
VERGE_WEB_PORT=${web_port}
VITE_ALLOWED_HOSTS=isengard.taild0946b.ts.net
EOF
}

start_db() {
  clear_db_port_conflict

  if sudo docker inspect "$db_container" >/dev/null 2>&1; then
    sudo docker start "$db_container" >/dev/null
    return
  fi

  sudo docker run -d \
    --name "$db_container" \
    --health-cmd "pg_isready -U ${db_user} -d ${db_name}" \
    --health-interval 5s \
    --health-timeout 5s \
    --health-retries 20 \
    -e POSTGRES_USER="$db_user" \
    -e POSTGRES_PASSWORD="$db_password" \
    -e POSTGRES_DB="$db_name" \
    -v "${db_volume}:/var/lib/postgresql/data" \
    -p "${db_port}:5432" \
    postgres:16 >/dev/null
}

find_port_container() {
  sudo docker ps -a --format '{{.Names}}\t{{.Ports}}' | awk -F '\t' -v port="${db_port}" '
    $2 ~ ":" port "->5432/tcp" {
      print $1;
      exit;
    }
  '
}

clear_db_port_conflict() {
  local conflicting_container
  conflicting_container="$(find_port_container)"

  if [[ -z "$conflicting_container" || "$conflicting_container" == "$db_container" ]]; then
    return
  fi

  if [[ "$conflicting_container" == "verge-postgres" ]]; then
    sudo docker rm -f "$conflicting_container" >/dev/null 2>&1 || true
    sudo docker volume rm -f verge-postgres-data >/dev/null 2>&1 || true
    return
  fi

  echo "Port ${db_port} is already used by container ${conflicting_container}" >&2
  exit 1
}

wait_for_db() {
  for _ in $(seq 1 60); do
    if PGPASSWORD="$db_password" pg_isready -h 127.0.0.1 -p "$db_port" -U "$db_user" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Database did not become ready on port ${db_port}" >&2
  return 1
}

with_runtime_env() {
  (
    set -a
    # shellcheck source=/dev/null
    source "$runtime_dir/toolchain.env"
    # shellcheck source=/dev/null
    source "$runtime_dir/verge.env"
    set +a
    "$@"
  )
}

start_service() {
  local unit="$1"
  local command="$2"

  systemctl --user stop "$unit" >/dev/null 2>&1 || true
  systemctl --user reset-failed "$unit" >/dev/null 2>&1 || true

  systemd-run \
    --user \
    --unit "$unit" \
    --property=WorkingDirectory="$repo_root" \
    --collect \
    /usr/bin/bash -lc "set -a; source \"$runtime_dir/toolchain.env\"; source \"$runtime_dir/verge.env\"; set +a; exec ${command}" \
    >/dev/null
}

start_services() {
  start_service "verge-api" "pnpm dev:api"
  start_service "verge-worker" "pnpm dev:worker"
  start_service "verge-web" "pnpm --filter @verge/web exec vite --host 0.0.0.0 --port ${web_port}"
}

stop_services() {
  systemctl --user stop verge-api verge-worker verge-web >/dev/null 2>&1 || true
}

wait_for_api() {
  for _ in $(seq 1 60); do
    if curl -sf "${api_url}/healthz" >/dev/null; then
      return 0
    fi
    sleep 1
  done

  echo "API did not become ready at ${api_url}" >&2
  return 1
}

cmd_up() {
  ensure_runtime_files
  start_db
  wait_for_db
  with_runtime_env pnpm db:migrate >/dev/null
  start_services
  wait_for_api
  with_runtime_env pnpm sync >/dev/null
  echo "Verge local runtime is ready."
  echo "API: ${api_url}"
  echo "UI: ${web_url}"
}

cmd_reset() {
  stop_services
  clear_db_port_conflict
  sudo docker rm -f "$db_container" >/dev/null 2>&1 || true
  sudo docker volume rm -f "$db_volume" >/dev/null 2>&1 || true
  rm -rf "$storage_root"
  ensure_runtime_files
  start_db
  wait_for_db
  with_runtime_env pnpm db:migrate >/dev/null
  with_runtime_env pnpm exec tsx scripts/reset-db.ts >/dev/null
  start_services
  wait_for_api
  with_runtime_env pnpm sync >/dev/null
  echo "Verge local runtime was reset."
  echo "API: ${api_url}"
  echo "UI: ${web_url}"
}

cmd_down() {
  stop_services
  sudo docker stop "$db_container" >/dev/null 2>&1 || true
  echo "Verge local runtime stopped."
}

cmd_status() {
  ensure_runtime_files
  echo "Runtime dir: $runtime_dir"
  echo "Storage root: $storage_root"
  echo "API: $api_url"
  echo "UI: $web_url"
  echo
  systemctl --user --no-pager --plain status verge-api verge-worker verge-web || true
  echo
  sudo docker ps --filter "name=^/${db_container}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  echo
  curl -sf "${api_url}/healthz" || true
  echo
}

case "${1:-}" in
  up)
    cmd_up
    ;;
  reset)
    cmd_reset
    ;;
  down)
    cmd_down
    ;;
  restart)
    cmd_down
    cmd_up
    ;;
  status)
    cmd_status
    ;;
  *)
    echo "Usage: scripts/local-runtime.sh {up|reset|down|restart|status}" >&2
    exit 1
    ;;
esac
