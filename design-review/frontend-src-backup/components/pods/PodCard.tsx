import { useState } from "react";
import { Link } from "react-router-dom";

import type { UpdatePodPayload } from "@/api/pods";
import { ChannelList } from "@/components/pods/ChannelList";
import { MemberList } from "@/components/pods/MemberList";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Input } from "@/components/ui/Input";
import { PillButton } from "@/components/ui/PillButton";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useAllChannels, useUpdatePod } from "@/hooks/usePods";
import type { Pod, PodStatus, User } from "@/types";

interface PodCardProps {
  pod: Pod;
  tl?: User;
  /** Owner, or the TL of this pod — the server checks the same thing. */
  canManage: boolean;
  /** Handing a pod to a different TL is Owner-only (403 otherwise). */
  isOwner: boolean;
  /** Active TL/Owner accounts, the only ones the server accepts as a pod TL. */
  tlOptions: User[];
}

export const POD_STATUS_META: Record<
  PodStatus,
  { label: string; icon: string; className: string; blurb: string }
> = {
  active: {
    label: "Active",
    icon: "ri-play-circle-line",
    className: "bg-[var(--accent-green-bg)] text-[var(--accent-green)]",
    blurb: "Retainer running — jobs flow normally.",
  },
  paused: {
    label: "Paused",
    icon: "ri-pause-circle-line",
    className: "bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]",
    blurb: "On hold — no new work expected this cycle.",
  },
  churned: {
    label: "Churned",
    icon: "ri-close-circle-line",
    className: "bg-[var(--accent-red-bg)] text-[var(--accent-red)]",
    blurb: "Client has left. Kept for history and past deliveries.",
  },
};

const POD_STATUSES: PodStatus[] = ["active", "paused", "churned"];

export function PodCard({ pod, tl, canManage, isOwner, tlOptions }: PodCardProps) {
  const updatePod = useUpdatePod(pod.id);
  /* One query for every card on the page — react-query dedupes it by key — so
     each card can say how many channels the client has without a request of
     its own. The number is the point: a card that says nothing about channels
     is why they were impossible to find. */
  const { data: allChannels } = useAllChannels();
  const channelCount = (allChannels ?? []).filter((c) => c.pod_id === pod.id).length;

  /* Which drawer is open, rather than one flag for both: the roster and the
     channels used to share a button labelled "Members", so the only way to
     discover that a client even *has* channels was to open something that did
     not mention them. */
  const [panel, setPanel] = useState<"members" | "channels" | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmChurn, setConfirmChurn] = useState(false);
  const [saved, setSaved] = useState(false);

  const [name, setName] = useState(pod.name);
  const [status, setStatus] = useState<PodStatus>(pod.status);
  const [currency, setCurrency] = useState(pod.billing_currency);
  const [retainer, setRetainer] = useState(pod.retainer_volume?.toString() ?? "");
  const [tlId, setTlId] = useState(pod.tl_id);

  const statusMeta = POD_STATUS_META[pod.status];

  function openEditor() {
    setName(pod.name);
    setStatus(pod.status);
    setCurrency(pod.billing_currency);
    setRetainer(pod.retainer_volume?.toString() ?? "");
    setTlId(pod.tl_id);
    updatePod.reset();
    setSaved(false);
    setEditing(true);
  }

  function submit() {
    const payload: UpdatePodPayload = {
      name: name.trim(),
      status,
      billing_currency: currency.trim() || pod.billing_currency,
      retainer_volume: retainer.trim() === "" ? null : Number(retainer),
    };
    // Only an Owner may send tl_id at all, and only when it actually changed —
    // a TL saving a rename must not trip the 403.
    if (isOwner && tlId !== pod.tl_id) payload.tl_id = tlId;

    updatePod.mutate(payload, {
      onSuccess: () => {
        setConfirmChurn(false);
        setEditing(false);
        setSaved(true);
      },
    });
  }

  function handleSave() {
    if (status === "churned" && pod.status !== "churned") {
      setConfirmChurn(true);
      return;
    }
    submit();
  }

  return (
    <div className={`glass-card p-5 transition-all ${pod.status === "churned" ? "opacity-75" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-xl text-lg font-extrabold text-white shadow-md ${
              pod.status === "churned"
                ? "bg-[var(--text-dim)]"
                : "bg-gradient-to-br from-[var(--primary)] to-[var(--primary-hover)] shadow-[var(--primary-glow-subtle)]"
            }`}
          >
            {pod.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-base font-bold text-[var(--text-main)]">{pod.name}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <i className="ri-user-star-line" /> TL: {tl?.name ?? "—"}
            </p>
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${statusMeta.className}`}
          title={statusMeta.blurb}
        >
          <i className={statusMeta.icon} /> {statusMeta.label}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--border-color-subtle)] pt-4 text-xs">
        <div>
          <span className="block text-[var(--text-dim)]">Billing</span>
          <span className="font-mono text-sm font-bold text-[var(--text-main)]">{pod.billing_currency}</span>
        </div>
        <div>
          <span className="block text-[var(--text-dim)]">Retainer / mo</span>
          <span className="font-mono text-sm font-bold text-[var(--text-main)]">
            {pod.retainer_volume ?? "—"}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link to={`/pods/${pod.id}/brand-assets`} className="min-w-[8rem] flex-1">
          <Button variant="secondary" className="w-full">
            <i className="ri-book-open-line" /> Brand assets
          </Button>
        </Link>
        <Button
          variant="secondary"
          className="w-full min-w-[8rem] flex-1"
          onClick={() => setPanel((p) => (p === "members" ? null : "members"))}
        >
          <i className={panel === "members" ? "ri-arrow-up-s-line" : "ri-group-line"} />
          {panel === "members" ? "Hide members" : "Members"}
        </Button>
        {/* Its own button, and it says the count: "where does this client
            publish" is a question about the client, asked as often as who works
            on it. */}
        <Button
          variant="secondary"
          className="w-full min-w-[8rem] flex-1"
          onClick={() => setPanel((p) => (p === "channels" ? null : "channels"))}
          title={
            channelCount
              ? `${pod.name} publishes to ${channelCount} channel(s)`
              : `No channels on ${pod.name} yet — add one and every video can say which it is for`
          }
        >
          <i className={panel === "channels" ? "ri-arrow-up-s-line" : "ri-play-list-2-line"} />
          {panel === "channels" ? "Hide channels" : `Channels${channelCount ? ` · ${channelCount}` : ""}`}
        </Button>
        {canManage && (
          <Button
            variant={editing ? "outline" : "secondary"}
            className="w-full min-w-[8rem] flex-1"
            onClick={() => (editing ? setEditing(false) : openEditor())}
          >
            <i className={editing ? "ri-close-line" : "ri-settings-3-line"} />
            {editing ? "Cancel" : "Edit pod"}
          </Button>
        )}
      </div>

      {saved && !editing && (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-[var(--accent-green)]">
          <i className="ri-check-line" /> Pod updated.
        </p>
      )}

      {editing && (
        <form
          className="mt-4 animate-fade-in-up space-y-3 border-t border-[var(--border-color-subtle)] pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
              Client name
            </label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
              Status
            </label>
            <div className="flex flex-wrap gap-1.5">
              {POD_STATUSES.map((s) => (
                <PillButton key={s} active={status === s} onClick={() => setStatus(s)}>
                  <i className={POD_STATUS_META[s].icon} /> {POD_STATUS_META[s].label}
                </PillButton>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">{POD_STATUS_META[status].blurb}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
                Billing currency
              </label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="INR" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
                Videos / month
              </label>
              <Input
                type="number"
                min={0}
                value={retainer}
                onChange={(e) => setRetainer(e.target.value)}
                placeholder="—"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
              Pod TL
            </label>
            <SearchableSelect value={tlId} onChange={setTlId} disabled={!isOwner} placeholder="Select a TL" options={[...tlOptions.map((u) => ({ value: u.id, label: `${u.name} (${u.role.toUpperCase()})` })), ...(!tlOptions.some((u) => u.id === pod.tl_id) ? [{ value: pod.tl_id, label: tl?.name ?? "Current TL" }] : [])]} />
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-[var(--text-dim)]">
              <i className="ri-information-line mt-px" />
              {isOwner
                ? "Handing the pod over also adds the new TL to the roster. Only TL or Owner accounts can lead a pod."
                : "Only an Owner can hand this pod to a different TL."}
            </p>
          </div>

          <ErrorNote error={updatePod.error} fallback="Could not save those pod changes." />

          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updatePod.isPending}>
              {updatePod.isPending ? (
                <>
                  <i className="ri-loader-4-line animate-spin" /> Saving...
                </>
              ) : (
                <>
                  <i className="ri-save-line" /> Save changes
                </>
              )}
            </Button>
          </div>
        </form>
      )}

      {panel !== null && (
        <div className="mt-4 animate-fade-in-up space-y-4 border-t border-[var(--border-color-subtle)] pt-4">
          {panel === "members" ? (
            <MemberList pod={pod} canManage={canManage} />
          ) : (
            <ChannelList pod={pod} canManage={canManage} />
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmChurn}
        title={`Mark ${pod.name} as churned?`}
        description={
          <>
            The pod stays in the system with all its jobs, brand assets and history — churning is a
            status, not a delete. It will read as <strong>Churned</strong> everywhere instead of
            silently showing as active, and you can set it back to Active later if they return.
          </>
        }
        confirmLabel="Mark as churned"
        confirmIcon="ri-close-circle-line"
        pending={updatePod.isPending}
        error={updatePod.error}
        errorFallback="Could not update the pod."
        onCancel={() => setConfirmChurn(false)}
        onConfirm={submit}
      />
    </div>
  );
}
