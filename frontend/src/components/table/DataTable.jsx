import Icon from '../common/Icon';
import { useState } from 'react';
import { stationTime } from '../../utils/format';
import './dataTable.css';

export default function DataTable({ dataset }) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [page, setPage] = useState(1);
  const columns = dataset?.columns || [];
  const rows = [...(dataset?.rows || [])].reverse();
  const sources = [...new Set(rows.map((row) => row.source))];
  const filtered = rows.filter((row) => (source === 'all' || row.source === source) && (!query || Object.values(row).some((value) => String(value).toLowerCase().includes(query.toLowerCase()))));
  const visibleColumns = columns.filter((column) => ['recorded_at', 'source'].includes(column.key) || filtered.some((row) => row[column.key] !== null && row[column.key] !== undefined));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * 20, currentPage * 20);

  function exportCSV() {
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const lines = [columns.map((column) => escape(column.name)).join(','), ...filtered.map((row) => columns.map((column) => escape(column.key === 'recorded_at' ? stationTime(row[column.key]) : row[column.key])).join(','))];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${dataset.station_code.toLowerCase()}-observations.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <section className="observation-table-card">
    <div className="table-heading"><div><span className="table-kicker">Data explorer</span><h2>Observation log</h2><p>Inspect the stored measurements received from each station instrument.</p></div><button className="table-export" onClick={exportCSV} disabled={!filtered.length}>Export CSV <Icon name="download" /></button></div>
    <div className="table-toolbar"><div className="table-actions"><label><span>Instrument</span><select value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}><option value="all">All instruments</option>{sources.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label><label className="table-search"><span>Search records</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search a source or value" /></label></div><div className="table-result-count"><strong>{filtered.length}</strong><span>matching samples</span></div></div>
    {filtered.length ? <div className="table-shell"><div className="table-scroll"><table><thead><tr>{visibleColumns.map((column) => <th scope="col" key={column.key}>{column.name}{column.unit ? <small>{column.unit}</small> : null}</th>)}</tr></thead><tbody>{visible.map((row, index) => <tr key={`${row.recorded_at}-${row.source}-${index}`}>{visibleColumns.map((column) => <td key={column.key} className={`column-${column.key}`}>{column.key === 'recorded_at' ? stationTime(row[column.key]) : column.key === 'source' ? <span className="table-source-badge">{row.source.toUpperCase()}</span> : row[column.key] ?? <span className="missing-value">—</span>}</td>)}</tr>)}</tbody></table></div></div> : <p className="table-empty">{rows.length ? 'No observations match the current filters.' : 'No observations received yet.'}</p>}
    <div className="table-footer"><span>Showing {filtered.length ? `${(currentPage - 1) * 20 + 1}–${Math.min(currentPage * 20, filtered.length)}` : '0'} of {filtered.length}</span>{filtered.length > 20 && <div className="table-pagination"><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><button disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div>}</div>
  </section>;
}
