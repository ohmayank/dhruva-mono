import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import './sidebar.css';
import Icon from '../common/Icon';

const metricLinks = [
  ['temperature_c', 'Air temperature'],
  ['wind_speed_mps', 'Wind speed'],
  ['wind_direction_deg', 'Wind direction'],
  ['air_pressure_hpa', 'Air pressure'],
  ['relative_humidity_pct', 'Relative humidity'],
  ['precipitation_rate_mmph', 'Precipitation rate'],
];


function StationNavigation({ station, name, open, expanded, onToggle }) {
  const { pathname, hash } = useLocation();
  const base = `/app/${station}/weather`;
  return <div className={`station-nav-group${open ? ' open' : ''}`}>
    <NavLink className="mobile-station-link" to={base}>{name}</NavLink>
    <button aria-label={`${open ? 'Collapse' : 'Expand'} ${name} navigation`} className="station-nav-toggle" type="button" onClick={onToggle} aria-expanded={open}>
      <span className="nav-icon station-icon"><Icon name="station" /></span>
      <span className="nav-text">{name}</span>
      <span className="station-chevron"><Icon name="chevron" /></span>
    </button>
    <div className="station-subnav" inert={!expanded || !open}>
      <Link aria-current={pathname === base && (!hash || hash === '#unified-view') ? 'location' : undefined} to={`${base}#unified-view`}>Live data</Link>
      {metricLinks.map(([key, label]) => <Link aria-current={pathname === base && hash === `#metric-${key}` ? 'location' : undefined} key={key} to={`${base}#metric-${key}`}>{label}</Link>)}
    </div>
  </div>;
}

export default function Sidebar() {
  const [expanded, setExpanded] = useState(true);
  const [openStations, setOpenStations] = useState({ maitri: true, bharti: true });

  function toggleStation(station) {
    if (!expanded) {
      setExpanded(true);
      setOpenStations((current) => ({ ...current, [station]: true }));
      return;
    }
    setOpenStations((current) => ({ ...current, [station]: !current[station] }));
  }

  return <aside className={`app-sidebar${expanded ? ' expanded' : ''}`}>
    <div className="sidebar-head">
      <NavLink to="/" className="sidebar-brand" aria-label="Dhruva landing page"><span className="brand-mark"><Icon name="spark" /></span><strong>Dhruva</strong></NavLink>
      <button className="sidebar-toggle" type="button" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'} aria-expanded={expanded}><Icon name={expanded ? 'previous' : 'next'} /></button>
    </div>
    <nav aria-label="Main navigation" className="primary-nav">
      <span className="nav-label">Workspace</span>
      <NavLink to="/app" end title="Overview"><span className="nav-icon"><Icon name="overview" /></span><span className="nav-text">Overview</span></NavLink>
      <NavLink to="/app/observations" title="Workloads"><span className="nav-icon"><Icon name="workloads" /></span><span className="nav-text">Workloads</span></NavLink>
      <NavLink to="/app/logs" title="Observation logs"><span className="nav-icon"><Icon name="logs" /></span><span className="nav-text">Logs</span></NavLink>
      <span className="nav-label station-label">Stations</span>
      <StationNavigation station="maitri" name="Maitri" expanded={expanded} open={openStations.maitri} onToggle={() => toggleStation('maitri')} />
      <StationNavigation station="bharti" name="Bharati" expanded={expanded} open={openStations.bharti} onToggle={() => toggleStation('bharti')} />
    </nav>
    <div className="researcher-chip">
      <span className="sidebar-avatar">DR</span>
      <span className="researcher-copy"><strong>Station operations</strong><small>Research workspace</small></span>
      <span className="sidebar-external"><Icon name="external" /></span>
    </div>
  </aside>;
}
