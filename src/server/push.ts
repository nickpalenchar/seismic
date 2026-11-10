// Pushes to the owner's phone when something starts to wait for them (design: Push): a card whose
// `needsYou` turns true (a demo, a question, a proposal, a card its agent withdrew, a PR to merge, an idea's turn), a landing
// that failed, a worker that is stuck. Each paired device that turned notifications on holds one
// subscription; Seismic signs with a VAPID key of its own in its home and needs no account.
//
// Each device is independent: a visible phone holds off only its own pushes. The first push goes
// out at once; what starts waiting in the next minute is sent together at its end.

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Language } from '../core/locale';
import { MESSAGES } from '../core/messages';
import { type PushKind, plainTitle } from '../core/waits';
import { BadRequest } from './board';
import type { Store } from './store';
import { UNUSED_MS } from './remote';
import { newVapidJwk, type Post, type PushMessage, send, subscriptionOf, type Vapid, vapidOf } from './webpush';

/** How long a page on a paired device counts as in view after it last said so (every 30 s). */
export const DEVICE_MS = 45_000;
/** What starts waiting within this after a push goes out together at its end. */
export const WINDOW_MS = 60_000;
/** Seismic's VAPID key, in its home: subscriptions hold its public half, so it stays. */
const KEY_FILE = 'vapid.json';

export { kindOf, plainTitle, type PushKind, startedWaiting } from '../core/waits';

/** At most `n` characters: a push carries at most about 4 KB, and a phone shows a few lines anyway. */
const clipped = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** A card that started to wait for the owner. */
export interface Waits {
  card: string;
  title: string;
  kind: PushKind;
  /** Its project's name, where Seismic has several. */
  project?: string;
  /** Whether it still waits: one the owner took care of within the minute is not pushed. */
  still: () => boolean;
}

export interface PushOptions {
  store: Store;
  /** Seismic's home, with the VAPID key; without one (a test) the key is made up in memory. */
  home?: string;
  language?: () => Language;
  now?: () => number;
  /** Sends a request to a push service: `fetch`, or a test's. */
  post?: Post;
  /** Runs `fn` after `ms`: `setTimeout`, or a test's. */
  later?: (fn: () => void, ms: number) => void;
}

export class Push {
  private readonly store: Store;
  private readonly home?: string;
  private readonly language: () => Language;
  private readonly now: () => number;
  private readonly post?: Post;
  private readonly later: (fn: () => void, ms: number) => void;
  private vapid?: Promise<Vapid>;
  /** The paired devices with a page in view, by id, and when it last said so. */
  private devices = new Map<string, number>();
  /** Per device, the minute after a push and what starts waiting meanwhile. */
  private windows = new Map<string, Map<string, Waits>>();
  /** Deliveries stay ordered per device, without blocking other devices. */
  private sending = new Map<string, Promise<void>>();

  constructor(o: PushOptions) {
    this.store = o.store;
    this.home = o.home;
    this.language = o.language ?? (() => 'en');
    this.now = o.now ?? Date.now;
    this.post = o.post;
    this.later = o.later ?? ((fn, ms) => void setTimeout(fn, ms));
  }

  /** The public VAPID key a page subscribes with. */
  async key(): Promise<string> {
    return (await this.keys()).publicKey;
  }

  private keys(): Promise<Vapid> {
    return (this.vapid ??= (async () => {
      const file = this.home && join(this.home, KEY_FILE);
      if (file && existsSync(file)) return vapidOf(JSON.parse(readFileSync(file, 'utf8')) as JsonWebKey);
      const jwk = await newVapidJwk();
      if (file) {
        writeFileSync(file, `${JSON.stringify(jwk)}\n`, { mode: 0o600 });
        chmodSync(file, 0o600);
      }
      return vapidOf(jwk);
    })());
  }

  /** The device turned notifications on: its subscription replaces the one it had. */
  subscribe(device: string, input: unknown) {
    const sub = subscriptionOf(input);
    if (typeof sub === 'string') throw new BadRequest('invalid', sub);
    this.store.devices.setPush(device, sub);
  }

  unsubscribe(device: string) {
    this.store.devices.setPush(device, null);
  }

  /** The devices that get pushes: not one unused for so long that it is no longer paired (remote.ts), even before it comes back and is removed. */
  private subscriptions() {
    const now = this.now();
    return this.store.devices.pushes().filter((p) => now - Date.parse(p.lastSeen) <= UNUSED_MS);
  }

  /** Whether `device` gets pushes. */
  subscribed(device: string): boolean {
    return this.subscriptions().some((p) => p.id === device);
  }

  /** A page on paired device `device` is in view until it goes away or falls silent. */
  onDevice(device: string) {
    this.devices.set(device, this.now());
  }

  /** The device's page went out of view (the phone locked, another app) or closed: pushes go out again at once. */
  away(device: string) {
    this.devices.delete(device);
  }

  /** Whether the owner has a page in view on a paired device. */
  onADevice(): boolean {
    return [...this.devices.values()].some((at) => this.now() - at < DEVICE_MS);
  }

  /** Cards that started to wait for the owner, independently for each device. */
  waits(cards: Waits[]) {
    if (!cards.length) return;
    for (const { id } of this.subscriptions()) {
      if (this.deviceInView(id)) continue;
      const window = this.windows.get(id);
      if (window) {
        for (const w of cards) window.set(w.card, w);
        continue;
      }
      const [first, ...rest] = cards;
      this.windows.set(id, new Map(rest.map((w) => [w.card, w])));
      this.deliver(id, this.message([first!]));
      this.later(() => this.windowEnds(id), WINDOW_MS);
    }
  }

  private deviceInView(id: string): boolean {
    return this.now() - (this.devices.get(id) ?? -Infinity) < DEVICE_MS;
  }

  /** Deliver the cards still waiting, unless this device is now in view. */
  private windowEnds(id: string) {
    const cards = [...(this.windows.get(id)?.values() ?? [])].filter((w) => w.still());
    this.windows.delete(id);
    if (!cards.length || this.deviceInView(id) || !this.subscribed(id)) return;
    this.windows.set(id, new Map());
    this.deliver(id, this.message(cards));
    this.later(() => this.windowEnds(id), WINDOW_MS);
  }

  private message(cards: Waits[]): PushMessage {
    const m = MESSAGES[this.language()].push;
    if (cards.length === 1) {
      const w = cards[0]!;
      return { title: clipped(plainTitle(w.title), 160), body: clipped([m[w.kind], w.project].filter(Boolean).join(' · '), 200), url: this.cardUrl(w.card), tag: w.card };
    }
    return { title: m.several(cards.length), body: clipped(cards.map((w) => plainTitle(w.title)).join(' · '), 600), url: '/', tag: 'several' };
  }

  /** Where tapping the push for a card leads: the card on its project, by its short code. */
  private cardUrl(id: string): string {
    const row = this.store.cards.get(id);
    return row ? `/p/${encodeURIComponent(row.project_id)}/c/${row.short}` : `/?card=${encodeURIComponent(id)}`;
  }

  /** Sends to one device; a subscription its push service no longer knows goes. */
  private deliver(device: string, message: PushMessage) {
    const previous = this.sending.get(device) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const vapid = await this.keys();
      await Promise.all(
        this.subscriptions().filter(({ id }) => id === device).map(async ({ id, name, push }) => {
          try {
            const status = await send(push, message, vapid, this.post);
            console.log(`Seismic: pushed “${message.title}” to ${name}: ${status === 201 ? 'taken' : status}`);
            if (status === 404 || status === 410) this.store.devices.setPush(id, null);
          } catch (e) {
            console.warn(`Seismic: push to ${name} failed: ${(e as Error).message}`);
          }
        }),
      );
    });
    this.sending.set(device, pending);
    void pending.then(
      () => { if (this.sending.get(device) === pending) this.sending.delete(device); },
      () => { if (this.sending.get(device) === pending) this.sending.delete(device); },
    );
  }

  /** Once what is on its way has been sent (for tests). */
  async settled(): Promise<void> {
    await Promise.all(this.sending.values());
  }
}
