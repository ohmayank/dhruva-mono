import { workloadChanges, requestWorkloadKey, requestStation, requestSetting } from './workloadChanges.js';
// Browser-only simulation of the proven request → Git delivery → Flux outcome flow.
const storageKey = 'dhruva-synthetic-demo-v1';
export const isSyntheticDemo = import.meta.env?.VITE_DATA_MODE !== 'live';
const iso = (at = Date.now()) => new Date(at).toISOString();
const revision = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), (n) => n.toString(16).padStart(2, '0')).join('');
function initialState() {
  const rev = revision();
  return { station_revisions: { Maitri: { delivered: rev, applied: rev }, Bharati: { delivered: '', applied: '' } }, link_up: true, link_changed_at: iso(), pending_revision: '', delivered_revision: rev, applied_revision: rev, workload: { desired_schedule: '0 */12 * * *', applied_schedule: '0 */12 * * *' }, requests: [], demo_controls_enabled: true };
}
let state;
try { state = JSON.parse(localStorage.getItem(storageKey)); } catch { /* Storage can be disabled. */ }
if (!state || state.version !== 1) state = { ...initialState(), version: 1 };
state.settings ||= {};
state.station_revisions ||= { Maitri: { delivered: state.delivered_revision, applied: state.applied_revision }, Bharati: { delivered: '', applied: '' } };
state.station_links ||= { Maitri: state.link_up, Bharati: true };
function save() { try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* The demo still works in memory. */ } }
function event(request, status, reason, actor = 'Station controller', at = Date.now()) {
  request.status = status;
  request.audit.push({ status, reason, actor, at: iso(at) });
}
export function advanceDemo(now = Date.now()) {
  // Advance one revision at a time so queued changes reach Flux in order.
  for (const station of ['Maitri', 'Bharati']) {
  const active = state.requests.filter((r) => ['awaiting-sync', 'delivered'].includes(r.status) && requestStation(r) === station)
    .sort((a, b) => Date.parse(a.approved_at || a.audit.find((e) => e.status === 'awaiting-sync')?.at) - Date.parse(b.approved_at || b.audit.find((e) => e.status === 'awaiting-sync')?.at))[0];
  if (active?.status === 'awaiting-sync' && state.station_links[station] && now - Date.parse(active.approved_at || active.audit.at(-1).at) >= (active.reconcile_requested_at ? 0 : 2500)) {
    event(active, 'delivered', active.reconcile_requested_at ? 'Revision mirrored to station-local Git. Requested immediate Flux source and workload reconciliation.' : 'Revision mirrored to station-local Git. Flux reconciliation started.', 'Git delivery service', now);
    active.delivered_at = iso(now);
    state.station_revisions[station].delivered = active.revision;
    if (station === 'Maitri') state.delivered_revision = active.revision;
  } else if (active?.status === 'delivered' && now - Date.parse(active.delivered_at || active.audit.find((e) => e.status === 'delivered')?.at) >= (active.reconcile_requested_at ? 1000 : 4000)) {
    event(active, 'confirmed', 'Flux applied the exact revision. Workload setting verified.', 'Flux outcome observer', now);
    state.station_revisions[station].applied = active.revision;
    if (station === 'Maitri') state.applied_revision = active.revision;
    const key = requestWorkloadKey(active);
    state.settings[key] ||= {};
    state.settings[key].applied = requestSetting(active);
    if (key === 'maitri/observation-aggregate') state.workload.applied_schedule = active.schedule;
  }

  }
  state.pending_revision = state.requests.filter((r) => r.status === 'awaiting-sync' && requestStation(r) === 'Maitri').sort((a, b) => Date.parse(a.approved_at || a.audit.find((e) => e.status === 'awaiting-sync')?.at) - Date.parse(b.approved_at || b.audit.find((e) => e.status === 'awaiting-sync')?.at))[0]?.revision || '';
  save();
  return structuredClone(state);
}
export function requestSummary(hours, role) {
  if (role !== 'researcher') throw new Error('Forbidden: only the researcher role can submit requests in Maitri.');
  if (![6, 12].includes(hours)) throw new Error('The demo supports a 6-hour or 12-hour aggregation schedule.');
  const request = { request_id: crypto.randomUUID(), schedule: `0 */${hours} * * *`, status: 'pending-approval', audit: [] };
  event(request, 'pending-approval', `Researcher requested aggregation every ${hours} hours. Capability and role verified.`, 'Demo researcher');
  state.requests.push(request);
  save();
  return structuredClone(request);
}
export function requestWorkloadChange(key, value, role) {
  if (role !== 'researcher') throw new Error('Only researchers can submit changes.');
  const capability = workloadChanges[key];
  if (!capability || !capability.options.includes(value)) throw new Error('This setting is not an allowed workload change.');
  if (key === 'maitri/observation-aggregate') return requestSummary(value === 'Every 6 hours' ? 6 : 12, role);
  const request = { request_id: crypto.randomUUID(), workload_key: key, value, status: 'pending-approval', audit: [] };
  event(request, 'pending-approval', `${capability.field}: ${value}. Researcher capability verified for ${capability.station}.`, 'Demo researcher');
  state.requests.push(request);
  save();
  return structuredClone(request);
}
export function reviewRequest(id, approved, role) {
  if (role !== 'approver') throw new Error('Forbidden: only the station approver role can review station requests.');
  const request = state.requests.find((r) => r.request_id === id);
  if (!request || request.status !== 'pending-approval') throw new Error('This request has already been reviewed.');
  if (approved) {
    request.revision = revision();
    request.approved_at = iso();
    const key = requestWorkloadKey(request);
    state.settings[key] ||= {};
    state.settings[key].desired = requestSetting(request);
    if (key === 'maitri/observation-aggregate') state.workload.desired_schedule = request.schedule;
    event(request, 'awaiting-sync', state.station_links[requestStation(request)] ? 'Approved. Controlled Kustomize patch committed; queued for delivery.' : 'Approved. Revision queued until station connectivity returns.', 'Demo station approver');
  } else event(request, 'rejected', 'Declined by station approver. Workload and Git revision unchanged.', 'Demo station approver');
  save();
  return advanceDemo();
}
export function reconcileNow(id, role) {
  if (role !== 'approver') throw new Error('Forbidden: only the station approver role can request reconciliation for approved changes.');
  const request = state.requests.find((r) => r.request_id === id);
  if (!request || !['awaiting-sync', 'delivered'].includes(request.status) || !request.revision) {
    throw new Error('Only an approved, unconfirmed revision can be reconciled.');
  }
  if (!request.reconcile_requested_at) {
    request.reconcile_requested_at = iso();
    event(request, request.status, state.station_links[requestStation(request)]
      ? 'Reconcile now requested. Skip the normal polling wait once this revision reaches the front of the delivery queue.'
      : 'Reconcile now requested. Held until connectivity returns; approved revisions remain in order.', 'Demo station approver');
    save();
  }
  return advanceDemo();
}
export function setDemoLink(up, station = 'Maitri') {
  if (!['Maitri', 'Bharati'].includes(station)) throw new Error('Unknown station.');
  state.station_links[station] = up;
  if (station === 'Maitri') { state.link_up = up; state.link_changed_at = iso(); }
  save();
  return advanceDemo();
}
export function resetSyntheticDemo() { state = { ...initialState(), settings: {}, station_links: { Maitri: true, Bharati: true }, version: 1 }; save(); return structuredClone(state); }

function values(at, station, source) {
  const t = at / 1000;
  const offset = station === 'maitri' ? 0 : 1.4;
  const wave = (period, phase = 0) => Math.sin(t / period + offset + phase);
  const round = (n) => Math.round(n * 100) / 100;
  const weather = {
    temperature_c: round((station === 'maitri' ? -14 : -9) + 1.8 * wave(26000) + .12 * wave(6500)),
    relative_humidity_pct: round(72 + 6 * wave(30000, 2) + .4 * wave(7800)),
    air_pressure_hpa: round(987 + 3 * wave(42000, 1) + .08 * wave(10000)),
    wind_speed_mps: round(6 + 1.6 * wave(19000) + .18 * wave(6000)),
    wind_direction_deg: round(190 + 25 * wave(27000, 1)),
  };
  const precipitation = round(Math.max(0, .16 + .14 * wave(28000, 3) + .01 * wave(7500)));
  return source === 'parsivel' ? { precipitation_rate_mmph: precipitation } : { ...weather, ...(source === 'dcwis' ? { precipitation_rate_mmph: precipitation } : {}) };
}
export function syntheticStationData(station, now = Date.now()) {
  if (!['maitri', 'bharti'].includes(station)) throw new Error('Unknown station');
  const sources = station === 'maitri' ? ['aws', 'parsivel'] : ['aws', 'dcwis'];
  const sample = (at, source) => ({ id: `${station}-${source}-${at}`, station: station === 'bharti' ? 'bharati' : station, source, observed_at: iso(at), ingested_at: iso(at + 400), values: values(at, station, source) });
  const latestAt = Math.floor(now / 5000) * 5000;
  const start = Math.floor(latestAt / 300000) * 300000;
  const observations = [];
  for (let i = 287; i >= 0; i--) for (const source of sources) observations.push(sample(start - i * 300000, source));
  const current = sources.map((source) => sample(latestAt, source));
  if (latestAt !== start) observations.push(...current);
  return { status: { station, latest_observed_at: iso(latestAt), latest_ingested_at: iso(latestAt + 400), latest_source: 'aws', samples_seen: observations.length, sources_available: sources }, current, observations };
}
