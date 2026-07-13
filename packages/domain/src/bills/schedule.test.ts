import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  isValidTimezone,
  nextDueDate,
  periodKey,
  ScheduleError,
  todayInTimezone,
  validateSchedule,
} from './schedule';

const isoArb = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2040-12-31') })
  .map((d) => d.toISOString().slice(0, 10));

const monthlyDayArb = fc.oneof(
  fc.integer({ min: 1, max: 31 }).map(String),
  fc.constant('last'),
);

const weekdayArb = fc.constantFrom(
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
);

describe('nextDueDate monthly', () => {
  it('stays in the current month when the day is still ahead', () => {
    expect(nextDueDate('monthly', '15', '2026-07-13')).toBe('2026-07-15');
  });

  it('is strictly after: a due date equal to `after` rolls to next month', () => {
    expect(nextDueDate('monthly', '13', '2026-07-13')).toBe('2026-08-13');
  });

  it('clamps day 31 to short months without skipping them', () => {
    expect(nextDueDate('monthly', '31', '2026-01-31')).toBe('2026-02-28');
    expect(nextDueDate('monthly', '31', '2026-02-28')).toBe('2026-03-31');
    expect(nextDueDate('monthly', '31', '2026-04-01')).toBe('2026-04-30');
  });

  it('handles leap February', () => {
    expect(nextDueDate('monthly', '30', '2028-02-01')).toBe('2028-02-29');
    expect(nextDueDate('monthly', 'last', '2028-02-01')).toBe('2028-02-29');
  });

  it("'last' always lands on the final day of the month", () => {
    expect(nextDueDate('monthly', 'last', '2026-12-31')).toBe('2027-01-31');
    expect(nextDueDate('monthly', 'last', '2026-11-01')).toBe('2026-11-30');
  });

  it('crosses year boundaries', () => {
    expect(nextDueDate('monthly', '5', '2026-12-20')).toBe('2027-01-05');
  });

  it('property: strictly after, and repeated advancing yields one unique period per month', () => {
    fc.assert(
      fc.property(isoArb, monthlyDayArb, (start, day) => {
        let cursor = start;
        const periods = new Set<string>();
        for (let i = 0; i < 30; i++) {
          const due = nextDueDate('monthly', day, cursor);
          expect(due > cursor).toBe(true);
          periods.add(periodKey('monthly', due));
          cursor = due;
        }
        expect(periods.size).toBe(30);
      }),
    );
  });
});

describe('nextDueDate weekly', () => {
  it('finds the next occurrence of the weekday', () => {
    // 2026-07-13 is a Monday
    expect(nextDueDate('weekly', 'wednesday', '2026-07-13')).toBe('2026-07-15');
    expect(nextDueDate('weekly', 'monday', '2026-07-13')).toBe('2026-07-20');
  });

  it('property: strictly after, lands on the right weekday, exactly 7 days apart thereafter', () => {
    fc.assert(
      fc.property(isoArb, weekdayArb, (start, weekday) => {
        const first = nextDueDate('weekly', weekday, start);
        const second = nextDueDate('weekly', weekday, first);
        expect(first > start).toBe(true);
        const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
        expect(toMs(second) - toMs(first)).toBe(7 * 86_400_000);
        expect(periodKey('weekly', first)).not.toBe(periodKey('weekly', second));
      }),
    );
  });
});

describe('validation', () => {
  it('rejects bad cadence days', () => {
    expect(() => validateSchedule('monthly', '0')).toThrow(ScheduleError);
    expect(() => validateSchedule('monthly', '32')).toThrow(ScheduleError);
    expect(() => validateSchedule('monthly', '07')).toThrow(ScheduleError);
    expect(() => validateSchedule('monthly', 'tuesday')).toThrow(ScheduleError);
    expect(() => validateSchedule('weekly', '3')).toThrow(ScheduleError);
    expect(() => validateSchedule('weekly', 'Monday')).toThrow(ScheduleError);
  });

  it('rejects malformed and impossible dates', () => {
    expect(() => nextDueDate('monthly', '1', '2026-7-1')).toThrow(ScheduleError);
    expect(() => nextDueDate('monthly', '1', '2026-02-30')).toThrow(ScheduleError);
  });
});

describe('timezones (H5)', () => {
  it('computes the house-local date, not the server date', () => {
    // 03:00 UTC on July 14 is still July 13 in New York (UTC-4 in July)
    const now = new Date('2026-07-14T03:00:00Z');
    expect(todayInTimezone('America/New_York', now)).toBe('2026-07-13');
    expect(todayInTimezone('UTC', now)).toBe('2026-07-14');
    expect(todayInTimezone('Pacific/Kiritimati', now)).toBe('2026-07-14');
  });

  it('validates IANA zones', () => {
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('Not/A_Zone')).toBe(false);
    expect(() => todayInTimezone('Not/A_Zone', new Date())).toThrow(ScheduleError);
  });
});
