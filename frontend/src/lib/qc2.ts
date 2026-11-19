import type { EmploymentType } from "@/types";

/** Points a reviewer may spend in a working day. Derived from employment type
 * on the server and never stored per account, so this is a lookup rather than
 * a default — change what a part-time day is worth and it changes for
 * everybody at once. */
export const QC2_DAILY_POINTS: Record<EmploymentType, number> = {
  full_time: 24,
  part_time: 12,
};

export function dailyBudgetLabel(employmentType: EmploymentType): string {
  const points = QC2_DAILY_POINTS[employmentType];
  return `${points} QC points a day`;
}
