import { Link, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { useCurrentUser } from "@/hooks/useAuth";
import { hasRole, isLead } from "@/lib/roles";

/** Any URL that matches no route. Without this, a typo'd or stale link
 * rendered an empty page inside the app chrome with no explanation. The way
 * back is the visitor's own home, not the owner's overview. */
export default function NotFoundPage() {
  const { pathname } = useLocation();
  const { data: user } = useCurrentUser();

  const home = isLead(user)
    ? { to: "/", label: "Back to overview" }
    : hasRole(user, "qc")
      ? { to: "/?view=qcqueue", label: "Back to my queue" }
      : hasRole(user, "ve")
        ? { to: "/?view=pipeline", label: "Back to my pipeline" }
        : hasRole(user, "hr")
          ? { to: "/hr", label: "Back to the directory" }
          : { to: "/", label: "Back to the dashboard" };

  return (
    <div className="glass-card mx-auto max-w-md space-y-2 p-8 text-center">
      <p className="num text-[44px] font-bold leading-none text-[var(--primary)]">404</p>
      <h2 className="text-lg font-bold text-[var(--text-main)]">This page doesn't exist</h2>
      <p className="text-sm text-[var(--text-muted)]">
        Nothing is routed at <span className="font-mono text-[var(--text-main)]">{pathname}</span>.
        The link may be out of date, or the job or pod it pointed at may have been renamed.
      </p>
      <div className="pt-3">
        <Link to={home.to}>
          <Button>{home.label}</Button>
        </Link>
      </div>
    </div>
  );
}
