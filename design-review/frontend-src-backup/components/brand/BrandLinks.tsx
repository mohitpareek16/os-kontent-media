import { useState } from "react";

import type { BrandLink, BrandLinkCategory } from "@/api/brandAssets";
import { useBrandLinkActions } from "@/hooks/useBrandAssets";
import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

const CATEGORIES: { value: BrandLinkCategory; label: string; icon: string }[] = [
  { value: "website", label: "Website & socials", icon: "ri-global-line" },
  { value: "assets", label: "Asset folders", icon: "ri-folder-cloud-line" },
  { value: "reference", label: "References", icon: "ri-links-line" },
  { value: "font", label: "Font sources", icon: "ri-font-size-2" },
  { value: "other", label: "Other", icon: "ri-bookmark-line" },
];

export function BrandLinkForm({ podId, link, onDone }: { podId: string; link?: BrandLink; onDone: () => void }) {
  const actions = useBrandLinkActions(podId);
  const mutation = link ? actions.update : actions.add;
  const [title, setTitle] = useState(link?.title ?? "");
  const [url, setUrl] = useState(link?.url ?? "");
  const [category, setCategory] = useState<BrandLinkCategory>(link?.category ?? "website");
  const [note, setNote] = useState("");
  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      const payload = { title: title.trim(), url: url.trim(), category, note: note.trim() };
      if (link) actions.update.mutate({ id: link.id, payload }, { onSuccess: onDone });
      else actions.add.mutate(payload, { onSuccess: onDone });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-semibold text-[var(--text-muted)]">Title<Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Approved references" maxLength={200} required /></label>
        <label className="space-y-1 text-xs font-semibold text-[var(--text-muted)]">Collection<Select value={category} onChange={(event) => setCategory(event.target.value as BrandLinkCategory)}>{CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></label>
      </div>
      <label className="block space-y-1 text-xs font-semibold text-[var(--text-muted)]">URL<Input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." maxLength={2048} required /></label>
      <label className="block space-y-1 text-xs font-semibold text-[var(--text-muted)]">Change note <span className="font-normal">(optional, shown to the pod)</span><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="What should the team know?" maxLength={1000} /></label>
      <ErrorNote error={mutation.error} fallback="Could not save this link." />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={actions.add.isPending || actions.update.isPending || !title.trim() || !url.trim()}>{mutation.isPending ? "Saving..." : link ? "Save changes" : "Add link"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

export function BrandLinks({ podId, links, canEdit }: { podId: string; links: BrandLink[]; canEdit: boolean }) {
  const actions = useBrandLinkActions(podId);
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-bold text-[var(--text-main)]">Useful links</h2><p className="text-xs text-[var(--text-muted)]">Everything that lives outside the kit.</p></div><span className="rounded-full border border-[var(--border-color)] px-2.5 py-1 text-xs font-semibold text-[var(--text-muted)]">{links.length}</span></div>
      <ErrorNote error={actions.remove.error} fallback="Could not remove that link." />
      {links.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{links.map((link) => {
        const category = CATEGORIES.find((item) => item.value === link.category) ?? CATEGORIES[4];
        return <article key={link.id} className="min-w-0 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 hover:border-[var(--border-color-hover)]">
          {editingId === link.id ? <BrandLinkForm podId={podId} link={link} onDone={() => setEditingId(null)} /> : <>
            <div className="flex items-start justify-between gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--primary-glow-subtle)] text-xl text-[var(--primary-light)]"><i className={category.icon} /></span><span className="rounded-full bg-[var(--bg-pill)] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{category.label}</span></div>
            <h3 className="mt-4 truncate text-sm font-bold text-[var(--text-main)]" title={link.title}>{link.title}</h3>
            <p className="mt-1 truncate text-xs text-[var(--text-muted)]" title={link.url}>{link.url}</p>
            <div className="mt-5 flex items-center justify-between border-t border-[var(--border-color-subtle)] pt-3"><a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-[var(--primary-light)] hover:bg-[var(--bg-pill)]">Open link <i className="ri-arrow-right-up-line" /></a>{canEdit && <span className="flex gap-1"><button type="button" onClick={() => setEditingId(link.id)} className="min-h-10 min-w-10 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-pill)]" aria-label={`Edit ${link.title}`}><i className="ri-pencil-line" /></button><button type="button" disabled={actions.remove.isPending} onClick={() => { const note = window.prompt(`Remove ${link.title}? Add an optional note for the pod. Cancel keeps the link.`, ""); if (note !== null) actions.remove.mutate({ id: link.id, note }); }} className="min-h-10 min-w-10 rounded-lg text-[var(--text-muted)] hover:bg-[var(--accent-red-bg)] hover:text-[var(--accent-red)]" aria-label={`Remove ${link.title}`}><i className="ri-delete-bin-line" /></button></span>}</div>
          </>}
        </article>;
      })}</div> : <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-card)] px-5 py-8 text-sm text-[var(--text-muted)]">No links yet. Add websites, references or shared asset folders with a clear title.</div>}
    </section>
  );
}
