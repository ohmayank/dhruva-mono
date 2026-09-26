import './pageHeader.css';

export default function PageHeader({ eyebrow, title, description, children }) {
  return <header className="page-header">
    <div className="page-header-copy"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
    {children && <div className="page-header-actions">{children}</div>}
  </header>;
}
