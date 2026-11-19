import type { ReactNode } from "react";

interface PageHeaderProps {
  /** One line on what this page is for. NOT a title: the layout header already
   * prints the page title as the page's single <h1>. */
  description?: ReactNode;
  /** Primary / secondary actions, right-aligned. */
  actions?: ReactNode;
  className?: string;
}

/** The strip under the layout header on every page: a description on the left,
 * actions on the right. Replaces the per-page eyebrow + second <h1> + rule. */
export function PageHeader({ description, actions, className = "" }: PageHeaderProps) {
  if (!description && !actions) return null;
  return (
    <div className={`mb-5 flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <div className="max-w-2xl text-sm text-[var(--text-muted)]">{description}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
