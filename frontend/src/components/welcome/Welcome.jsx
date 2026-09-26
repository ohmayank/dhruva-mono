import { requestTitle, requestStation } from '../../services/workloadChanges';
import { useState } from 'react';
import { Link } from 'react-router';
import { observationMetrics, setDemoSummaryFrequency } from '../../services/api';
import { usePatchData, useStationData } from '../../services/useLiveData';
import { freshness, stationTime } from '../../utils/format';
import './welcome.css';
import Icon from '../common/Icon';
import DemoPanel, { DemoReview } from '../common/DemoPanel';
import { isSyntheticDemo } from '../../services/syntheticDemo';

const scheduleLabel = (value) => value === '0 */6 * * *' ? 'Every 6 hours' : value === '0 */12 * * *' ? 'Every 12 hours' : 'Unavailable';
const statusLabels = {
  'pending-approval': 'Awaiting review',
  'awaiting-sync': 'Waiting for delivery',
  'already-generated': 'Waiting for delivery',
  delivered: 'Delivered to station',
  confirmed: 'Active at station',
  rejected: 'Declined',
  failed: 'Needs attention',
};
const statusLabel = (status) => statusLabels[status] || 'Status unavailable';

function StationSummary({ station, name, sources, linkDownAt, linkState }) {
  const { data, error, loading } = useStationData(station);
  const latest = data?.status.latest_observed_at;
  const connectionNote = error ? 'Observations unavailable' : loading ? 'Loading observations' : station !== 'maitri' ? 'Readings available' : linkState === 'unknown' ? 'Delivery status unavailable' : linkState === 'up' ? 'Delivery available'
    : !linkDownAt ? 'Delivery paused' : latest && Date.parse(latest) > Date.parse(linkDownAt) ? 'Collecting during delivery pause' : 'Waiting for next sample';
  const readings = (data?.current || []).flatMap((sample) => observationMetrics
    .filter((metric) => Number.isFinite(sample.values?.[metric.key]))
    .map((metric) => ({ key: `${sample.source}-${metric.key}`, source: sample.source.toUpperCase(), label: metric.name, value: sample.values[metric.key], unit: metric.unit, observedAt: sample.observed_at })));
  const featured = readings.find((item) => item.label === 'Temperature') || readings[0];
  const secondary = readings.filter((item) => item !== featured).slice(0, 4);

  return <article className="station-summary">
    <div className="station-summary-head"><div><span className="station-kicker"><span className={`live-dot${error || !latest ? ' unavailable' : ''}`} /> Latest station snapshot</span><h3>{name}</h3></div><Link to={`/app/${station}/weather`} aria-label={`Explore ${name} observations`}>Explore data <Icon name="arrow" /></Link></div>
    <div className="station-feature"><span>{featured?.label || 'Latest reading'}</span><strong>{featured ? <>{featured.value}<small>{featured.unit}</small></> : loading ? 'Loading…' : '—'}</strong><span>{featured?.source || 'No instrument sample'} · {stationTime(featured?.observedAt)}</span></div>
    {error ? <p className="error-text">Observations unavailable: {error}</p> : <dl className="reading-grid">{secondary.map((item) => <div key={item.key}><dt>{item.label} <small>· {item.source}</small></dt><dd>{item.value}<small>{item.unit}</small></dd></div>)}</dl>}
    <div className="station-foot"><span>{sources.map((source) => source.toUpperCase()).join(' + ')} instruments</span><span>{freshness(latest)} · {connectionNote}</span></div>
  </article>;
}

function StationControls({ patch }) {
  const { data, error, refresh } = patch;
  const [role, setRole] = useState('researcher');
  const canRequest = !isSyntheticDemo || role === 'researcher';
  const pending = (data?.requests || []).filter((item) => item.status === 'pending-approval');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const currentSchedule = data?.workload?.desired_schedule;
  const controlsEnabled = data?.demo_controls_enabled === true;
  const history = [...(data?.requests || [])].sort((a, b) => Date.parse(b.audit?.at(-1)?.at || 0) - Date.parse(a.audit?.at(-1)?.at || 0)).slice(0, 5);

  async function changeSummary(hours) {
    setBusy(true); setMessage('');
    try {
      const result = await setDemoSummaryFrequency(hours, role);
      await refresh();
      setMessage(result.status === 'pending-approval' ? 'Request submitted. Switch to Station approver to review it in the approval queue.' : result.status === 'delivered' ? 'Change delivered. Waiting for station confirmation.' : 'Change saved. Delivery will resume when the connection is available.');
    } catch (cause) { setMessage(cause.message); }
    finally { setBusy(false); }
  }

  return <section className="change-section" id="changes">
    <div className="section-header"><div><span className="eyebrow">Research workflow</span><h2>Workload changes</h2><p>Review station requests and follow each change through delivery and confirmation.</p></div><button className="quiet-button" onClick={refresh}>Refresh status <Icon name="refresh" /></button></div>
    {error && <p className="error-text">Workload controls unavailable: {error}</p>}
    <DemoPanel data={data} refresh={refresh} role={role} onRoleChange={(next) => { setRole(next); setMessage(''); }} />
    <div className="workflow-grid">
      <article className="setting-card connected-setting"><div className="setting-heading"><div><span className="card-overline">MAITRI · OBSERVATION AGGREGATION</span><h3>Observation summary frequency</h3><p>How often collected observations are compiled for review.</p></div><span className="setting-badge">Approval required</span></div><div className="setting-value"><span>Active at station</span><strong>{scheduleLabel(data?.workload?.applied_schedule || currentSchedule)}</strong>{data?.workload?.applied_schedule && data.workload.applied_schedule !== currentSchedule && <span>Approved next setting: {scheduleLabel(currentSchedule)}</span>}</div><div className="setting-actions"><button disabled={busy || !controlsEnabled || !canRequest || (!isSyntheticDemo && currentSchedule === '0 */6 * * *')} onClick={() => changeSummary(6)}>{isSyntheticDemo ? 'Request 6-hour schedule' : 'Every 6 hours'}</button><button disabled={busy || !controlsEnabled || !canRequest || (!isSyntheticDemo && currentSchedule === '0 */12 * * *')} onClick={() => changeSummary(12)}>{isSyntheticDemo ? 'Request 12-hour schedule' : 'Every 12 hours'}</button></div><small>{!canRequest ? 'Switch to Researcher to submit a schedule request.' : controlsEnabled ? 'The setting changes only after approval and station confirmation.' : 'Direct demo control is unavailable in this patch service.'}</small></article>
      <article className="delivery-card"><span className="card-overline">DELIVERY STATE</span><div className="delivery-state"><span className={`state-indicator ${data?.link_up === undefined ? 'unknown' : data.link_up ? 'up' : 'down'}`} /><strong>{data?.link_up === undefined ? 'Status unknown' : data.link_up ? 'Link available' : 'Link paused'}</strong></div><p>{data?.link_up === false ? 'Maitri keeps collecting observations while a change waits for delivery.' : 'Approved changes can be delivered to Maitri.'}</p><dl><div><dt>Waiting for delivery</dt><dd>{(data?.requests || []).filter((item) => item.status === 'awaiting-sync' && requestStation(item) === 'Maitri').length} changes</dd></div><div><dt>Awaiting confirmation</dt><dd>{(data?.requests || []).filter((item) => item.status === 'delivered' && requestStation(item) === 'Maitri').length} changes</dd></div></dl></article>
    </div>
    {message && <p className="action-message" role="status">{message}</p>}
    {isSyntheticDemo && role === 'approver' && <section className="approval-queue" aria-labelledby="approval-heading"><div className="history-heading"><div><span className="card-overline">STATION APPROVER WORKSPACE</span><h3 id="approval-heading">Pending review</h3></div><span>{pending.length} requests</span></div>{pending.length ? pending.map((item) => <article key={item.request_id}><strong>{requestStation(item)} · {requestTitle(item)}</strong><p>Requested by Demo researcher · {stationTime(item.audit?.[0]?.at)}</p><span className="review-scope">{requestStation(item)} · Workload setting change</span><DemoReview request={item} refresh={refresh} role={role} /></article>) : <p className="history-empty">No requests awaiting review. Submit a change from Workloads or the schedule control above.</p>}</section>}
    <div className="change-history"><div className="history-heading"><div><span className="card-overline">REQUEST TRAIL</span><h3>Recent changes</h3></div><span>{history.length} shown</span></div>{history.length ? <ol>{history.map((item) => <li key={item.request_id}><div className="history-main"><strong>{requestStation(item)} · {requestTitle(item)}</strong><span className={`request-status status-${item.status}`}>{statusLabel(item.status)}</span></div><div className="history-meta"><time>{stationTime(item.audit?.at(-1)?.at)}</time><span>{item.status === 'confirmed' ? 'Station confirmed' : item.status === 'rejected' ? 'Setting unchanged' : 'Decision and delivery tracked'}</span></div>{isSyntheticDemo && item.status === 'pending-approval' && <p className="pending-review-note">Waiting for a station approver’s decision.</p>}<details><summary>View change history</summary>{item.revision && <p className="technical-reference">Delivery reference: <code>{item.revision.slice(0, 12)}</code></p>}<ol>{(item.audit || []).map((event, index) => <li key={`${event.at}-${index}`}><strong>{statusLabel(event.status)}</strong><span>{event.reason || 'Status updated'} · {event.actor || 'System'} · {stationTime(event.at)}</span></li>)}</ol></details></li>)}</ol> : <p className="history-empty">Your change history starts here. Submit a schedule request to follow its journey.</p>}</div>

  </section>;
}

export default function Welcome() {
  const patch = usePatchData();
  const linkDownAt = patch.data && patch.data.link_up === false && patch.data.link_changed_at && !patch.data.link_changed_at.startsWith('0001-') ? patch.data.link_changed_at : null;
  const linkState = patch.data?.link_up === null || patch.data?.link_up === undefined ? 'unknown' : patch.data.link_up ? 'up' : 'down';
  return <div className="operations-page">
    <header className="hero"><div className="hero-copy"><span className="hero-eyebrow">DHRUVA / STATION OPERATIONS</span><h1>Antarctic observations,<br /><em>in focus.</em></h1><p>See the latest station measurements, inspect instrument data, and follow changes from request to station confirmation.</p><div className="hero-actions"><Link className="primary-action" to="/app/observations">View all workloads <Icon name="arrow" /></Link><a className="secondary-action" href="#changes">Track a change <Icon name="down" /></a></div></div><div className="hero-aside"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="polar-point" /><span className="hero-aside-label">ANTARCTIC RESEARCH NETWORK</span><strong>02 <small>stations</small></strong><span>MAITRI  ·  BHARATI</span></div></header>
    <section className="readings-section" aria-labelledby="station-heading"><div className="section-header"><div><span className="eyebrow">LIVE FROM THE STATIONS</span><h2 id="station-heading">Latest observations</h2><p>Current readings across both stations. All times are IST.</p></div><Link className="text-link" to="/app/observations">Manage station workloads <Icon name="arrow" /></Link></div><div className="station-grid"><StationSummary station="maitri" name="Maitri" sources={['aws', 'parsivel']} linkDownAt={linkDownAt} linkState={linkState} /><StationSummary station="bharti" name="Bharati" sources={['aws', 'dcwis']} linkDownAt={linkDownAt} linkState={linkState} /></div></section>
    <StationControls patch={patch} />
  </div>;
}
