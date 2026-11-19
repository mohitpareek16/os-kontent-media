import { useState } from "react";

import { ChatThread } from "@/components/chat/ChatThread";
import { ConversationList } from "@/components/chat/ConversationList";
import { JobDetailPanel } from "@/components/pipeline/JobDetailPanel";
import {
  useBotChat,
  useChatStatus,
  useConversations,
  useDeleteConversation,
} from "@/hooks/useChat";
import { useJobEvents, useJobs } from "@/hooks/useJobs";

export default function ChatPage() {
  const chat = useBotChat();
  const { data: status } = useChatStatus();
  const { data: conversations } = useConversations();
  const deleteConversation = useDeleteConversation();

  /* A job code quoted in an answer opens the same inspector the pipeline
   * table opens. The bot returns codes, not ids, so the code is resolved
   * through the job search the pipeline already uses rather than inventing
   * a lookup endpoint for it. */
  const [openCode, setOpenCode] = useState<string | null>(null);
  const { data: codeMatches } = useJobs(
    { search: openCode ?? undefined, page_size: 1 },
    { enabled: Boolean(openCode) },
  );
  const openJob = codeMatches?.items?.[0];
  const { data: openJobEvents } = useJobEvents(openJob?.id ?? null);

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-0 flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border-color)] pb-5">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--primary-light)]">
            <i className="ri-sparkling-2-line" /> Kontent Bot
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[var(--text-main)]">
            Ask about your ops
          </h1>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Client health, editor trends, stuck jobs and capacity — answered from live platform
            data, scoped to what you can see. Read-only: it can't change anything.
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[16rem_1fr]">
        <aside className="hidden min-h-0 lg:block">
          <ConversationList
            conversations={conversations?.items ?? []}
            activeId={chat.conversationId}
            onOpen={chat.openConversation}
            onNew={chat.startNew}
            onDelete={(id) => {
              deleteConversation.mutate(id, {
                onSuccess: () => {
                  if (id === chat.conversationId) chat.startNew();
                },
              });
            }}
            deletingId={deleteConversation.isPending ? deleteConversation.variables : null}
          />
        </aside>

        <section className="glass-card flex min-h-0 flex-col p-4">
          <ChatThread
            status={status}
            messages={chat.messages}
            pending={chat.pending}
            error={chat.error}
            errorCode={chat.errorCode}
            loadingHistory={chat.loadingHistory}
            onSend={chat.send}
            onJobCode={setOpenCode}
          />
        </section>
      </div>

      <JobDetailPanel
        job={openJob}
        events={openJobEvents}
        open={Boolean(openCode)}
        onClose={() => setOpenCode(null)}
      />
    </div>
  );
}
