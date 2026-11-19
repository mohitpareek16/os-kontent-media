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

/** A neutral tag per type. Video type is a label, not a signal: the row
 * already carries the tint that means something (`jobRowTone`), and stage
 * colours own the hues, so every type wears the same quiet chip. */
const NEUTRAL_TYPE_CLASS =
  "bg-[var(--bg-card-hover)] text-[var(--text-muted)] border border-[var(--border-color)]";

export const VIDEO_TYPE_CLASSES: Record<string, string> = {
  podcast: NEUTRAL_TYPE_CLASS,
  long_form: NEUTRAL_TYPE_CLASS,
  short_form: NEUTRAL_TYPE_CLASS,
};

/** Chip classes for any type key, including catalog types added later. */
export function videoTypeClass(value: string): string {
  return VIDEO_TYPE_CLASSES[value] ?? NEUTRAL_TYPE_CLASS;
}

export const VIDEO_TYPE_ICONS: Record<string, string> = {
  podcast: "ri-mic-2-line",
  long_form: "ri-film-line",
  short_form: "ri-smartphone-line",
};

export function videoTypeLabel(value: string, types: VideoTypeConfig[] = []): string {
  return types.find((type) => type.key === value)?.label ?? FALLBACK_LABELS[value] ?? value.replace(/_/g, " ");
}
