import { useState } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useVideoTypeActions, useVideoTypes } from "@/hooks/useVideoTypes";
import type { VideoTypeConfig } from "@/types";

export default function VideoTypesAdminPage() {
  const { data: types = [], isLoading, error } = useVideoTypes();
  const actions = useVideoTypeActions();
  const toast = useToast();
  const [name, setName] = useState("");
  const [points, setPoints] = useState(3);
  const key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
  const canAdd = /^[a-z][a-z0-9_]{1,31}$/.test(key) && name.trim().length >= 2 && points >= 1 && points <= 24;

  return (
    <div className="space-y-5 pb-10">
      <Link
        to="/?view=capacity"
        className="inline-flex items-center gap-1 text-[13px] font-bold text-[var(--primary-text)] hover:underline"
      >
        <i className="ri-arrow-left-line" /> Team Capacity
      </Link>

      <PageHeader
        description="Set the categories the team can choose and how many QC points a first review costs. Repeat reviews cost half, rounded up."
        actions={
          <Badge>
            {types.filter((type) => type.enabled).length} active types · 24 full-time / 12 part-time points a day
          </Badge>
        }
        className="!mb-0"
      />

      <Banner tone="info">
        Point changes apply to new QC reviews. Points already charged stay in the ledger. Disabling a type removes it
        from new-video choices; existing videos and reports keep their type.
      </Banner>

      <ErrorNote error={error || actions.add.error} fallback="Could not load or add video types." />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <section className="space-y-3" aria-label="Categories">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[var(--text-main)]">Categories</h2>
            <span className="text-[13px] text-[var(--text-dim)]">{types.length} total</span>
          </div>
          {isLoading && <SkeletonRows rows={4} label="Loading video types" />}
          <div className="glass-card overflow-x-auto">
            <table className="k-table min-w-[640px]">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="w-28">QC points</th>
                  <th className="w-36">Repeat review</th>
                  <th className="w-28">Status</th>
                  <th className="w-44">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {types.map((type) => (
                  <TypeRow key={type.key} type={type} />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!canAdd) return;
            actions.add.mutate(
              { key, label: name.trim(), qc_points: points },
              {
                onSuccess: () => {
                  setName("");
                  setPoints(3);
                  toast.notify("Video type added", "success");
                },
              },
            );
          }}
          className="glass-card space-y-4 p-5 lg:sticky lg:top-24"
        >
          <div>
            <h2 className="text-base font-bold text-[var(--text-main)]">Add a video type</h2>
            <p className="mt-0.5 text-[13px] text-[var(--text-dim)]">Available immediately for new videos.</p>
          </div>
          <Field
            label="Name"
            htmlFor="vt-name"
            help={name ? <>Key: <code>{key || "—"}</code> · fixed after creation</> : undefined}
          >
            <Input
              id="vt-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
              placeholder="e.g. Motion graphics"
            />
          </Field>
          <Field label="QC points per first review" htmlFor="vt-points" help="1–24. Repeat reviews cost half, rounded up.">
            <Input
              id="vt-points"
              type="number"
              min={1}
              max={24}
              value={points}
              onChange={(event) => setPoints(Number(event.target.value))}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={!canAdd || actions.add.isPending}>
            {actions.add.isPending ? "Adding..." : "Add video type"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function TypeRow({ type }: { type: VideoTypeConfig }) {
  const actions = useVideoTypeActions();
  const toast = useToast();
  const [label, setLabel] = useState(type.label);
  const [points, setPoints] = useState(type.qc_points);
  const changed = label.trim() !== type.label || points !== type.qc_points;
  const valid = label.trim().length >= 2 && label.trim().length <= 80 && points >= 1 && points <= 24;
  const save = () =>
    actions.update.mutate(
      { key: type.key, changes: { label: label.trim(), qc_points: points } },
      { onSuccess: () => toast.notify("Video type updated", "success") },
    );
  const toggle = () =>
    actions.update.mutate(
      { key: type.key, changes: { enabled: !type.enabled } },
      { onSuccess: () => toast.notify(type.enabled ? "Video type disabled" : "Video type enabled", "success") },
    );
  return (
    <>
      <tr className={type.enabled ? "" : "opacity-70"}>
        <td>
          <input
            aria-label={`Display name for ${type.key}`}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={80}
            className="h-9 w-full rounded-lg border border-transparent bg-transparent px-2 text-sm font-bold text-[var(--text-main)] outline-none hover:border-[var(--border-color)] focus:border-[var(--primary)]"
          />
          <span className="block px-2 font-mono text-xs text-[var(--text-dim)]">{type.key}</span>
        </td>
        <td>
          <input
            type="number"
            min={1}
            max={24}
            aria-label={`QC points for ${type.label}`}
            value={points}
            onChange={(event) => setPoints(Number(event.target.value))}
            className="num h-9 w-20 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-sm font-bold text-[var(--text-main)] outline-none focus:border-[var(--primary)]"
          />
        </td>
        <td className="text-[var(--text-muted)]">{Math.ceil(type.qc_points / 2)} points</td>
        <td>
          <Badge className={type.enabled ? "bg-[var(--ok-bg)] text-[var(--ok-text)]" : "bg-[var(--stage-intake-bg)] text-[var(--stage-intake-fg)]"}>
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
            {type.enabled ? "Active" : "Disabled"}
          </Badge>
        </td>
        <td>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={save} disabled={!changed || !valid || actions.update.isPending}>
              Save
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={toggle}
              disabled={actions.update.isPending}
              aria-label={`${type.enabled ? "Disable" : "Enable"} ${type.label}`}
            >
              {type.enabled ? "Disable" : "Enable"}
            </Button>
          </div>
        </td>
      </tr>
      {Boolean(actions.update.error) && (
        <tr>
          <td colSpan={5} className="!py-2">
            <ErrorNote error={actions.update.error} fallback="Could not update video type." />
          </td>
        </tr>
      )}
    </>
  );
}
