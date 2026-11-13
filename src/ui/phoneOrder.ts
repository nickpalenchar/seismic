import { type Item, snoozeOf } from '../core/types';

/** Active plans first, then snoozed plans; newest created first within each group. */
export function plannedOrder(a: Item, b: Item): number {
  return Number(!!snoozeOf(a)) - Number(!!snoozeOf(b)) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
}
