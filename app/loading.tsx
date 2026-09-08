export default function Loading() {
  return (
    <div className="page-stack" aria-busy="true" aria-label="Loading">
      <div className="skeleton skeleton-title" />
      <div className="stats-grid">
        {Array.from({ length: 4 }).map((_, index) => <div className="skeleton skeleton-stat" key={index} />)}
      </div>
      <div className="skeleton skeleton-panel" />
    </div>
  );
}
