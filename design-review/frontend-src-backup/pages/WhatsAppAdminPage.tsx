import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

import type { WhatsAppMessage, WhatsAppTemplate } from "@/api/whatsapp";
import {
  useResubmitTemplate,
  useDeleteTemplate,
  useRunScheduler,
  useSubmitTemplate,
  useSyncTemplates,
  useTestSend,
  useUpdateNumber,
  useUpdateWhatsAppSettings,
  useWhatsAppConnection,
  useWhatsAppEvents,
  useWhatsAppMessageStats,
  useWhatsAppMessages,
  useWhatsAppNumbers,
  useWhatsAppSettings,
  useWhatsAppTemplates,
} from "@/hooks/useWhatsApp";

type Tab = "connection" | "templates" | "events" | "log" | "numbers";

const TABS: [Tab, string, string][] = [
  ["connection", "Connection", "ri-plug-line"],
  ["templates", "Templates", "ri-file-list-3-line"],
  ["events", "Events", "ri-flashlight-line"],
  ["log", "Delivery log", "ri-history-line"],
  ["numbers", "Numbers", "ri-contacts-book-line"],
];

const PAGE_SIZE = 25;
const LEGACY_TEMPLATES = new Set([
  "job_assigned_v1", "qc1_ready_v1", "qc2_assigned_v1", "qc2_unrouted_v1",
  "changes_raised_v1", "final_check_v1", "job_scrapped_v1",
  "job_reassigned_v1", "qc1_flag_raised_v1", "qc1_flag_cleared_v1",
  "deadline_soon_v1", "stuck_rounds_v1", "daily_digest_v1",
]);

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* Status colours are load-bearing here rather than decorative: this page is
 * read to answer "is anything wrong", and the answer should be visible before
 * anything is read. */
const TEMPLATE_STATUS_CLASSES: Record<string, string> = {
  APPROVED: "bg-emerald-500/10 text-emerald-500",
  PENDING: "bg-amber-500/10 text-amber-500",
  REJECTED: "bg-rose-500/10 text-rose-400",
  PAUSED: "bg-orange-500/10 text-orange-400",
  DISABLED: "bg-rose-500/10 text-rose-400",
  NOT_SUBMITTED: "bg-[var(--bg-pill)] text-[var(--text-muted)]",
};

const MESSAGE_STATUS_CLASSES: Record<string, string> = {
  sent: "bg-sky-500/10 text-sky-400",
  delivered: "bg-violet-500/10 text-violet-400",
  read: "bg-emerald-500/10 text-emerald-500",
  failed: "bg-rose-500/10 text-rose-400",
  skipped: "bg-[var(--bg-pill)] text-[var(--text-muted)]",
  queued: "bg-amber-500/10 text-amber-500",
};

const QUALITY_CLASSES: Record<string, string> = {
  GREEN: "bg-emerald-500/10 text-emerald-500",
  YELLOW: "bg-amber-500/10 text-amber-500",
  RED: "bg-rose-500/10 text-rose-400",
};

export default function WhatsAppAdminPage() {
  const [tab, setTab] = useState<Tab>("connection");

  const connection = useWhatsAppConnection();
  const templates = useWhatsAppTemplates();
  const settings = useWhatsAppSettings();

  /* The banner that pays for this whole page. Meta re-files templates after
   * approval, and a UTILITY template quietly reclassified as MARKETING is
   * capped at ~2 messages per person per day across every business on
   * WhatsApp — the sends do not fail, they are simply refused with 131049
   * after the second one. Nothing else in the product would ever say so. */
  const miscategorised = (templates.data ?? []).filter((t) => t.category_drifted);
  const drifted = (templates.data ?? []).filter((t) => t.drifted);

  return (
    <div className="space-y-6">
      <KillSwitch />

      {miscategorised.length > 0 && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-rose-400">
            <i className="ri-alarm-warning-line" />
            Meta has re-categorised {miscategorised.length} template
            {miscategorised.length === 1 ? "" : "s"} away from Utility
          </p>
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            {miscategorised.map((t) => t.name).join(", ")} — now{" "}
            {[...new Set(miscategorised.map((t) => t.category))].join(", ")}. Marketing
            templates are capped at roughly two messages per person per day across every
            business on WhatsApp (error 131049), and no number of extra phone numbers works
            around it. Appeal the category in Meta Business Manager, or reword and resubmit.
          </p>
        </div>
      )}

      {drifted.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-500">
            <i className="ri-git-branch-line" />
            {drifted.length} template{drifted.length === 1 ? " has" : "s have"} drifted from the
            code
          </p>
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            {drifted.map((t) => t.name).join(", ")} — the version Meta approved no longer matches
            what this app sends. The next message using one will be refused with error 132000.
            Resubmit them from the Templates tab.
          </p>
        </div>
      )}

      <nav className="flex flex-wrap gap-1.5">
        {TABS.map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-all ${
              tab === key
                ? "bg-[var(--primary)] text-white"
                : "bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
            }`}
          >
            <i className={icon} />
            {label}
          </button>
        ))}
      </nav>

      {connection.data && !connection.data.configured && (
        <div className="glass-card p-4 text-sm text-[var(--text-muted)]">
          <p className="font-semibold text-[var(--text-main)]">Not connected to Meta yet.</p>
          <p className="mt-1 text-xs">
            Set <code>WHATSAPP_ACCESS_TOKEN</code>, <code>WHATSAPP_PHONE_NUMBER_ID</code> and{" "}
            <code>WHATSAPP_BUSINESS_ACCOUNT_ID</code> in the environment, then restart the app.
            The full setup sequence is in <code>docs/13-whatsapp.md</code>.
          </p>
        </div>
      )}

      {tab === "connection" && <ConnectionTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "events" && <EventsTab />}
      {tab === "log" && <DeliveryLogTab />}
      {tab === "numbers" && <NumbersTab />}

      {settings.isError && (
        <ErrorNote error={settings.error} fallback="Could not read the WhatsApp settings" />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * The kill switch
 * ---------------------------------------------------------------------- */

function KillSwitch() {
  const settings = useWhatsAppSettings();
  const update = useUpdateWhatsAppSettings();
  const enabled = settings.data?.enabled ?? false;

  return (
    <div className="glass-card flex flex-wrap items-center justify-between gap-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-main)]">
          <i className={`ri-whatsapp-line ${enabled ? "text-emerald-500" : ""}`} />
          WhatsApp messaging is {enabled ? "on" : "off"}
        </h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {enabled
            ? "Job events are being sent to people's phones. In-app notifications and desktop push are unaffected either way."
            : "Nothing is being sent. In-app notifications and desktop push carry on exactly as they do now — WhatsApp is additive and never the only path."}
        </p>
      </div>
      <Button
        variant={enabled ? "danger" : "primary"}
        disabled={update.isPending}
        onClick={() => update.mutate({ enabled: !enabled })}
      >
        <i className={enabled ? "ri-stop-circle-line" : "ri-play-circle-line"} />
        {enabled ? "Stop all messages" : "Turn messaging on"}
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Connection
 * ---------------------------------------------------------------------- */

function ConnectionTab() {
  const { data, isLoading, error } = useWhatsAppConnection();
  const templates = useWhatsAppTemplates();
  const testSend = useTestSend();
  const scheduler = useRunScheduler();
  const [template, setTemplate] = useState("job_assigned_v1");

  const approved = (templates.data ?? []).filter((t) => t.status === "APPROVED" && !t.unmanaged);

  if (isLoading) return <p className="text-sm text-[var(--text-muted)]">Checking…</p>;
  if (error) return <ErrorNote error={error} fallback="Could not reach the connection check" />;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Business number" value={data.display_phone_number ?? "—"} />
        <Stat label="Verified name" value={data.verified_name ?? "—"} />
        <Stat
          label="Quality rating"
          value={data.quality_rating ?? "—"}
          tone={QUALITY_CLASSES[data.quality_rating ?? ""]}
        />
        <Stat label="Messaging tier" value={data.messaging_limit ?? "—"} />
      </div>

      {data.error && (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-lg bg-[var(--accent-red-bg)] px-3 py-2 text-xs font-medium text-[var(--accent-red)]"
        >
          <i className="ri-error-warning-line mt-px shrink-0" />
          {data.error}
        </p>
      )}

      <div className="glass-card space-y-3 p-5">
        <h3 className="text-sm font-semibold text-[var(--text-main)]">Credentials</h3>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-xs sm:grid-cols-2">
          <Row label="Graph API version" value={data.graph_version} />
          <Row label="WABA id" value={data.waba_id ?? "not set"} />
          <Row label="Phone number id" value={data.phone_number_id ?? "not set"} />
          <Row label="Access token" value={data.has_token ? "set" : "not set"} />
          <Row label="App secret" value={data.has_app_secret ? "set" : "not set"} />
          <Row label="Verify token" value={data.has_verify_token ? "set" : "not set"} />
        </dl>
        <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
          Values are never shown, only whether they are set — this screen would otherwise put a
          token that can message the whole company into a browser cache and a screenshot.
        </p>
      </div>

      <div className="glass-card space-y-2 p-5">
        <h3 className="text-sm font-semibold text-[var(--text-main)]">Webhook</h3>
        <p className="text-xs text-[var(--text-muted)]">
          Last event received: <strong>{when(data.webhook_last_received_at)}</strong>
        </p>
        {!data.webhook_last_received_at && (
          <p className="text-[11px] leading-relaxed text-amber-500">
            Nothing has ever arrived. Template approvals, delivery receipts and button taps all
            come in this way, so until one does the integration is sending blind. Subscribe the
            app to the WABA at <code>/api/whatsapp/webhook</code> in Meta&nbsp;Business&nbsp;Manager.
          </p>
        )}
      </div>

      <div className="glass-card space-y-3 p-5">
        <h3 className="text-sm font-semibold text-[var(--text-main)]">Send yourself a test</h3>
        <p className="text-xs text-[var(--text-muted)]">
          Runs the real guard rails rather than bypassing them, so &ldquo;nothing arrived&rdquo;
          is diagnosed here instead of after a real hand-off goes missing.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <SearchableSelect value={template} onChange={setTemplate} placeholder={approved.length ? "Choose a template" : "No approved templates yet"} options={approved.map((t) => ({ value: t.name, label: t.name }))} />
          <Button
            disabled={!approved.length || testSend.isPending}
            onClick={() => testSend.mutate({ templateName: template })}
          >
            <i className="ri-send-plane-line" />
            Send test
          </Button>
          <Button
            variant="secondary"
            disabled={scheduler.isPending}
            onClick={() => scheduler.mutate()}
          >
            <i className="ri-refresh-line" />
            Run hourly pass now
          </Button>
        </div>
        {testSend.data && (
          <p className="text-xs text-[var(--text-muted)]">
            Result: <strong>{testSend.data.status}</strong>
            {testSend.data.reason ? ` — ${testSend.data.reason}` : ""}
            {testSend.data.to_phone ? ` (to ${testSend.data.to_phone})` : ""}
          </p>
        )}
        {scheduler.data && (
          <p className="text-xs text-[var(--text-muted)]">
            Reconciled {scheduler.data.reconciled?.seen ?? 0} templates · sent{" "}
            {scheduler.data.deadline_soon} deadline reminders and {scheduler.data.deadline_missed} missed-deadline alerts.
          </p>
        )}
        <ErrorNote error={testSend.error} fallback="The test send failed" />
        <ErrorNote error={scheduler.error} fallback="The scheduled pass failed" />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="glass-card p-5">
      <p className="text-xs font-medium text-[var(--text-muted)]">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone ? "" : "text-[var(--text-main)]"}`}>
        {tone ? <Badge className={tone}>{value}</Badge> : value}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className="font-medium text-[var(--text-main)]">{value}</dd>
    </>
  );
}

/* -------------------------------------------------------------------------
 * Templates
 * ---------------------------------------------------------------------- */

function TemplatesTab() {
  const { data, isLoading, error } = useWhatsAppTemplates();
  const sync = useSyncTemplates();
  const submit = useSubmitTemplate();
  const resubmit = useResubmitTemplate();
  const remove = useDeleteTemplate();
  const [preview, setPreview] = useState<WhatsAppTemplate | null>(null);

  const missing = (data ?? []).filter((t) => t.missing);

  if (isLoading) return <p className="text-sm text-[var(--text-muted)]">Loading templates…</p>;
  if (error) return <ErrorNote error={error} fallback="Could not load the templates" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--text-muted)]">
          Shape is defined in code (<code>services/whatsapp/registry.py</code>); status and
          category are whatever Meta currently says. This table is where the two are compared.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={sync.isPending} onClick={() => sync.mutate()}>
            <i className="ri-download-cloud-line" />
            Sync from Meta
          </Button>
          <Button
            disabled={!missing.length || submit.isPending}
            onClick={async () => {
              /* One at a time, and stop at the first refusal. Firing ten
                 concurrent POSTs at Meta invites a rate limit, and a burst of
                 parallel failures makes it impossible to see which template
                 was actually rejected. */
              for (const template of missing) {
                try {
                  await submit.mutateAsync(template.name);
                } catch {
                  break;
                }
              }
            }}
          >
            <i className="ri-upload-cloud-line" />
            Submit {missing.length || ""} missing
          </Button>
        </div>
      </div>

      <ErrorNote error={sync.error} fallback="The sync failed" />
      <ErrorNote error={submit.error} fallback="Meta refused the submission" />
      <ErrorNote error={resubmit.error} fallback="Meta refused the resubmission" />
      <ErrorNote error={remove.error} fallback="Meta refused the deletion" />
      {sync.data && (
        <p className="text-xs text-[var(--text-muted)]">
          Synced {sync.data.seen} templates, {sync.data.changed} changed.
          {sync.data.unmanaged.length > 0 &&
            ` Not in the registry: ${sync.data.unmanaged.join(", ")}.`}
        </p>
      )}

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--border-color)] text-xs text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Template</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Quality</th>
              <th className="px-4 py-3 font-medium">Last change</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((row) => (
              <tr
                key={`${row.name}:${row.language}`}
                className="border-b border-[var(--border-color)] last:border-0"
              >
                <td className="px-4 py-3">
                  <button
                    type="button"
                    className="text-left font-medium text-[var(--text-main)] hover:text-[var(--primary)]"
                    onClick={() => setPreview(row)}
                  >
                    {row.name}
                  </button>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {row.unmanaged
                      ? "Created at Meta by hand — nothing here knows how to fill it, so it is never sent."
                      : row.purpose}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {row.recipient && !row.unmanaged && (
                      <Badge>
                        <i className="ri-user-line" />
                        {row.recipient}
                      </Badge>
                    )}
                    {row.drifted && (
                      <Badge className="bg-amber-500/10 text-amber-500">
                        <i className="ri-git-branch-line" />
                        code changed — resubmit
                      </Badge>
                    )}
                    {row.unmanaged && (
                      <Badge className="bg-[var(--bg-pill)] text-[var(--text-muted)]">
                        unmanaged
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge
                    className={
                      row.category_drifted
                        ? "bg-rose-500/10 text-rose-400"
                        : "bg-emerald-500/10 text-emerald-500"
                    }
                  >
                    {row.category}
                  </Badge>
                  {row.category_drifted && (
                    <p className="mt-1 text-[11px] text-rose-400">
                      asked for {row.requested_category}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge className={TEMPLATE_STATUS_CLASSES[row.status] ?? ""}>{row.status}</Badge>
                  {row.rejected_reason && (
                    <p className="mt-1 text-[11px] text-rose-400">{row.rejected_reason}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  {row.quality_score ? (
                    <Badge className={QUALITY_CLASSES[row.quality_score] ?? ""}>
                      {row.quality_score}
                    </Badge>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                  {when(row.last_status_at ?? row.last_synced_at)}
                </td>
                <td className="px-4 py-3 text-right">
                  {!row.unmanaged && row.missing && (
                    <Button
                      variant="outline"
                      disabled={submit.isPending}
                      onClick={() => submit.mutate(row.name)}
                    >
                      Submit
                    </Button>
                  )}
                  {!row.unmanaged && !row.missing && (row.drifted || row.status === "REJECTED") && (
                    <Button
                      variant="outline"
                      disabled={resubmit.isPending}
                      onClick={() => resubmit.mutate(row.name)}
                    >
                      Resubmit
                    </Button>
                  )}
                  {row.unmanaged && LEGACY_TEMPLATES.has(row.name) && (
                    <Button
                      variant="outline"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`Delete old template ${row.name} from Meta?`)) {
                          remove.mutate(row.name);
                        }
                      }}
                    >
                      Delete old template
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {preview && (
        <Modal open onClose={() => setPreview(null)} title={preview.name}>
          <TemplatePreview template={preview} />
        </Modal>
      )}
    </div>
  );
}

/** The bubble, roughly as it lands on a phone — with the example values left
 * in as `{{n}}`, because what matters here is the shape and the buttons. */
function TemplatePreview({ template }: { template: WhatsAppTemplate }) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-[#005c4b]/15 p-4">
        <p className="whitespace-pre-wrap text-sm text-[var(--text-main)]">
          {template.body_preview ?? "No body recorded — this template was made outside the app."}
        </p>
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">Kontent OS</p>
        {template.buttons.length > 0 && (
          <div className="mt-3 space-y-1.5 border-t border-[var(--border-color)] pt-3">
            {template.buttons.map((label) => (
              <p key={label} className="text-center text-sm font-medium text-sky-400">
                {label}
              </p>
            ))}
          </div>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-y-1 text-xs">
        <Row label="Language" value={template.language} />
        <Row label="Parameters" value={String(template.param_count ?? "—")} />
        <Row label="Meta id" value={template.meta_template_id ?? "—"} />
        <Row label="Approved" value={when(template.approved_at)} />
      </dl>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Events
 * ---------------------------------------------------------------------- */

const TIER_LABELS: Record<string, string> = {
  core: "Core loop — sent immediately",
  exception: "Exception — rare, and too important to wait",
  scheduled: "Scheduled — fires on a date, not a move",
};

function EventsTab() {
  const { data, isLoading, error } = useWhatsAppEvents();
  const update = useUpdateWhatsAppSettings();

  const grouped = useMemo(() => {
    const groups: Record<string, typeof data> = {};
    (data ?? []).forEach((rule) => {
      (groups[rule.tier] ||= []).push(rule);
    });
    return groups;
  }, [data]);

  if (isLoading) return <p className="text-sm text-[var(--text-muted)]">Loading events…</p>;
  if (error) return <ErrorNote error={error} fallback="Could not load the event rules" />;

  return (
    <div className="space-y-5">
      <p className="text-xs text-[var(--text-muted)]">
        Most job events are in-app only and are not listed here — six messages a video across
        twenty-two people is eighty pings each a month before anything optional is added.
      </p>
      <ErrorNote error={update.error} fallback="Could not save that toggle" />

      {(["core", "exception", "scheduled"] as const).map((tier) => (
        <section key={tier} className="space-y-2">
          <h3 className="text-sm font-semibold text-[var(--text-main)]">{TIER_LABELS[tier]}</h3>
          <div className="glass-card divide-y divide-[var(--border-color)]">
            {(grouped[tier] ?? []).map((rule) => (
              <div key={rule.event_key} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-main)]">
                    {rule.template_name}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">{rule.purpose}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Badge>
                      <i className="ri-user-line" />
                      {rule.recipient}
                    </Badge>
                    <Badge className="bg-[var(--bg-pill)] font-mono text-[10px]">
                      {rule.event_key}
                    </Badge>
                    {!rule.template_ready && (
                      <Badge className="bg-amber-500/10 text-amber-500">
                        <i className="ri-error-warning-line" />
                        template {rule.template_status} — nothing would send
                      </Badge>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={update.isPending}
                  onClick={() =>
                    update.mutate({ event_flags: { [rule.event_key]: !rule.enabled } })
                  }
                  className={`mt-1 h-6 w-11 shrink-0 rounded-full transition-colors ${
                    rule.enabled ? "bg-emerald-500" : "bg-[var(--bg-pill)]"
                  }`}
                  aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.event_key}`}
                >
                  <span
                    className={`block h-5 w-5 rounded-full bg-white transition-transform ${
                      rule.enabled ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Delivery log
 * ---------------------------------------------------------------------- */

const STATUS_FILTERS = ["", "sent", "delivered", "read", "failed", "skipped"];

function DeliveryLogTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const stats = useWhatsAppMessageStats(30);
  const { data, isLoading, error } = useWhatsAppMessages({
    page,
    page_size: PAGE_SIZE,
    status: status || undefined,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="Sent" value={String(stats.data?.sent ?? 0)} />
        <Stat label="Delivered" value={String(stats.data?.delivered ?? 0)} />
        <Stat label="Read" value={String(stats.data?.read ?? 0)} />
        <Stat label="Failed" value={String(stats.data?.failed ?? 0)} />
        <Stat label="Skipped" value={String(stats.data?.skipped ?? 0)} />
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Counted over the last 30 days, across every row rather than this page. A{" "}
        <strong>skipped</strong> message is a decision with a reason on the record, not an
        absence — it is the answer to &ldquo;why didn&rsquo;t they get it&rdquo;.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((value) => (
          <button
            key={value || "all"}
            type="button"
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              status === value
                ? "bg-[var(--primary)] text-white"
                : "bg-[var(--bg-card)] text-[var(--text-muted)]"
            }`}
          >
            {value || "All"}
          </button>
        ))}
      </div>

      {error && <ErrorNote error={error} fallback="Could not load the delivery log" />}
      {isLoading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--border-color)] text-xs text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">To</th>
              <th className="px-4 py-3 font-medium">Template</th>
              <th className="px-4 py-3 font-medium">Job</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((message) => (
              <MessageRow key={message.id} message={message} />
            ))}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                  Nothing sent yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={data.total}
          onPageChange={setPage}
          noun="messages"
        />
      )}
    </div>
  );
}

function MessageRow({ message }: { message: WhatsAppMessage }) {
  return (
    <tr className="border-b border-[var(--border-color)] last:border-0">
      <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{when(message.created_at)}</td>
      <td className="px-4 py-3">
        <p className="font-medium text-[var(--text-main)]">{message.user_name ?? "—"}</p>
        <p className="text-xs text-[var(--text-muted)]">{message.to_phone ?? "no number"}</p>
      </td>
      <td className="px-4 py-3 text-xs">
        <p className="text-[var(--text-main)]">{message.template_name ?? "—"}</p>
        <p className="font-mono text-[10px] text-[var(--text-muted)]">{message.event_key}</p>
      </td>
      <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{message.job_code ?? "—"}</td>
      <td className="px-4 py-3">
        <Badge className={MESSAGE_STATUS_CLASSES[message.status] ?? ""}>{message.status}</Badge>
        {message.reason && (
          <p className="mt-1 max-w-sm text-[11px] text-[var(--text-muted)]">{message.reason}</p>
        )}
        {message.error_detail && (
          <p className="mt-0.5 max-w-sm text-[11px] text-rose-400">{message.error_detail}</p>
        )}
        {message.button_action && (
          <p className="mt-0.5 text-[11px] text-emerald-500">
            tapped {message.button_action} · {when(message.button_tapped_at)}
          </p>
        )}
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------------------
 * Numbers
 * ---------------------------------------------------------------------- */

function NumbersTab() {
  const { data, isLoading, error } = useWhatsAppNumbers();
  const update = useUpdateNumber();

  const unreachable = (data ?? []).filter((n) => !n.reachable);

  if (isLoading) return <p className="text-sm text-[var(--text-muted)]">Loading the roster…</p>;
  if (error) return <ErrorNote error={error} fallback="Could not load the numbers" />;

  return (
    <div className="space-y-4">
      {unreachable.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-500">
            {unreachable.length} {unreachable.length === 1 ? "person" : "people"} cannot be reached
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            They will silently miss every hand-off, and nothing else in the product would ever say
            so — a message that was never sent leaves no trace anywhere a person looks.
          </p>
        </div>
      )}

      <ErrorNote error={update.error} fallback="Could not update that row" />

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--border-color)] text-xs text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Person</th>
              <th className="px-4 py-3 font-medium">Typed</th>
              <th className="px-4 py-3 font-medium">Dialled</th>
              <th className="px-4 py-3 font-medium">Opted in</th>
              <th className="px-4 py-3 font-medium">24h window</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((row) => (
              <tr
                key={row.user_id}
                className={`border-b border-[var(--border-color)] last:border-0 ${
                  row.reachable ? "" : "bg-amber-500/5"
                }`}
              >
                <td className="px-4 py-3">
                  <p className="font-medium text-[var(--text-main)]">{row.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{row.role}</p>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{row.phone ?? "—"}</td>
                <td className="px-4 py-3 text-xs">
                  {row.valid ? (
                    <span className="text-[var(--text-main)]">{row.phone_display}</span>
                  ) : (
                    <Badge className="bg-rose-500/10 text-rose-400">not usable</Badge>
                  )}
                  {row.duplicate && (
                    <p className="mt-1 text-[11px] text-rose-400">
                      shared with another account — buttons cannot be attributed
                    </p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ userId: row.user_id, opt_in: !row.opt_in })}
                    className={`h-6 w-11 rounded-full transition-colors ${
                      row.opt_in ? "bg-emerald-500" : "bg-[var(--bg-pill)]"
                    }`}
                    aria-label={`${row.opt_in ? "Opt out" : "Opt in"} ${row.name}`}
                  >
                    <span
                      className={`block h-5 w-5 rounded-full bg-white transition-transform ${
                        row.opt_in ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                  {row.window_open ? (
                    <Badge className="bg-emerald-500/10 text-emerald-500">open — replies free</Badge>
                  ) : (
                    when(row.last_inbound_at)
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="ghost"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ userId: row.user_id, renormalise: true })}
                  >
                    Re-derive
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        The number itself is edited on Users &amp; Roles, which is where the roster is maintained.
        &ldquo;Re-derive&rdquo; recomputes the dialled form from whatever is typed there — a bare
        ten-digit number is assumed Indian, and when that guess is wrong the typed column is how
        you can see it.
      </p>
    </div>
  );
}
