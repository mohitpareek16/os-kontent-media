import type { Notification } from "@/types";

/** How loud a row is allowed to be. `danger` is reserved for the two things
 * somebody has to stop and deal with — a change list and a scrapped project. */
export type NotificationTone = "primary" | "danger" | "muted";

export const TONE_ICON_CLASSES: Record<NotificationTone, string> = {
  primary: "bg-[var(--bg-pill)] text-[var(--primary-text)]",
  danger: "bg-[var(--bad-bg)] text-[var(--bad-text)]",
  muted: "bg-[var(--bg-pill)] text-[var(--text-muted)]",
};

export interface NotificationDescription {
  headline: string;
  icon: string;
  tone: NotificationTone;
}

/** The icon and the loudness for each kind of event.
 *
 * **The sentence is no longer here.** It moved to the server
 * (`services/notification_text.py`) when push notifications landed: the
 * inbox and the toast could share this module, but a service worker woken by
 * the OS with no page behind it cannot import it, and writing the same
 * sentences again in a second language is exactly the drift the old comment
 * in this file was guarding against. So one event, one sentence, rendered
 * once and carried on `Notification.headline`.
 *
 * What stayed is what has no meaning off a screen: which glyph to draw and
 * whether the row is red. A CSS class is not a sentence, and an OS
 * notification has no use for either.
 */
const EVENT_STYLE: Record<string, { icon: string; tone: NotificationTone }> = {
  intake: { icon: "ri-add-circle-line", tone: "primary" },
  stage_changed: { icon: "ri-arrow-right-circle-line", tone: "primary" },
  changes_raised: { icon: "ri-error-warning-line", tone: "danger" },
  note_added: { icon: "ri-chat-1-line", tone: "muted" },
  job_updated: { icon: "ri-pencil-line", tone: "muted" },
  job_reassigned: { icon: "ri-user-shared-line", tone: "primary" },
  job_scrapped: { icon: "ri-close-circle-line", tone: "danger" },
  qc1_flag_raised: { icon: "ri-flag-2-line", tone: "danger" },
  qc1_flag_cleared: { icon: "ri-flag-off-line", tone: "primary" },
  qc2_assigned_v1: { icon: "ri-shield-check-line", tone: "primary" },
  job_restored: { icon: "ri-arrow-go-back-line", tone: "primary" },
  brand_kit_updated: { icon: "ri-palette-line", tone: "primary" },
};

/** What actually happened, in one line, with the job named — plus how to
 * draw it.
 *
 * The headline comes off the row. The fallback is for a server that predates
 * `headline` (a browser holding a cached page through a deploy), and it is
 * deliberately not a second implementation of the wording: it names the
 * event and the job and stops there. */
export function describeNotification(n: Notification): NotificationDescription {
  const style = EVENT_STYLE[n.event_type] ?? { icon: "ri-information-line", tone: "muted" as const };
  return {
    headline: n.headline || `${n.event_type.replace(/_/g, " ")} on ${n.job_code}`,
    icon: style.icon,
    tone: style.tone,
  };
}
