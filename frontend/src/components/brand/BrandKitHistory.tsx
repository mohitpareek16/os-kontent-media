import { useBrandKitHistory } from "@/hooks/useBrandAssets";
import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { formatDateTime } from "@/lib/format";
import type { BrandKitEvent } from "@/api/brandAssets";

const ACTIONS: Record<string, { label: string; icon: string }> = {
  file_added: { label: "Added a file", icon: "ri-upload-2-line" },
  file_updated: { label: "Uploaded a new version", icon: "ri-history-line" },
  link_added: { label: "Added a link", icon: "ri-link" },
  link_updated: { label: "Updated a link", icon: "ri-pencil-line" },
  link_removed: { label: "Removed a link", icon: "ri-delete-bin-line" },
};

function changeDetails(event: BrandKitEvent) {
  if (event.action === "file_added" || event.action === "file_updated") {
    return `${event.after?.filename ?? "File"} · ${event.before?.version ? `version ${event.before.version} → ${event.after?.version}` : `version ${event.after?.version ?? "?"}`}`;
  }
  const oldUrl = event.before?.url;
  const newUrl = event.after?.url;
  const url = oldUrl && newUrl && oldUrl !== newUrl ? `${oldUrl} → ${newUrl}` : String(newUrl ?? oldUrl ?? "");
  const category = event.before?.category && event.after?.category && event.before.category !== event.after.category ? ` · ${event.before.category} → ${event.after.category}` : "";
  return `${url}${category}`;
}

export function BrandKitHistory({ podId }: { podId: string }) {
  const history = useBrandKitHistory(podId);
  const events = history.data?.pages.flat() ?? [];
  return (
    <section className="space-y-4">
      <div><h2 className="text-lg font-bold text-[var(--text-main)]">Change history</h2><p className="text-xs text-[var(--text-muted)]">Every upload and link change, with the note shared with the pod.</p></div>
      <ErrorNote error={history.error} fallback="Could not load brand kit history." />
      {history.isPending && <p className="text-sm text-[var(--text-muted)]">Loading changes...</p>}
      {!history.isPending && !events.length && <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-card)] p-6 text-sm text-[var(--text-muted)]">No changes recorded yet. New additions will appear here.</div>}
      <ol className="space-y-3">
        {events.map((event) => {
          const action = ACTIONS[event.action] ?? { label: "Changed the kit", icon: "ri-information-line" };
          return <li key={event.id} className="flex gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-glow-subtle)] text-[var(--primary-light)]"><i className={action.icon} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><p className="text-sm font-semibold text-[var(--text-main)]">{event.actor_name} · {action.label}</p><time className="text-xs text-[var(--text-dim)]" dateTime={event.created_at}>{formatDateTime(event.created_at)}</time></div>
              <p className="mt-1 text-sm font-medium text-[var(--text-main)]">{event.title}</p>
              {changeDetails(event) && <p className="mt-1 break-all text-xs text-[var(--text-muted)]">{changeDetails(event)}</p>}
              {event.action === "link_updated" && event.before?.title !== event.after?.title && <p className="mt-1 text-xs text-[var(--text-muted)]">Renamed from {event.before?.title}</p>}
              {event.note && <p className="mt-3 rounded-lg bg-[var(--bg-pill)] px-3 py-2 text-xs leading-relaxed text-[var(--text-main)]"><i className="ri-chat-1-line mr-1 text-[var(--primary-light)]" />{event.note}</p>}
            </div>
          </li>;
        })}
      </ol>
      {history.hasNextPage && <Button variant="secondary" disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()} className="w-full">{history.isFetchingNextPage ? "Loading..." : "Load older changes"}</Button>}
    </section>
  );
}
