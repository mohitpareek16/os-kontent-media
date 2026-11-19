import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { ErrorNote } from "@/components/ui/ErrorNote";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { useCreateChannel, usePodChannels, useUpdateChannel } from "@/hooks/usePods";
import type { Channel, Pod } from "@/types";

function ChannelRow({
  pod,
  channel,
  canManage,
}: {
  pod: Pod;
  channel: Channel;
  canManage: boolean;
}) {
  const update = useUpdateChannel(pod.id);
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(channel.name);

  const save = () => {
    if (!name.trim() || name.trim() === channel.name) {
      setRenaming(false);
      return;
    }
    update.mutate(
      { channelId: channel.id, name: name.trim() },
      {
        onSuccess: () => setRenaming(false),
        onError: (error) => toast.notifyError(error, "Could not rename that channel."),
      },
    );
  };

  if (renaming) {
    return (
      <li className="flex items-center gap-2">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <Button disabled={update.isPending} onClick={save}>
          Save
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setRenaming(false);
            setName(channel.name);
          }}
        >
          Cancel
        </Button>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 rounded-lg border border-[var(--border-color-subtle)] bg-[var(--bg-card)] px-3 py-2">
      <i className="ri-play-list-2-line text-[var(--text-dim)]" />
      <span className="flex-1 truncate text-xs font-semibold text-[var(--text-main)]">
        {channel.name}
      </span>
      <span className="shrink-0 text-xs text-[var(--text-dim)]">
        {channel.job_count} {channel.job_count === 1 ? "video" : "videos"}
      </span>
      {canManage && (
        <>
          <button
            type="button"
            onClick={() => setRenaming(true)}
            title="Rename"
            className="shrink-0 rounded p-1.5 text-[var(--text-dim)] transition-colors hover:text-[var(--text-main)]"
          >
            <i className="ri-pencil-line" />
          </button>
          <button
            type="button"
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { channelId: channel.id, archived: true },
                { onError: (error) => toast.notifyError(error, "Could not retire that channel.") },
              )
            }
            title="Retire it — the videos already filed under it keep the name, and it stops appearing in pickers"
            className="shrink-0 rounded p-1.5 text-[var(--text-dim)] transition-colors hover:text-[var(--accent-amber)] disabled:opacity-50"
          >
            <i className="ri-archive-line" />
          </button>
        </>
      )}
    </li>
  );
}

/** A client's publishing destinations — Dhan HQ, AAD, lwdhan.
 *
 * There is no delete, only retire: a channel that named real work has to go on
 * naming it, and dropping the row would silently re-file those videos as "no
 * channel", which looks exactly like data somebody entered. */
export function ChannelList({ pod, canManage }: { pod: Pod; canManage: boolean }) {
  const { data: channels, isLoading } = usePodChannels(pod.id);
  const create = useCreateChannel(pod.id);
  const toast = useToast();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const add = () => {
    if (!name.trim()) return;
    create.mutate(name.trim(), {
      onSuccess: () => {
        setName("");
        setAdding(false);
      },
      onError: (error) => toast.notifyError(error, "Could not add that channel."),
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-[var(--text-dim)]">
          Channels
        </span>
        {canManage && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-xs font-semibold text-[var(--primary-light)] transition-colors hover:text-[var(--primary)]"
          >
            <i className="ri-add-line" /> Add a channel
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-[var(--text-dim)]">Loading channels...</p>
      ) : (channels ?? []).length > 0 ? (
        <ul className="space-y-1.5">
          {(channels ?? []).map((channel) => (
            <ChannelRow key={channel.id} pod={pod} channel={channel} canManage={canManage} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-[var(--text-dim)]">
          {pod.name} publishes to one place as far as this system knows. Add a channel if the
          client has more than one, and every video can say which it is for.
        </p>
      )}

      {adding && (
        <div className="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-pill)] p-3">
          <Input
            autoFocus
            placeholder="Channel name — Dhan HQ, AAD..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <ErrorNote error={create.error} fallback="Could not add that channel." />
          <div className="flex gap-2">
            <Button disabled={create.isPending || !name.trim()} onClick={add}>
              Add
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setName("");
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
