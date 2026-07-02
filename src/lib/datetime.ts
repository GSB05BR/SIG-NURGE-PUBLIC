import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import {
  addDays,
  endOfDay,
  getISOWeek,
  getISOWeekYear,
  parseISO,
  startOfDay,
} from 'date-fns';
import type { DiaSemana } from '@/types';

export const TZ = 'America/Sao_Paulo';

/** Returns "now" projected into the America/Sao_Paulo timezone. */
export function nowInSp(): Date {
  return toZonedTime(new Date(), TZ);
}

/** Returns ISO week label "YYYY-Www" (e.g. "2026-W19"), zero-padded. */
export function getSemanaIso(date: Date): string {
  const zoned = toZonedTime(date, TZ);
  const year = getISOWeekYear(zoned);
  const week = getISOWeek(zoned);
  const weekStr = String(week).padStart(2, '0');
  return `${year}-W${weekStr}`;
}

/** "YYYY-MM-DD" in TZ for a given Date. */
function toIsoDateInTz(date: Date): string {
  return formatInTimeZone(date, TZ, 'yyyy-MM-dd');
}

/**
 * Returns true if date (evaluated in SP timezone) is a weekend (Sat/Sun)
 * or an ISO-formatted holiday in feriadosIso.
 */
function isNonWorkingDay(date: Date, feriadosIso: string[]): boolean {
  const zoned = toZonedTime(date, TZ);
  const dow = zoned.getDay(); // 0=Sun, 6=Sat in zoned-local terms
  if (dow === 0 || dow === 6) return true;
  const iso = toIsoDateInTz(date);
  return feriadosIso.includes(iso);
}

/**
 * Adds n business days to date (skipping Sat/Sun and feriadosIso).
 * If n=0, returns the same day if it is a working day, else advances to next.
 * Comparison happens in America/Sao_Paulo timezone.
 */
export function addDiasUteis(
  date: Date,
  n: number,
  feriadosIso: string[]
): Date {
  let cursor = startOfDay(toZonedTime(date, TZ));

  // n=0: ensure cursor is a working day; if not, push forward.
  if (n === 0) {
    while (isNonWorkingDay(cursor, feriadosIso)) {
      cursor = addDays(cursor, 1);
    }
    return endOfDay(cursor);
  }

  let remaining = n;
  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    if (!isNonWorkingDay(cursor, feriadosIso)) {
      remaining -= 1;
    }
  }
  return endOfDay(cursor);
}

/**
 * Returns the next occurrence (>= fromDate, evaluated in SP TZ) of the
 * given DiaSemana. If fromDate is already that weekday, returns fromDate.
 */
export function proximaOcorrenciaDia(
  diaSemana: DiaSemana,
  fromDate: Date
): Date {
  const target = diaSemanaToIndex(diaSemana); // 1..5
  let cursor = toZonedTime(fromDate, TZ);
  for (let i = 0; i < 7; i += 1) {
    const dow = cursor.getDay(); // 0=Sun..6=Sat
    if (dow === target) return cursor;
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

function diaSemanaToIndex(d: DiaSemana): number {
  switch (d) {
    case 'segunda':
      return 1;
    case 'terca':
      return 2;
    case 'quarta':
      return 3;
    case 'quinta':
      return 4;
    case 'sexta':
      return 5;
  }
}

/** Formats a date in TZ (default "dd/MM/yyyy"). */
export function formatDateBr(date: Date, fmt = 'dd/MM/yyyy'): string {
  return formatInTimeZone(date, TZ, fmt);
}

/**
 * Parses an ISO date string "YYYY-MM-DD" into a Date representing
 * midnight in America/Sao_Paulo.
 */
export function parseIsoDateLocal(iso: string): Date {
  // parseISO of "YYYY-MM-DD" returns midnight UTC; convert to SP local midnight.
  const utcMidnight = parseISO(iso);
  // We want a Date that, when read in SP TZ, equals iso 00:00.
  // toZonedTime returns the wall-clock projection in SP for the given instant,
  // so we use it on UTC midnight then re-project.
  return startOfDay(toZonedTime(utcMidnight, TZ));
}
