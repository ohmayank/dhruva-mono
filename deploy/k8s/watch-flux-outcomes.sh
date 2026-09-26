#!/usr/bin/env bash
# Poll delivered change requests and report only revisions that Flux has applied.
set -euo pipefail

patch_service_url=${PATCH_SERVICE_URL:-http://127.0.0.1:18080}
poll_seconds=${POLL_SECONDS:-10}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

: "${APPROVAL_TOKEN:?APPROVAL_TOKEN is required}"
command -v jq >/dev/null

while true; do
  requests=$(curl --fail --silent --show-error "$patch_service_url/v1/change-requests")
  while IFS= read -r request_id; do
    [[ -z "$request_id" ]] && continue
    if ! "$script_dir/observe-flux-outcome.sh" "$request_id"; then
      echo "Station confirmation still pending for $request_id" >&2
    fi
  done < <(jq -r '.[] | select(.status == "delivered") | .request_id' <<<"$requests")
  [[ "${WATCH_ONCE:-0}" == "1" ]] && exit 0
  sleep "$poll_seconds"
done
