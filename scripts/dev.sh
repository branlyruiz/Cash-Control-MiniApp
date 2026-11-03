#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
frontend_port="${FRONTEND_PORT:-3100}"
backend_pid=""
frontend_pid=""

cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$backend_pid" ]]; then kill "$backend_pid" 2>/dev/null || true; fi
  if [[ -n "$frontend_pid" ]]; then kill "$frontend_pid" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(cd "$root_dir/cash-control--backend" && exec .venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000) &
backend_pid=$!
(cd "$root_dir/cash-control-admin--front" && exec ./node_modules/.bin/next dev --hostname 127.0.0.1 --port "$frontend_port") &
frontend_pid=$!

echo "Web: http://127.0.0.1:$frontend_port"
echo "API: http://127.0.0.1:8000/docs"
echo "Pulsa Ctrl+C para detener ambos servidores."

while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$frontend_pid" 2>/dev/null; do
  sleep 1
done

echo "Uno de los servidores se detuvo; cerrando el otro." >&2
exit 1
