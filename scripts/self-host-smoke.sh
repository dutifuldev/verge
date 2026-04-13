#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be set for the self-host smoke test" >&2
  exit 1
fi

export VERGE_STORAGE_ROOT="${VERGE_STORAGE_ROOT:-$(mktemp -d)}"
export GITHUB_WEBHOOK_SECRET="${GITHUB_WEBHOOK_SECRET:-integration-secret}"
export VERGE_ALLOWED_ORIGINS="${VERGE_ALLOWED_ORIGINS:-http://127.0.0.1:5173,http://localhost:5173}"
api_port="${VERGE_SMOKE_PORT:-18787}"
api_base_url="http://127.0.0.1:${api_port}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

pnpm db:migrate >/tmp/verge-db-migrate.log 2>&1

PORT="$api_port" pnpm --filter @verge/api dev >/tmp/verge-api.log 2>&1 &
api_pid=$!

cleanup() {
  kill "$api_pid" >/dev/null 2>&1 || true
  if [[ -n "${worker_pid:-}" ]]; then
    kill "$worker_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "${resume_worker_pid:-}" ]]; then
    kill "$resume_worker_pid" >/dev/null 2>&1 || true
  fi
  wait "$api_pid" >/dev/null 2>&1 || true
  if [[ -n "${worker_pid:-}" ]]; then
    wait "$worker_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "${resume_worker_pid:-}" ]]; then
    wait "$resume_worker_pid" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -sf "$api_base_url/healthz" >/dev/null; then
    break
  fi
  sleep 1
done

curl -sf "$api_base_url/healthz" >/dev/null

head_sha="$(git rev-parse HEAD)"
manual_response="$(
  curl -sf \
    -X POST \
    "$api_base_url/run-requests/manual" \
    -H "content-type: application/json" \
    --data "{\"repositorySlug\":\"verge\",\"commitSha\":\"$head_sha\",\"changedFiles\":[\"apps/api/src/app.ts\",\"apps/worker/src/index.ts\",\"packages/db/src/index.ts\"]}"
)"
manual_run_request_id="$(node -e "const data = JSON.parse(process.argv[1]); process.stdout.write(data.runRequestId);" "$manual_response")"

VERGE_API_URL="$api_base_url" pnpm --filter @verge/worker dev >/tmp/verge-worker.log 2>&1 &
worker_pid=$!

for _ in $(seq 1 180); do
  detail="$(curl -sf "$api_base_url/run-requests/$manual_run_request_id")"
  status="$(node -e "const data = JSON.parse(process.argv[1]); process.stdout.write(data.status);" "$detail")"
  if [[ "$status" == "passed" || "$status" == "reused" ]]; then
    break
  fi
  if [[ "$status" == "failed" ]]; then
    echo "Self-hosted run failed" >&2
    echo "$detail" >&2
    exit 1
  fi
  sleep 1
done

manual_detail="$(curl -sf "$api_base_url/run-requests/$manual_run_request_id")"
manual_status="$(node -e "const data = JSON.parse(process.argv[1]); process.stdout.write(data.status);" "$manual_detail")"
if [[ "$manual_status" != "passed" && "$manual_status" != "reused" ]]; then
  echo "Self-hosted run did not complete" >&2
  echo "$manual_detail" >&2
  exit 1
fi

kill "$worker_pid" >/dev/null 2>&1 || true
wait "$worker_pid" >/dev/null 2>&1 || true
unset worker_pid

resume_seed_response="$(
  curl -sf \
    -X POST \
    "$api_base_url/run-requests/manual" \
    -H "content-type: application/json" \
    --data "{\"repositorySlug\":\"verge\",\"commitSha\":\"$head_sha\",\"requestedProcessSpecKeys\":[\"test\"],\"resumeFromCheckpoint\":false,\"disableReuse\":true}"
)"
resume_seed_request_id="$(node -e "const data = JSON.parse(process.argv[1]); process.stdout.write(data.runRequestId);" "$resume_seed_response")"

VERGE_API_URL="$api_base_url" pnpm --filter @verge/worker dev -- --once >/tmp/verge-resume-seed-worker.log 2>&1

seed_detail="$(curl -sf "$api_base_url/run-requests/$resume_seed_request_id")"
seed_run_id="$(node -e "const data = JSON.parse(process.argv[1]); process.stdout.write(data.steps[0].id);" "$seed_detail")"
seed_run_detail="$(curl -sf "$api_base_url/runs/$seed_run_id")"
seed_passed="$(node -e "const data = JSON.parse(process.argv[1]); process.stdout.write(String(data.processes.filter((process) => process.status === 'passed').length));" "$seed_run_detail")"
if [[ "$seed_passed" -lt 1 ]]; then
  echo "Checkpoint seed run did not finish any process" >&2
  echo "$seed_run_detail" >&2
  exit 1
fi

resume_response="$(
  curl -sf \
    -X POST \
    "$api_base_url/run-requests/manual" \
    -H "content-type: application/json" \
    --data "{\"repositorySlug\":\"verge\",\"commitSha\":\"$head_sha\",\"requestedProcessSpecKeys\":[\"test\"],\"resumeFromCheckpoint\":true}"
)"
resume_request_id="$(node -e "const data = JSON.parse(process.argv[1]); process.stdout.write(data.runRequestId);" "$resume_response")"
resume_request_detail="$(curl -sf "$api_base_url/run-requests/$resume_request_id")"
resume_run_id="$(node -e "const data = JSON.parse(process.argv[1]); process.stdout.write(data.steps[0].id);" "$resume_request_detail")"
resume_run_detail="$(curl -sf "$api_base_url/runs/$resume_run_id")"
checkpoint_source="$(node -e "const data = JSON.parse(process.argv[1]); process.stdout.write(data.checkpointSourceRunId ?? '');" "$resume_run_detail")"
if [[ -z "$checkpoint_source" ]]; then
  echo "Resume run did not use a checkpoint" >&2
  echo "$resume_run_detail" >&2
  exit 1
fi

VERGE_API_URL="$api_base_url" pnpm --filter @verge/worker dev >/tmp/verge-resume-worker.log 2>&1 &
resume_worker_pid=$!

for _ in $(seq 1 180); do
  detail="$(curl -sf "$api_base_url/run-requests/$resume_request_id")"
  status="$(node -e "const data = JSON.parse(process.argv[1]); process.stdout.write(data.status);" "$detail")"
  if [[ "$status" == "passed" || "$status" == "reused" ]]; then
    break
  fi
  if [[ "$status" == "failed" ]]; then
    echo "Resume run failed" >&2
    echo "$detail" >&2
    exit 1
  fi
  sleep 1
done

resume_final="$(curl -sf "$api_base_url/run-requests/$resume_request_id")"
resume_status="$(node -e "const data = JSON.parse(process.argv[1]); process.stdout.write(data.status);" "$resume_final")"
if [[ "$resume_status" != "passed" && "$resume_status" != "reused" ]]; then
  echo "Resume run did not complete" >&2
  echo "$resume_final" >&2
  exit 1
fi

node - <<'NODE' "$manual_detail" "$resume_final" "$resume_run_detail"
const manual = JSON.parse(process.argv[2]);
const resumed = JSON.parse(process.argv[3]);
const resumeRun = JSON.parse(process.argv[4]);

const summary = {
  selfHostedRequestStatus: manual.status,
  selfHostedRuns: manual.steps.map((step) => ({ key: step.processSpecKey, status: step.status })),
  resumeRequestStatus: resumed.status,
  resumedRun: {
    processSpecKey: resumeRun.processSpecKey,
    status: resumeRun.status,
    checkpointSourceRunId: resumeRun.checkpointSourceRunId,
    reusedProcesses: resumeRun.processes
      .filter((process) => process.status === "reused")
      .map((process) => process.processKey),
    passedProcesses: resumeRun.processes
      .filter((process) => process.status === "passed")
      .map((process) => process.processKey),
  },
};

console.log(JSON.stringify(summary, null, 2));
NODE
