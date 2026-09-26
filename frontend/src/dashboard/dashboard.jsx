import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { isSyntheticDemo } from '../services/syntheticDemo';
import Sidebar from "../components/sidebar/Sidebar";
import "./dashboard.css";

export default function Dashboard() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) { window.scrollTo(0, 0); return; }
    const frame = requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);
  return (
    <div className="dashboard-layout">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Sidebar />
      <main id="main-content" tabIndex={-1} className="dashboard-main-content">
        <>{isSyntheticDemo && <div className="simulation-notice"><span className="live-dot" /><strong>Demo environment</strong></div>}<Outlet /></>
      </main>
    </div>
  );
}
