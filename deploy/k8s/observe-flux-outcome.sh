#!/usr/bin/env bash
# Local demo helper: report a station-local Flux apply back to patch-svc.
# It is intentionally not a deployed controller or a replacement for the
# station's eventual outbox/telemetry agent.
set -euo pipefail

request_id=${1:?usage: observe-flux-outcome.sh REQUEST_ID}
patch_service_url=${PATCH_SERVICE_URL:-http://127.0.0.1:8080}
approval_token=${APPROVAL_TOKEN:?APPROVAL_TOKEN is required}
namespace=${STATION_NAMESPACE:-simulator-maitri}
flux_namespace=${FLUX_NAMESPACE:-flux-system}
flux_kustomization=${FLUX_KUSTOMIZATION:-maitri-workloads}

request=$(curl --fail --silent "$patch_service_url/v1/change-requests/$request_id")
revision=$(sed -n 's/.*"revision":"\([^"]*\)".*/\1/p' <<<"$request")
status=$(sed -n 's/.*"status":"\([^"]*\)".*/\1/p' <<<"$request")
if [[ -z "$revision" ]]; then
  echo "request $request_id has no controlled Git revision" >&2
  exit 1
fi
if [[ "$status" == "confirmed" ]]; then
  echo "request $request_id is already confirmed"
  exit 0
fi

for _ in $(seq 1 30); do
  applied=$(kubectl get kustomization "$flux_kustomization" -n "$flux_namespace" -o jsonpath='{.status.lastAppliedRevision}')
  if [[ "$applied" == *"$revision" ]]; then
    curl --fail-with-body --silent -X POST "$patch_service_url/v1/change-requests/$request_id/outcome" \
      -H "X-Dhruva-Approval: $approval_token" \
      -H 'Content-Type: application/json' \
      --data "{\"status\":\"confirmed\",\"revision\":\"$revision\",\"reporter\":\"station-flux-observer\"}"
    echo
    exit 0
  fi
  sleep 2
done

echo "Flux did not apply revision $revision at $namespace within 60 seconds" >&2
exit 1
