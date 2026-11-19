import type {
  ChartSpec,
  ChatConversation,
  ChatConversationDetail,
  ChatStatus,
  ChatToolCall,
} from "@/types";

import { apiClient, endExpiredSession } from "./client";

export async function fetchChatStatus() {
  const { data } = await apiClient.get<ChatStatus>("/chat/status");
  return data;
}

interface ConversationPage {
  items: ChatConversation[];
  total: number;
  page: number;
  page_size: number;
}

export async function fetchConversations(params: { page?: number; page_size?: number } = {}) {
  const { data } = await apiClient.get<ConversationPage>("/chat/conversations", { params });
  return data;
}

export async function fetchConversation(conversationId: string) {
  const { data } = await apiClient.get<ChatConversationDetail>(
    `/chat/conversations/${conversationId}`,
  );
  return data;
}

export async function deleteConversation(conversationId: string) {
  await apiClient.delete(`/chat/conversations/${conversationId}`);
}

/* --- The answer stream ---
 *
 * `POST /api/chat` replies with Server-Sent Events so the UI can show which
 * lookups are running while they run. That needs the response body read
 * incrementally, which axios in the browser cannot do — it hands back a
 * complete string — so this one call uses `fetch` directly.
 *
 * It stays in `api/` rather than leaking into a hook or a component, which
 * is what docs/06-frontend-rules.md actually asks for: transport lives here,
 * components never speak to the network. The 401 path calls the same
 * `endExpiredSession` the axios interceptor does.
 *
 * Frames are event-typed rather than token-typed, so token-level streaming
 * can be added later as one more event without changing this parser.
 */

export interface BotToolFrame {
  name: string;
  status: "running" | "done" | "refused";
  arguments?: Record<string, unknown>;
}

export interface BotAnswerFrame {
  message_id: string;
  conversation_id: string;
  content: string;
  tool_calls: ChatToolCall[];
  charts: ChartSpec[];
  model: string | null;
  hit_iteration_cap: boolean;
}

export interface AskBotHandlers {
  onMeta?: (conversationId: string) => void;
  onTool?: (frame: BotToolFrame) => void;
  /** A chart finished rendering server-side, mid-answer. The same specs
   * arrive again on the stored message; this is only so the graph appears
   * while the model is still writing about it. */
  onChart?: (spec: ChartSpec) => void;
  onAnswer?: (frame: BotAnswerFrame) => void;
  /** `code` is set only for failures with a fix — see BotErrorCode. */
  onError?: (detail: string, code?: BotErrorCode) => void;
}

/** Failures a person can act on, as opposed to "try again". Kept in step
 * with `AiRequestError.code` on the server. */
export type BotErrorCode = "out_of_credits" | "invalid_key";

export interface AskBotPayload {
  message: string;
  conversation_id?: string | null;
}

export async function askBot(
  payload: AskBotPayload,
  handlers: AskBotHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = localStorage.getItem("access_token");
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message: payload.message,
      conversation_id: payload.conversation_id ?? null,
    }),
    signal,
  });

  if (!response.ok) {
    if (response.status === 401) {
      endExpiredSession();
      return;
    }
    // 503 (no key), 429 (daily cap) and 403 all arrive as real statuses with
    // a `detail` — the server decides everything it can before spending
    // money, precisely so these don't have to be dug out of a stream.
    let detail = "Kontent Bot couldn't answer that.";
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* a non-JSON error body is not worth failing over */
    }
    handlers.onError?.(detail);
    return;
  }

  if (!response.body) {
    handlers.onError?.("This browser can't read streamed responses.");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleFrame = (block: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
    }
    if (!dataLines.length) return;

    let data: unknown;
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }

    if (event === "meta") handlers.onMeta?.((data as { conversation_id: string }).conversation_id);
    else if (event === "tool") handlers.onTool?.(data as BotToolFrame);
    else if (event === "chart") handlers.onChart?.(data as ChartSpec);
    else if (event === "message") handlers.onAnswer?.(data as BotAnswerFrame);
    else if (event === "error") {
      const payload = data as { detail: string; code?: BotErrorCode };
      handlers.onError?.(payload.detail, payload.code);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split = buffer.indexOf("\n\n");
    while (split !== -1) {
      handleFrame(buffer.slice(0, split));
      buffer = buffer.slice(split + 2);
      split = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) handleFrame(buffer);
}
