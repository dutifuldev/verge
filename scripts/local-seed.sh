#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_dir="${VERGE_LOCAL_RUNTIME_DIR:-$HOME/.local/share/verge-local}"

set -a
# shellcheck source=/dev/null
source "$runtime_dir/toolchain.env"
# shellcheck source=/dev/null
source "$runtime_dir/verge.env"
set +a

wait_for_api() {
  for _ in $(seq 1 60); do
    if curl -sf "${VERGE_API_URL}/healthz" >/dev/null; then
      return 0
    fi
    sleep 1
  done

  echo "API did not become ready at ${VERGE_API_URL}" >&2
  exit 1
}

create_run() {
  local payload="$1"
  curl -sf \
    -X POST \
    "${VERGE_API_URL}/runs/manual" \
    -H "content-type: application/json" \
    --data "$payload" | node -e 'const data = JSON.parse(require("node:fs").readFileSync(0, "utf8")); process.stdout.write(data.runId);'
}

wait_for_run() {
  local run_id="$1"
  for _ in $(seq 1 240); do
    local status
    status="$(curl -sf "${VERGE_API_URL}/runs/${run_id}" | node -e 'const data = JSON.parse(require("node:fs").readFileSync(0, "utf8")); process.stdout.write(data.status);')"
    if [[ "$status" == "passed" || "$status" == "failed" || "$status" == "reused" || "$status" == "interrupted" ]]; then
      echo "$status"
      return 0
    fi
    sleep 1
  done

  echo "timed-out"
  return 1
}

seed_repository_head() {
  local repository_slug="$1"
  local repository_path="$2"
  local requested_steps_json="${3:-null}"

  if [[ ! -d "$repository_path/.git" ]]; then
    return 0
  fi

  local head_sha
  head_sha="$(git -C "$repository_path" rev-parse HEAD)"

  local payload
  if [[ "$requested_steps_json" == "null" ]]; then
    payload="{\"repositorySlug\":\"${repository_slug}\",\"commitSha\":\"${head_sha}\",\"branch\":\"main\"}"
  else
    payload="{\"repositorySlug\":\"${repository_slug}\",\"commitSha\":\"${head_sha}\",\"branch\":\"main\",\"requestedStepKeys\":${requested_steps_json}}"
  fi

  local run_id
  run_id="$(create_run "$payload")"
  local final_status
  final_status="$(wait_for_run "$run_id")"
  printf '%s\t%s\t%s\n' "$repository_slug" "$run_id" "$final_status"
}

seed_resume_demo() {
  local repository_path="$HOME/repos/verge-testbed"
  if [[ ! -d "$repository_path/.git" ]]; then
    return 0
  fi

  (cd "$repository_path" && pnpm fixture:reset-resume >/dev/null)

  local head_sha
  head_sha="$(git -C "$repository_path" rev-parse HEAD)"

  local seed_payload
  seed_payload="{\"repositorySlug\":\"verge-testbed\",\"commitSha\":\"${head_sha}\",\"branch\":\"main\",\"requestedStepKeys\":[\"test-resume\"],\"resumeFromCheckpoint\":false,\"disableReuse\":true}"
  local seed_run_id
  seed_run_id="$(create_run "$seed_payload")"
  local seed_status
  seed_status="$(wait_for_run "$seed_run_id")"

  local resume_payload
  resume_payload="{\"repositorySlug\":\"verge-testbed\",\"commitSha\":\"${head_sha}\",\"branch\":\"main\",\"requestedStepKeys\":[\"test-resume\"],\"resumeFromCheckpoint\":true}"
  local resume_run_id
  resume_run_id="$(create_run "$resume_payload")"
  local resume_status
  resume_status="$(wait_for_run "$resume_run_id")"

  printf 'verge-testbed-resume-seed\t%s\t%s\n' "$seed_run_id" "$seed_status"
  printf 'verge-testbed-resume\t%s\t%s\n' "$resume_run_id" "$resume_status"
}

wait_for_api

printf 'repo\trunId\tstatus\n'
seed_repository_head "verge" "$repo_root"
seed_repository_head "verge-testbed" "$HOME/repos/verge-testbed" '["test"]'
seed_resume_demo
