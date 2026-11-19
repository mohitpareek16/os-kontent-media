import { useState } from "react";
import { Link } from "react-router-dom";

import type { UpdatePodPayload } from "@/api/pods";
import { ChannelList } from "@/components/pods/ChannelList";
import { MemberList } from "@/components/pods/MemberList";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorNote, SuccessNote } from "@/components/ui/ErrorNote";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PillButton } from "@/components/ui/PillButton";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { TabBar } from "@/components/ui/TabBar";
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
    className: "bg-[var(--ok-bg)] text-[var(--ok-text)]",
    blurb: "Retainer running — jobs flow normally.",
  },
  paused: {
    label: "Paused",
    icon: "ri-pause-circle-line",
    className: "bg-[var(--stage-intake-bg)] text-[var(--stage-intake-fg)]",
    blurb: "On hold — no new work expected this cycle.",
  },
  churned: {
    label: "Churned",
    icon: "ri-close-circle-line",
    className: "bg-[var(--bad-bg)] text-[var(--bad-text)]",
    blurb: "Client has left. Kept for history and past deliveries.",
  },
};

const POD_STATUSES: PodStatus[] = ["active", "paused", "churned"];

type PodTab = "overview" | "members" | "channels";

/** A compact client card: who, status, and three facts. Everything you can do
 * to the pod lives in the "Manage" drawer (Overview / Members / Channels), so a
 * card never grows or shifts the grid around it. */
export function PodCard({ pod, tl, canManage, isOwner, tlOptions }: PodCardProps) {
  const updatePod = useUpdatePod(pod.id);
  /* One query for every card on the page — react-query dedupes it by key — so
     each card can say how many channels the client has without a request of
     its own. */
  const { data: allChannels } = useAllChannels();
  const channelCount = (allChannels ?? []).filter((c) => c.pod_id === pod.id).length;

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PodTab>("overview");
  const [confirmChurn, setConfirmChurn] = useState(false);
  const [saved, setSaved] = useState(false);

  const [name, setName] = useState(pod.name);
  const [status, setStatus] = useState<PodStatus>(pod.status);
  const [currency, setCurrency] = useState(pod.billing_currency);
  const [retainer, setRetainer] = useState(pod.retainer_volume?.toString() ?? "");
  const [tlId, setTlId] = useState(pod.tl_id);

  const statusMeta = POD_STATUS_META[pod.status];

  function openManage(initial: PodTab = "overview") {
    setName(pod.name);
    setStatus(pod.status);
    setCurrency(pod.billing_currency);
    setRetainer(pod.retainer_volume?.toString() ?? "");
    setTlId(pod.tl_id);
    updatePod.reset();
    setSaved(false);
    setTab(initial);
    setOpen(true);
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
    <div className={`glass-card p-5 ${pod.status === "churned" ? "opacity-80" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={pod.name} text={pod.name.charAt(0).toUpperCase()} size={44} square />
          <div className="min-w-0">
            <p className="truncate text-[17px] font-bold text-[var(--text-main)]">{pod.name}</p>
            <p className="mt-0.5 flex items-center gap-1 text-[13px] text-[var(--text-dim)]">
              <i className="ri-user-star-line" /> TL · {tl?.name ?? "—"}
            </p>
          </div>
        </div>
        <Badge className={statusMeta.className} title={statusMeta.blurb}>
          <i className={statusMeta.icon} /> {statusMeta.label}
        </Badge>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 text-xs text-[var(--text-dim)]">
        <div>
          <dt>Billing</dt>
          <dd className="num text-lg font-bold text-[var(--text-main)]">{pod.billing_currency}</dd>
        </div>
        <div>
          <dt>Retainer / mo</dt>
          <dd className="num text-lg font-bold text-[var(--text-main)]">{pod.retainer_volume ?? "—"}</dd>
        </div>
        <div>
          <dt>Channels</dt>
          <dd className="num text-lg font-bold text-[var(--text-main)]">{channelCount}</dd>
        </div>
      </dl>

      <div className="mt-4 flex gap-2">
        <Link to={`/pods/${pod.id}/brand-assets`} className="flex-1">
          <Button variant="secondary" size="sm" className="w-full">
            <i className="ri-book-open-line" /> Brand kit
          </Button>
        </Link>
        <Button size="sm" className="flex-1" onClick={() => openManage()}>
          {canManage ? "Manage" : "View"}
        </Button>
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        header={
          <div className="min-w-0">
            <h2 className="truncate text-[22px] font-bold">{pod.name}</h2>
            <p className="text-[13px] text-[var(--text-dim)]">
              {statusMeta.label} · TL {tl?.name ?? "—"}
            </p>
          </div>
        }
      >
        <div className="space-y-4">
          <TabBar
            aria-label="Pod sections"
            showCounts={false}
            value={tab}
            onChange={setTab}
            tabs={[
              { key: "overview", label: "Overview" },
              { key: "members", label: "Members" },
              { key: "channels", label: `Channels · ${channelCount}` },
            ]}
          />

          {tab === "overview" && (
            <form
              className="glass-card space-y-4 p-5"
              onSubmit={(e) => {
                e.preventDefault();
                handleSave();
              }}
            >
              {!canManage && (
                <p className="text-sm text-[var(--text-muted)]">
                  Only the Owner or this pod's TL can change these details.
                </p>
              )}
              <Field label="Client name">
                <Input value={name} onChange={(e) => setName(e.target.value)} required disabled={!canManage} />
              </Field>

              <Field label="Status" help={POD_STATUS_META[status].blurb}>
                <div className="flex flex-wrap gap-1.5">
                  {POD_STATUSES.map((s) => (
                    <PillButton key={s} active={status === s} disabled={!canManage} onClick={() => setStatus(s)}>
                      <i className={POD_STATUS_META[s].icon} /> {POD_STATUS_META[s].label}
                    </PillButton>
                  ))}
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Billing currency">
                  <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="INR" disabled={!canManage} />
                </Field>
                <Field label="Videos per month (optional)">
                  <Input
                    type="number"
                    min={0}
                    value={retainer}
                    onChange={(e) => setRetainer(e.target.value)}
                    placeholder="e.g. 12"
                    disabled={!canManage}
                  />
                </Field>
              </div>

              <Field
                label="Pod TL"
                help={
                  isOwner
                    ? "Handing the pod over also adds the new TL to the roster. Only TL or Owner accounts can lead a pod."
                    : "Only an Owner can hand this pod to a different TL."
                }
              >
                <SearchableSelect value={tlId} onChange={setTlId} disabled={!isOwner} placeholder="Select a TL" options={[...tlOptions.map((u) => ({ value: u.id, label: `${u.name} (${u.role.toUpperCase()})` })), ...(!tlOptions.some((u) => u.id === pod.tl_id) ? [{ value: pod.tl_id, label: tl?.name ?? "Current TL" }] : [])]} />
              </Field>

              <ErrorNote error={updatePod.error} fallback="Could not save those pod changes." />
              {saved && !updatePod.isPending && <SuccessNote message="Pod updated." />}

              {canManage && (
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
                    Close
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
              )}
            </form>
          )}

          {tab === "members" && <MemberList pod={pod} canManage={canManage} />}
          {tab === "channels" && <ChannelList pod={pod} canManage={canManage} />}
        </div>
      </Drawer>

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
