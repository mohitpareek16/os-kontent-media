import type { VideoTypeConfig } from "@/types";

/** What a video *is*, in the words the team already uses.
 *
 * This replaced `weight` (light / standard / heavy) on every screen. Weight
 * asked a TL to guess difficulty at the moment they knew least about the job
 * and nothing ever checked the guess; the format is on the brief, is not a
 * judgement, and is what people already say to each other. See migration 0018
 * for what happened to weight underneath (it still counts *editor* load, and
 * nobody is asked for it).
 */
const FALLBACK_LABELS: Record<string, string> = {
  podcast: "Podcast",
  long_form: "Long form",
  short_form: "Short form",
};

/** A pill per type, tinted so a table scans by shape rather than by reading.
 * Deliberately quiet colours: the row already carries the tint that means
 * something (`jobRowTone`), and a loud badge here would compete with it. */
export const VIDEO_TYPE_CLASSES: Record<string, string> = {
  podcast: "bg-violet-500/10 text-violet-400",
  long_form: "bg-sky-500/10 text-sky-400",
  short_form: "bg-emerald-500/10 text-emerald-500",
};

export const VIDEO_TYPE_ICONS: Record<string, string> = {
  podcast: "ri-mic-2-line",
  long_form: "ri-film-line",
  short_form: "ri-smartphone-line",
};

export function videoTypeLabel(value: string, types: VideoTypeConfig[] = []): string {
  return types.find((type) => type.key === value)?.label ?? FALLBACK_LABELS[value] ?? value.replace(/_/g, " ");
}
