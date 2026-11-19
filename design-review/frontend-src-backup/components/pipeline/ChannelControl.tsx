import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Input } from "@/components/ui/Input";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useToast } from "@/components/ui/Toast";
import { useCurrentUser } from "@/hooks/useAuth";
import { useUpdateJob } from "@/hooks/useJobs";
import { useCreateChannel, usePodChannels } from "@/hooks/usePods";
import { hasRole, leadsAllPods } from "@/lib/roles";
import type { JobDetail, User } from "@/types";

/** `check_pod_lead` on the server — the pod's own TL, or the Owner. */
function canFile(job: JobDetail, user: User | undefined): boolean {
  if (leadsAllPods(user)) return true;
  return hasRole(user, "tl") && job.tl_id === user?.id;
}

export function useCanFileChannel(job: JobDetail): boolean {
  const { data: user } = useCurrentUser();
  return canFile(job, user) && !job.scrapped_at;
}

/** Which of the client's channels this video is for.
 *
 * Every job that existed before channels did has none, and that is deliberate
 * — a channel guessed from a title would render exactly like one somebody
 * chose. So this control's main job is not setting it at creation but filing
 * the backlog: a TL works down the board and says where each one goes. */
export function ChannelControl({ job }: { job: JobDetail }) {
  const { data: user } = useCurrentUser();
  const { data: channels } = usePodChannels(job.pod_id);
  const update = useUpdateJob(job.id);
  const createChannel = useCreateChannel(job.pod_id);
  const toast = useToast();

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  if (!canFile(job, user) || job.scrapped_at) return null;

  const file = (channelId: string) =>
    update.mutate(
      channelId ? { channel_id: channelId } : { clear_channel: true },
      { onError: (error) => toast.notifyError(error, "Could not file this job.") },
    );

  const addAndFile = () => {
    const name = newName.trim();
    if (!name) return;
    createChannel.mutate(name, {
      onSuccess: (channel) => {
        setNewName("");
        setAdding(false);
        file(channel.id);
      },
      onError: (error) => toast.notifyError(error, "Could not add that channel."),
    });
  };

  return (
    <div className="space-y-2">
      <SearchableSelect value={job.channel_id ?? ""} disabled={update.isPending} onChange={file} placeholder="Not filed under a channel" options={[{ value: "", label: "Not filed under a channel" }, ...(channels ?? []).map((channel) => ({ value: channel.id, label: channel.name }))]} />

      <ErrorNote error={update.error} fallback="Could not file this job." />

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 text-[11px] font-semibold text-[var(--primary-light)] transition-colors hover:text-[var(--primary)]"
        >
          <i className="ri-add-line" /> New channel for {job.pod_name}
        </button>
      ) : (
        <div className="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-pill)] p-3">
          <Input
            autoFocus
            placeholder="Channel name — Dhan HQ, AAD..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addAndFile()}
          />
          <ErrorNote error={createChannel.error} fallback="Could not add that channel." />
          <div className="flex gap-2">
            <Button disabled={createChannel.isPending || !newName.trim()} onClick={addAndFile}>
              Add and file this job
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setNewName("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {(channels ?? []).length === 0 && !adding && (
        <p className="text-[11px] text-[var(--text-dim)]">
          {job.pod_name} has no channels yet. Add one and every job for this client can be filed
          under it.
        </p>
      )}
    </div>
  );
}
