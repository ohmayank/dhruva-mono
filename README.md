# Maitri local GitOps outage demo

This prototype simulates a station scientific stream and one approved change to its aggregation CronJob schedule. It is a proposed workflow, not a deployment at NCPOR. The local Git daemon stands in for a station-side cache; the link toggle controls whether the approval service publishes to that cache. The station simulator has no dependency on that toggle.

Prerequisites: Go, Git, kubectl with Kustomize support, curl, and a local Kubernetes cluster with Flux installed for the optional in-cluster reconciliation. Commands below run from the repository root. Use separate terminals for long-running commands.

```sh
export DEMO_DIR="$(mktemp -d)"
export APPROVAL_TOKEN=local-demo-token
mkdir -p "$DEMO_DIR/mainland/gitops/maitri/patches" "$DEMO_DIR/station"
cp gitops/maitri/kustomization.yaml "$DEMO_DIR/mainland/gitops/maitri/"
cp gitops/maitri/patches/observation-aggregate-schedule.yaml "$DEMO_DIR/mainland/gitops/maitri/patches/"
mkdir -p "$DEMO_DIR/mainland/simulate"
cp -R simulate/k8s "$DEMO_DIR/mainland/simulate/"
git -C "$DEMO_DIR/mainland" init -b master
git -C "$DEMO_DIR/mainland" add gitops simulate/k8s
git -C "$DEMO_DIR/mainland" -c user.name=demo -c user.email=demo@local commit -m baseline
git init --bare "$DEMO_DIR/station/desired-state.git"
git -C "$DEMO_DIR/mainland" remote add station "$DEMO_DIR/station/desired-state.git"
```

Run the simulator locally with persistent observation storage (terminal 1). Its producer writes immediately and then every minute. Restarting the store reads its data file.

```sh
cd simulate
DATA_DIR="$DEMO_DIR/observations" go run . store
```

```sh
cd simulate
STATION=maitri SOURCE=parsivel INTERVAL=1m STORE_URL=http://localhost:8080 go run . producer
```

Run the approval and gateway service (terminal 3). State is outside the Git worktree so retries and duplicate suppression survive restart.

```sh
cd deploy/k8s
PORT=8081 GIT_WORKTREE="$DEMO_DIR/mainland" GIT_PUSH_REMOTE=station GATEWAY_STATE="$DEMO_DIR/gateway.json" APPROVAL_TOKEN="$APPROVAL_TOKEN" go run .
```

The link starts down. In another terminal, approve exactly the 12-hour to 6-hour schedule change and inspect the held revision. The station bare repo still has no master ref while observations keep arriving.

```sh
curl -s -H "X-Dhruva-Approval: $APPROVAL_TOKEN" -H 'Content-Type: application/json' -d '{"request_id":"demo-1","station":"maitri","schedule":"0 */6 * * *","approved_by":"demo-operator"}' http://localhost:8081/v1/approved-schedule-changes
curl -s -H "X-Dhruva-Approval: $APPROVAL_TOKEN" http://localhost:8081/v1/state
curl -s http://localhost:8080/latest?source=parsivel
git --git-dir="$DEMO_DIR/station/desired-state.git" show-ref || true
```

Before restoring the link, serve the station cache and give Flux a route to the host. From the repo root, run the local smart-HTTP Git cache in another terminal:

```sh
cd deploy/k8s/gitcache
GIT_PROJECT_ROOT="$DEMO_DIR/station" PORT=9418 go run .
```

Set `STATION_GIT_URL` to the host address reachable **from Flux pods** (for example, a cluster-specific host gateway). Install the baseline first, then the narrow Flux RBAC and source resources. The source is empty until restore, so Flux cannot fetch the new revision during the outage. After restore, the GitRepository becomes ready and the CronJob reconciles.

```sh
export STATION_GIT_URL='http://REPLACE_WITH_REACHABLE_HOST:9418/desired-state.git'
kubectl apply -f simulate/k8s/overlays/maitri/namespace.yaml
kubectl apply -k simulate/k8s/overlays/maitri
kubectl apply -f deploy/flux/maitri/bootstrap.yaml
kubectl apply -f deploy/flux/maitri/source.yaml
kubectl -n flux-system patch gitrepository maitri-desired-state --type=merge -p "{\"spec\":{\"url\":\"$STATION_GIT_URL\"}}"
kubectl apply -f deploy/flux/maitri/reconcile.yaml
kubectl -n flux-system get gitrepository maitri-desired-state
kubectl -n simulator-maitri get cronjob observation-aggregate -o jsonpath='{.spec.schedule}'
```

Stop and restart terminal 3 with the same command, then restore the link. The gateway pushes the saved revision to the station cache. Sending the same approval again returns `already-generated`; the delivered revision and attempt count stay unchanged.

```sh
curl -s -H "X-Dhruva-Approval: $APPROVAL_TOKEN" -H 'Content-Type: application/json' -d '{"up":true}' http://localhost:8081/v1/link
curl -s -H "X-Dhruva-Approval: $APPROVAL_TOKEN" http://localhost:8081/v1/state
git --git-dir="$DEMO_DIR/station/desired-state.git" show-ref
curl -s -H "X-Dhruva-Approval: $APPROVAL_TOKEN" -H 'Content-Type: application/json' -d '{"request_id":"demo-1","station":"maitri","schedule":"0 */6 * * *","approved_by":"demo-operator"}' http://localhost:8081/v1/approved-schedule-changes
```

The `ko://simulator` images in the baseline require a local image build/load or a cluster with ko support. The Git and gateway exercise above runs without a cluster. Kubernetes admission policy rejects schedule values outside 12 or 6 hours and changes to the enumerated CronJob spec fields; Flux's ServiceAccount can update only the named CronJob. This is prototype policy, not production authorization or a secure satellite transport.

Tests:

```sh
cd deploy/k8s && go test ./...
kubectl kustomize gitops/maitri
```
