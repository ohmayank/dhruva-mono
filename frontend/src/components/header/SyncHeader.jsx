import { freshness, stationTime } from '../../utils/format';
import './syncHeader.css';
import PageHeader from '../common/PageHeader';

export default function SyncHeader({ stationKey, pageTitle, moduleDescription, status, onRefresh }) {
  return <PageHeader eyebrow={`${stationKey === 'maitri' ? 'Maitri' : 'Bharati'} / Station observations`} title={pageTitle} description={moduleDescription}>
    <div className="observation-meta"><div><span>Latest observed</span><strong>{stationTime(status?.latest_observed_at)}</strong></div><div><span>Freshness</span><strong>{freshness(status?.latest_observed_at)}</strong></div><div><span>Source</span><strong>{status?.latest_source?.toUpperCase() || '—'}</strong></div><button onClick={onRefresh}>Refresh</button></div>
  </PageHeader>;
}
