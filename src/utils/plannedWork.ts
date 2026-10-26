/**
 * Helpers for resource assignment planned work (msdyn_plannedwork).
 *
 * Dataverse stores planned work as a JSON array of daily slices with WCF dates:
 *   [{"Start":"/Date(1767603600000)/","End":"/Date(1767632400000)/","Hours":8}, ...]
 *
 * msdyn_PssUpdateResourceAssignmentContourV1 takes slices in a different shape:
 *   [{"start":"2026-01-05T09:00:00.000Z","end":"2026-01-05T17:00:00.000Z","minutes":480}]
 * and only replaces the slices it receives, so days that exist in the target but not in the
 * source must be sent with 0 minutes to reproduce the source allocation exactly.
 */

import type { PlannedWorkSlice } from '../types/migration';

export interface WorkSlice {
  start: Date;
  end: Date;
  hours: number;
}

export interface ContourSlice {
  start: string;
  end: string;
  minutes: number;
}

const WCF_DATE = /\/Date\((-?\d+)(?:[+-]\d{4})?\)\//;

export function parseDataverseDate(value: string): Date | undefined {
  if (!value) return undefined;
  const wcf = WCF_DATE.exec(value);
  if (wcf) return new Date(Number(wcf[1]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Parse msdyn_plannedwork into slices; returns [] for empty or malformed values */
export function parsePlannedWork(raw?: string | null): WorkSlice[] {
  if (!raw) return [];
  let items: PlannedWorkSlice[];
  try {
    items = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];
  const slices: WorkSlice[] = [];
  for (const item of items) {
    const start = parseDataverseDate(item.Start);
    const end = parseDataverseDate(item.End);
    const hours = Number(item.Hours);
    if (start && end && Number.isFinite(hours)) slices.push({ start, end, hours });
  }
  return slices.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function totalHours(slices: WorkSlice[]): number {
  return round(slices.reduce((sum, s) => sum + s.hours, 0));
}

export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function overlaps(a: WorkSlice, b: WorkSlice): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/**
 * Build the contour update that makes the target assignment carry exactly the source hours:
 * every source slice (shifted by `offsetMs`), plus a 0-minute slice for each target slice the
 * source doesn't cover.
 */
export function buildContour(sourceSlices: WorkSlice[], targetSlices: WorkSlice[] = [], offsetMs = 0): ContourSlice[] {
  const shifted = sourceSlices.map(s => ({
    start: new Date(s.start.getTime() + offsetMs),
    end: new Date(s.end.getTime() + offsetMs),
    hours: s.hours,
  }));

  const contour: ContourSlice[] = shifted.map(s => ({
    start: s.start.toISOString(),
    end: s.end.toISOString(),
    minutes: round(s.hours * 60, 4),
  }));

  for (const t of targetSlices) {
    if (!shifted.some(s => overlaps(s, t))) {
      contour.push({ start: t.start.toISOString(), end: t.end.toISOString(), minutes: 0 });
    }
  }

  return contour.sort((a, b) => a.start.localeCompare(b.start));
}

/** True when two allocations carry the same total within a small tolerance */
export function sameHours(a: number, b: number, tolerance = 0.05): boolean {
  return Math.abs(a - b) <= tolerance;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Align source planned work to the target assignment's own working-day slots.
 *
 * After an assignment is created, Project Operations spreads the task effort over the working days of
 * the target calendar; those slots are the only periods the contour API accepts (other days fail with
 * "No working hours between start and end dates"). Source hours are placed on the slot for the same day;
 * hours on days that aren't working days in the target are spread over the other working days so the
 * total effort is kept.
 */
export function alignToTargetSlots(
  sourceSlices: WorkSlice[],
  targetSlices: WorkSlice[],
  offsetMs = 0
): { contour: ContourSlice[]; unplacedHours: number; unchanged: boolean } {
  if (!targetSlices.length) {
    return { contour: buildContour(sourceSlices, [], offsetMs), unplacedHours: 0, unchanged: sourceSlices.length === 0 };
  }

  const slots = targetSlices.map(t => ({ start: t.start, end: t.end, current: t.hours, hours: 0 }));
  const byDay = new Map<string, (typeof slots)[number]>();
  for (const s of slots) if (!byDay.has(dayKey(s.start))) byDay.set(dayKey(s.start), s);

  let unplaced = 0;
  for (const s of sourceSlices) {
    const slot = byDay.get(dayKey(new Date(s.start.getTime() + offsetMs)));
    if (slot) slot.hours += s.hours;
    else unplaced += s.hours;
  }
  if (unplaced > 0) {
    const carriers = slots.filter(s => s.hours > 0);
    const pool = carriers.length ? carriers : slots;
    const share = unplaced / pool.length;
    pool.forEach(s => (s.hours += share));
  }

  const unchanged = slots.every(s => sameHours(s.hours, s.current, 0.01));
  return {
    contour: slots.map(s => ({ start: s.start.toISOString(), end: s.end.toISOString(), minutes: round(s.hours * 60, 4) })),
    unplacedHours: round(unplaced),
    unchanged,
  };
}
