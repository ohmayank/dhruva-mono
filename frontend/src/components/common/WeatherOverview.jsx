import { stationTime } from '../../utils/format';
import './weatherOverview.css';

const metrics = [
  { key: 'temperature_c', label: 'Temperature', unit: '°C' },
  { key: 'relative_humidity_pct', label: 'Relative humidity', summaryLabel: 'Rel. humidity', unit: '%' },
  { key: 'air_pressure_hpa', label: 'Air pressure', unit: 'hPa' },
  { key: 'wind_speed_mps', label: 'Wind speed', unit: 'm/s' },
];

function format(value) { return Number.isFinite(value) ? Number(value.toFixed(2)).toString() : '—'; }

function weatherWindow(data) {
  const aws = data.current.find((item) => item.source === 'aws') || [...data.observations].reverse().find((item) => item.source === 'aws');
  const latestAt = aws?.observed_at;
  const cutoff = latestAt ? Date.parse(latestAt) - 24 * 60 * 60 * 1000 : 0;
  const windowSamples = data.observations.filter((item) => item.source === 'aws' && Date.parse(item.observed_at) >= cutoff && Date.parse(item.observed_at) <= Date.parse(latestAt));
  return { aws, latestAt, windowSamples };
}

export function WeatherCurrent({ data }) {
  const { aws, latestAt } = weatherWindow(data);
  return <section className="weather-current" aria-label="Current weather measurements"><div className="weather-current-heading"><span>Latest AWS observation</span><strong>{stationTime(latestAt)}</strong></div><div className="weather-current-grid">{metrics.map((metric) => <div key={metric.key}><span>{metric.label}</span><strong>{format(aws?.values?.[metric.key])}<small>{metric.unit}</small></strong></div>)}</div></section>;
}

export function WeatherSummary({ data }) {
  const { latestAt, windowSamples } = weatherWindow(data);
  const summaries = [
    { label: 'Average', value: (values) => values.reduce((sum, value) => sum + value, 0) / values.length },
    { label: 'Minimum', value: (values) => Math.min(...values) },
    { label: 'Maximum', value: (values) => Math.max(...values) },
  ];
  return <section className="weather-stats" id="weather-summary"><div className="weather-stats-heading"><div><h2>24-hour summary</h2><p>Calculated from {windowSamples.length} stored weather samples ending {stationTime(latestAt)}.</p></div><span>SYNTHETIC DATA</span></div><div className="weather-stats-scroll"><div className="weather-summary-grid">{summaries.map((summary) => <table key={summary.label}><thead><tr><th>Data</th><th>{summary.label}</th></tr></thead><tbody>{metrics.map((metric) => { const values = windowSamples.map((item) => item.values?.[metric.key]).filter(Number.isFinite); return <tr key={metric.key}><th>{metric.summaryLabel || metric.label}</th><td>{format(values.length ? summary.value(values) : NaN)} {metric.unit}</td></tr>; })}</tbody></table>)}</div></div></section>;
}
