import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useToast } from "@/components/ui/Toast";
import { useCurrentUser } from "@/hooks/useAuth";
import { useUpdateJob } from "@/hooks/useJobs";
import { usePodChannels } from "@/hooks/usePods";
import {
  ACTUAL_DEADLINE_LABEL,
  DEADLINE_LABEL,
  deadlineBuffer,
  formatFullDate,
} from "@/lib/format";
import { hasRole, leadsAllPods } from "@/lib/roles";
import { useVideoTypes } from "@/hooks/useVideoTypes";
import type { JobDetail, User, VideoType } from "@/types";

/** `check_pod_lead` + `_require_live` on the server — the pod's own TL or the
 * Owner, and nothing at all on a scrapped project. Mirrored here so the pencil
 * only shows where the PATCH would actually be accepted: an edit affordance
 * that answers 403 is worse than no affordance at all. */
function canEditJob(job: JobDetail, user: User | undefined): boolean {
  if (job.scrapped_at) return false;
  return leadsJobPod(job, user);
}

/** `services/access.py::leads_pod` — the Owner, or this pod's own TL (which
 * is how a lent TL passes too, since the check is `Pod.tl_id`).
 *
 * Split out of `canEditJob` because seeing and writing are not the same
 * question: a scrapped project accepts no edits but its client deadline is
 * still the lead's to read, and the client deadline is shown to exactly this
 * set of people and nobody else. */
function leadsJobPod(job: JobDetail, user: User | undefined): boolean {
  if (leadsAllPods(user)) return true;
  return hasRole(user, "tl") && job.tl_id === user?.id;
}

export function useCanEditJob(job: JobDetail): boolean {
  const { data: user } = useCurrentUser();
  return canEditJob(job, user);
}

/** Whether this person is shown the job's client deadline at all.
 *
 * The server has already decided — a VE's payload does not carry the field —
 * so this is not the security boundary, it is what stops a lead's own empty
 * client deadline rendering as an inviting blank box on a screen where
 * nobody else has one. */
export function useLeadsJobPod(job: JobDetail): boolean {
  const { data: user } = useCurrentUser();
  return leadsJobPod(job, user);
}

/* --------------------------------------------------------------------------
   The shell every editable field wears
   -------------------------------------------------------------------------- */

/** A read-only `Field` with a pencil on its label. Reads exactly like the
 * static one until someone clicks — the panel is something everybody looks at
 * and only a TL writes to, so the editing chrome stays out of the layout until
 * it is asked for. */
function EditableField({
  label,
  canEdit,
  display,
  editor,
}: {
  label: string;
  canEdit: boolean;
  display: ReactNode;
  /** Gets a `done()` to close itself with, whether it saved or gave up. */
  editor: (done: () => void) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="min-w-0">
      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
        {label}
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title={`Edit ${label.toLowerCase()}`}
            aria-label={`Edit ${label.toLowerCase()}`}
            className="opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          >
            <i className="ri-pencil-line text-xs text-[var(--primary-light)]" />
          </button>
        )}
      </span>
      {editing ? (
        <div className="mt-1 space-y-1.5">{editor(() => setEditing(false))}</div>
      ) : (
        <span className="mt-0.5 block truncate text-sm font-semibold text-[var(--text-main)]">
          {display}
        </span>
      )}
    </div>
  );
}

/** The close button every inline editor carries, so a field opened by mistake
 * gets shut the same way everywhere. */
function CancelEdit({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Cancel"
      aria-label="Cancel"
      className="shrink-0 text-[var(--text-dim)] transition-colors hover:text-[var(--text-main)]"
    >
      <i className="ri-close-line text-sm" />
    </button>
  );
}

/* --------------------------------------------------------------------------
   The fields themselves
   -------------------------------------------------------------------------- */

/** Which of the client's channels this video is for. Picking one saves it —
 * there is nothing to confirm about a single choice from a list, and the value
 * back under the label is the confirmation. */
export function ChannelField({ job }: { job: JobDetail }) {
  const canEdit = useCanEditJob(job);
  const { data: channels } = usePodChannels(job.pod_id);
  const update = useUpdateJob(job.id);
  const toast = useToast();

  const save = (channelId: string, done: () => void) =>
    update.mutate(channelId ? { channel_id: channelId } : { clear_channel: true }, {
      onSuccess: done,
      onError: (error) => toast.notifyError(error, "Could not file this job."),
    });

  return (
    <EditableField
      label="Channel"
      canEdit={canEdit}
      display={job.channel_name ?? <span className="text-[var(--text-dim)]">Not filed</span>}
      editor={(done) => (
        <>
          <div className="flex items-center gap-1.5">
            <SearchableSelect autoFocus value={job.channel_id ?? ""} disabled={update.isPending} onChange={(id) => save(id, done)} placeholder="Not filed" options={[{ value: "", label: "Not filed" }, ...(channels ?? []).map((channel) => ({ value: channel.id, label: channel.name }))]} />
            <CancelEdit onClick={done} />
          </div>
          {(channels ?? []).length === 0 && (
            <p className="text-[11px] text-[var(--text-dim)]">
              {job.pod_name} has no channels yet — add one under "Which channel" below.
            </p>
          )}
          <ErrorNote error={update.error} fallback="Could not file this job." />
        </>
      )}
    />
  );
}

/** Podcast / long form / short form. Wrong at creation more often than
 * anything else on this card, because it is picked off a brief nobody has
 * opened yet. */
export function VideoTypeField({ job, children }: { job: JobDetail; children: ReactNode }) {
  const { data: videoTypes } = useVideoTypes();
  const canEdit = useCanEditJob(job);
  const update = useUpdateJob(job.id);
  const toast = useToast();

  const save = (videoType: string, done: () => void) =>
    update.mutate(
      { video_type: videoType as VideoType },
      {
        onSuccess: done,
        onError: (error) => toast.notifyError(error, "Could not change the video type."),
      },
    );

  return (
    <EditableField
      label="Video type"
      canEdit={canEdit}
      display={children}
      editor={(done) => (
        <>
          <div className="flex items-center gap-1.5">
            <Select
              autoFocus
              value={job.video_type}
              disabled={update.isPending || !videoTypes}
              onChange={(e) => save(e.target.value, done)}
              className="!py-1.5 !pr-8 !text-xs"
            >
              {(videoTypes ?? []).filter((type) => type.enabled || type.key === job.video_type).map((type) => (
                <option key={type.key} value={type.key}>
                  {type.label}{type.enabled ? "" : " (disabled)"}
                </option>
              ))}
            </Select>
            <CancelEdit onClick={done} />
          </div>
          <ErrorNote error={update.error} fallback="Could not change the video type." />
        </>
      )}
    />
  );
}

/** The date the client is expecting it. Unlike the two selects this one waits
 * for a Save: a date input fires `change` while it is still half-typed, and a
 * year of 0026 written straight through would land in the activity feed
 * looking exactly like a real edit. */
export function DeadlineField({ job, children }: { job: JobDetail; children: ReactNode }) {
  const canEdit = useCanEditJob(job);
  const update = useUpdateJob(job.id);
  const toast = useToast();
  const current = job.deadline ? job.deadline.slice(0, 10) : "";
  const [draft, setDraft] = useState(current);

  const save = (done: () => void) => {
    if (draft === current) return done();
    update.mutate(draft ? { deadline: draft } : { clear_deadline: true }, {
      onSuccess: done,
      onError: (error) => toast.notifyError(error, "Could not change the deadline."),
    });
  };

  return (
    <EditableField
      label={DEADLINE_LABEL}
      canEdit={canEdit}
      display={children}
      editor={(done) => (
        <>
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              type="date"
              value={draft}
              disabled={update.isPending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save(done);
                if (e.key === "Escape") done();
              }}
              className="!px-2 !py-1.5 !text-xs"
            />
            <CancelEdit onClick={done} />
          </div>
          <div className="flex items-center gap-2">
            <Button
              disabled={update.isPending}
              onClick={() => save(done)}
              className="!px-2.5 !py-1 !text-xs"
            >
              Save
            </Button>
            {draft && (
              <button
                type="button"
                disabled={update.isPending}
                onClick={() => setDraft("")}
                className="text-[11px] font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--accent-red)]"
              >
                No deadline
              </button>
            )}
          </div>
          <ErrorNote error={update.error} fallback="Could not change the deadline." />
        </>
      )}
    />
  );
}

/** The date the client was actually promised — the TL's and the Owner's, and
 * rendered to nobody else.
 *
 * A separate field rather than a second input inside `DeadlineField` because
 * they are separate decisions made at separate moments: the promise comes off
 * the brief at intake, the working date is chosen when the job is handed to
 * an editor. Putting them in one editor would suggest they move together.
 */
export function ClientDeadlineField({ job }: { job: JobDetail }) {
  const canSee = useLeadsJobPod(job);
  const canEdit = useCanEditJob(job);
  const update = useUpdateJob(job.id);
  const toast = useToast();
  const current = job.client_deadline ? job.client_deadline.slice(0, 10) : "";
  const [draft, setDraft] = useState(current);

  if (!canSee) return null;

  const save = (done: () => void) => {
    if (draft === current) return done();
    update.mutate(draft ? { client_deadline: draft } : { clear_client_deadline: true }, {
      onSuccess: done,
      onError: (error) => toast.notifyError(error, "Could not change the actual deadline."),
    });
  };

  const buffer = deadlineBuffer(job.deadline, job.client_deadline);

  return (
    <EditableField
      label={ACTUAL_DEADLINE_LABEL}
      canEdit={canEdit}
      display={
        <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
          {job.client_deadline ? formatFullDate(job.client_deadline) : "None set"}
          {/* The gap is the reason the second date exists, so it is on the
              same line rather than something to work out in your head. */}
          {buffer && (
            <span
              className={
                buffer.days <= 0
                  ? "text-[11px] text-[var(--accent-amber)]"
                  : "text-[11px] text-[var(--text-dim)]"
              }
            >
              · {buffer.label}
            </span>
          )}
        </span>
      }
      editor={(done) => (
        <>
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              type="date"
              value={draft}
              disabled={update.isPending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save(done);
                if (e.key === "Escape") done();
              }}
              className="!px-2 !py-1.5 !text-xs"
            />
            <CancelEdit onClick={done} />
          </div>
          <p className="text-[11px] text-[var(--text-dim)]">
            Only you and the Owner see this. The team works to the deadline above.
          </p>
          <div className="flex items-center gap-2">
            <Button
              disabled={update.isPending}
              onClick={() => save(done)}
              className="!px-2.5 !py-1 !text-xs"
            >
              Save
            </Button>
            {draft && (
              <button
                type="button"
                disabled={update.isPending}
                onClick={() => setDraft("")}
                className="text-[11px] font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--accent-red)]"
              >
                None
              </button>
            )}
          </div>
          <ErrorNote error={update.error} fallback="Could not change the actual deadline." />
        </>
      )}
    />
  );
}

/** The job's name, edited where it is read — in the panel header and at the
 * top of the full page. `children` is whatever that header already renders, so
 * the two keep their own type sizes and the code prefix. */
export function EditableTitle({
  job,
  className = "",
  children,
}: {
  job: JobDetail;
  className?: string;
  children: ReactNode;
}) {
  const canEdit = useCanEditJob(job);
  const update = useUpdateJob(job.id);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(job.title);

  const save = () => {
    const title = draft.trim();
    if (!title || title === job.title) return setEditing(false);
    update.mutate(
      { title },
      {
        onSuccess: () => setEditing(false),
        onError: (error) => toast.notifyError(error, "Could not rename this job."),
      },
    );
  };

  if (editing) {
    return (
      <div className="mt-1 w-full space-y-2">
        <Input
          autoFocus
          value={draft}
          disabled={update.isPending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          className="!py-1.5 !text-sm font-semibold"
        />
        <div className="flex items-center gap-2">
          <Button
            disabled={update.isPending || !draft.trim()}
            onClick={save}
            className="!px-2.5 !py-1 !text-xs"
          >
            Save
          </Button>
          <Button
            variant="ghost"
            disabled={update.isPending}
            onClick={() => setEditing(false)}
            className="!px-2.5 !py-1 !text-xs"
          >
            Cancel
          </Button>
        </div>
        <ErrorNote error={update.error} fallback="Could not rename this job." />
      </div>
    );
  }

  return (
    <div className={`flex min-w-0 items-start gap-1.5 ${className}`}>
      {children}
      {canEdit && (
        <button
          type="button"
          onClick={() => {
            setDraft(job.title);
            setEditing(true);
          }}
          title="Edit title"
          aria-label="Edit title"
          className="mt-1 shrink-0 opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100"
        >
          <i className="ri-pencil-line text-sm text-[var(--primary-light)]" />
        </button>
      )}
    </div>
  );
}
