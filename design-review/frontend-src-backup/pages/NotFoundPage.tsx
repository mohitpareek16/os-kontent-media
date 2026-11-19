import { Link, useLocation } from "react-router-dom";

/** Any URL that matches no route. Without this, a typo'd or stale link
 * rendered an empty page inside the app chrome with no explanation. */
export default function NotFoundPage() {
  const { pathname } = useLocation();

  return (
    <div className="glass-card mx-auto max-w-md space-y-3 p-8 text-center">
      <i className="ri-compass-3-line text-4xl text-[var(--primary)]" />
      <h1 className="text-lg font-bold text-[var(--text-main)]">This page doesn't exist</h1>
      <p className="text-sm text-[var(--text-muted)]">
        Nothing is routed at <span className="font-mono text-[var(--text-main)]">{pathname}</span>.
        The link may be out of date, or the job or pod it pointed at may have been renamed.
      </p>
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--primary-hover)] px-3.5 py-2 text-sm font-semibold text-white shadow-md shadow-[var(--primary-glow-subtle)] transition-all hover:-translate-y-0.5"
      >
        <i className="ri-home-4-line" /> Back to the dashboard
      </Link>
    </div>
  );
}
