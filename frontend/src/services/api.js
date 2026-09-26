import { isSyntheticDemo, syntheticStationData, advanceDemo, requestSummary } from './syntheticDemo';
const stationSources = {
  maitri: ['aws', 'parsivel'],
  bharti: ['aws', 'dcwis'],
};
const simulatorStationNames = { maitri: 'maitri', bharti: 'bharati' };
const patchURL = '/patch';
const seenObservations = new Map();

export const observationMetrics = [
  { key: 'temperature_c', name: 'Temperature', unit: '°C' },
  { key: 'relative_humidity_pct', name: 'Relative humidity', unit: '%' },
  { key: 'air_pressure_hpa', name: 'Air pressure', unit: 'hPa' },
  { key: 'wind_speed_mps', name: 'Wind speed', unit: 'm/s' },
  { key: 'wind_direction_deg', name: 'Wind direction', unit: '°' },
  { key: 'precipitation_rate_mmph', name: 'Precipitation rate', unit: 'mm/h' },
];

async function getJSON(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const detail = await response.text();
    let message = detail.trim() || response.statusText;
    try {
      const parsed = JSON.parse(detail);
      message = parsed.reason || parsed.error || message;
    } catch { /* plain-text API response */ }
    const error = new Error(`${response.status} ${message}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

// Read persisted station history so charts are populated when the page opens.
// Retain seen samples as a fallback while an older simulator store is deployed.
export async function getStationData(station) {
  if (isSyntheticDemo) return syntheticStationData(station);
  const sources = stationSources[station];
  if (!sources) throw new Error(`Unknown station: ${station}`);
  const [results, historyResults] = await Promise.all([
    Promise.allSettled(sources.map((source) => getJSON(`/sim/${station}/latest?source=${encodeURIComponent(source)}`))),
    Promise.allSettled(sources.map((source) => getJSON(`/sim/${station}/observations?source=${encodeURIComponent(source)}&limit=100`))),
  ]);
  const current = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    .filter((item) => item.station === simulatorStationNames[station] && sources.includes(item.source) && item.id && item.observed_at);
  if (current.length === 0) {
    throw new Error(results.map((result) => result.status === 'rejected' ? result.reason.message : 'Unexpected station response').join('; '));
  }
  const history = new Map((seenObservations.get(station) || []).map((item) => [item.id, item]));
  for (const result of historyResults) {
    if (result.status !== 'fulfilled' || !Array.isArray(result.value)) continue;
    for (const item of result.value) {
      if (item.station === simulatorStationNames[station] && sources.includes(item.source) && item.id && item.observed_at) history.set(item.id, item);
    }
  }
  for (const item of current) history.set(item.id, item);
  const observations = [...history.values()]
    .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at))
    .slice(-200);
  seenObservations.set(station, observations);
  const latest = [...current].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0];
  return {
    status: {
      station,
      latest_observed_at: latest.observed_at,
      latest_ingested_at: latest.ingested_at,
      latest_source: latest.source,
      samples_seen: observations.length,
      sources_available: current.map((item) => item.source),
    },
    current,
    observations,
  };
}

export function getPatchDashboard() {
  if (isSyntheticDemo) return Promise.resolve(advanceDemo());
  return getJSON(`${patchURL}/v1/dashboard`);
}

export function setDemoSummaryFrequency(hours, role = 'researcher') {
  if (isSyntheticDemo) return Promise.resolve(requestSummary(hours, role));
  return getJSON(`${patchURL}/v1/demo/summary-frequency`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours }),
  });
}

export function weatherDataset(station, observations) {
  const rows = observations
    .filter((item) => stationSources[station]?.includes(item.source))
    .map((item) => ({ recorded_at: item.observed_at, source: item.source, ...item.values }));
  const available = new Set(rows.flatMap((row) => Object.keys(row)));
  return {
    table: 'observations seen this session',
    station_code: station.toUpperCase(),
    columns: [
      { key: 'recorded_at', name: 'Observed At (IST)', type: 'datetime' },
      { key: 'source', name: 'Source' },
      ...observationMetrics,
    ].filter((column) => available.has(column.key)),
    rows,
  };
}
