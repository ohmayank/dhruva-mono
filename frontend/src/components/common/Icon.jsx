export default function Icon({ name }) {
  const paths = {
    spark: <><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" /></>,
    overview: <><path d="M4 10.5 12 4l8 6.5" /><path d="M6.5 9.5V20h11V9.5M10 20v-6h4v6" /></>,
    workloads: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    logs: <><path d="M7 6h13M7 12h13M7 18h13" /><circle cx="4" cy="6" r=".8" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r=".8" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r=".8" fill="currentColor" stroke="none" /></>,
    station: <><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    external: <><path d="M9 5h10v10M19 5 8 16" /><path d="M15 12v7H5V9h7" /></>,
    previous: <path d="m14 7-5 5 5 5" />,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="white" /><circle cx="15" cy="17" r="3" fill="white" /></>,
    archive: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v12h14V8M10 12h4" /></>,
    wind: <><path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h6a3 3 0 1 1-3 3" /></>,
    droplet: <path d="M12 3s-7 8-7 12a7 7 0 0 0 14 0c0-4-7-12-7-12Z" />,
    activity: <path d="M3 12h4l2.5-5 5 10 2.5-5h4" />,
    refresh: <><path d="M20 7h-5V2" /><path d="M20 7a8 8 0 1 0 1 7" /></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    down: <path d="M12 5v14m-5-5 5 5 5-5" />,
    next: <path d="m10 7 5 5-5 5" />,
  };
  return <svg className="app-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

