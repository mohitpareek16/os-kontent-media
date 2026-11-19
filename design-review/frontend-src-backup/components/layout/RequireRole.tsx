import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useCurrentUser } from "@/hooks/useAuth";
import { hasRole } from "@/lib/roles";
import type { Role } from "@/types";

/** Matched against the person's *effective* roles, so a lent TL reaches every
 * lead route the same way a primary one does (`hasRole`). */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading) return null;
  if (!hasRole(user, ...roles)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
