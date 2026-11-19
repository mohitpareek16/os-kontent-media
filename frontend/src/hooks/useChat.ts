import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  askBot,
  deleteConversation,
  fetchChatStatus,
  fetchConversation,
  fetchConversations,
  type BotErrorCode,
  type BotToolFrame,
} from "@/api/chat";
import type { ChartSpec, ChatMessage } from "@/types";

export function useChatStatus(enabled = true) {
  return useQuery({ queryKey: ["chat", "status"], queryFn: fetchChatStatus, enabled });
}

export function useConversations(enabled = true) {
  return useQuery({
    queryKey: ["chat", "conversations"],
    queryFn: () => fetchConversations({ page_size: 50 }),
    enabled,
  });
}

export function useConversation(conversationId: string | null) {
  return useQuery({
    queryKey: ["chat", "conversation", conversationId],
    queryFn: () => fetchConversation(conversationId as string),
    enabled: Boolean(conversationId),
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteConversation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] }),
  });
}

/** One in-flight exchange: the question already asked, the lookups running,
 * the charts drawn so far, and the answer when it lands. */
export interface PendingExchange {
  question: string;
  tools: BotToolFrame[];
  charts: ChartSpec[];
}

/**
 * The whole client side of a conversation.
 *
 * A hook rather than page state because two surfaces mount it — the full
 * Kontent Bot page and the floating widget — and duplicating "hold the
 * optimistic turn, drain the stream, then trust the server" across both is
 * exactly the silent duplication docs/06-frontend-rules.md is about.
 */
export function useBotChat() {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingExchange | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set alongside `error` when the failure has a fix the user can carry
   * out — the thread renders instructions instead of a red line. */
  const [errorCode, setErrorCode] = useState<BotErrorCode | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const conversation = useConversation(conversationId);

  /** Server truth once it exists; nothing before the first answer lands. */
  const messages: ChatMessage[] = conversation.data?.messages ?? [];

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || pending) return;

      setError(null);
      setErrorCode(null);
      setPending({ question: text, tools: [], charts: [] });

      const controller = new AbortController();
      abortRef.current = controller;
      let landedConversationId = conversationId;

      try {
        await askBot(
          { message: text, conversation_id: conversationId },
          {
            onMeta: (id) => {
              landedConversationId = id;
              // Set immediately so a mid-answer navigation still resumes the
              // right thread.
              setConversationId(id);
            },
            onTool: (frame) =>
              setPending((current) => {
                if (!current) return current;
                // A tool reports twice — running, then done/refused. Replace
                // the running entry rather than stacking two chips for one
                // lookup.
                const tools = [...current.tools];
                const index = tools.findIndex(
                  (t) => t.name === frame.name && t.status === "running",
                );
                if (frame.status !== "running" && index !== -1) tools[index] = frame;
                else tools.push(frame);
                return { ...current, tools };
              }),
            onChart: (spec) =>
              setPending((current) =>
                current ? { ...current, charts: [...current.charts, spec] } : current,
              ),
            onError: (detail, code) => {
              setError(detail);
              setErrorCode(code ?? null);
            },
          },
          controller.signal,
        );
      } catch (streamError) {
        if ((streamError as Error)?.name !== "AbortError") {
          setError("Lost the connection before the answer arrived.");
        }
      } finally {
        abortRef.current = null;
        setPending(null);
        if (landedConversationId) {
          await queryClient.invalidateQueries({
            queryKey: ["chat", "conversation", landedConversationId],
          });
        }
        queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
        queryClient.invalidateQueries({ queryKey: ["chat", "status"] });
      }
    },
    [conversationId, pending, queryClient],
  );

  const openConversation = useCallback((id: string | null) => {
    abortRef.current?.abort();
    setPending(null);
    setError(null);
    setErrorCode(null);
    setConversationId(id);
  }, []);

  return {
    conversationId,
    openConversation,
    startNew: () => openConversation(null),
    messages,
    loadingHistory: conversation.isLoading,
    pending,
    streaming: pending !== null,
    error,
    errorCode,
    dismissError: () => {
      setError(null);
      setErrorCode(null);
    },
    send,
  };
}
