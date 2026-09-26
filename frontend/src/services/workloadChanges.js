// Bounded capabilities for the browser demo. Live backend capability stays unchanged.
export const workloadChanges = {
  'maitri/observation-aggregate': { title: 'Observation summaries', station: 'Maitri', field: 'Summary frequency', initial: 'Every 12 hours', options: ['Every 6 hours', 'Every 12 hours'] },
  'maitri/instrument-calibration': { title: 'Instrument calibration', station: 'Maitri', field: 'Calibration frequency', initial: 'Weekly', options: ['Daily', 'Weekly', 'Every 2 weeks'] },
  'bharati/quality-checks': { title: 'Data quality checks', station: 'Bharati', field: 'Review level', initial: 'Standard checks', options: ['Standard checks', 'Enhanced checks', 'Hold for review'] },
  'bharati/archive-maintenance': { title: 'Archive maintenance', station: 'Bharati', field: 'Retention', initial: '90 days', options: ['30 days', '90 days', '180 days'] },
};
export const requestWorkloadKey = (request) => request.workload_key || 'maitri/observation-aggregate';
export const requestStation = (request) => workloadChanges[requestWorkloadKey(request)]?.station || 'Maitri';
export const requestSetting = (request) => request.value || (request.schedule === '0 */6 * * *' ? 'Every 6 hours' : 'Every 12 hours');
export const requestTitle = (request) => `${workloadChanges[requestWorkloadKey(request)]?.title || 'Observation summaries'} · ${requestSetting(request)}`;
export const requestStatus = (status) => ({ 'pending-approval': 'Awaiting review', 'awaiting-sync': 'Waiting for delivery', delivered: 'Delivered to station', confirmed: 'Active at station', rejected: 'Declined' }[status] || 'Needs attention');
