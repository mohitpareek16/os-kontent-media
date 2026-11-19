import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { useCurrentUser } from "@/hooks/useAuth";
import { useAddJobLink, useJobLinks, useRemoveJobLink } from "@/hooks/useJobs";
import { hasRole, leadsAllPods } from "@/lib/roles";
import type { JobDetail, JobLink, JobLinkKind, User } from "@/types";

/** The server's split, mirrored so the UI doesn't offer a certain 403: raw
 * material is the TL's — the client sends it to them — and the cut is the
 * editor's, because nobody else knows which export is the one to review.
 * `services/job_links.py::may_add`. */
function canAdd(job: JobDetail, user: User | undefined, kind: JobLinkKind): boolean {
  const leads = leadsAllPods(user) || (hasRole(user, "tl") && job.tl_id === user?.id);
  if (kind === "raw") return leads;
  return job.assigned_editor_id === user?.id;
}

function canRemove(job: JobDetail, user: User | undefined, link: JobLink): boolean {
  if (link.added_by_id === user?.id) return true;
  return leadsAllPods(user) || (hasRole(user, "tl") && job.tl_id === user?.id);
}

const KIND_COPY: Record<
  JobLinkKind,
  { title: string; icon: string; empty: string; emptyForOwner: string; addLabel: string }
> = {
  raw: {
    title: "Raw files",
    icon: "ri-folder-video-line",
    empty: "Nothing here yet — the TL adds the client's footage.",
    emptyForOwner: "Add the folders the client sent. A shoot is usually more than one.",
    addLabel: "Add raw files",
  },
  video: {
    title: "Cuts",
    icon: "ri-film-line",
    empty: "No cut yet — it appears here when the editor sends one for QC.",
    emptyForOwner: "Your exports land here when you send a cut for QC. Add another any time.",
    addLabel: "Add a cut",
  },
};

function LinkRow({
  link,
  removable,
  onRemove,
  removing,
}: {
  link: JobLink;
  removable: boolean;
  onRemove: () => void;
  removing: boolean;
}) {
  return (
    <li className="flex items-center gap-2 rounded-lg border border-[var(--border-color-subtle)] bg-[var(--bg-card)] px-3 py-2">
      <div className="min-w-0 flex-1">
        {link.title && (
          <span className="block text-xs font-bold text-[var(--text-main)]">{link.title}</span>
        )}
        <span className="block truncate text-[11px] text-[var(--text-muted)]">{link.url}</span>
      </div>
      <a
        href={link.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border-color)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--primary-light)] transition-colors hover:border-[var(--primary)]"
      >
        Open <i className="ri-external-link-line" />
      </a>
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          title={`Remove${link.added_by_name ? ` — added by ${link.added_by_name}` : ""}`}
          className="shrink-0 rounded-lg p-1.5 text-[var(--text-dim)] transition-colors hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50"
        >
          <i className="ri-delete-bin-line" />
        </button>
      )}
    </li>
  );
}

function LinkList({ job, kind, links }: { job: JobDetail; kind: JobLinkKind; links: JobLink[] }) {
  const { data: user } = useCurrentUser();
  const add = useAddJobLink(job.id);
  const remove = useRemoveJobLink(job.id);
  const toast = useToast();
  const copy = KIND_COPY[kind];

  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  const mine = canAdd(job, user, kind) && !job.scrapped_at;

  const submit = () => {
    if (!url.trim()) return;
    add.mutate(
      { kind, url: url.trim(), title: title.trim() || null },
      {
        onSuccess: () => {
          setUrl("");
          setTitle("");
          setOpen(false);
        },
        onError: (error) => toast.notifyError(error, "Could not add that link."),
      },
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
          <i className={copy.icon} /> {copy.title}
          {links.length > 0 && <span className="font-mono">({links.length})</span>}
        </span>
        {mine && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-1 text-[11px] font-semibold text-[var(--primary-light)] transition-colors hover:text-[var(--primary)]"
          >
            <i className="ri-add-line" /> {copy.addLabel}
          </button>
        )}
      </div>

      {links.length > 0 ? (
        <ul className="space-y-1.5">
          {links.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              removable={canRemove(job, user, link) && !job.scrapped_at}
              removing={remove.isPending}
              onRemove={() =>
                remove.mutate(link.id, {
                  onError: (error) => toast.notifyError(error, "Could not remove that link."),
                })
              }
            />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-[var(--text-dim)]">{mine ? copy.emptyForOwner : copy.empty}</p>
      )}

      {open && (
        <div className="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-pill)] p-3">
          <Input
            autoFocus
            placeholder={kind === "raw" ? "https://drive.google.com/..." : "https://f.io/..."}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Input
            placeholder={
              kind === "raw" ? "What is it? A-roll, B-roll, graphics..." : "Which cut is this?"
            }
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <ErrorNote error={add.error} fallback="Could not add that link." />
          <div className="flex gap-2">
            <Button disabled={add.isPending || !url.trim()} onClick={submit}>
              <i className="ri-link" /> Add
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setUrl("");
                setTitle("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Everything this job points at, in two lists that belong to two different
 * people.
 *
 * There used to be one link on a job, in one field, called "Working file" —
 * so the client's Drive folder and the editor's Frame.io export took turns
 * occupying it. Whichever was written last was what everybody saw, and the
 * editor's own "paste your link" box opened pre-filled with the client's
 * footage. A shoot arrives as several folders and an edit leaves as several
 * cuts; both are lists, and always were. */
export function JobLinksPanel({ job }: { job: JobDetail }) {
  const { data: links, isLoading } = useJobLinks(job.id);

  if (isLoading) {
    return <p className="text-xs text-[var(--text-dim)]">Loading links...</p>;
  }

  const all = links ?? [];
  return (
    <div className="space-y-4">
      <LinkList job={job} kind="raw" links={all.filter((link) => link.kind === "raw")} />
      <LinkList job={job} kind="video" links={all.filter((link) => link.kind === "video")} />
    </div>
  );
}
