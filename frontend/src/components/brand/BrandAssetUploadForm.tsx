import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useUploadBrandAsset } from "@/hooks/useBrandAssets";
import type { BrandAsset, BrandAssetType } from "@/types";

/** The server returns 413 above this — briefs, SOPs and kits are documents;
 * anything bigger is a video and belongs in Frame.io. Checked here too so the
 * user finds out before uploading 300MB. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const TYPE_OPTIONS: { value: BrandAssetType; label: string }[] = [
  { value: "brief", label: "Brief" },
  { value: "sop", label: "SOP" },
  { value: "kit", label: "Kit" },
  { value: "do_not", label: "Do-not list" },
];

interface BrandAssetUploadFormProps {
  podId: string;
  /** Stacked is the onboarding wizard's single-column layout; inline is the
   * one-row bar on the brand kit page. */
  layout?: "inline" | "stacked";
  submitLabel?: string;
  /** Existing titles in this pod — re-using one bumps its version instead of
   * creating a second row that looks like a duplicate. */
  knownTitles?: BrandAsset[];
  onUploaded?: (asset: BrandAsset) => void;
}

export function BrandAssetUploadForm({
  podId,
  layout = "inline",
  submitLabel = "Upload",
  knownTitles = [],
  onUploaded,
}: BrandAssetUploadFormProps) {
  const uploadAsset = useUploadBrandAsset(podId);
  const [type, setType] = useState<BrandAssetType>("brief");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [sizeError, setSizeError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const stacked = layout === "stacked";
  const isNewVersion = knownTitles.some((asset) => asset.type === type && asset.title === title.trim());

  return (
    <form
      className={
        stacked ? "space-y-3" : "glass-card border-glow flex flex-wrap items-center gap-2 p-3"
      }
      onSubmit={(e) => {
        e.preventDefault();
        if (!file) return;
        if (file.size > MAX_UPLOAD_BYTES) {
          setSizeError(
            `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)}MB — the limit is 25MB.`,
          );
          return;
        }
        setSizeError(null);
        uploadAsset.mutate(
          { type, title: title.trim(), file, note: note.trim() },
          {
            onSuccess: (asset) => {
              setTitle("");
              setFile(null);
              setNote("");
              if (fileInput.current) fileInput.current.value = "";
              onUploaded?.(asset);
            },
          },
        );
      }}
    >
      <div className={stacked ? "space-y-1" : "w-36"}>
        {stacked && <label className="text-xs font-semibold text-[var(--text-muted)]">Collection</label>}
        <Select value={type} onChange={(e) => setType(e.target.value as BrandAssetType)}>
          {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </div>

      <div className={stacked ? "space-y-1" : "min-w-[10rem] flex-1"}>
        {stacked && <label className="text-xs font-semibold text-[var(--text-muted)]">Title</label>}
        <Input placeholder="e.g. Primary logo, Brand fonts, Editing brief" value={title} onChange={(e) => setTitle(e.target.value)} list="brand-asset-titles" maxLength={200} required />
        <datalist id="brand-asset-titles">
          {[...new Set(knownTitles.filter((asset) => asset.type === type).map((asset) => asset.title))].map((t) => <option key={t} value={t} />)}
        </datalist>
      </div>

      <label className="relative flex min-h-24 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[var(--border-color-hover)] bg-[var(--bg-pill)] px-4 py-3 transition-colors hover:border-[var(--primary)] focus-within:border-[var(--primary)]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-glow-subtle)] text-xl text-[var(--primary-light)]"><i className="ri-upload-cloud-2-line" /></span>
        <span className="min-w-0 text-sm font-semibold text-[var(--text-main)]"><span className="block truncate">{file ? file.name : "Choose a file"}</span><span className="mt-0.5 block text-xs font-normal text-[var(--text-muted)]">PDF, image, font, ZIP or other reference · max 25 MB</span></span>
        <input
          ref={fileInput}
          type="file"
          onChange={(e) => {
            setSizeError(null);
            setFile(e.target.files?.[0] ?? null);
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Choose brand kit file"
        />
      </label>

      <div className={stacked ? "space-y-1" : "w-full"}>
        {stacked && <label className="text-xs font-semibold text-[var(--text-muted)]">Change note <span className="font-normal">(optional, shown to the pod)</span></label>}
        <Input placeholder="What changed? Optional note for everyone in this pod" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </div>

      <Button type="submit" disabled={uploadAsset.isPending || !file || !title.trim()} className={stacked ? "w-full" : ""}>
        {uploadAsset.isPending ? (
          <>
            <i className="ri-loader-4-line animate-spin" /> Uploading...
          </>
        ) : (
          <>
            <i className="ri-upload-2-line" /> {submitLabel}
          </>
        )}
      </Button>

      {isNewVersion && !uploadAsset.isPending && (
        <p className="flex w-full items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <i className="ri-history-line text-[var(--primary)]" />
          That title already exists — this uploads as a new version, and the old one stays in the
          history.
        </p>
      )}

      {sizeError && (
        <p
          role="alert"
          className="flex w-full items-start gap-1.5 rounded-lg bg-[var(--accent-red-bg)] px-3 py-2 text-xs font-medium text-[var(--accent-red)]"
        >
          <i className="ri-error-warning-line mt-px" /> {sizeError}
        </p>
      )}

      <ErrorNote
        error={uploadAsset.error}
        fallback="Upload failed — check the file size (25MB max) and try again."
        className="w-full"
      />
    </form>
  );
}
