import Link from "next/link";

export default function NotFound() {
  return (
    <div className="error-state">
      <span className="eyebrow">404</span>
      <h1>Nothing here</h1>
      <p>This item is not part of your listening history.</p>
      <Link className="button" href="/">Back to overview</Link>
    </div>
  );
}
