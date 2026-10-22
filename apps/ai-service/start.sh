#!/usr/bin/env bash
# Container entrypoint: the API, and (INTERVIEWER_IN_CONTAINER=true) the voice worker beside it. Exits when either exits, so the host restarts both.
set -euo pipefail

pids=()
uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" &
pids+=($!)
if [ "${INTERVIEWER_IN_CONTAINER:-}" = "true" ]; then
  python -m app.interviewer.worker start &
  pids+=($!)
fi

stop() { kill "${pids[@]}" 2>/dev/null || true; }
trap 'stop; wait || true; exit 143' TERM INT

status=0
wait -n || status=$?
stop
wait || true
exit "$status"
