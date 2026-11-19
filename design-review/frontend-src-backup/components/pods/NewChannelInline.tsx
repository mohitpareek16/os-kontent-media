import { useState } from "react";

import { useToast } from "@/components/ui/Toast";
import { useCreateChannel } from "@/hooks/usePods";
import type { Channel } from "@/types";

interface NewChannelInlineProps {
  podId: string;
  /** Named in the prompt, so a picker holding one client says which. */
  podName?: string | null;
  /** The new channel, for callers that want to use it immediately — file the
   * selected rows under it, or make it the bulk picker's value. */
  onCreated?: (channel: Channel) => void;
  label?: string;
  /** Small enough to sit inside a table cell or a bulk toolbar. */
  compact?: boolean;
}

/** "+ New channel", wherever you find out you need one.
 *
 * Channels used to be creatable in exactly two places: expanded inside a pod
 * card, behind a button labelled *Members*, and on the detail panel of one job.
 * Everywhere else — the intake wizard, the pipeline table — a client with no
 * channels yet showed no picker at all and no way to make one, so the feature
 * was unreachable from the two screens where the need actually comes up.
 * That is a chicken-and-egg, not a permission: the TL who is filing the work
 * is the person allowed to name the channel.
 */
export function NewChannelInline({
  podId,
  podName,
  onCreated,
  label = "New channel",
  compact = false,
}: NewChannelInlineProps) {
  const create = useCreateChannel(podId);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || !podId) return;
    create.mutate(trimmed, {
      onSuccess: (channel) => {
        setName("");
        setOpen(false);
        // The server returns the existing row when the name is already there
        // (including a retired one it un-retires), so this is also how a TL
        // gets back to a channel they cannot see in the picker.
        onCreated?.(channel);
        toast.notify(`Channel "${channel.name}" is ready.`, "success");
      },
      onError: (error) => toast.notifyError(error, "Could not add that channel."),
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={podName ? `Add a channel to ${podName}` : "Add a channel"}
        className={`flex shrink-0 items-center gap-1 font-semibold text-[var(--primary-light)] transition-colors hover:text-[var(--primary)] ${
          compact ? "text-[10px]" : "text-[11px]"
        }`}
      >
        <i className="ri-add-line" /> {label}
      </button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setOpen(false);
            setName("");
          }
        }}
        placeholder={podName ? `New channel for ${podName}` : "Channel name — Dhan HQ, AAD..."}
        className={`rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 outline-none focus:border-[var(--primary)] ${
          compact ? "w-36 text-[10px]" : "w-48 text-xs"
        }`}
      />
      <button
        type="button"
        disabled={create.isPending || !name.trim()}
        onClick={submit}
        className="rounded p-1 text-[var(--accent-green)] transition-colors hover:bg-[var(--bg-pill)] disabled:opacity-40"
        title="Add it"
      >
        <i className={create.isPending ? "ri-loader-4-line animate-spin" : "ri-check-line"} />
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setName("");
        }}
        className="rounded p-1 text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-pill)]"
        title="Cancel"
      >
        <i className="ri-close-line" />
      </button>
    </div>
  );
}
