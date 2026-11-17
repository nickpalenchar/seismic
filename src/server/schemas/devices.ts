import { eq, isNotNull, sql } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { DeviceView } from '../../core/types';
import type { Db } from './common';
import { type Subscription, subscriptionOf } from '../webpush';

/** The devices paired to reach Seismic from another machine, each known by the hash of its cookie. */
export const devices = sqliteTable('devices', {
  id: text().primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  /** From its browser's user agent: "iPhone · Safari". */
  name: text().notNull(),
  pairedAt: text('paired_at').notNull(),
  lastSeen: text('last_seen').notNull(),
  /** Where it turned notifications on: its push subscription. */
  push: text({ mode: 'json' }).$type<Subscription>(),
});

const view = { id: devices.id, name: devices.name, pairedAt: devices.pairedAt, lastSeen: devices.lastSeen };

/** The paired devices' queries (`Store.devices`). */
export class Devices {
  constructor(private readonly db: Db) {}

  /** Every paired device, the first paired first. */
  all(): DeviceView[] {
    const rows = this.db.select({ ...view, push: isNotNull(devices.push).mapWith(Boolean) }).from(devices).orderBy(devices.pairedAt).all();
    return rows.map(({ push, ...d }) => (push ? { ...d, push: true } : d));
  }

  /** The devices that get pushes, each with its subscription; one whose stored subscription is no valid subscription is cleared and left out. */
  pushes(): { id: string; name: string; push: Subscription; lastSeen: string }[] {
    // The column is read as the raw text, so one malformed value fails only its own device.
    const rows = this.db
      .select({ id: devices.id, name: devices.name, raw: sql<string>`${devices.push}`, lastSeen: devices.lastSeen })
      .from(devices)
      .where(isNotNull(devices.push))
      .all();
    const out: { id: string; name: string; push: Subscription; lastSeen: string }[] = [];
    for (const { raw, ...d } of rows) {
      let push: Subscription | string;
      try {
        push = subscriptionOf(JSON.parse(raw));
      } catch {
        push = 'not JSON';
      }
      if (typeof push === 'string') this.setPush(d.id, null);
      else out.push({ ...d, push });
    }
    return out;
  }

  /** A device's push subscription, or none any more. */
  setPush(id: string, push: Subscription | null) {
    this.db.update(devices).set({ push }).where(eq(devices.id, id)).run();
  }

  /** The device whose cookie hashes to `hash`. */
  byToken(hash: string): DeviceView | null {
    return this.db.select(view).from(devices).where(eq(devices.tokenHash, hash)).get() ?? null;
  }

  add(d: DeviceView & { tokenHash: string }) {
    this.db.insert(devices).values({ id: d.id, tokenHash: d.tokenHash, name: d.name, pairedAt: d.pairedAt, lastSeen: d.lastSeen }).run();
  }

  seen(id: string, at: string) {
    this.db.update(devices).set({ lastSeen: at }).where(eq(devices.id, id)).run();
  }

  /** Unpairs the device; whether it was paired. */
  remove(id: string): boolean {
    return this.db.delete(devices).where(eq(devices.id, id)).returning({ id: devices.id }).all().length > 0;
  }
}
