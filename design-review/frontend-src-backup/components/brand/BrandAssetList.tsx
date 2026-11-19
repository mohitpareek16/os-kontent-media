import { useState } from "react";

import { ErrorNote } from "@/components/ui/ErrorNote";
import type { BrandAsset, BrandAssetType } from "@/types";

const COLLECTIONS: { type: BrandAssetType; label: string; icon: string; hint: string }[] = [
  { type: "brief", label: "Briefs", icon: "ri-file-text-line", hint: "The client's direction" },
  { type: "sop", label: "Playbooks", icon: "ri-book-open-line", hint: "How the work gets made" },
  { type: "kit", label: "Identity & assets", icon: "ri-palette-line", hint: "Logos, imagery, fonts & source files" },
  { type: "do_not", label: "Do not use", icon: "ri-forbid-line", hint: "Rules everyone should read first" },
];

interface Props {
  assets: BrandAsset[];
  onDownload: (assetId: string) => void;
  downloadingId: string | null;
  downloadError: unknown;
  canUpload: boolean;
}

function fileDetails(asset: BrandAsset) {
  const name = asset.file_path.split(/[\\/]/).pop()?.replace(/^[a-f0-9]{32}_/, "") ?? "File";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const kind = ["ttf", "otf", "woff", "woff2"].includes(ext) ? "FONT" : ["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(ext) ? "IMAGE" : ext === "pdf" ? "PDF" : ext === "zip" ? "ZIP" : "FILE";
  const icon = kind === "FONT" ? "ri-font-size-2" : kind === "IMAGE" ? "ri-image-line" : kind === "PDF" ? "ri-file-pdf-2-line" : "ri-file-3-line";
  return { name, kind, icon };
}

export function BrandAssetList({ assets, onDownload, downloadingId, downloadError, canUpload }: Props) {
  return (
    <div className="space-y-8">
      <ErrorNote error={downloadError} fallback="That file could not be opened." />
      {COLLECTIONS.map((collection) => {
        const grouped = new Map<string, BrandAsset[]>();
        assets.filter((asset) => asset.type === collection.type).forEach((asset) => {
          const key = asset.title;
          grouped.set(key, [...(grouped.get(key) ?? []), asset]);
        });
        const groups = [...grouped.values()].map((versions) => versions.sort((a, b) => b.version - a.version));
        return (
          <section key={collection.type} className="scroll-mt-24" id={`brand-${collection.type}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] text-lg text-[var(--primary-light)]"><i className={collection.icon} /></div>
                <div><h2 className="text-base font-bold text-[var(--text-main)]">{collection.label}</h2><p className="text-xs text-[var(--text-muted)]">{collection.hint}</p></div>
              </div>
              <span className="rounded-full border border-[var(--border-color)] px-2.5 py-1 text-xs font-semibold text-[var(--text-muted)]">{groups.length}</span>
            </div>
            {groups.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {groups.map((versions) => <AssetCard key={`${collection.type}-${versions[0].title}`} versions={versions} onDownload={onDownload} downloadingId={downloadingId} />)}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-card)] px-5 py-6 text-sm text-[var(--text-muted)]">
                {canUpload ? `Add ${collection.label.toLowerCase()} to give the pod a shared source of truth.` : `No ${collection.label.toLowerCase()} here yet. Ask your TL to add them.`}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function AssetCard({ versions, onDownload, downloadingId }: { versions: BrandAsset[]; onDownload: (id: string) => void; downloadingId: string | null }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const latest = versions[0];
  const file = fileDetails(latest);
  return (
    <article className="group flex min-w-0 flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 transition-colors hover:border-[var(--border-color-hover)]">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-glow-subtle)] text-2xl text-[var(--primary-light)]"><i className={file.icon} /></span>
        <span className="rounded-full bg-[var(--bg-pill)] px-2 py-1 font-mono text-[10px] font-bold text-[var(--primary-light)]">{file.kind} · v{latest.version}</span>
      </div>
      <h3 className="mt-4 truncate text-sm font-bold text-[var(--text-main)]" title={latest.title}>{latest.title}</h3>
      <p className="mt-1 truncate text-xs text-[var(--text-muted)]" title={file.name}>{file.name}</p>
      <div className="mt-5 flex items-center justify-between gap-2 border-t border-[var(--border-color-subtle)] pt-3">
        <button type="button" onClick={() => onDownload(latest.id)} disabled={downloadingId === latest.id} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs font-bold text-[var(--primary-light)] hover:bg-[var(--bg-pill)] disabled:opacity-50">
          <i className={downloadingId === latest.id ? "ri-loader-4-line animate-spin" : "ri-download-2-line"} /> {downloadingId === latest.id ? "Opening" : "Open file"}
        </button>
        {versions.length > 1 && <button type="button" onClick={() => setHistoryOpen(!historyOpen)} aria-expanded={historyOpen} className="min-h-10 rounded-lg px-2 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-pill)]">{versions.length - 1} older <i className={historyOpen ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} /></button>}
      </div>
      {historyOpen && <div className="space-y-1 border-t border-[var(--border-color-subtle)] pt-2">{versions.slice(1).map((asset) => <button key={asset.id} type="button" onClick={() => onDownload(asset.id)} className="flex w-full min-h-9 items-center justify-between rounded px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-pill)]"><span>Version {asset.version}</span><i className="ri-download-2-line" /></button>)}</div>}
    </article>
  );
}
