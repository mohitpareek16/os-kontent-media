import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deleteTemplate,
  fetchConnection,
  fetchEventRules,
  fetchMessageStats,
  fetchMessages,
  fetchNumbers,
  fetchSettings,
  fetchTemplates,
  resubmitTemplate,
  runScheduler,
  submitTemplate,
  syncTemplates,
  testSend,
  updateNumber,
  updateSettings,
  type MessageFilters,
  type WhatsAppSettings,
} from "@/api/whatsapp";

/** Connection health. Polled rather than fetched once: this is the panel
 * somebody stares at while setting the integration up, and the quality rating
 * and messaging tier move on Meta's side without anything happening here. */
export function useWhatsAppConnection() {
  return useQuery({
    queryKey: ["whatsapp", "connection"],
    queryFn: fetchConnection,
    refetchInterval: 60_000,
  });
}

/** The registry joined against Meta's copy — missing, drifted and unmanaged
 * rows all come back from one call. */
export function useWhatsAppTemplates() {
  return useQuery({ queryKey: ["whatsapp", "templates"], queryFn: fetchTemplates });
}

export function useSyncTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: syncTemplates,
    onSuccess: () => {
      // Events read template status too, so a sync that flips one to APPROVED
      // must refresh both tabs or the Events tab keeps saying "not ready".
      qc.invalidateQueries({ queryKey: ["whatsapp", "templates"] });
      qc.invalidateQueries({ queryKey: ["whatsapp", "events"] });
    },
  });
}

export function useSubmitTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitTemplate,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp", "templates"] });
      qc.invalidateQueries({ queryKey: ["whatsapp", "events"] });
    },
  });
}

export function useResubmitTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: resubmitTemplate,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp", "templates"] });
      qc.invalidateQueries({ queryKey: ["whatsapp", "events"] });
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp", "templates"] });
      qc.invalidateQueries({ queryKey: ["whatsapp", "events"] });
    },
  });
}

export function useWhatsAppEvents() {
  return useQuery({ queryKey: ["whatsapp", "events"], queryFn: fetchEventRules });
}

export function useWhatsAppSettings() {
  return useQuery({ queryKey: ["whatsapp", "settings"], queryFn: fetchSettings });
}

export function useUpdateWhatsAppSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Pick<WhatsAppSettings, "enabled" | "pilot_user_ids" | "event_flags">>) =>
      updateSettings(payload),
    onSuccess: (data) => {
      // Written straight into the cache as well as invalidated: a toggle that
      // visibly springs back while the refetch is in flight reads as a failed
      // save, and this one is a kill switch.
      qc.setQueryData(["whatsapp", "settings"], data);
      qc.invalidateQueries({ queryKey: ["whatsapp", "events"] });
    },
  });
}

/** One page of the delivery log. Filtered and paged server-side — this table
 * grows with every notification the app sends. */
export function useWhatsAppMessages(params: MessageFilters = {}) {
  return useQuery({
    queryKey: ["whatsapp", "messages", params],
    queryFn: () => fetchMessages(params),
    placeholderData: keepPreviousData,
  });
}

/** Counted over the window rather than the page, so the cards above the table
 * don't shrink when you turn to page two. */
export function useWhatsAppMessageStats(days = 30) {
  return useQuery({
    queryKey: ["whatsapp", "message-stats", days],
    queryFn: () => fetchMessageStats(days),
  });
}

export function useWhatsAppNumbers() {
  return useQuery({ queryKey: ["whatsapp", "numbers"], queryFn: fetchNumbers });
}

export function useUpdateNumber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      ...payload
    }: {
      userId: string;
      opt_in?: boolean;
      renormalise?: boolean;
    }) => updateNumber(userId, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp", "numbers"] }),
  });
}

export function useTestSend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateName, userId }: { templateName: string; userId?: string }) =>
      testSend(templateName, userId),
    // A test send lands in the delivery log like any other message, and the
    // first thing anyone does after pressing it is go and look.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp", "messages"] }),
  });
}

export function useRunScheduler() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: runScheduler,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp", "templates"] });
      qc.invalidateQueries({ queryKey: ["whatsapp", "messages"] });
    },
  });
}
