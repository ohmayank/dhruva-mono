export function stationTime(value) {
  if (!value || value === '0001-01-01T00:00:00Z') return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' }) + ' IST';
}

export function freshness(value) {
  if (!value) return 'No observations';
  const age = Date.now() - Date.parse(value);
  if (!Number.isFinite(age)) return 'Unknown';
  if (age < 0) return 'Clock ahead';
  if (age < 60_000) return 'Under 1 min old';
  if (age < 3_600_000) return `${Math.floor(age / 60_000)} min old`;
  return `${Math.floor(age / 3_600_000)} hr old`;
}
