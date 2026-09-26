#!/usr/bin/env bash
set -uo pipefail

if [[ $# -ne 2 || ! "$2" =~ ^[0-9]+$ ]]; then
  echo "usage: $0 <namespace> <local-port>" >&2
  exit 2
fi

namespace=$1
local_port=$2

while true; do
  # Reuse an existing healthy forward; take over if it disappears.
  if curl --silent --fail --max-time 2 "http://127.0.0.1:${local_port}/healthz" >/dev/null; then
    sleep 5
    continue
  fi
  kubectl -n "$namespace" port-forward svc/simulator-store "${local_port}:8080" || true
  sleep 2
done
