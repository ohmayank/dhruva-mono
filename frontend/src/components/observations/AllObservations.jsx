import WorkloadChange from './WorkloadChange';
import { isSyntheticDemo } from '../../services/syntheticDemo';
import { workloadChanges } from '../../services/workloadChanges';
import { Link, useSearchParams } from 'react-router';
import './allObservations.css';
import Icon from '../common/Icon';
import { usePatchData } from '../../services/useLiveData';

const workloads = [
  { station: 'Maitri', namespace: 'maitri', name: 'weather-collector', kind: 'Deployment', title: 'Weather readings', description: 'Temperature, humidity, pressure and wind from the station’s AWS instruments.', cadence: 'Continuous', to: '/app/maitri/weather', action: 'View readings', icon: 'activity' },
  { station: 'Maitri', namespace: 'maitri', name: 'observation-aggregate', kind: 'CronJob', title: 'Observation summaries', description: 'Compiles recent readings into a summary. You can request a different schedule.', connected: true, to: '/app#changes', action: 'Manage schedule', icon: 'refresh' },
  { station: 'Maitri', namespace: 'maitri', name: 'precipitation-collector', kind: 'Deployment', title: 'Snowfall observations', description: 'Precipitation measurements from the Parsivel instrument.', cadence: 'Continuous', to: '/app/maitri/weather#metric-precipitation_rate_mmph', action: 'View precipitation', icon: 'droplet' },
  { station: 'Bharati', namespace: 'bharati', name: 'weather-collector', kind: 'Deployment', title: 'Weather readings', description: 'Weather readings from the AWS instruments at Bharati.', cadence: 'Continuous', to: '/app/bharti/weather', action: 'View readings', icon: 'activity' },
  { station: 'Bharati', namespace: 'bharati', name: 'coastal-collector', kind: 'Deployment', title: 'Coastal conditions', description: 'Weather and precipitation records from the DCWIS instrument.', cadence: 'Continuous', to: '/app/logs?station=bharti', action: 'View records', icon: 'activity' },
  { station: 'Maitri', namespace: 'maitri', name: 'instrument-calibration', kind: 'CronJob', title: 'Instrument calibration', description: 'Checks sensor offsets against reference readings and records calibration results.', cadence: 'Weekly', showOnly: true, icon: 'settings' },
  { station: 'Maitri', namespace: 'maitri', name: 'instrument-records', kind: 'Deployment', title: 'Instrument history', description: 'Search recent AWS and Parsivel records, or download them as a CSV.', cadence: 'Every sample', to: '/app/logs?station=maitri', action: 'View records', icon: 'logs' },
  { station: 'Bharati', namespace: 'bharati', name: 'quality-checks', kind: 'Deployment', title: 'Data quality checks', description: 'Flags missing readings, unusual values and gaps in instrument records for review.', cadence: 'Every sample', showOnly: true, icon: 'check' },
  { station: 'Bharati', namespace: 'bharati', name: 'archive-maintenance', kind: 'CronJob', title: 'Archive maintenance', description: 'Organizes older records and clears temporary files to keep station storage available.', cadence: 'Nightly', showOnly: true, icon: 'archive' },
  { station: 'Maitri', namespace: 'maitri', name: 'station-git-cache', kind: 'Deployment', title: 'Change delivery', description: 'Sends approved changes to Maitri when the connection is available.', cadence: 'When connected', to: '/app#changes', action: 'Track delivery', icon: 'station' },
];

function WorkloadCard({ workload, schedule, data, refresh, role }) {
  const key = `${workload.namespace}/${workload.name}`;
  const capability = isSyntheticDemo && workloadChanges[key];
  const setting = data?.settings?.[key]?.applied || (workload.connected ? schedule : capability?.initial);
  return <article className={`workload-card${workload.connected ? ' connected-workload' : ''}`}>
    <div className="workload-card-head"><span className="workload-icon"><Icon name={workload.icon} /></span><div><span className="workload-station">{workload.station}</span><h2>{workload.title}</h2></div></div>
    <div className="workload-resource"><code>{workload.kind} · {workload.name}</code><span>{workload.namespace} namespace</span></div>
    <p>{workload.description}</p>
    <div className="workload-cadence"><span>{capability ? capability.field : workload.connected ? 'Current schedule' : 'Frequency'}</span><strong>{capability ? setting : workload.connected ? schedule : workload.cadence}</strong></div>
    {workload.showOnly && !capability ? <span className="workload-preview-note">Example workload · Preview only</span> : workload.to && !(workload.connected && isSyntheticDemo) ? <Link className={workload.connected ? 'connected-action' : 'workload-view-action'} to={workload.to}>{workload.action}<Icon name="arrow" /></Link> : null}
    <WorkloadChange workloadKey={key} role={role} data={data} refresh={refresh} />
  </article>;
}

export default function AllObservations() {
  const { data, refresh } = usePatchData();
  const role = 'researcher';
  const [params, setParams] = useSearchParams();
  const station = ['maitri', 'bharati'].includes(params.get('station')) ? params.get('station') : 'all';
  const visibleWorkloads = workloads.filter((workload) => station === 'all' || workload.namespace === station);
  const stationOptions = [['all', 'All stations'], ['maitri', 'Maitri'], ['bharati', 'Bharati']];
  function selectStation(next) {
    const updated = new URLSearchParams(params);
    if (next === 'all') updated.delete('station');
    else updated.set('station', next);
    setParams(updated, { preventScrollReset: true });
  }
  const schedule = data?.workload?.applied_schedule || data?.workload?.desired_schedule;
  const cadence = schedule === '0 */6 * * *' ? 'Every 6 hours' : schedule === '0 */12 * * *' ? 'Every 12 hours' : 'Unavailable';
  return <div className="all-workloads">
    <header className="workload-page-heading"><h1>Workloads</h1><p>What’s running at each station, and where to find its data.</p></header>
    <section className="workload-filter-bar" aria-label="Filter workloads by station"><div className="station-switch" role="group" aria-label="Station filter">{stationOptions.map(([key, label]) => <button type="button" key={key} aria-pressed={station === key} className={station === key ? 'active' : ''} onClick={() => selectStation(key)}>{label}</button>)}</div><span role="status">{visibleWorkloads.length} workloads{station !== 'all' ? ` at ${stationOptions.find(([key]) => key === station)[1]}` : ' across both stations'}</span></section>

    <div className="workload-grid">{visibleWorkloads.map((workload) => <WorkloadCard key={`${workload.namespace}-${workload.name}`} workload={workload} schedule={cadence} data={data} refresh={refresh} role={role} />)}</div>
  </div>;
}
