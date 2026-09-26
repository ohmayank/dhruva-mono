# Dhruva demo

A self-contained simulation of Antarctic observations and governed Kubernetes workload changes. Readings update every five seconds; each station opens with 24 hours of history. Requests, approvals, outage queues, Git revisions, and Flux confirmation are simulated in the browser. Demo state persists locally and can be reset.

```bash
npm ci
npm run dev
npm run build
```

For Vercel, set the project **Root Directory** to `frontend`, use the Vite preset, and select `patch-svc` as the production branch if deploying this branch. The repository config selects Node 22, installs with `npm ci`, and builds to `dist`; `vercel.json` handles direct links and page refreshes on workspace routes. Leave `VITE_DATA_MODE` unset (or set it to `demo`): `live` requires local services that Vercel cannot reach. No backend, cluster, or environment variables are needed. Each visitor gets their own demo state.

Try `/app#changes`: pause the station link, request a schedule as Researcher, switch to Station approver and approve it, then restore the link. Delivery and confirmation follow automatically. Submit another request and reject it to see the governance trail. Station approvers can use Apply sooner on an approved change to skip the polling wait; an outage still holds delivery, and approval order is preserved.

To use the existing local backend instead, set `VITE_DATA_MODE=live` and configure the simulator and patch-service proxy targets in `.env`. This mode needs the local services; the default Vercel demo does not.

Workload cards also offer inline requests for calibration frequency, quality review level, and archive retention. These additional capabilities are browser simulations only. Their requests appear in the overview for approval and use independent station connections; the live backend remains limited to the aggregation schedule capability.
