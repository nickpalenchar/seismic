import { createHash, createHmac, randomBytes } from 'node:crypto';
import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
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

/** A table of an earlier design's credential handover: databases have it, nothing reads or writes it. */
export const deviceRenewals = sqliteTable('device_renewals', {
  deviceId: text('device_id').primaryKey().references(() => devices.id, { onDelete: 'cascade' }),
  nonce: text().notNull(),
  tokenHash: text('token_hash').notNull().unique(),
});

/**
 * Every credential a device was given once it was paired again, in the order given (`seq`; 0 the
 * one of its first pairing, `devices.token_hash`, until then the only one). Presenting one retires
 * those given before it, never those given after: an answer still on its way keeps working. A
 * replacement is made from the credential the pairing brought (`source_hash`, `nonce`), so the same
 * pairing again gets it again; a retired one lets nobody in, but still names its device.
 */
export const deviceTokens = sqliteTable(
  'device_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    deviceId: text('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
    seq: integer().notNull(),
    retired: integer({ mode: 'boolean' }).notNull().default(false),
    sourceHash: text('source_hash'),
    nonce: text(),
  },
  (t) => [
    index('device_tokens_by_device').on(t.deviceId, t.seq),
    index('device_tokens_active').on(t.deviceId, t.seq).where(sql`retired = 0`),
  ],
);

// Keep the literal predicate so SQLite can use the partial index at query planning time.
const activeToken = sql`${deviceTokens.retired} = 0`;

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** The replacement credential of `token` with `nonce`: only who holds `token` can make it. */
const replacement = (token: string, nonce: string) => createHmac('sha256', token).update(nonce).digest('base64url');

/** A credential given in a pairing again. */
export interface Issued {
  token: string;
  nonce: string;
  hash: string;
  seq: number;
}

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
   * The device whose credential hashes to `hash`, and that credential's place in the order given
   * (`seq`). Presenting it retires the device's credentials given before it.
   */
  byToken(hash: string): { device: DeviceView; seq: number } | null {
    const row = this.db.select({ deviceId: deviceTokens.deviceId, seq: deviceTokens.seq, retired: deviceTokens.retired }).from(deviceTokens).where(eq(deviceTokens.tokenHash, hash)).get();
    if (row) {
      if (row.retired) return null;
      const older = and(eq(deviceTokens.deviceId, row.deviceId), lt(deviceTokens.seq, row.seq), activeToken);
      if (row.seq > 0 && this.db.select({ seq: deviceTokens.seq }).from(deviceTokens).where(older).limit(1).get()) {
        this.db.update(deviceTokens).set({ retired: true }).where(older).run();
      }
      const device = this.byId(row.deviceId);
      return device ? { device, seq: row.seq } : null;
    }
    const first = this.db.select(view).from(devices).where(eq(devices.tokenHash, hash)).get();
    // once paired again, the first credential is in `device_tokens` too, which decides
    if (!first || this.db.select({ seq: deviceTokens.seq }).from(deviceTokens).where(eq(deviceTokens.deviceId, first.id)).get()) return null;
    return { device: first, seq: 0 };
  }

  /** The device a retired credential (`hash`) was of, for pairing it again; it lets nobody in. */
  retired(hash: string): DeviceView | null {
    const row = this.db.select({ id: deviceTokens.deviceId }).from(deviceTokens).where(and(eq(deviceTokens.tokenHash, hash), eq(deviceTokens.retired, true))).get();
    return row ? this.byId(row.id) : null;
  }

  byId(id: string): DeviceView | null {
    return this.db.select(view).from(devices).where(eq(devices.id, id)).get() ?? null;
  }

  /** What the device's credential `hash` is: its place in the order, whether retired, and what it was made from. */
  given(hash: string): { deviceId: string; seq: number; retired: boolean; sourceHash: string | null; nonce: string | null } | null {
    const row = this.db.select({ deviceId: deviceTokens.deviceId, seq: deviceTokens.seq, retired: deviceTokens.retired, sourceHash: deviceTokens.sourceHash, nonce: deviceTokens.nonce }).from(deviceTokens).where(eq(deviceTokens.tokenHash, hash)).get();
    if (row) return row;
    const first = this.db.select({ id: devices.id }).from(devices).where(eq(devices.tokenHash, hash)).get();
    return first ? { deviceId: first.id, seq: 0, retired: false, sourceHash: null, nonce: null } : null;
  }

  /** The replacement made from `source` again, where `given` says it was made from it. */
  remake(source: string, nonce: string): string {
    return replacement(source, nonce);
  }

  add(d: DeviceView & { tokenHash: string }) {
    this.db.insert(devices).values({ id: d.id, tokenHash: d.tokenHash, name: d.name, pairedAt: d.pairedAt, lastSeen: d.lastSeen }).run();
  }

  /**
   * A replacement for the device's credential `presented` (its current one, or one retired since,
   * from a request sent before its replacement arrived), given after all the others. The same
   * credential brought again, while what it was given is not retired, gets that again, even after
   * a restart; the nonce alone cannot make it, that takes the browser's secret as well. No other
   * credential of the device is touched: those on their way keep working.
   */
  renew(d: DeviceView, presented: string): Issued {
    const source = sha256(presented);
    return this.db.transaction((tx) => {
      tx.update(devices).set({ pairedAt: d.pairedAt, lastSeen: d.lastSeen }).where(eq(devices.id, d.id)).run();
      const history = eq(deviceTokens.deviceId, d.id);
      const again = tx.select({ tokenHash: deviceTokens.tokenHash, seq: deviceTokens.seq, nonce: deviceTokens.nonce })
        .from(deviceTokens).where(and(history, activeToken, eq(deviceTokens.sourceHash, source), isNotNull(deviceTokens.nonce))).limit(1).get();
      if (again?.nonce) return { token: replacement(presented, again.nonce), nonce: again.nonce, hash: again.tokenHash, seq: again.seq };
      const last = tx.select({ seq: deviceTokens.seq }).from(deviceTokens).where(history).orderBy(desc(deviceTokens.seq)).limit(1).get();
      if (!last) {
        const first = tx.select({ tokenHash: devices.tokenHash }).from(devices).where(eq(devices.id, d.id)).get()!;
        tx.insert(deviceTokens).values({ tokenHash: first.tokenHash, deviceId: d.id, seq: 0 }).run();
      }
      const seq = (last?.seq ?? 0) + 1;
      const nonce = randomBytes(32).toString('hex');
      const token = replacement(presented, nonce);
      const hash = sha256(token);
      tx.insert(deviceTokens).values({ tokenHash: hash, deviceId: d.id, seq, sourceHash: source, nonce }).run();
      return { token, nonce, hash, seq };
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
