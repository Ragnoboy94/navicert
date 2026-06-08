export function SiteMapShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-map-page">
      <div className="site-map-layer" aria-hidden />
      <div className="site-map-content">{children}</div>
    </div>
  );
}
