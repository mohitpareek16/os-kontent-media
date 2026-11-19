import { Button } from "@/components/ui/Button";
import { timeAgo } from "@/lib/format";
import type { ChatConversation } from "@/types";

interface ConversationListProps {
  conversations: ChatConversation[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  deletingId?: string | null;
}

export function ConversationList({
  conversations,
  activeId,
  onOpen,
  onNew,
  onDelete,
  deletingId,
}: ConversationListProps) {
  return (
    <div className="flex h-full flex-col gap-3">
      <Button variant="secondary" onClick={onNew} className="w-full">
        <i className="ri-add-line" /> New conversation
      </Button>

      {!conversations.length && (
        <p className="px-1 text-xs text-[var(--text-muted)]">
          Nothing yet. Your past questions will be listed here — they're private to you.
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            className={`group flex items-center gap-1 rounded-lg border px-2 py-1.5 transition-all ${
              conversation.id === activeId
                ? "border-[var(--primary)] bg-[var(--bg-card-hover)]"
                : "border-transparent hover:border-[var(--border-color)] hover:bg-[var(--bg-card-hover)]"
            }`}
          >
            <button
              type="button"
              onClick={() => onOpen(conversation.id)}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-xs font-semibold text-[var(--text-main)]">
                {conversation.title}
              </p>
              <p className="text-xs text-[var(--text-dim)]">
                {timeAgo(conversation.updated_at)}
              </p>
            </button>
            <button
              type="button"
              aria-label={`Delete ${conversation.title}`}
              onClick={() => onDelete(conversation.id)}
              disabled={deletingId === conversation.id}
              className="shrink-0 rounded p-1 text-[var(--text-dim)] opacity-0 transition-all hover:text-[var(--accent-red)] group-hover:opacity-100 disabled:opacity-50"
            >
              <i className="ri-delete-bin-line text-xs" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
