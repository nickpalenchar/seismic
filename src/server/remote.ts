// Other devices reaching Seismic: the owner's phone over the owner's own private network. Seismic keeps
// listening on 127.0.0.1; with the setting "Reachable from other devices" on, `tailscale serve`
// proxies HTTPS at the machine's tailnet name to it (tailscale.ts), or Seismic also listens on an
// address of this machine the owner picked (another VPN's interface), in plain HTTP, or the owner's own
// reverse proxy on this machine forwards the hosts they list (`via: "hosts"`) and terminates HTTPS:
// Seismic then touches no `tailscale serve` entry, and the proxy must pass `Host` through unchanged.
//
// A request is local when it comes from loopback under one of this machine's names and no proxy
// forwarded it; through `tailscale serve` requests come from 127.0.0.1 too, but under the tailnet
// name and with `X-Forwarded-For`, and count as remote. A remote request needs a paired device:
// the page "Connect a phone" shows a one-time code (in a QR code with the address), the device
// opens it, and gets a cookie that Seismic keeps only the hash of. Without one it gets a page that
// says how to connect, and no API. Pairing, the devices and the setting are managed only on this
// machine itself. A device stays paired until it is removed or goes unused for `UNUSED_MS`.

import { networkInterfaces } from 'node:os';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Language } from '../core/locale';
import { MESSAGES } from '../core/messages';
import type { AccessView, DeviceView, Pairing, RemoteProblem, RemoteSetting, TailscaleState } from '../core/types';
import { LOCAL_HOSTS, hostname, type Gate } from './access';
import { BadRequest } from './board';
import type { Store } from './store';
import { OWNER_SETTINGS_FILE as SETTINGS_FILE } from '../../plugin/skills/demo/lib/language.ts';
import { Owner } from './owner';
import { remoteOf, remoteSetting, saveRemote } from './settings';
import { type ServeEntry, Tailscale } from './tailscale';

export const DEVICE_COOKIE = 'seismic-device';
/**
 * The device cookie of the Seismic a request reaches: `seismic-device-https-8443` at an address with
 * a port, `seismic-device-https` or `seismic-device-http` at one without. A cookie belongs to a host,
 * whatever its port and scheme, so two Seismics on one machine (at `:4417` and `:4418`, `tailscale
 * serve` at 443 and 8443, or `http://studio` and `https://studio`, which a browser sends without a
 * port) would each overwrite the other's under one name, and a browser or the desktop app paired with
 * both would lose the first; over plain HTTP it could not even replace one set Secure over HTTPS. The
 * scheme goes into the name beside the port too: `http://studio:8443` and `https://studio:8443` may
 * reach one Seismic, and pairing at the second would otherwise renew the first's credential and
 * replace its cookie with a Secure one the browser keeps off plain HTTP.
 */
export function deviceCookie(req: Request): string {
  const port = portOf(req);
  return `${DEVICE_COOKIE}-${schemeOf(req)}${port ? `-${port}` : ''}`;
}
/** The cookie's name before the scheme joined the port in it (`seismic-device-8443`); none at an address without a port. */
function portOnlyDeviceCookie(req: Request): string | null {
  const port = portOf(req);
  return port ? `${DEVICE_COOKIE}-${port}` : null;
}
/** The value of the cookie `name` the request carries, or none. */
function cookieOf(req: Request, name: string): string | undefined {
  const cookies = req.headers.get('cookie')?.split(';').map((c) => c.trim()) ?? [];
  return cookies.find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
}
/** The port of the address the browser used, from the host a proxy forwarded or the request's; none where it sent none. */
function portOf(req: Request): string | undefined {
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host') || '';
  return /:(\d+)$/.exec(host)?.[1];
}
/**
 * The scheme of the address the browser used: a proxy's `x-forwarded-proto`, else the connection's.
 * Only `http` or `https`: it goes into a cookie's name, where a stray character from a proxy would
 * make the browser drop the cookie of a pairing whose code is spent by then.
 */
function schemeOf(req: Request): 'http' | 'https' {
  const forwarded = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (forwarded === 'http' || forwarded === 'https') return forwarded;
  return new URL(req.url).protocol === 'https:' ? 'https' : 'http';
}
/** The paired device's cookie before the rename: a device paired before it keeps working, and gets the new one when it pairs again. */
const OLD_DEVICE_COOKIE = 'obeya-device';
/** How long a pairing code holds. */
export const PAIRING_MS = 5 * 60_000;
/** Wrong codes after which a pairing code no longer pairs anything. */
const PAIRING_TRIES = 5;
/** How long the one-time link `POST /api/pair` answers with holds. */
export const LINK_MS = 60_000;
/** A device unused this long is no longer paired: a phone given away or lost and forgotten. */
export const UNUSED_MS = 90 * 24 * 3600_000;
/** How often a device's "last seen" is written. */
const SEEN_EVERY_MS = 60_000;
/** The cookie's own lifetime, the longest browsers keep one (400 days); Seismic's `UNUSED_MS` decides. */
const COOKIE_MAX_AGE = 400 * 24 * 3600;
/** The `tailscale serve` entry Seismic made, in its home, so turning the setting off removes it after a restart too. */
const SERVE_FILE = 'tailscale-serve.json';

/** The icons of the web app's manifest and its service worker: the same for everyone, and nothing in them the owner's. */
export const PUBLIC = new Set(['/sw.js', '/icons/180.png', '/icons/512.png']);

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const FORWARDED = ['x-forwarded-for', 'x-forwarded-host', 'forwarded'];

const sha256 = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex');

/** A device's name from its browser's user agent: "iPhone · Safari". */
export function deviceName(ua: string): string {
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux|X11/.test(ua) ? 'Linux' : '';
  const browser = /EdgiOS|EdgA|Edg\//.test(ua) ? 'Edge' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [device, browser].filter(Boolean).join(' · ') || ua.slice(0, 40) || '?';
}

/** This machine's addresses beyond loopback, IPv4 first: where another VPN may reach it. */
export function machineAddresses(): string[] {
  const all = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && !a.internal && !(a.family === 'IPv6' && a.address.startsWith('fe80')));
  return [...all.filter((a) => a!.family === 'IPv4'), ...all.filter((a) => a!.family === 'IPv6')].map((a) => a!.address);
}

/** An address as it stands in a URL and a `Host` header: IPv6 in brackets. */
const inUrl = (address: string) => (address.includes(':') ? `[${address}]` : address);

export interface AccessOptions {
  store: Store;
  /** Seismic's home, with the setting in `settings.json`; without one (a test) it is kept in memory. */
  home?: string;
  tailscale?: Tailscale;
  language?: () => Language;
  now?: () => number;
  platform?: string;
  /** Who is the owner on this machine; by default the key in `home` (made up for a test without one). */
  owner?: Owner;
}

/** What answers on another address: started and stopped by the server, which knows its routes. */
export type Listen = (address: string | null) => void;

/** The one-time code "Connect a phone" shows; `spent` once `POST /api/pair` traded it for a link, `paired` once a device paired with it. */
interface PairingCode {
  code: string;
  expires: number;
  tries: number;
  spent?: boolean;
  paired?: DeviceView;
}

export class Access implements Gate {
  /** The owner's key: what a request from this machine names. */
  readonly owner: Owner;
  readonly store: Store;
  private readonly home?: string;
  private readonly tailscale: Tailscale;
  private readonly language: () => Language;
  private readonly now: () => number;
  private readonly platform: string;
  private setting: RemoteSetting | null;
  private ts: TailscaleState = { state: 'missing' };
  /** The `tailscale serve` entry Seismic keeps, and the tailnet name it serves at. */
  private served: (ServeEntry & { name: string }) | null = null;
  /** The other address Seismic listens on. */
  private listening: string | null = null;
  private problem: RemoteProblem | undefined;
  private port = 0;
  private listen: Listen = () => {};
  private pairing: PairingCode | null = null;
  /** The one-time links `POST /api/pair` gave out, by their token's hash, with the code each spent. */
  private readonly links = new Map<string, { expires: number; pairing: PairingCode }>();
  /** The device each admitted remote request came from: its WebSocket closes when the device is removed. */
  private readonly from = new WeakMap<Request, string>();
  private readonly removedFns = new Set<(id: string) => void>();
  /** Changes to the network, one after the other. */
  private applying: Promise<void> = Promise.resolve();

  constructor(o: AccessOptions) {
    this.store = o.store;
    this.home = o.home;
    this.tailscale = o.tailscale ?? new Tailscale();
    this.language = o.language ?? (() => 'en');
    this.now = o.now ?? Date.now;
    this.platform = o.platform ?? process.platform;
    this.owner = o.owner ?? new Owner({ home: o.home, language: this.language });
    this.setting = o.home ? remoteSetting(o.home) : null;
    this.served = this.readServed();
  }

  // ------------------------------------------------------------ the network

  /** Seismic's server answers on `port`: the network is made as the setting says. */
  start(port: number, listen: Listen): Promise<void> {
    this.port = port;
    this.listen = listen;
    return this.apply(true);
  }

  /** Stops answering on the other address. */
  stop() {
    if (this.listening) this.listen(null);
    this.listening = null;
  }

  /**
   * Seismic stops: the `tailscale serve` entry goes with it, so whatever takes its port afterwards is
   * not served to the tailnet. The next start serves Seismic again, at the same address while 443 is free.
   */
  release() {
    this.stop();
    if (!this.served) return;
    // an entry recorded in a home copied from a running Seismic proxies to that one's port: it stays
    if (this.served.target === this.target()) this.tailscale.unserveSync(this.served.name, this.served);
    this.keepServed(null);
  }

  /** Where `tailscale serve` sends this Seismic's requests. */
  private target() {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Makes the network as the setting says; `check`: asks Tailscale even where it was asked before. */
  private apply(check = false): Promise<void> {
    this.applying = this.applying.then(async () => {
      try {
        await this.applyNow(check);
      } catch (e) {
        this.problem = { code: 'failed', detail: (e as Error).message };
      }
    });
    return this.applying;
  }

  private async applyNow(check: boolean) {
    const s = this.setting;
    if (s?.via !== 'address' && this.listening) {
      this.listen(null);
      this.listening = null;
    }
    if (s?.via !== 'tailscale') {
      if (this.served) {
        await this.tailscale.unserve(this.served.name, this.served, this.target()).catch(() => {});
        this.keepServed(null);
      }
      if (s?.via === 'address' && this.listening !== s.address) {
        this.problem = undefined;
        if (this.listening) this.listen(null);
        this.listening = null;
        if (!machineAddresses().includes(s.address)) {
          this.problem = { code: 'listen', detail: `${s.address} is not an address of this machine` };
          return;
        }
        try {
          this.listen(s.address);
          this.listening = s.address;
        } catch (e) {
          this.problem = { code: 'listen', detail: (e as Error).message };
        }
      }
      if (!s || s.via === 'hosts') this.problem = undefined;
      return;
    }
    if (check || this.ts.state !== 'ready') this.ts = await this.tailscale.state();
    if (this.ts.state !== 'ready') return void (this.problem = undefined);
    const name = this.ts.name;
    if (this.served && this.served.name === name && this.served.target === this.target() && !check && !this.problem) return;
    const r = await this.tailscale.serve(name, this.port, this.served?.name === name ? this.served : null);
    if ('problem' in r) {
      this.problem = r.problem;
      return;
    }
    this.problem = undefined;
    this.keepServed({ ...r.entry, name });
  }

  private readServed(): (ServeEntry & { name: string }) | null {
    if (!this.home || !existsSync(join(this.home, SERVE_FILE))) return null;
    try {
      const o = JSON.parse(readFileSync(join(this.home, SERVE_FILE), 'utf8')) as ServeEntry & { name: string };
      return typeof o.https === 'number' && typeof o.target === 'string' && typeof o.name === 'string' ? o : null;
    } catch {
      return null;
    }
  }

  private keepServed(entry: (ServeEntry & { name: string }) | null) {
    this.served = entry;
    if (!this.home) return;
    if (entry) writeFileSync(join(this.home, SERVE_FILE), `${JSON.stringify(entry, null, 2)}\n`);
    else rmSync(join(this.home, SERVE_FILE), { force: true });
  }

  /**
   * How long Seismic keeps this machine from sleeping for other devices: `off` while they may not reach
   * it, else `always` or only while a worker `works`, as the owner set it.
   */
  awake(): 'off' | 'works' | 'always' {
    return !this.setting ? 'off' : this.setting.awake === 'always' ? 'always' : 'works';
  }

  /** Where other devices reach Seismic now; `null` while they do not. */
  address(): string | null {
    const s = this.setting;
    if (s?.via === 'tailscale' && this.served && this.ts.state === 'ready' && this.served.name === this.ts.name && !this.problem)
      return `https://${this.served.name}${this.served.https === 443 ? '' : `:${this.served.https}`}`;
    if (s?.via === 'address' && this.listening === s.address) return `http://${inUrl(s.address)}:${this.port}`;
    if (s?.via === 'hosts' && s.hosts.length) return `https://${s.hosts[0]}`;
    return null;
  }

  /** The names requests may come under: this machine's, the tailnet name Seismic is served at, the hosts a reverse proxy serves it under, the other address. */
  hosts(): readonly string[] {
    return [...LOCAL_HOSTS, ...(this.served && this.setting?.via === 'tailscale' ? [this.served.name] : []), ...(this.setting?.via === 'hosts' ? this.setting.hosts : []), ...(this.listening ? [inUrl(this.listening).toLowerCase()] : [])];
  }

  /** The section "From other devices", with what Tailscale says now (and the network made anew if that changed). */
  async view(): Promise<AccessView> {
    if (this.setting?.via === 'tailscale') {
      const before = JSON.stringify(this.ts);
      this.ts = await this.tailscale.state();
      if (JSON.stringify(this.ts) !== before || (this.ts.state === 'ready' && !this.served)) await this.apply();
    } else this.ts = await this.tailscale.state();
    await this.applying;
    const p = this.livePairing();
    return {
      local: true,
      file: this.home ? join(this.home, SETTINGS_FILE) : SETTINGS_FILE,
      remote: this.setting,
      tailscale: this.ts,
      address: this.address(),
      ...(this.problem && this.setting ? { problem: this.problem } : {}),
      addresses: machineAddresses(),
      devices: this.devices(),
      pairing: p,
      platform: this.platform,
    };
  }

  /** Saves the setting (`{ remote }`), makes the network as it says, and returns the section. */
  async save(input: unknown): Promise<AccessView> {
    const given = (input as { remote?: unknown } | null)?.remote;
    if (given !== null && !remoteOf(given)) throw new BadRequest('invalid', 'remote must be null, { via: "tailscale" }, { via: "address", address } or { via: "hosts", hosts }, each with an optional awake: "always"');
    this.setting = this.home ? saveRemote(this.home, input) : remoteOf(given);
    this.problem = undefined;
    if (!this.setting) {
      this.pairing = null;
      this.links.clear();
    }
    await this.apply(true);
    return this.view();
  }

  // ------------------------------------------------------------ who comes in

  /** From this machine: loopback, under one of its names, forwarded by no proxy. */
  isLocal(req: Request, server: Bun.Server<unknown>): boolean {
    const ip = server.requestIP(req)?.address;
    return !!ip && LOOPBACK.has(ip) && !FORWARDED.some((h) => req.headers.has(h)) && LOCAL_HOSTS.includes(hostname(req.headers.get('host') ?? ''));
  }

  /**
   * What a request gets instead of its route's answer, or `null`: a local one passes with the
   * owner's key (and to sign in), a remote one from a paired device too, but for managing access;
   * another gets the page that says how to sign in or connect, or a 401 for the API.
   */
  admit(req: Request, server: Bun.Server<unknown>, route: string): Response | null {
    // what a browser fetches to make the home-screen app, maybe without its cookies: nothing in them is the owner's
    if (PUBLIC.has(route)) return null;
    // `/api/pair` answers a request from this machine that it needs no pairing, with the key or without
    if (this.isLocal(req, server)) return route === '/login' || route === '/api/pair' ? null : this.owner.refusal(req, server.port!, route);
    if (route === '/pair' || route === '/api/pair') return null;
    const device = this.device(req);
    if (device) {
      this.from.set(req, device.id);
      if (route.startsWith('/api/access') && !(route === '/api/access' && req.method === 'GET'))
        return Response.json({ code: 'onlyHere', error: 'only on the machine Seismic runs on' }, { status: 403 });
      return null;
    }
    if (route.startsWith('/api/')) return Response.json({ code: 'notPaired', error: 'this device is not paired with Seismic' }, { status: 401 });
    return this.notPairedPage(false);
  }

  /** `/login`: a browser on this machine signs in with a one-time link; another device goes to the project, or to how to connect. */
  loginRoute(req: Request, server: Bun.Server<unknown>): Response {
    return this.isLocal(req, server) ? this.owner.login(req, server.port!) : new Response(null, { status: 303, headers: { location: '/' } });
  }

  /** The device an admitted remote request came from. */
  deviceOf(req: Request): string | undefined {
    return this.from.get(req);
  }

  /**
   * The paired device a request's cookie names; one unused for too long is removed. The cookie named
   * for this very address decides where the browser sends one: a device paired here again under it
   * and removed since is not let in by an older name's cookie beside it, the one it kept from before
   * cookies had a scheme's or port's name. Only a browser without the address's own cookie is let in
   * by an older name, from a pairing before the names changed or at another origin of this host.
   */
  device(req: Request): DeviceView | null {
    const own = deviceCookie(req);
    const names = cookieOf(req, own) ? [own] : [portOnlyDeviceCookie(req), DEVICE_COOKIE, OLD_DEVICE_COOKIE].filter((n): n is string => n !== null);
    return this.credential(req, names)?.device ?? null;
  }

  private credential(req: Request, names: string[]): { device: DeviceView; token: string } | null {
    const now = this.now();
    for (const name of names) {
      const token = cookieOf(req, name);
      if (!token) continue;
      const device = this.store.devices.byToken(sha256(token));
      if (!device) continue;
      const seen = Date.parse(device.lastSeen);
      if (now - seen > UNUSED_MS) {
        this.remove(device.id);
        continue;
      }
      if (now - seen > SEEN_EVERY_MS) this.store.devices.seen(device.id, new Date(now).toISOString());
      return { device, token };
    }
    return null;
  }

  devices(): DeviceView[] {
    const now = this.now();
    return this.store.devices.all().filter((d) => now - Date.parse(d.lastSeen) <= UNUSED_MS);
  }

  /** Removes a device at once: its cookie lets nothing in any more, and its open pages lose their connection. */
  remove(id: string): boolean {
    const gone = this.store.devices.remove(id);
    if (gone) for (const fn of this.removedFns) fn(id);
    return gone;
  }

  onRemoved(fn: (id: string) => void) {
    this.removedFns.add(fn);
    return () => this.removedFns.delete(fn);
  }

  // ------------------------------------------------------------ pairing

  private livePairing(): Pairing | null {
    const p = this.pairing;
    const address = this.address();
    if (!p || !address || p.expires <= this.now()) return null;
    return { code: p.code, url: `${address}/pair?code=${p.code}`, expires: new Date(p.expires).toISOString(), ...(p.paired ? { paired: p.paired } : {}) };
  }

  /** A new one-time code, valid for `PAIRING_MS`; the one before no longer pairs. */
  pair(): Pairing {
    if (!this.address()) throw new BadRequest('notReachable', 'other devices do not reach Seismic yet');
    const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
    this.pairing = { code: String(n).padStart(6, '0'), expires: this.now() + PAIRING_MS, tries: 0 };
    return this.livePairing()!;
  }

  /**
   * A link that pairs whichever browser opens it first, at the address other devices reach Seismic
   * under, once the network is made as the setting says; `null` while they do not reach it. Not a
   * login link: that one signs in only a browser on this machine (`loginRoute`), and would carry the
   * owner's key over plain HTTP. A paired device gets a cookie of its own instead, which may not
   * manage access and goes once the device is removed.
   */
  async pairingLink(): Promise<string | null> {
    await this.applying;
    return this.address() ? this.pair().url : null;
  }

  /** Pairs the device that brings the current code; its cookie, or `null` for a wrong or expired code. */
  /** `counts`: a wrong code spends one of the tries; one another site sent the browser here with spends none. */
  redeem(code: string, userAgent: string, counts = true, existing?: { device: DeviceView; token: string }): { token: string; device: DeviceView } | null {
    return this.check(code, counts) === 'ok' ? this.enroll(this.pairing!, userAgent, existing) : null;
  }

  /** Whether `code` is the current one; `counts`: a wrong one spends one of the tries. */
  private check(code: string, counts: boolean): 'ok' | 'wrongCode' | 'codeExpired' {
    const p = this.pairing;
    if (!p || p.spent || p.paired || p.expires <= this.now()) return 'codeExpired';
    if (code.replace(/\D/g, '') !== p.code) {
      // guessing gets five tries at a code, then it is spent
      if (counts && ++p.tries >= PAIRING_TRIES) this.pairing = null;
      return 'wrongCode';
    }
    return 'ok';
  }

  /** Pairs the browser with the code `p` let in, or pairs it again where it brings its credential of this address (`existing`). */
  private enroll(p: PairingCode, userAgent: string, existing?: { device: DeviceView; token: string }): { token: string; device: DeviceView } {
    const at = new Date(this.now()).toISOString();
    const device: DeviceView = { id: existing?.device.id ?? crypto.randomUUID(), name: existing?.device.name ?? deviceName(userAgent), pairedAt: at, lastSeen: at };
    const token = existing ? this.store.devices.renew(device, existing.token) : Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    if (!existing) this.store.devices.add({ ...device, tokenHash: sha256(token) });
    p.paired = device;
    console.log(`Seismic: ${device.name} paired`);
    return { token, device };
  }

  /**
   * `/pair`: the address in the QR code (`?code=`) or the form of the page for devices not paired
   * yet, or the one-time link `POST /api/pair` answers with (`?token=`). A device with the right
   * code or link gets its cookie and goes to the project; one already paired is paired again.
   */
  async pairRoute(req: Request, server: Bun.Server<unknown>): Promise<Response> {
    const project = () => new Response(null, { status: 303, headers: { location: '/' } });
    if (this.isLocal(req, server)) return project();
    const params = new URL(req.url).searchParams;
    const userAgent = req.headers.get('user-agent') ?? '';
    // Older names let a device in, but may belong to another origin on this host (another port, or
    // the other scheme at this one): only the cookie named for this very address is renewed.
    const existing = () => this.credential(req, [deviceCookie(req)]) ?? undefined;
    if (req.method === 'GET' && params.has('token')) {
      const hash = sha256(params.get('token')!);
      const link = this.links.get(hash);
      this.links.delete(hash);
      if (!link || link.expires <= this.now()) return this.notPairedPage(true);
      return this.paired(req, this.enroll(link.pairing, userAgent, existing()).token);
    }
    const code = req.method === 'POST' ? String((await req.formData().catch(() => null))?.get('code') ?? '') : (params.get('code') ?? '');
    if (req.method === 'GET' && !params.has('code') && this.device(req)) return project();
    // another site may send a browser in the tailnet here as often as it likes, to spend the code's tries
    const paired = this.redeem(code, userAgent, req.headers.get('sec-fetch-site') !== 'cross-site', existing());
    if (!paired) return this.notPairedPage(true);
    return this.paired(req, paired.token);
  }

  /**
   * `POST /api/pair` with `{ code }`: the desktop app's shell pairing with this Seismic over HTTP,
   * before it opens a window here. The right code buys a one-time link, valid for `LINK_MS`, that
   * pairs the browser which opens it (`pairRoute`); the code is spent with it. A wrong code spends
   * one of its tries, as on the page. Only for a program, not for a page of another site: the guard
   * turns away what a browser marks as cross-site, and it takes JSON alone, which a browser does not
   * send to another origin without asking first.
   */
  async pairApi(req: Request, server: Bun.Server<unknown>): Promise<Response> {
    const refuse = (status: number, code: string, error: string) => Response.json({ code, error }, { status });
    if (this.isLocal(req, server)) return refuse(409, 'onThisMachine', 'this is the Seismic of this machine: it needs no pairing');
    const body = req.headers.get('content-type')?.split(';')[0]?.trim() === 'application/json' ? ((await req.json().catch(() => null)) as { code?: unknown } | null) : null;
    if (typeof body?.code !== 'string') return refuse(400, 'invalid', 'send { "code": "123456" } as JSON');
    const checked = this.check(body.code, true);
    if (checked === 'wrongCode') return refuse(401, 'wrongCode', 'this code is wrong');
    if (checked === 'codeExpired') return refuse(410, 'codeExpired', 'this code has expired or was used: "Connect a phone" shows a new one');
    const p = this.pairing!;
    p.spent = true;
    const now = this.now();
    for (const [hash, link] of this.links) if (link.expires <= now) this.links.delete(hash);
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    this.links.set(sha256(token), { expires: now + LINK_MS, pairing: p });
    // the address the shell asked at, as a proxy forwarded it; the guard checked it to be one of Seismic's
    const host = (req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host')!).toLowerCase();
    const url = `${schemeOf(req)}://${host}/pair?token=${token}`;
    return Response.json({ url, expires: new Date(now + LINK_MS).toISOString() });
  }

  /** The answer that gives a paired browser its cookie and leads it on to the project. */
  private paired(req: Request, token: string): Response {
    // over HTTPS the cookie goes with what a worker's HTML artifact loads in its sandboxed frame too, which counts as another site
    const https = schemeOf(req) === 'https';
    const cookie = `${deviceCookie(req)}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; ${https ? 'SameSite=None; Secure' : 'SameSite=Lax'}`;
    return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': cookie } });
  }

  private notPairedPage(wrong: boolean): Response {
    const m = MESSAGES[this.language()].notPaired;
    const html = `<!doctype html>
<html lang="${this.language()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${m.title}</title>
<style>
:root { color-scheme: light dark; font: 17px/1.45 -apple-system, system-ui, sans-serif; }
body { margin: 0; padding: 12vh 24px; max-width: 30rem; margin-inline: auto; }
h1 { font-size: 1.3rem; margin: 0 0 1rem; }
form { display: flex; gap: 8px; margin-top: 1rem; }
input { flex: 1; font: inherit; font-size: 1.4rem; letter-spacing: .2em; padding: 10px 12px; border-radius: 10px; border: 1px solid #8888; min-width: 0; }
button { font: inherit; padding: 10px 18px; border-radius: 10px; border: 0; background: #2f6fde; color: #fff; }
.wrong { color: #d33; }
</style></head>
<body><h1>${m.heading}</h1>
${wrong ? `<p class="wrong">${m.wrong}</p>` : ''}<p>${m.how}</p>
<form method="post" action="/pair"><input name="code" inputmode="numeric" autocomplete="one-time-code" aria-label="${m.code}" placeholder="${m.code}" required><button>${m.pair}</button></form>
</body></html>`;
    return new Response(html, { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
}
