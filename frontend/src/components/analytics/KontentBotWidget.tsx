import { useState } from "react";
import { Link } from "react-router-dom";

import { ChatThread } from "@/components/chat/ChatThread";
import { useCurrentUser } from "@/hooks/useAuth";
import { isLead } from "@/lib/roles";
import { useBotChat, useChatStatus } from "@/hooks/useChat";

/**
 * The floating Kontent Bot launcher.
 *
 * This was a disabled mock-up labelled "Preview"; it now runs the real
 * thread — the same `ChatThread` the full page mounts, so the two can't
 * drift. Ask a quick question here without losing the page you're on; open
 * the full page for history and the job inspector.
 *
 * Rendered for Owner and TL only, matching analytics: QCs and VEs have no
 * bot (docs/04-permissions.md). The server enforces that regardless — this
 * only avoids showing a button that would do nothing but 403.
 */
export function KontentBotWidget() {
  const [open, setOpen] = useState(false);
  const { data: user } = useCurrentUser();
  const allowed = isLead(user);

  const chat = useBotChat();
  const { data: status } = useChatStatus(allowed);

  if (!allowed) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((isOpen) => !isOpen)}
        aria-label={open ? "Close Kontent Bot" : "Open Kontent Bot"}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--primary)] text-2xl text-white transition-all"
      >
        <i className={open ? "ri-close-line" : "ri-sparkling-2-line"} />
      </button>

      {open && (
        <div className="glass-card fixed bottom-24 right-6 z-40 flex max-h-[70vh] w-96 max-w-[calc(100vw-3rem)] flex-col gap-3 p-4 shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
              <i className="ri-sparkling-2-line text-[var(--primary)]" /> Kontent Bot
            </h2>
            <Link
              to="/bot"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--primary-light)]"
            >
              Full page <i className="ri-external-link-line" />
            </Link>
          </div>

          <ChatThread
            compact
            status={status}
            messages={chat.messages}
            pending={chat.pending}
            error={chat.error}
            errorCode={chat.errorCode}
            loadingHistory={chat.loadingHistory}
            onSend={chat.send}
          />
        </div>
      )}
    </>
  );
}
