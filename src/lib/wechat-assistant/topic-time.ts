const BUSINESS_DAY_BOUNDARY_HOUR = 4;
const DAY_MS = 86_400_000;

export function currentBusinessDate(nowMs = Date.now()): string {
  return businessDateForTimestamp(Math.floor(nowMs / 1000));
}

export function lastCompletedBusinessDate(nowMs = Date.now()): string {
  return addBusinessDays(currentBusinessDate(nowMs), -1);
}

export function businessDateForTimestamp(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  d.setHours(d.getHours() - BUSINESS_DAY_BOUNDARY_HOUR, 0, 0, 0);
  return formatLocalDate(d);
}

export function businessDayBounds(date: string): { startTs: number; endTs: number } {
  const [year, month, day] = parseBusinessDate(date);
  const start = new Date(year, month - 1, day, BUSINESS_DAY_BOUNDARY_HOUR, 0, 0, 0);
  const end = new Date(start.getTime() + DAY_MS);
  return {
    startTs: Math.floor(start.getTime() / 1000),
    endTs: Math.floor(end.getTime() / 1000),
  };
}

export function normalizeBusinessDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  try {
    parseBusinessDate(value);
    return value;
  } catch {
    return null;
  }
}

export function defaultTopicDateRange(nowMs = Date.now()): { from: string; to: string } {
  const to = lastCompletedBusinessDate(nowMs);
  return { from: addBusinessDays(to, -6), to };
}

export function addBusinessDays(date: string, delta: number): string {
  const [year, month, day] = parseBusinessDate(date);
  const d = new Date(year, month - 1, day, 12, 0, 0, 0);
  d.setDate(d.getDate() + delta);
  return formatLocalDate(d);
}

export function compareBusinessDates(a: string, b: string): number {
  return a.localeCompare(b);
}

function parseBusinessDate(date: string): [number, number, number] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('invalid_business_date');
  }
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    d.getFullYear() !== year
    || d.getMonth() !== month - 1
    || d.getDate() !== day
  ) {
    throw new Error('invalid_business_date');
  }
  return [year, month, day];
}

function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
