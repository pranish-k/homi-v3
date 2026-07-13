/**
 * HOMI-13 schedule math: pure calendar functions, no database, no clock.
 *
 * H5: all scheduling is computed server-side in the house timezone. Due
 * dates are wall-clock DATES, never times: a bill is due "on July 1st in
 * America/New_York", and the worker posts once the house's local date
 * reaches it. Working in whole dates sidesteps the DST hazards entirely
 * (a local time that does not exist or exists twice); a local DATE
 * always exists exactly once.
 *
 * H4: period identity. Two posting attempts are "the same period" iff
 * periodKey returns the same string; the unique index on
 * (template_id, period) turns that identity into a database guarantee.
 */

export type Cadence = 'monthly' | 'weekly';

export class ScheduleError extends Error {}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

function parseISO(iso: string): { y: number; m: number; d: number } {
  if (!ISO_DATE_RE.test(iso)) throw new ScheduleError(`not an ISO date: ${iso}`);
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const roundTrip = new Date(Date.UTC(y, m - 1, d));
  if (
    roundTrip.getUTCFullYear() !== y ||
    roundTrip.getUTCMonth() !== m - 1 ||
    roundTrip.getUTCDate() !== d
  ) {
    throw new ScheduleError(`not a real calendar date: ${iso}`);
  }
  return { y, m, d };
}

function toISO(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Throws ScheduleError unless (cadence, cadenceDay) is a valid pair. */
export function validateSchedule(cadence: Cadence, cadenceDay: string): void {
  if (cadence === 'monthly') {
    if (cadenceDay === 'last') return;
    const day = Number(cadenceDay);
    if (!Number.isInteger(day) || day < 1 || day > 31 || String(day) !== cadenceDay) {
      throw new ScheduleError(
        `monthly cadenceDay must be '1'..'31' or 'last', got '${cadenceDay}'`,
      );
    }
    return;
  }
  if (!(WEEKDAYS as readonly string[]).includes(cadenceDay)) {
    throw new ScheduleError(
      `weekly cadenceDay must be a lowercase weekday name, got '${cadenceDay}'`,
    );
  }
}

/**
 * The next due date STRICTLY AFTER `afterISO`. Monthly days beyond a
 * month's length clamp to its last day (day 31 posts Feb 28), and every
 * month still gets exactly one due date because clamping never crosses
 * a month boundary.
 */
export function nextDueDate(cadence: Cadence, cadenceDay: string, afterISO: string): string {
  validateSchedule(cadence, cadenceDay);
  const after = parseISO(afterISO);

  if (cadence === 'monthly') {
    // candidate months: the month of `after`, then forward; the first
    // whose (clamped) due date lands after `after` wins - at most two
    // iterations, but the loop states the intent.
    for (let offset = 0; offset < 3; offset++) {
      const monthIndex = after.m - 1 + offset;
      const y = after.y + Math.floor(monthIndex / 12);
      const m = (monthIndex % 12) + 1;
      const dim = daysInMonth(y, m);
      const d = cadenceDay === 'last' ? dim : Math.min(Number(cadenceDay), dim);
      const iso = toISO(y, m, d);
      if (iso > afterISO) return iso;
    }
    throw new ScheduleError('unreachable: no monthly due date within three months');
  }

  const target = (WEEKDAYS as readonly string[]).indexOf(cadenceDay);
  const base = Date.UTC(after.y, after.m - 1, after.d);
  for (let step = 1; step <= 7; step++) {
    const candidate = new Date(base + step * 86_400_000);
    if (candidate.getUTCDay() === target) {
      return toISO(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, candidate.getUTCDate());
    }
  }
  throw new ScheduleError('unreachable: no weekday within seven days');
}

/**
 * Period identity for the H4 unique key. Monthly periods are the
 * calendar month ('2026-07'): even with clamping, each month has one
 * due date, so the month names the period. Weekly periods are the due
 * date itself ('2026-07-06'): each due date IS one period.
 */
export function periodKey(cadence: Cadence, dueISO: string): string {
  parseISO(dueISO);
  return cadence === 'monthly' ? dueISO.slice(0, 7) : dueISO;
}

/** True iff `timezone` is an IANA zone this runtime can compute dates in. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The current wall-clock DATE in `timezone` (H5). en-CA formats as
 * YYYY-MM-DD, so the output is directly comparable with due dates.
 */
export function todayInTimezone(timezone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch (err) {
    throw new ScheduleError(`cannot compute dates in timezone '${timezone}': ${String(err)}`);
  }
}
