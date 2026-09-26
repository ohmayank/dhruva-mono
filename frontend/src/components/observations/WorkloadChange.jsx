import { Link } from 'react-router';
import { useState } from 'react';
import { isSyntheticDemo, requestWorkloadChange } from '../../services/syntheticDemo';
import { workloadChanges, requestWorkloadKey, requestSetting, requestStatus } from '../../services/workloadChanges';

export default function WorkloadChange({ workloadKey, role, data, refresh }) {
  const capability = workloadChanges[workloadKey];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(capability?.options[0] || '');
  const [message, setMessage] = useState('');
  if (!isSyntheticDemo || !capability) return null;
  const requests = (data?.requests || []).filter((r) => requestWorkloadKey(r) === workloadKey);
  const active = requests.filter((r) => !['confirmed', 'rejected'].includes(r.status));
  const latest = active.at(-1);
  const recent = requests.at(-1);
  const applied = data?.settings?.[workloadKey]?.applied || (workloadKey === 'maitri/observation-aggregate' ? (data?.workload?.applied_schedule === '0 */6 * * *' ? 'Every 6 hours' : 'Every 12 hours') : capability.initial);
  function submit(event) {
    event.preventDefault();
    try {
      requestWorkloadChange(workloadKey, value, role);
      refresh(); setEditing(false); setMessage('');
    } catch (error) { setMessage(error.message); }
  }
  return <div className="workload-change">
    {!latest && role === 'researcher' && <button className="workload-request-button" type="button" aria-expanded={editing} onClick={() => { if (!editing) setValue(capability.options.find((option) => option !== applied) || capability.options[0]); setEditing(!editing); setMessage(''); }}>{editing ? 'Cancel' : 'Change setting'}</button>}
    {editing && !latest && role === 'researcher' && <form onSubmit={submit}><label><span>{capability.field}</span><select aria-label={capability.field} value={value} onChange={(event) => setValue(event.target.value)}>{capability.options.map((option) => <option key={option}>{option}</option>)}</select></label><button type="submit" disabled={value === applied}>Request change</button><p>Requires station approval.</p></form>}
    {latest && <div className="workload-pending"><div><strong>{requestSetting(latest)}</strong><span>{active.length > 1 ? `${active.length} changes pending` : requestStatus(latest.status)}</span></div><Link to="/app#changes">View request{active.length > 1 ? 's' : ''} →</Link></div>}
    {!latest && recent?.status === 'rejected' && <p className="workload-change-result">Last request declined. Current setting unchanged.</p>}
    {message && <p role="alert">{message}</p>}
  </div>;
}
