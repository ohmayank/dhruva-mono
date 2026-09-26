import { Link } from 'react-router';
import { useStationData } from '../services/useLiveData';
import './landing.css';
import Icon from '../components/common/Icon';

function Arrow({ down = false }) { return <Icon name={down ? 'down' : 'arrow'} />; }
function LogoMark() { return <Icon name="spark" />; }

function weather(data) {
  const sample = data?.current.find((item) => item.source === 'aws');
  return {
    temperature: sample?.values?.temperature_c,
    wind: sample?.values?.wind_speed_mps,
    humidity: sample?.values?.relative_humidity_pct,
  };
}

function Brand() {
  return <Link className="landing-brand" to="/" aria-label="Dhruva home">
    <span className="landing-brand-mark"><LogoMark /></span>
    <span>Dhruva</span>
  </Link>;
}

function StationCard({ station, name, instrument, index, data }) {
  const { temperature, wind, humidity } = weather(data);
  return <Link className="landing-station" to={`/app/${station}/weather`}>
    <div className="landing-station-top">
      <span>0{index}</span>
      <span className="landing-live"><i /> LIVE SIMULATION</span>
    </div>
    <div className="landing-station-copy">
      <span>{name}</span>
      <strong>{Number.isFinite(temperature) ? temperature : '—'}<small>°C</small></strong>
      <p>{instrument}</p>
    </div>
    <div className="landing-station-stats">
      <span>Wind <b>{Number.isFinite(wind) ? `${wind} m/s` : '—'}</b></span>
      <span>Humidity <b>{Number.isFinite(humidity) ? `${humidity}%` : '—'}</b></span>
      <span className="landing-round-arrow"><Arrow /></span>
    </div>
  </Link>;
}

function WorkspacePreview({ maitri, bharati }) {
  const stations = [{ name: 'Maitri', data: maitri }, { name: 'Bharati', data: bharati }];
  return <div className="landing-workspace" aria-label="Dhruva workspace preview">
    <div className="landing-workspace-head">
      <div><span className="landing-avatar">DR</span><span><small>Research workspace</small><b>Station overview</b></span></div>
      <span className="landing-online"><i /> Sync active</span>
    </div>
    <div className="landing-workspace-body">
      <div className="landing-workspace-title"><span>Antarctica / Live</span><h3>Station conditions</h3><p>Latest simulated readings across the network.</p></div>
      <div className="landing-workspace-grid">
        {stations.map(({ name, data }) => {
          const values = weather(data);
          return <div className="landing-reading" key={name}>
            <div><span>{name}</span><i /></div>
            <strong>{Number.isFinite(values.temperature) ? values.temperature : '—'}<small>°C</small></strong>
            <p>{Number.isFinite(values.wind) ? `${values.wind} m/s wind` : 'Awaiting observations'}</p>
          </div>;
        })}
      </div>
      <div className="landing-delivery">
        <span className="landing-delivery-icon" aria-hidden="true"><Icon name="check" /></span>
        <span><b>Changes remain governed</b><small>Request → approval → station confirmation</small></span>
        <Link to="/app#changes">View trail <Arrow /></Link>
      </div>
    </div>
  </div>;
}

export default function Landing() {
  const maitri = useStationData('maitri');
  const bharati = useStationData('bharti');

  return <div className="landing">
    <header className="landing-nav">
      <Brand />
      <nav className="landing-nav-links" aria-label="Primary navigation">
        <a href="#platform">Platform <Icon name="chevron" /></a>
        <a href="#stations">Stations</a>
        <a href="#governance">Governance</a>
        <a href="#story">How it works <Icon name="chevron" /></a>
      </nav>
      <div className="landing-nav-actions">
        <Link className="landing-signin" to="/app">View demo</Link>
        <Link className="landing-get-started" to="/app">Open workspace <Arrow /></Link>
      </div>
    </header>

    <main>
      <section className="landing-hero" id="platform" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <a className="landing-announcement" href="#governance"><span>Demo</span> Kubernetes at the edge <Arrow /></a>
          <h1 id="landing-title">Research at the edge of the world.</h1>
          <p>Antarctic science runs on resilient infrastructure. Explore station data and see how approved changes reach Kubernetes workloads—even after a connection goes dark.</p>
          <div className="landing-hero-actions">
            <Link className="landing-primary-action" to="/app">Explore the workspace <Arrow /></Link>
            <a className="landing-secondary-action" href="#story">See how it works <Arrow /></a>
          </div>
          <span className="landing-hero-note">Interactive simulation · No cluster or account required</span>
        </div>
        <WorkspacePreview maitri={maitri.data} bharati={bharati.data} />
      </section>

      <section className="landing-trust" aria-label="Platform capabilities">
        <span>Built for research at the world’s most remote stations</span>
        <div><b>OFFLINE-FIRST</b><b>GOVERNED CHANGE</b><b>KUBERNETES + FLUX</b><b>AUDITABLE</b></div>
      </section>

      <section id="story" className="landing-story">
        <div className="landing-section-copy">
          <span className="landing-eyebrow">How it works</span>
          <h2>From field observation to confident action.</h2>
          <p>Dhruva keeps the science moving when connectivity does not—and makes every operational change easy to understand.</p>
          <div className="landing-section-actions"><Link to="/app">Open workspace <Arrow /></Link><a href="#stations">Explore stations <Arrow /></a></div>
        </div>
        <div className="landing-steps">
          <article><span>01</span><div><h3>Observe continuously</h3><p>Station instruments keep collecting conditions even while the delivery link is unavailable.</p></div></article>
          <article><span>02</span><div><h3>Approve with context</h3><p>Authorized researchers request a controlled change and reviewers see exactly what will happen.</p></div></article>
          <article><span>03</span><div><h3>Deliver and confirm</h3><p>When the link returns, the approved revision reaches the station and its outcome is confirmed.</p></div></article>
        </div>
      </section>

      <section id="stations" className="landing-stations">
        <div className="landing-section-copy landing-section-copy-centered">
          <span className="landing-eyebrow">Station network</span>
          <h2>Two stations. One shared view.</h2>
          <p>Move from a live summary to detailed weather observations in a single click.</p>
        </div>
        <div className="landing-station-grid">
          <StationCard station="maitri" name="Maitri" instrument="AWS + Parsivel" index={1} data={maitri.data} />
          <StationCard station="bharti" name="Bharati" instrument="AWS + DCWIS" index={2} data={bharati.data} />
        </div>
      </section>

      <section id="governance" className="landing-governance">
        <div className="landing-governance-copy"><span className="landing-eyebrow">Governance, visible</span><h2>Every change has a clear path.</h2><p>See the request, decision, delivery revision, and final station outcome without losing the human story behind the infrastructure.</p><Link to="/app#changes">Follow a governed change <Arrow /></Link></div>
        <div className="landing-timeline">
          <div><span className="done"><Icon name="check" /></span><p><b>Request submitted</b><small>Observation schedule · 12h → 6h</small></p><em>09:42</em></div>
          <div><span className="done"><Icon name="check" /></span><p><b>Approved</b><small>Capability verified for researcher</small></p><em>09:44</em></div>
          <div><span className="active"><Icon name="arrow" /></span><p><b>Delivered to Maitri</b><small>Station-local Git → Flux reconciliation</small></p><em>09:51</em></div>
          <div><span className="done"><Icon name="check" /></span><p><b>Station confirmed</b><small>CronJob schedule verified at station</small></p><em>09:52</em></div>
        </div>
      </section>

      <section className="landing-final">
        <span className="landing-eyebrow">Research, connected</span>
        <h2>See the whole station story.</h2>
        <div><Link className="landing-primary-action" to="/app">Open the workspace <Arrow /></Link><a href="#stations">View station data <Arrow /></a></div>
      </section>
    </main>

    <footer className="landing-footer"><Brand /><p>Resilient Antarctic research operations.</p><div><a href="#story">How it works</a><a href="#stations">Stations</a><Link to="/app">Workspace</Link></div><span>Dhruva · Interactive demonstration</span></footer>
  </div>;
}
