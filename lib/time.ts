/** Minutes from midnight helpers. Sunday = 0, matching Date.getDay() and place hours. */

export function weekdayIndex(date: string): number {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  if (!year || !month || !day) return 0;
  return new Date(year, month - 1, day).getDay();
}

export function isWeekend(date: string): boolean {
  const day = weekdayIndex(date);
  return day === 0 || day === 6;
}

export function formatMinutes(total: number): string {
  const normalized = ((Math.round(total) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export function formatRange(startMin: number, endMin: number): string {
  return `${formatMinutes(startMin)} – ${formatMinutes(endMin)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
