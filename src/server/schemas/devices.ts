import { createHash, createHmac, randomBytes } from 'node:crypto';
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

/** A device's replacement credential from pairing again, not presented by its browser yet: one at most per device. */
export const deviceRenewals = sqliteTable('device_renewals', {
  deviceId: text('device_id').primaryKey().references(() => devices.id, { onDelete: 'cascade' }),
  nonce: text().notNull(),
  tokenHash: text('token_hash').notNull().unique(),
});

/**
 * The credentials a replacement retired: they let nobody in, but a pairing again that brings one
 * (a request sent before its replacement arrived) pairs the device it was of, not a new one.
 */
export const deviceRetired = sqliteTable('device_retired', {
  tokenHash: text('token_hash').primaryKey(),
  deviceId: text('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
});

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** The replacement credential of `token` with `nonce`: only who holds `token` can make it. */
const replacement = (token: string, nonce: string) => createHmac('sha256', token).update(nonce).digest('base64url');

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

  /**
   * The device whose credential hashes to `hash`; `promoted` where it was the device's replacement,
   * which this makes current, retiring the one it replaces.
   */
  byToken(hash: string): { device: DeviceView; promoted: boolean } | null {
    const active = this.db.select(view).from(devices).where(eq(devices.tokenHash, hash)).get();
    if (active) return { device: active, promoted: false };
    const pending = this.db.select({ id: deviceRenewals.deviceId }).from(deviceRenewals).where(eq(deviceRenewals.tokenHash, hash)).get();
    if (!pending) return null;
    const device = this.db.transaction((tx) => {
      const received = tx.delete(deviceRenewals).where(eq(deviceRenewals.tokenHash, hash)).returning({ id: deviceRenewals.deviceId }).get();
      if (!received) return null;
      const before = tx.select({ tokenHash: devices.tokenHash }).from(devices).where(eq(devices.id, received.id)).get();
      if (before) tx.insert(deviceRetired).values({ tokenHash: before.tokenHash, deviceId: received.id }).onConflictDoNothing().run();
      return tx.update(devices).set({ tokenHash: hash }).where(eq(devices.id, received.id)).returning(view).get() ?? null;
    });
    return device ? { device, promoted: true } : null;
  }

  /** The device a retired credential (`hash`) was of, for pairing it again; it lets nobody in. */
  retired(hash: string): DeviceView | null {
    const row = this.db.select({ id: deviceRetired.deviceId }).from(deviceRetired).where(eq(deviceRetired.tokenHash, hash)).get();
    return row ? (this.db.select(view).from(devices).where(eq(devices.id, row.id)).get() ?? null) : null;
  }

  /** The device's replacement credential made from `token`, while its browser has not presented it yet. */
  pending(id: string, token: string): { token: string; nonce: string } | null {
    const row = this.db.select({ nonce: deviceRenewals.nonce, tokenHash: deviceRenewals.tokenHash }).from(deviceRenewals).where(eq(deviceRenewals.deviceId, id)).get();
    if (!row) return null;
    const made = replacement(token, row.nonce);
    return sha256(made) === row.tokenHash ? { token: made, nonce: row.nonce } : null;
  }

  add(d: DeviceView & { tokenHash: string }) {
    this.db.insert(devices).values({ id: d.id, tokenHash: d.tokenHash, name: d.name, pairedAt: d.pairedAt, lastSeen: d.lastSeen }).run();
  }

  /**
   * A replacement for the device's credential `presented` (its current one, or one retired since),
   * which becomes current, retiring the one before, when the browser first presents it (`byToken`).
   * Retries with the same credential get the same replacement, even after a restart; the nonce
   * alone cannot make it, that takes the browser's secret as well. One made from another credential
   * gives way to this one. `nonce` names the replacement's cookie (`Access.pairRoute`).
   */
  renew(d: DeviceView, presented: string): { token: string; nonce: string } {
    return this.db.transaction((tx) => {
      const row = tx.select({ nonce: deviceRenewals.nonce, tokenHash: deviceRenewals.tokenHash }).from(deviceRenewals).where(eq(deviceRenewals.deviceId, d.id)).get();
      tx.update(devices).set({ pairedAt: d.pairedAt, lastSeen: d.lastSeen }).where(eq(devices.id, d.id)).run();
      if (row && sha256(replacement(presented, row.nonce)) === row.tokenHash) return { token: replacement(presented, row.nonce), nonce: row.nonce };
      const nonce = randomBytes(32).toString('hex');
      const token = replacement(presented, nonce);
      tx.delete(deviceRenewals).where(eq(deviceRenewals.deviceId, d.id)).run();
      tx.insert(deviceRenewals).values({ deviceId: d.id, nonce, tokenHash: sha256(token) }).run();
      return { token, nonce };
    });
  }

  seen(id: string, at: string) {
    this.db.update(devices).set({ lastSeen: at }).where(eq(devices.id, id)).run();
  }

  /** Unpairs the device; whether it was paired. */
  remove(id: string): boolean {
    return this.db.delete(devices).where(eq(devices.id, id)).returning({ id: devices.id }).all().length > 0;
  }
}
