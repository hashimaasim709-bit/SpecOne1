import { SLOT_ORDER, type SlotKey } from './constants';
import type { DayAvailability } from './types';

/** Slots a job starting at `slot` would occupy, or null if it runs past the end of the day. */
export function slotsCovered(slot: SlotKey, span: number): SlotKey[] | null {
  const start = SLOT_ORDER.indexOf(slot);
  if (start < 0 || start + span > SLOT_ORDER.length) return null;
  return SLOT_ORDER.slice(start, start + span);
}

/** Can a job needing `span` consecutive slots start in `slot` on this day? */
export function fitsDay(day: DayAvailability | undefined, slot: SlotKey, span: number): boolean {
  if (!day || day.closed) return false;
  const covered = slotsCovered(slot, span);
  return !!covered && covered.every((s) => (day.slots[s] ?? 0) > 0);
}

export const dayHasSpace = (day: DayAvailability, span: number): boolean => SLOT_ORDER.some((s) => fitsDay(day, s, span));

/** Scarcity message for a slot, or '' when there is plenty of room. Driven by real remaining capacity. */
export function scarcityLabel(remaining: number, slot: SlotKey): string {
  if (remaining <= 0) return 'Fully booked';
  if (remaining === 1) return `Only 1 ${slot} slot left`;
  return '';
}
