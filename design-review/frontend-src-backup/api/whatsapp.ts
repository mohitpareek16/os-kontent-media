import type { Page } from "@/types";

import { apiClient } from "./client";

/** Connection health. Everything except `error` is read live from Meta where
 * possible, so a wrong phone number id shows up here rather than as silence at
 * the first hand-off. The access token is never returned — only whether one is
 * set. */
export interface WhatsAppConnection {
  configured: boolean;
  has_token: boolean;
  has_app_secret: boolean;
  has_verify_token: boolean;
  graph_version: string;
  waba_id: string | null;
  phone_number_id: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
  quality_rating: string | null;
  messaging_limit: string | null;
  platform_type: string | null;
  /** Null until the first webhook ever arrives — a connection that looks
   * healthy but has never received one is a subscription that was never set
   * up, which is invisible from every other angle. */
  webhook_last_received_at: string | null;
  error: string | null;
}

export interface WhatsAppTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  requested_category: string;
  quality_score: string | null;
  rejected_reason: string | null;
  meta_template_id: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  last_status_at: string | null;
  last_synced_at: string | null;
  /** Meta has re-filed this away from UTILITY — the ~2/day Marketing cap. */
  category_drifted: boolean;
  /** The code changed after Meta approved this version. Resubmit. */
  drifted: boolean;
  /** In the registry, never submitted. */
  missing: boolean;
  /** At Meta, not in the registry — made by hand, and never sent from here. */
  unmanaged: boolean;
  purpose: string | null;
  recipient: string | null;
  param_count: number | null;
  body_preview: string | null;
  buttons: string[];
}

export interface TemplateSyncResult {
  seen: number;
  changed: number;
  unmanaged: string[];
  synced_at: string;
}

export interface WhatsAppEventRule {
  event_key: string;
  template_name: string;
  enabled: boolean;
  tier: "core" | "exception" | "scheduled";
  recipient: string;
  purpose: string;
  /** False when the template behind it is not approved: the toggle is on but
   * nothing would send. */
  template_ready: boolean;
  template_status: string | null;
}

export interface WhatsAppSettings {
  enabled: boolean;
  pilot_user_ids: string[];
  event_flags: Record<string, boolean>;
  updated_at: string | null;
}

export interface WhatsAppMessage {
  id: string;
  user_id: string;
  user_name: string | null;
  job_id: string | null;
  job_code: string | null;
  event_key: string | null;
  template_name: string | null;
  to_phone: string | null;
  status: string;
  reason: string | null;
  error_code: number | null;
  error_detail: string | null;
  button_action: string | null;
  button_tapped_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  created_at: string;
}

export interface WhatsAppMessageStats {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
}

export interface WhatsAppNumber {
  user_id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  phone: string | null;
  phone_e164: string | null;
  phone_display: string | null;
  valid: boolean;
  opt_in: boolean;
  last_inbound_at: string | null;
  /** Inside Meta's 24-hour service window, so a reply right now would be free. */
  window_open: boolean;
  /** Another account holds the same number, so neither can use a button. */
  duplicate: boolean;
  reachable: boolean;
}

export interface TestSendResult {
  status: string;
  reason: string | null;
  error_code: number | null;
  error_detail: string | null;
  wamid: string | null;
  to_phone: string | null;
}

export interface SchedulerRunResult {
  reconciled: TemplateSyncResult | null;
  deadline_soon: number;
  deadline_missed: number;
}

export interface MessageFilters {
  status?: string;
  user_id?: string;
  job_id?: string;
  event_key?: string;
  template_name?: string;
  page?: number;
  page_size?: number;
}

export async function fetchConnection(): Promise<WhatsAppConnection> {
  const { data } = await apiClient.get<WhatsAppConnection>("/whatsapp/status");
  return data;
}

export async function fetchTemplates(): Promise<WhatsAppTemplate[]> {
  const { data } = await apiClient.get<WhatsAppTemplate[]>("/whatsapp/templates");
  return data;
}

export async function syncTemplates(): Promise<TemplateSyncResult> {
  const { data } = await apiClient.post<TemplateSyncResult>("/whatsapp/templates/sync");
  return data;
}

export async function submitTemplate(name: string): Promise<WhatsAppTemplate> {
  const { data } = await apiClient.post<WhatsAppTemplate>(
    `/whatsapp/templates/${encodeURIComponent(name)}/submit`,
  );
  return data;
}

export async function resubmitTemplate(name: string): Promise<WhatsAppTemplate> {
  const { data } = await apiClient.post<WhatsAppTemplate>(
    `/whatsapp/templates/${encodeURIComponent(name)}/resubmit`,
  );
  return data;
}

export async function deleteTemplate(name: string): Promise<void> {
  await apiClient.delete(`/whatsapp/templates/${encodeURIComponent(name)}`);
}

export async function fetchEventRules(): Promise<WhatsAppEventRule[]> {
  const { data } = await apiClient.get<WhatsAppEventRule[]>("/whatsapp/events");
  return data;
}

export async function fetchSettings(): Promise<WhatsAppSettings> {
  const { data } = await apiClient.get<WhatsAppSettings>("/whatsapp/settings");
  return data;
}

export async function updateSettings(
  payload: Partial<Pick<WhatsAppSettings, "enabled" | "pilot_user_ids" | "event_flags">>,
): Promise<WhatsAppSettings> {
  const { data } = await apiClient.patch<WhatsAppSettings>("/whatsapp/settings", payload);
  return data;
}

export async function fetchMessages(
  params: MessageFilters = {},
): Promise<Page<WhatsAppMessage>> {
  const { data } = await apiClient.get<Page<WhatsAppMessage>>("/whatsapp/messages", { params });
  return data;
}

export async function fetchMessageStats(days = 30): Promise<WhatsAppMessageStats> {
  const { data } = await apiClient.get<WhatsAppMessageStats>("/whatsapp/messages/stats", {
    params: { days },
  });
  return data;
}

export async function fetchNumbers(): Promise<WhatsAppNumber[]> {
  const { data } = await apiClient.get<WhatsAppNumber[]>("/whatsapp/numbers");
  return data;
}

export async function updateNumber(
  userId: string,
  payload: { opt_in?: boolean; renormalise?: boolean },
): Promise<WhatsAppNumber> {
  const { data } = await apiClient.patch<WhatsAppNumber>(`/whatsapp/numbers/${userId}`, payload);
  return data;
}

export async function testSend(templateName: string, userId?: string): Promise<TestSendResult> {
  const { data } = await apiClient.post<TestSendResult>("/whatsapp/test-send", {
    template_name: templateName,
    user_id: userId ?? null,
  });
  return data;
}

export async function runScheduler(): Promise<SchedulerRunResult> {
  const { data } = await apiClient.post<SchedulerRunResult>("/whatsapp/scheduler/run");
  return data;
}
