import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router';
import { useStationData } from '../../services/useLiveData';
import { weatherDataset } from '../../services/api';
import SyncHeader from '../header/SyncHeader';
import ApacheEChart from '../charts/ApacheEChart';
import { WeatherSummary } from './WeatherOverview';
import './stationModulePage.css';

export default function StationModulePage({ stationKey, pageTitle, moduleDescription }) {
  const { hash } = useLocation();
  const { data, loading, error, refresh } = useStationData(stationKey);
  const dataset = useMemo(() => data ? weatherDataset(stationKey, data.observations) : null, [stationKey, data]);

  useEffect(() => {
    if (loading || !hash) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return () => window.cancelAnimationFrame(frame);
  }, [hash, loading]);

  return <div className="station-page-wrapper">
    <SyncHeader stationKey={stationKey} pageTitle={pageTitle} moduleDescription={moduleDescription} status={data?.status} onRefresh={refresh} />
    {loading ? <p className="page-state">Loading observations…</p> : error ? <p className="page-state error-text">Simulator unavailable: {error}</p> : <>
      <ApacheEChart dataset={dataset} />
      <WeatherSummary data={data} />
    </>}
  </div>;
}
