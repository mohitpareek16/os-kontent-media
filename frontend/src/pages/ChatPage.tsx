import { useState } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
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
    <div className="flex h-[calc(100vh-9rem)] min-h-0 flex-col gap-4">
      <PageHeader description="Client health, editor trends, stuck jobs and capacity — answered from live platform data, scoped to what you can see. Read-only: it can't change anything." className="!mb-0" />

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
