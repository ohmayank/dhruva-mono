import Icon from '../common/Icon';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { weatherDataset } from '../../services/api';
import { useStationData } from '../../services/useLiveData';
import DataTable from '../table/DataTable';
import './observationLogs.css';
import PageHeader from '../common/PageHeader';

const stations = {
  maitri: { name: 'Maitri', instruments: 'AWS + Parsivel' },
  bharti: { name: 'Bharati', instruments: 'AWS + DCWIS' },
};

export default function ObservationLogs() {
  const [params, setParams] = useSearchParams();
  const station = params.get('station') === 'bharti' ? 'bharti' : 'maitri';
  const setStation = (next) => setParams({ station: next });
  const { data, loading, error, refresh } = useStationData(station);
  const dataset = useMemo(() => data ? weatherDataset(station, data.observations) : null, [station, data]);
  const selected = stations[station];

  return <div className="logs-page">
    <PageHeader eyebrow="Research records" title="Observation logs" description="Search, filter, and export measurements from each station instrument.">
      <button className="quiet-button" type="button" onClick={refresh}>Refresh records <Icon name="refresh" /></button>
    </PageHeader>
    <section className="logs-station-bar" aria-label="Choose a station">
      <div className="logs-station-switch">{Object.entries(stations).map(([key, item]) => <button type="button" key={key} aria-pressed={station === key} className={station === key ? 'active' : ''} onClick={() => setStation(key)}><span>{item.name}</span><small>{item.instruments}</small></button>)}</div>
      <div className="logs-station-context"><span>Viewing</span><strong>{selected.name}</strong><small>{data?.status?.samples_seen || 0} stored samples</small></div>
    </section>
    {loading ? <p className="logs-state">Loading {selected.name} records…</p> : error ? <p className="logs-state error-text">Simulator unavailable: {error}</p> : <DataTable key={station} dataset={dataset} />}
  </div>;
}
