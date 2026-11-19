import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { BrandAssetList } from "@/components/brand/BrandAssetList";
import { BrandAssetUploadForm } from "@/components/brand/BrandAssetUploadForm";
import { BrandKitHistory } from "@/components/brand/BrandKitHistory";
import { BrandLinkForm, BrandLinks } from "@/components/brand/BrandLinks";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useCurrentUser } from "@/hooks/useAuth";
import { useBrandAssets, useBrandLinks, useDownloadBrandAsset } from "@/hooks/useBrandAssets";
import { usePods } from "@/hooks/usePods";
import { isAdmin } from "@/lib/roles";

type View = "overview" | "files" | "links" | "history";
const VIEWS: { value: View; label: string; icon: string }[] = [
  { value: "overview", label: "Overview", icon: "ri-layout-grid-line" },
  { value: "files", label: "Files", icon: "ri-folder-2-line" },
  { value: "links", label: "Links", icon: "ri-links-line" },
  { value: "history", label: "Activity", icon: "ri-time-line" },
];

export default function BrandAssetsPage() {
  const { podId } = useParams<{ podId: string }>();
  const [params, setParams] = useSearchParams();
  const { data: pods } = usePods();
  const { data: me } = useCurrentUser();
  const assetsQuery = useBrandAssets(podId ?? null);
  const linksQuery = useBrandLinks(podId ?? null);
  const download = useDownloadBrandAsset(podId ?? "");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [composer, setComposer] = useState<"file" | "link" | null>(null);
  const requestedView = params.get("history") === "1" ? "history" : params.get("tab");
  const view: View = VIEWS.some((item) => item.value === requestedView) ? requestedView as View : "overview";
  const pod = pods?.find((item) => item.id === podId);
  const canEdit = Boolean(me && pod && (isAdmin(me) || pod.tl_id === me.id));
  const assets = assetsQuery.data ?? [];
  const links = linksQuery.data ?? [];
  const search = query.trim().toLocaleLowerCase();
  const visibleAssets = assets.filter((asset) => `${asset.title} ${asset.file_path}`.toLocaleLowerCase().includes(search));
  const visibleLinks = links.filter((link) => `${link.title} ${link.url} ${link.category}`.toLocaleLowerCase().includes(search));
  const currentFiles = new Set(assets.map((asset) => `${asset.type}:${asset.title}`)).size;

  if (!podId) return null;

  const setView = (next: View) => {
    setParams(next === "overview" ? {} : next === "history" ? { history: "1" } : { tab: next });
    setQuery("");
  };
  const openComposer = (next: "file" | "link") => {
    setComposer(composer === next ? null : next);
    window.requestAnimationFrame(() => document.getElementById("brand-kit-composer")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      <Link to="/?view=brandkit" className="inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--primary-light)]"><i className="ri-arrow-left-line" /> All brand kits</Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-[26px] font-bold leading-tight tracking-tight">{pod?.name ?? "Brand kit"}</h2>
          <p className="mt-1 max-w-xl text-sm text-[var(--text-muted)]">One place for the brief, visual identity, fonts, references and every decision the pod should work from.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>{currentFiles} files</Badge>
          <Badge>{links.length} links</Badge>
          <Badge>{canEdit ? "You can update this kit" : "Read access"}</Badge>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-1" role="tablist" aria-label="Brand kit sections">
              {VIEWS.map((item) => <button key={item.value} type="button" role="tab" aria-selected={view === item.value} onClick={() => setView(item.value)} className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${view === item.value ? "bg-[var(--bg-pill)] text-[var(--primary-text)]" : "text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-main)]"}`}><i className={item.icon} />{item.label}</button>)}
            </div>
            {view !== "history" && <div className="relative w-full sm:max-w-56"><i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this kit" aria-label="Search this brand kit" className="pl-9" /></div>}
          </div>

          <ErrorNote error={assetsQuery.error || linksQuery.error} fallback="Could not load this brand kit." />
          {view !== "history" && (assetsQuery.isPending || linksQuery.isPending) && <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-8 text-sm text-[var(--text-muted)]"><i className="ri-loader-4-line mr-2 animate-spin" /> Loading brand kit...</div>}

          {view === "history" ? <BrandKitHistory podId={podId} /> : <div className="space-y-9">
            {!assetsQuery.isPending && !assetsQuery.isError && (view === "overview" || view === "files") && <BrandAssetList assets={visibleAssets} canUpload={canEdit} downloadingId={downloadingId} downloadError={download.error} onDownload={(assetId) => { setDownloadingId(assetId); download.mutate(assetId, { onSettled: () => setDownloadingId(null) }); }} />}
            {!linksQuery.isPending && !linksQuery.isError && (view === "overview" || view === "links") && <BrandLinks podId={podId} links={visibleLinks} canEdit={canEdit} />}
          </div>}
        </div>

        <aside className="order-first space-y-4 lg:order-last lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-glow-subtle)] text-xl text-[var(--primary-light)]"><i className="ri-shield-check-line" /></span>
            <h2 className="mt-4 text-base font-bold text-[var(--text-main)]">Shared source of truth</h2>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">Everyone in this pod can read the kit. The TL and Owner can update it. Each change is saved in activity and sent to pod members.</p>
            {canEdit && <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => openComposer("file")} className="min-h-11 rounded-xl bg-[var(--primary)] px-2 text-xs font-bold text-white hover:bg-[var(--primary-hover)]"><i className="ri-upload-cloud-2-line mr-1" /> Add file</button><button type="button" onClick={() => openComposer("link")} className="min-h-11 rounded-xl border border-[var(--border-color)] px-2 text-xs font-bold text-[var(--text-main)] hover:bg-[var(--bg-pill)]"><i className="ri-link mr-1" /> Add link</button></div>}
          </div>
          {canEdit && composer && <div id="brand-kit-composer" className="rounded-2xl border border-[var(--primary)] bg-[var(--bg-card)] p-5"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-bold text-[var(--text-main)]">{composer === "file" ? "Add or update a file" : "Add a titled link"}</h2><button type="button" onClick={() => setComposer(null)} aria-label="Close form" className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-pill)]"><i className="ri-close-line" /></button></div>{composer === "file" ? <BrandAssetUploadForm podId={podId} layout="stacked" knownTitles={assets} onUploaded={() => setComposer(null)} /> : <BrandLinkForm podId={podId} onDone={() => setComposer(null)} />}</div>}
          <button type="button" onClick={() => setView("history")} className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] px-4 text-left text-xs font-semibold text-[var(--text-muted)] hover:border-[var(--primary)] hover:text-[var(--primary-light)]"><span><i className="ri-time-line mr-2" /> See every change</span><i className="ri-arrow-right-line" /></button>
        </aside>
      </div>
    </div>
  );
}
