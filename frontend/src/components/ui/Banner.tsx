import type { ReactNode } from "react";

type Tone = "bad" | "warn" | "info" | "ok";

const TONES: Record<Tone, { box: string; icon: string; iconClass: string; title: string }> = {
  bad: { box: "bg-[var(--bad-bg)]", icon: "ri-alarm-warning-fill", iconClass: "text-[var(--bad-text)]", title: "text-[var(--bad-text)]" },
  warn: { box: "bg-[var(--warn-bg)]", icon: "ri-error-warning-fill", iconClass: "text-[var(--warn-text)]", title: "text-[var(--warn-text)]" },
  ok: { box: "bg-[var(--ok-bg)]", icon: "ri-checkbox-circle-fill", iconClass: "text-[var(--ok-text)]", title: "text-[var(--ok-text)]" },
  info: { box: "bg-[var(--bg-pill)]", icon: "ri-information-fill", iconClass: "text-[var(--primary)]", title: "text-[var(--text-main)]" },
};

interface BannerProps {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  /** A `Button size="sm"` or link. */
  action?: ReactNode;
  icon?: string;
  className?: string;
}

/** A page-level notice: icon, optional bold title, 14px body, optional
 * action. Replaces the hand-coloured `border-rose-500/30 bg-rose-500/10`
 * boxes (which measured ~2:1 contrast). */
export function Banner({ tone = "info", title, children, action, icon, className = "" }: BannerProps) {
  const t = TONES[tone];
  return (
    <div
      role={tone === "bad" || tone === "warn" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-xl px-4 py-3 ${t.box} ${className}`}
    >
      <i className={`${icon ?? t.icon} mt-0.5 text-xl ${t.iconClass}`} />
      <div className="min-w-0 flex-1">
        {title && <p className={`font-bold ${t.title}`}>{title}</p>}
        {children && <div className="text-sm text-[var(--text-muted)]">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
