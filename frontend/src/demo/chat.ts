import type { AskBotHandlers, AskBotPayload } from "@/api/chat";
import type { ChartSpec } from "@/types";

import { demoAddConversation, demoOverviewFor, demoUserFromToken } from "./server";

/* A scripted stand-in for Kontent Bot in the demo build. It answers a handful
 * of the suggested questions from the demo data and says plainly that it is a
 * demo for anything else — there is no model behind it. */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function demoAskBot(
  payload: AskBotPayload,
  handlers: AskBotHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const me = demoUserFromToken(localStorage.getItem("access_token"));
  const overview = me ? demoOverviewFor(me.id) : null;
  const q = payload.message.toLowerCase();

  const convId = payload.conversation_id ?? "pending";
  handlers.onMeta?.(convId);
  await wait(350);
  if (signal?.aborted) return;

  let content = "This is the demo build, so Kontent Bot only knows a few questions. Try “Which client has the most overdue videos?” or “How is first-pass going?”.";
  const charts: ChartSpec[] = [];
  let tool = "demo_lookup";

  if (overview && /overdue|late|behind/.test(q)) {
    tool = "overdue_by_client";
    const rows = [...overview.pods].sort((a, b) => b.overdue - a.overdue).slice(0, 6);
    const top = rows[0];
    content = top && top.overdue > 0
      ? `${top.pod_name} has the most overdue videos right now (${top.overdue}). Overall ${overview.overdue} videos are past their deadline.`
      : "Nothing is overdue right now. Nice.";
    charts.push({
      chart_type: "bar", title: "Overdue videos by client", labels: rows.map((r) => r.pod_name),
      series: [{ name: "Overdue", values: rows.map((r) => r.overdue) }], y_label: "Videos", value_format: "number", note: null,
    });
  } else if (overview && /first.?pass|clean|revision/.test(q)) {
    tool = "first_pass_rate";
    content = overview.first_pass_pct == null
      ? "Nothing has been delivered yet, so there is no first-pass rate to report."
      : `First-pass rate is ${overview.first_pass_pct}%: ${overview.clean_delivered} of ${overview.delivered} delivered videos went out with no revision round.`;
  } else if (overview && /stuck|qc ?1|flag/.test(q)) {
    tool = "qc_health";
    content = `${overview.pending_qc1} videos are waiting at QC 1 and ${overview.qc1_flagged} has been flagged as a skipped QC 1.`;
  } else if (overview && /overload|capacity|busy|editor/.test(q)) {
    tool = "editor_capacity";
    content = `${overview.in_flight} videos are in flight and ${overview.intake} are still waiting for an editor. Open Team Capacity to see each editor's free slots.`;
  }

  handlers.onTool?.({ name: tool, status: "running" });
  await wait(450);
  handlers.onTool?.({ name: tool, status: "done" });
  charts.forEach((c) => handlers.onChart?.(c));
  await wait(250);
  if (signal?.aborted) return;

  const conversationId = payload.conversation_id ?? demoAddConversation(payload.message, content);
  handlers.onAnswer?.({
    message_id: `m_${Date.now()}`,
    conversation_id: conversationId,
    content,
    tool_calls: [{ name: tool, arguments: {}, ok: true }],
    charts,
    model: "demo",
    hit_iteration_cap: false,
  });
}
