import { lazy, Suspense, useEffect, useRef, useState } from "react";

import type { BotErrorCode } from "@/api/chat";
import { AnswerText } from "@/components/chat/AnswerText";
import { BillingNotice } from "@/components/chat/BillingNotice";
import { ToolActivity } from "@/components/chat/ToolActivity";
import { Button } from "@/components/ui/Button";
import type { PendingExchange } from "@/hooks/useChat";
import type { ChatMessage, ChatStatus } from "@/types";

/* The charting library is the single heaviest thing the app imports and most
 * answers never draw a graph, so it is fetched the first time one appears
 * rather than on every page load. The placeholder holds the chart's own
 * height so the thread doesn't jump when it arrives. */
const ChartBlock = lazy(() =>
  import("@/components/chat/ChartBlock").then((module) => ({ default: module.ChartBlock })),
);

function ChartFallback({ compact }: { compact: boolean }) {
  return (
    <div
      className={`mt-2 flex ${compact ? "h-40" : "h-56"} items-center justify-center rounded-lg border border-[var(--border-color-subtle)] bg-[var(--bg-card)] text-xs text-[var(--text-muted)]`}
    >
      <i className="ri-loader-4-line mr-1.5 animate-spin" /> Drawing the chart…
    </div>
  );
}

export const SUGGESTIONS = [
  "Chart deliveries per week for the last 3 months",
  "How is this month going for my clients?",
  "Who has delivered the most this month?",
  "Anything stuck at 3+ rounds?",
  "Who has capacity for a heavy job this week?",
];

interface ChatThreadProps {
  status?: ChatStatus;
  messages: ChatMessage[];
  pending: PendingExchange | null;
  error: string | null;
  /** Present when the failure has a fix — renders instructions, not a line. */
  errorCode?: BotErrorCode | null;
  loadingHistory?: boolean;
  onSend: (question: string) => void;
  onJobCode?: (code: string) => void;
  /** Widget mode is cramped: fewer suggestions, shorter scroll area. */
  compact?: boolean;
}

/** The conversation itself. Takes everything as props so the full page and
 * the floating widget render the identical thread — one component, two
 * mounts, the same arrangement `JobDetailContent` already uses so the two
 * can't drift apart. */
export function ChatThread({
  status,
  messages,
  pending,
  error,
  errorCode = null,
  loadingHistory = false,
  onSend,
  onJobCode,
  compact = false,
}: ChatThreadProps) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending]);

  const disabled = status ? !status.enabled : false;
  const overCap = Boolean(status && status.daily_cap > 0 && status.used_today >= status.daily_cap);
  const empty = !messages.length && !pending && !loadingHistory;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || overCap || pending) return;
    onSend(draft);
    setDraft("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Not connected yet is a real state, not an error — say so plainly
          rather than offering a box that fails on submit. */}
      {disabled && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
          <i className="ri-plug-line mt-px shrink-0" />
          <span>{status?.reason}</span>
        </div>
      )}

      <div
        className={`min-h-0 flex-1 space-y-4 overflow-y-auto rounded-lg border border-[var(--border-color-subtle)] bg-[var(--bg-app)] p-3 ${
          compact ? "max-h-72" : ""
        }`}
      >
        {loadingHistory && (
          <p className="text-xs text-[var(--text-muted)]">Loading this conversation…</p>
        )}

        {empty && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <i className="ri-sparkling-2-line text-2xl text-[var(--primary)]" />
            <p className="text-sm font-semibold text-[var(--text-main)]">
              Ask about your clients, your editors, or a specific job.
            </p>
            <p className="max-w-md text-xs text-[var(--text-muted)]">
              Answers come from live platform data — the same numbers as the analytics
              pages, scoped to what you're allowed to see. It can read, not change anything.
            </p>
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-lg rounded-tr-none bg-gradient-to-br from-[var(--primary)] to-[var(--primary-hover)] px-3 py-2 text-xs font-medium text-white">
                {message.content}
              </div>
            </div>
          ) : (
            <div key={message.id} className="flex items-start gap-2">
              <BotAvatar />
              {/* Wider than a text-only turn: a chart squeezed into 85% of a
                  narrow column stops being readable, and the answer it
                  belongs to should stay beside it rather than wrap away. */}
              <div
                className={`min-w-0 space-y-1.5 ${
                  message.charts?.length ? "w-full max-w-2xl" : "max-w-[85%]"
                }`}
              >
                {/* An answer that is all chart and no words renders as the
                    chart alone rather than an empty speech bubble. The server
                    tries not to produce one (agent.py::_final_answer); this
                    makes it a non-event if it ever does. */}
                {message.content.trim() && (
                  <div className="rounded-lg rounded-tl-none border border-[var(--border-color-subtle)] bg-[var(--bg-card)] px-3 py-2 text-xs leading-relaxed text-[var(--text-main)]">
                    <AnswerText text={message.content} onJobCode={onJobCode} />
                  </div>
                )}
                {message.charts?.map((chart, index) => (
                  <Suspense key={`${message.id}-${index}`} fallback={<ChartFallback compact={compact} />}>
                    <ChartBlock spec={chart} compact={compact} />
                  </Suspense>
                ))}
                <ToolActivity calls={message.tool_calls} />
              </div>
            </div>
          ),
        )}

        {pending && (
          <>
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-lg rounded-tr-none bg-gradient-to-br from-[var(--primary)] to-[var(--primary-hover)] px-3 py-2 text-xs font-medium text-white opacity-70">
                {pending.question}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <BotAvatar />
              <div
                className={`min-w-0 space-y-1.5 ${pending.charts.length ? "w-full max-w-2xl" : ""}`}
              >
                <div className="flex items-center gap-2 rounded-lg rounded-tl-none border border-[var(--border-color-subtle)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-muted)]">
                  <i className="ri-loader-4-line animate-spin" />
                  {pending.tools.length ? "Looking that up…" : "Thinking…"}
                </div>
                {/* Charts land before the written answer does — same reason
                    the tool chips do. No sense hiding a finished graph while
                    the model composes a paragraph about it. */}
                {pending.charts.map((chart, index) => (
                  <Suspense key={`pending-${index}`} fallback={<ChartFallback compact={compact} />}>
                    <ChartBlock spec={chart} compact={compact} />
                  </Suspense>
                ))}
                <ToolActivity frames={pending.tools} />
              </div>
            </div>
          </>
        )}

        <div ref={bottomRef} />
      </div>

      {/* A failure with a fix gets the fix; everything else gets one line.
          Both can't be true at once, so this is a branch, not two banners. */}
      {error && errorCode ? (
        <BillingNotice code={errorCode} detail={error} compact={compact} />
      ) : error ? (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-lg bg-[var(--accent-red-bg)] px-3 py-2 text-xs font-medium text-[var(--accent-red)]"
        >
          <i className="ri-error-warning-line mt-px shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      {empty && !disabled && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.slice(0, compact ? 2 : SUGGESTIONS.length).map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => setDraft(question)}
              className="rounded-full border border-[var(--border-color)] bg-[var(--bg-pill)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-muted)] transition-all hover:border-[var(--primary)] hover:text-[var(--text-main)]"
            >
              {question}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            disabled
              ? "Kontent Bot isn't connected yet"
              : overCap
                ? "Daily question limit reached"
                : "Ask Kontent Bot something…"
          }
          disabled={disabled || overCap}
          className="flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-main)] outline-none focus:border-[var(--primary)] disabled:opacity-60"
        />
        <Button type="submit" disabled={disabled || overCap || !draft.trim() || Boolean(pending)}>
          <i className={pending ? "ri-loader-4-line animate-spin" : "ri-send-plane-2-line"} />
        </Button>
      </form>

      {status?.enabled && status.daily_cap > 0 && (
        <p className="text-right text-[10px] text-[var(--text-dim)]">
          {status.used_today}/{status.daily_cap} questions today · {status.model}
        </p>
      )}
    </div>
  );
}

function BotAvatar() {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/15 text-sm text-[var(--primary-light)]">
      <i className="ri-sparkling-2-line" />
    </div>
  );
}
