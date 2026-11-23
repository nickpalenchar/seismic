import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AccessView, Pairing } from '../../core/types';
import { ProjectRuntime } from '../project';
import { Store } from '../store';
import { Access, deviceName, LINK_MS, machineAddresses, PAIRING_MS, UNUSED_MS } from '../remote';
import { serve } from '../server';
import { Tailscale } from '../tailscale';
import { Push } from '../push';
import { asOwner, fakeTailscale, gitRepo, heard, noForge, tailscaleStatus, until } from './helpers/testing';
import { b64u } from '../webpush';

const NAME = 'mac.tail1234.ts.net';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

let dir: string;
let ts: string;
let store: Store;
let access: Access;
let server: ReturnType<typeof serve>;
let clock: number;
let project: ProjectRuntime;
let push: Push;
/** What went to the push service: to where. */
let pushed: string[];
let pushTimers: (() => void)[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seismic-remote-'));
  const main = gitRepo(join(dir, 'main'), { 'README.md': 'hi\n', '.seismic/settings.json': '{ "workstations": "clones" }\n' });
  ts = join(dir, 'ts');
  store = new Store(':memory:');
  clock = Date.now();
  access = new Access({ store, home: dir, tailscale: new Tailscale(fakeTailscale(ts)), now: () => clock });
  project = new ProjectRuntime({ repos: [{ path: main }] }, { store, home: dir, runtime: undefined as never, forge: noForge });
  pushed = [];
  pushTimers = [];
  push = new Push({
    later: (fn) => void pushTimers.push(fn),
    store,
    post: async (url) => {
      pushed.push(url);
      return { status: 201, text: async () => '' };
    },
  });
  server = serve([project], { transcriber: { transcribe: async () => ({ text: '', doubtful: false }) } }, 0, false, undefined, undefined, undefined, undefined, undefined, undefined, access, push);
});
afterEach(() => {
  access.stop();
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

// on this machine: with the owner's key
const local = (path: string, init: RequestInit = {}) => asOwner(() => server).fetch(new URL(path, server.url), init);
/** What `tailscale serve` sends on: from 127.0.0.1, under the tailnet name, forwarded. */
const viaTailnet = (path: string, headers: Record<string, string> = {}, init: RequestInit = {}) =>
  fetch(new URL(path, server.url), { redirect: 'manual', ...init, headers: { host: NAME, 'x-forwarded-for': '100.64.0.7', 'x-forwarded-host': NAME, 'x-forwarded-proto': 'https', 'user-agent': IPHONE, ...headers } });
const view = async () => (await (await local('/api/access')).json()) as AccessView;
const turnOn = async (remote: unknown = { via: 'tailscale' }) =>
  (await (await local('/api/access', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ remote }) })).json()) as AccessView;
const pairing = async () => (await (await local('/api/access/pair', { method: 'POST' })).json()) as Pairing;
const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0]!;
const opens = (headers: Record<string, string>) =>
  new Promise<WebSocket | null>((done) => {
    const ws = new WebSocket(new URL('/api/c/main/ws', server.url.href.replace('http', 'ws')), { headers } as unknown as string[]);
    ws.onopen = () => done(ws);
    ws.onerror = () => done(null);
  });

describe('keeping the machine awake', () => {
  test('off while other devices may not reach Seismic; while a worker works by default, or always as the owner sets it', async () => {
    expect(access.awake()).toBe('off');
    await turnOn({ via: 'tailscale' });
    expect(access.awake()).toBe('works');
    expect((await turnOn({ via: 'tailscale', awake: 'always' })).remote).toEqual({ via: 'tailscale', awake: 'always' });
    expect(access.awake()).toBe('always');
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).remote).toEqual({ via: 'tailscale', awake: 'always' });
    await turnOn({ via: 'tailscale', awake: 'sometimes' });
    expect(access.awake()).toBe('works');
    await turnOn(null);
    expect(access.awake()).toBe('off');
  });
});

describe('through Tailscale', () => {
  test('off by default: the tailnet name is not one of Seismic’s', async () => {
    expect((await view()).remote).toBeNull();
    expect((await viaTailnet('/')).status).toBe(421);
    expect(existsSync(join(ts, 'calls')) && readFileSync(join(ts, 'calls'), 'utf8')).not.toContain('serve --bg');
  });

  test('turned on, Seismic serves its port over HTTPS at the tailnet name, and off removes only that entry', async () => {
    // something else serves on 443 already: Seismic takes the next port and leaves it be
    writeFileSync(join(ts, 'serve.json'), JSON.stringify({ TCP: { 443: { HTTPS: true } }, Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } } }));
    const on = await turnOn();
    expect(on.tailscale).toEqual({ state: 'ready', name: NAME, account: 'owner@example.com', others: 1 });
    expect(on.address).toBe(`https://${NAME}:8443`);
    const config = () => JSON.parse(readFileSync(join(ts, 'serve.json'), 'utf8'));
    expect(config().Web[`${NAME}:8443`].Handlers['/'].Proxy).toBe(`http://127.0.0.1:${server.port}`);
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).remote).toEqual({ via: 'tailscale' });
    const off = await turnOn(null);
    expect(off.address).toBeNull();
    expect(config().Web[`${NAME}:8443`]).toBeUndefined();
    expect(config().Web[`${NAME}:443`].Handlers['/'].Proxy).toBe('http://127.0.0.1:3000');
  });

  test('an entry recorded in a copied home stays with the Seismic that still answers there; a dead one is taken back', async () => {
    const other = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('the running Seismic') });
    const live = `http://127.0.0.1:${other.port}`;
    const dead = 'http://127.0.0.1:1';
    const serving = (target: string) => writeFileSync(join(ts, 'serve.json'), JSON.stringify({ TCP: { 443: { HTTPS: true } }, Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: target } } } } }));
    const tailscale = new Tailscale(fakeTailscale(ts));
    try {
      serving(live);
      expect(await tailscale.serve(NAME, 50104, { https: 443, target: live })).toEqual({ entry: { https: 8443, target: 'http://127.0.0.1:50104' } });
      expect(JSON.parse(readFileSync(join(ts, 'serve.json'), 'utf8')).Web[`${NAME}:443`].Handlers['/'].Proxy).toBe(live);
      serving(dead);
      expect(await tailscale.serve(NAME, 50104, { https: 443, target: dead })).toEqual({ entry: { https: 443, target: 'http://127.0.0.1:50104' } });
    } finally {
      other.stop(true);
    }
  });

  test('stopping, Seismic removes its entry: what takes the port next is not served to the tailnet', async () => {
    await turnOn();
    access.release();
    expect(JSON.parse(readFileSync(join(ts, 'serve.json'), 'utf8')).Web[`${NAME}:443`]).toBeUndefined();
    expect(existsSync(join(dir, 'tailscale-serve.json'))).toBe(false);
  });

  test('a Seismic on a copied home leaves the running Seismic its entry, stopping or turned off', async () => {
    const other = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('the running Seismic') });
    const live = `http://127.0.0.1:${other.port}`;
    const entry = () => JSON.parse(readFileSync(join(ts, 'serve.json'), 'utf8')).Web[`${NAME}:443`]?.Handlers['/'].Proxy;
    const copied = () => {
      writeFileSync(join(ts, 'serve.json'), JSON.stringify({ TCP: { 443: { HTTPS: true } }, Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: live } } } } }));
      writeFileSync(join(dir, 'tailscale-serve.json'), JSON.stringify({ https: 443, target: live, name: NAME }));
      return new Access({ store, home: dir, tailscale: new Tailscale(fakeTailscale(ts)), now: () => clock });
    };
    try {
      // stopping before it served anything of its own (Tailscale did not answer in time, say)
      copied().release();
      expect(entry()).toBe(live);
      expect(existsSync(join(dir, 'tailscale-serve.json'))).toBe(false);
      // starting with remote access off, it gives up only what it served itself
      await copied().start(server.port!, () => {});
      expect(entry()).toBe(live);
      expect(existsSync(join(dir, 'tailscale-serve.json'))).toBe(false);
    } finally {
      other.stop(true);
    }
  });

  test('says what the network lacks: Tailscale logged out, HTTPS off in the tailnet, missing', async () => {
    tailscaleStatus(ts, { state: 'NeedsLogin', name: NAME, https: false });
    expect((await turnOn()).tailscale).toEqual({ state: 'loggedOut' });
    tailscaleStatus(ts, { state: 'Running', name: NAME, https: false });
    const v = await view();
    expect(v.tailscale).toEqual({ state: 'noHttps', name: NAME });
    expect(v.address).toBeNull();
    expect(readFileSync(join(ts, 'calls'), 'utf8')).not.toContain('serve --bg');
    // once HTTPS is on, the section's next look serves Seismic
    tailscaleStatus(ts, { state: 'Running', name: NAME, https: true });
    expect((await view()).address).toBe(`https://${NAME}`);
    const missing = new Access({ store, tailscale: new Tailscale(null) });
    expect((await missing.view()).tailscale).toEqual({ state: 'missing' });
  });

  test('says the account and that no other device is in the tailnet yet, until the phone joins it', async () => {
    tailscaleStatus(ts, { state: 'Running', name: NAME, https: true, account: 'me@example.com', others: 0 });
    const alone = await turnOn();
    expect(alone.tailscale).toEqual({ state: 'ready', name: NAME, account: 'me@example.com', others: 0 });
    expect(alone.address).toBe(`https://${NAME}`);
    tailscaleStatus(ts, { state: 'Running', name: NAME, https: true, account: 'me@example.com', others: 1 });
    const joined = await view();
    expect(joined.tailscale).toMatchObject({ others: 1 });
    expect(joined.address).toBe(`https://${NAME}`);
  });

  test('a Tailscale slow to answer under load keeps the state it had; one that never answered is stopped', async () => {
    const tailscale = new Tailscale(join(ts, 'tailscale'), process.platform, 500);
    writeFileSync(join(ts, 'slow'), '');
    expect(await tailscale.state()).toEqual({ state: 'stopped' });
    rmSync(join(ts, 'slow'));
    expect(await tailscale.state()).toMatchObject({ state: 'ready', name: 'mac.tail1234.ts.net' });
    writeFileSync(join(ts, 'slow'), '');
    expect(await tailscale.state()).toMatchObject({ state: 'ready', name: 'mac.tail1234.ts.net' });
  });

  test('on Linux without the operator right, the section says so', async () => {
    writeFileSync(join(ts, 'fail'), 'sending serve config: Access denied: serve config denied');
    const linux = new Access({ store, tailscale: new Tailscale(join(ts, 'tailscale'), 'linux') });
    linux.start(4417, () => {});
    expect((await linux.save({ remote: { via: 'tailscale' } })).problem).toEqual({ code: 'operator' });
  });
});

describe('pairing', () => {
  test('a device without a cookie gets the page that says how to connect, and no API', async () => {
    await turnOn();
    const page = await viaTailnet('/');
    expect(page.status).toBe(401);
    expect(await page.text()).toContain('This device is not connected to Seismic');
    expect(await (await viaTailnet('/api/projects')).json()).toMatchObject({ code: 'notPaired' });
    expect(await opens({ host: NAME, 'x-forwarded-for': '100.64.0.7', origin: `https://${NAME}` })).toBeNull();
    // this machine itself needs none
    expect((await local('/api/projects')).status).toBe(200);
  });

  test('the code from the QR code pairs the phone once; it then opens the project, until it is removed', async () => {
    expect((await local('/api/access/pair', { method: 'POST' })).status).toBe(400);
    await turnOn();
    const p = await pairing();
    expect(p.code).toMatch(/^\d{6}$/);
    expect(p.url).toBe(`https://${NAME}/pair?code=${p.code}`);
    // the scanner app opens the address from a page of its own: a navigation from another site
    const paired = await viaTailnet(`/pair?code=${p.code}`, { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' });
    expect(paired.status).toBe(303);
    expect(paired.headers.get('location')).toBe('/');
    expect(paired.headers.get('set-cookie')).toContain('HttpOnly');
    expect(paired.headers.get('set-cookie')).toContain('Secure');
    const cookie = cookieOf(paired);
    // a second device with the same code gets nothing
    expect((await viaTailnet(`/pair?code=${p.code}`)).status).toBe(401);
    const v = await view();
    expect(v.devices.map((d) => d.name)).toEqual(['iPhone · Safari']);
    expect(v.pairing?.paired?.name).toBe('iPhone · Safari');

    const page = await viaTailnet('/', { cookie });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<html');
    // a card from the phone's page
    const card = await viaTailnet('/api/c/main/cards', { cookie, origin: `https://${NAME}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, { method: 'POST', body: JSON.stringify({ title: 'Vom Telefon', x: 0, y: 0 }) });
    expect(card.status).toBe(200);
    const ws = await opens({ host: NAME, 'x-forwarded-for': '100.64.0.7', 'x-forwarded-proto': 'https', origin: `https://${NAME}`, cookie });
    expect(ws).not.toBeNull();
    const closed = new Promise((r) => (ws!.onclose = r));

    // “Remove” takes effect at once
    expect(await (await local(`/api/access/devices/${v.devices[0]!.id}`, { method: 'DELETE' })).json()).toEqual({ removed: true });
    await closed;
    expect((await viaTailnet('/', { cookie })).status).toBe(401);
    expect((await view()).devices).toEqual([]);
  });

  /** A browser's jar for NAME: what each answer sets or unsets, sent along with every request. */
  const jarOf = () => {
    const jar = new Map<string, string>();
    const keep = (res: Response) => {
      for (const set of res.headers.getSetCookie()) {
        const [pair, ...attributes] = set.split(';').map((p) => p.trim());
        const [name, value] = [pair!.slice(0, pair!.indexOf('=')), pair!.slice(pair!.indexOf('=') + 1)];
        if (attributes.includes('Max-Age=0')) jar.delete(name);
        else jar.set(name, value);
      }
      return res;
    };
    const header = () => [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
    return { jar, keep, header };
  };

  test('reconnecting a paired desktop requires a fresh code, keeps its device entry, and hands over a new credential', async () => {
    await turnOn();
    const first = await pairing();
    const { jar, keep, header } = jarOf();
    keep(await viaTailnet(`/pair?code=${first.code}`));
    const original = header();
    const id = (await view()).devices[0]!.id;
    const reconnect = (code: string) => viaTailnet(`/pair?code=${code}`, { cookie: header() });
    expect((await viaTailnet('/pair', { cookie: header() })).status).toBe(303);
    expect((await reconnect(first.code)).status).toBe(401);
    const posted = await viaTailnet('/pair', { cookie: header(), origin: `https://${NAME}`, 'content-type': 'application/x-www-form-urlencoded' }, { method: 'POST', body: `code=${first.code}` });
    expect(posted.status).toBe(401);
    const expired = await pairing();
    clock += PAIRING_MS + 1;
    expect((await reconnect(expired.code)).status).toBe(401);
    const next = await pairing();
    expect((await reconnect(next.code === '000000' ? '111111' : '000000')).status).toBe(401);
    expect((await viaTailnet('/api/projects', { cookie: header() })).status).toBe(200);
    // the right code: a new credential under a name of its own, the original's unset
    const renewed = await reconnect(next.code);
    expect(renewed.status).toBe(303);
    const sets = renewed.headers.getSetCookie();
    expect(sets[0]).toMatch(/^seismic-device-https\.[0-9a-f]{24}=/);
    expect(sets[1]).toStartWith(`${original.split('=')[0]}=; Max-Age=0`);
    // the answer might never reach the webview: the original cookie still works, and a retry gets the same answer
    expect((await viaTailnet('/api/projects', { cookie: original })).status).toBe(200);
    const retried = await reconnect((await pairing()).code);
    expect(retried.headers.getSetCookie()).toEqual(sets);
    keep(renewed);
    expect([...jar.keys()]).toEqual([sets[0]!.split('=')[0]!]);
    // the browser presents the new one: it becomes current, and the original no longer lets anyone in
    expect((await viaTailnet('/api/projects', { cookie: header() })).status).toBe(200);
    expect((await viaTailnet('/api/projects', { cookie: original })).status).toBe(401);
    expect((await reconnect(next.code)).status).toBe(401);
    expect((await view()).devices.map((d) => d.id)).toEqual([id]);
  });

  test('answers of overlapping pairings again that arrive late, out of order, never put the browser out', async () => {
    await turnOn();
    const { jar, keep, header } = jarOf();
    keep(await viaTailnet(`/pair?code=${(await pairing()).code}`));
    // two pairings again at once, with the same cookie: both answers carry credential B
    const sent = header();
    const one = await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: sent });
    const late = await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: sent });
    keep(one);
    expect((await viaTailnet('/api/projects', { cookie: header() })).status).toBe(200);
    // two more rounds: C from B, then D from C, which retires B for good
    for (let i = 0; i < 2; i++) {
      keep(await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: header() }));
      expect((await viaTailnet('/api/projects', { cookie: header() })).status).toBe(200);
    }
    const newest = header();
    // the late answer sets B, retired by now, under its own name beside D, not over it
    keep(late);
    expect(jar.size).toBe(2);
    expect((await viaTailnet('/api/projects', { cookie: late.headers.getSetCookie()[0]!.split(';')[0]! })).status).toBe(401);
    expect((await viaTailnet('/api/projects', { cookie: header() })).status).toBe(200);
    // and the next pairing again clears it out
    keep(await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: header() }));
    expect(jar.size).toBe(1);
    expect((await viaTailnet('/api/projects', { cookie: header() })).status).toBe(200);
    expect((await viaTailnet('/api/projects', { cookie: newest })).status).toBe(401);
    expect((await view()).devices).toHaveLength(1);
  });

  test('a pairing again sent with the old cookie, arriving after its replacement took over, pairs the same device and gets the same answer', async () => {
    await turnOn();
    const { jar, keep, header } = jarOf();
    keep(await viaTailnet(`/pair?code=${(await pairing()).code}`));
    const old = header();
    const first = await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: old });
    keep(first);
    // the browser uses the replacement: the old credential is retired
    expect((await viaTailnet('/api/projects', { cookie: header() })).status).toBe(200);
    expect((await viaTailnet('/api/projects', { cookie: old })).status).toBe(401);
    // a second pairing again, sent with the old cookie before the first answer came, arrives only now
    const late = await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: old });
    expect(late.headers.getSetCookie()).toEqual(first.headers.getSetCookie());
    keep(late);
    expect(jar.size).toBe(1);
    expect((await viaTailnet('/api/projects', { cookie: header() })).status).toBe(200);
    expect((await view()).devices).toHaveLength(1);
  });

  test('a late pairing again with a retired cookie leaves alone a replacement still on its way', async () => {
    await turnOn();
    const { keep, header } = jarOf();
    keep(await viaTailnet(`/pair?code=${(await pairing()).code}`));
    const original = header();
    const renew = async (cookie: string) => viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie });
    const first = await renew(original);
    keep(first);
    keep(await renew(header()));
    const current = header();
    expect((await viaTailnet('/api/projects', { cookie: current })).status).toBe(200);
    expect((await viaTailnet('/api/projects', { cookie: cookieOf(first) })).status).toBe(401);

    const pending = await renew(current);
    // The original cookie's first replacement has retired. The delayed request issues a
    // distinct replacement while the browser still holds only its current cookie.
    const delayed = await renew(original);
    expect(delayed.status).toBe(303);
    expect(cookieOf(delayed)).not.toBe(cookieOf(first));
    expect(cookieOf(delayed)).not.toBe(cookieOf(pending));
    expect(header()).toBe(current);
    keep(pending);
    expect(header()).toBe(cookieOf(pending));
    expect((await viaTailnet('/api/projects', { cookie: header() })).status).toBe(200);
    keep(delayed);
    expect((await viaTailnet('/api/projects', { cookie: header() })).status).toBe(200);
    expect((await viaTailnet('/api/projects', { cookie: cookieOf(pending) })).status).toBe(401);
    expect((await view()).devices).toHaveLength(1);
  });

  test('renewed credentials authenticate without a write once their predecessors retire', async () => {
    await turnOn();
    const original = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`));
    const renewed = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: original }));
    expect((await viaTailnet('/api/projects', { cookie: renewed })).status).toBe(200);
    expect((await viaTailnet('/api/projects', { cookie: original })).status).toBe(401);
    store.db.run('PRAGMA query_only = ON');
    try {
      expect((await viaTailnet('/api/projects', { cookie: renewed })).status).toBe(200);
    } finally {
      store.db.run('PRAGMA query_only = OFF');
    }
  });

  test.each(['code', 'link'])('pairing by %s with a retired cookie replaces an expired device entry', async (method) => {
    await turnOn();
    const original = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`));
    const current = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: original }));
    expect((await viaTailnet('/api/projects', { cookie: current })).status).toBe(200);
    const id = (await view()).devices[0]!.id;
    store.devices.setPush(id, { endpoint: 'https://web.push.apple.com/QGx', keys: { p256dh: 'key', auth: 'secret' } });
    clock += UNUSED_MS + 1;

    const { code } = await pairing();
    let path = `/pair?code=${code}`;
    if (method === 'link') {
      const traded = await viaTailnet('/api/pair', { 'content-type': 'application/json' }, { method: 'POST', body: JSON.stringify({ code }) });
      const url = new URL(((await traded.json()) as { url: string }).url);
      path = `${url.pathname}${url.search}`;
    }
    const paired = await viaTailnet(path, { cookie: original });
    expect(paired.status).toBe(303);
    const devices = store.devices.all();
    expect(devices).toHaveLength(1);
    expect(devices[0]!.id).not.toBe(id);
    expect(devices[0]!.push).toBeUndefined();
    expect((await viaTailnet('/api/projects', { cookie: cookieOf(paired) })).status).toBe(200);
    expect((await viaTailnet('/api/projects', { cookie: current })).status).toBe(401);
  });

  test('a cookie without a value at this address breaks no pairing', async () => {
    await turnOn();
    const res = await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: 'seismic-device-https; seismic-device-https.0123456789ab; other=1' });
    expect(res.status).toBe(303);
    expect((await viaTailnet('/api/projects', { cookie: `${cookieOf(res)}; seismic-device-https.0123456789ab` })).status).toBe(200);
  });

  test('a used link opened again by its browser while the renewal it set has not arrived gives the same answer again', async () => {
    await turnOn();
    const { keep, header } = jarOf();
    keep(await viaTailnet(`/pair?code=${(await pairing()).code}`));
    const original = header();
    const traded = await viaTailnet('/api/pair', { 'content-type': 'application/json' }, { method: 'POST', body: JSON.stringify({ code: (await pairing()).code }) });
    const url = new URL(((await traded.json()) as { url: string }).url);
    const link = `${url.pathname}${url.search}`;
    // the answer is lost: the browser still holds the original cookie
    const lost = await viaTailnet(link, { cookie: original });
    const again = await viaTailnet(link, { cookie: original });
    expect(again.status).toBe(303);
    expect(again.headers.getSetCookie()).toEqual(lost.headers.getSetCookie());
    keep(again);
    expect((await viaTailnet('/api/projects', { cookie: header() })).status).toBe(200);
    expect((await viaTailnet('/api/projects', { cookie: original })).status).toBe(401);
    // now it holds the replacement: on to the project, nothing set
    const copied = await viaTailnet(link, { cookie: original });
    expect(copied.status).toBe(401);
    expect(copied.headers.getSetCookie()).toEqual([]);
    const replay = await viaTailnet(link, { cookie: header() });
    expect(replay.status).toBe(303);
    expect(replay.headers.getSetCookie()).toEqual([]);
    // another browser gets nothing from the used link
    expect((await viaTailnet(link)).status).toBe(401);
    // a later pairing again from its credential, whose answer is not kept: the earlier link gives none of it away
    const later = await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: header() });
    expect(later.status).toBe(303);
    const reopened = await viaTailnet(link, { cookie: header() });
    expect(reopened.status).toBe(303);
    expect(reopened.headers.getSetCookie()).toEqual([]);
  });

  test('a link that paired again from a retired cookie, its answer lost, gives it again to the browser bringing that cookie', async () => {
    await turnOn();
    const { keep, header } = jarOf();
    keep(await viaTailnet(`/pair?code=${(await pairing()).code}`));
    const c = header();
    keep(await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: c }));
    keep(await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: header() }));
    expect((await viaTailnet('/api/projects', { cookie: header() })).status).toBe(200);
    // the window opens a link with the retired C, and that answer is lost
    const traded = await viaTailnet('/api/pair', { 'content-type': 'application/json' }, { method: 'POST', body: JSON.stringify({ code: (await pairing()).code }) });
    const url = new URL(((await traded.json()) as { url: string }).url);
    const link = `${url.pathname}${url.search}`;
    const lost = await viaTailnet(link, { cookie: c });
    expect(lost.status).toBe(303);
    const again = await viaTailnet(link, { cookie: c });
    expect(again.headers.getSetCookie()).toEqual(lost.headers.getSetCookie());
    // with only its current cookie, which cannot make that replacement, the browser is told the link did not pair it
    expect((await viaTailnet(link, { cookie: header() })).status).toBe(401);
    // Reopening the link with the replacement itself confirms receipt, just like opening the workspace.
    const confirmed = await viaTailnet(link, { cookie: cookieOf(again) });
    expect(confirmed.status).toBe(303);
    expect(confirmed.headers.getSetCookie()).toEqual([]);
    const copied = await viaTailnet(link, { cookie: c });
    expect(copied.status).toBe(401);
    expect(copied.headers.getSetCookie()).toEqual([]);
  });

  test('a used link cannot reissue a replacement when its device entry has expired', async () => {
    await turnOn();
    const original = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`));
    const first = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: original }));
    const current = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: first }));
    expect((await viaTailnet('/api/projects', { cookie: current })).status).toBe(200);
    const id = (await view()).devices[0]!.id;
    const traded = await viaTailnet('/api/pair', { 'content-type': 'application/json' }, { method: 'POST', body: JSON.stringify({ code: (await pairing()).code }) });
    const url = new URL(((await traded.json()) as { url: string }).url);
    const link = `${url.pathname}${url.search}`;
    expect((await viaTailnet(link, { cookie: original })).status).toBe(303);
    // Keep the link in its replay window while exercising the device's separate expiry check.
    store.devices.seen(id, new Date(clock - UNUSED_MS - 1).toISOString());
    const replay = await viaTailnet(link, { cookie: original });
    expect(replay.status).toBe(401);
    expect(replay.headers.getSetCookie()).toEqual([]);
    expect(store.devices.all()).toEqual([]);
  });

  test('a request with one device cookie looks it up once', async () => {
    await turnOn();
    const cookie = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`));
    const byToken = store.devices.byToken.bind(store.devices);
    let lookups = 0;
    store.devices.byToken = (hash) => (lookups++, byToken(hash));
    try {
      expect((await viaTailnet('/api/projects', { cookie })).status).toBe(200);
      expect(lookups).toBe(1);
    } finally {
      store.devices.byToken = byToken;
    }
  });

  test('"Remove" puts a browser out whatever generation of its device cookies it holds', async () => {
    await turnOn();
    const { keep, header } = jarOf();
    keep(await viaTailnet(`/pair?code=${(await pairing()).code}`));
    const late = await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: header() });
    keep(await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: header() }));
    keep(late);
    expect((await viaTailnet('/api/projects', { cookie: header() })).status).toBe(200);
    await local(`/api/access/devices/${(await view()).devices[0]!.id}`, { method: 'DELETE' });
    expect((await viaTailnet('/api/projects', { cookie: header() })).status).toBe(401);
  });

  test('pairing at a second port preserves the legacy pairing used at the first', async () => {
    await turnOn();
    const token = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`)).split('=')[1];
    const first = `seismic-device=${token}`;
    const port = { host: `${NAME}:8443`, 'x-forwarded-host': `${NAME}:8443` };
    const second = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`, { ...port, cookie: first }));
    const renewed = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`, { ...port, cookie: `${first}; ${second}` }));
    expect((await viaTailnet('/api/projects', { ...port, cookie: renewed })).status).toBe(200);
    expect((await viaTailnet('/api/projects', { cookie: first })).status).toBe(200);
    expect((await view()).devices).toHaveLength(2);
  });

  test("at an address with a port the cookie is named for it: another Seismic on the same host keeps its own", async () => {
    await turnOn();
    const at8443 = { host: `${NAME}:8443`, 'x-forwarded-host': `${NAME}:8443` };
    const cookie = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`, at8443));
    expect(cookie).toStartWith('seismic-device-https-8443.');
    // the browser sends the other Seismic's cookie of that host along, which lets nothing in here
    expect((await viaTailnet('/api/projects', { ...at8443, cookie: `seismic-device=the-other-ones; ${cookie}` })).status).toBe(200);
    expect((await viaTailnet('/api/projects', { ...at8443, cookie: 'seismic-device=the-other-ones' })).status).toBe(401);
    // a device paired under the name without a port or scheme keeps working at the address with one
    const token = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`)).split('=')[1];
    expect((await viaTailnet('/api/projects', { ...at8443, cookie: `seismic-device=${token}` })).status).toBe(200);
    expect((await viaTailnet('/api/projects', { cookie: `seismic-device=${token}` })).status).toBe(200);
    // so does one paired under the port's name alone, before the scheme joined it
    expect((await viaTailnet('/api/projects', { ...at8443, cookie: `seismic-device-8443=${token}` })).status).toBe(200);
    expect((await viaTailnet('/api/projects', { cookie: `seismic-device-8443=${token}` })).status).toBe(401);
  });

  test('http:// and https:// at one port of one host reaching one Seismic: pairing at the second pairs nothing of the first again', async () => {
    await turnOn();
    const port = { host: `${NAME}:8443`, 'x-forwarded-host': `${NAME}:8443` };
    const plain = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`, { ...port, 'x-forwarded-proto': 'http' }));
    expect(plain).toStartWith('seismic-device-http-8443.');
    const token = plain.split('=')[1]!;
    // the browser sends the plain cookie along over HTTPS too (it is not Secure): the pairing there is a device of its own
    const secure = await viaTailnet(`/pair?code=${(await pairing()).code}`, { ...port, cookie: plain });
    expect(secure.headers.get('set-cookie')).toStartWith('seismic-device-https-8443.');
    expect(secure.headers.get('set-cookie')).toContain('Secure');
    expect((await view()).devices).toHaveLength(2);
    // and the first keeps its access over plain HTTP, its cookie not replaced by a Secure one it would never send there
    expect((await viaTailnet('/api/projects', { ...port, cookie: cookieOf(secure) })).status).toBe(200);
    expect((await viaTailnet('/api/projects', { ...port, 'x-forwarded-proto': 'http', cookie: plain })).status).toBe(200);
    // a cookie of the port's name alone, from before the scheme joined it, lets the device in at both but is paired again at neither
    const legacy = `seismic-device-8443=${token}`;
    expect((await viaTailnet('/api/projects', { ...port, cookie: legacy })).status).toBe(200);
    expect((await viaTailnet('/api/projects', { ...port, 'x-forwarded-proto': 'http', cookie: legacy })).status).toBe(200);
    const again = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`, { ...port, cookie: legacy }));
    expect(again).toStartWith('seismic-device-https-8443.');
    expect((await viaTailnet('/api/projects', { ...port, 'x-forwarded-proto': 'http', cookie: plain })).status).toBe(200);
    expect((await view()).devices).toHaveLength(3);
  });

  test('a browser paired again under the address\'s own name is out once that device is removed, whatever older cookie it keeps beside it', async () => {
    await turnOn();
    const port = { host: `${NAME}:8443`, 'x-forwarded-host': `${NAME}:8443` };
    const first = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`, port)).split('=')[1]!;
    const legacy = `seismic-device-8443=${first}`;
    expect((await viaTailnet('/api/projects', { ...port, cookie: legacy })).status).toBe(200);
    // the browser pairs again with that cookie in its jar: a device of its own, under the address's own name
    const own = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`, { ...port, cookie: legacy }));
    expect(own).toStartWith('seismic-device-https-8443.');
    const both = `${legacy}; ${own}`;
    expect((await viaTailnet('/api/projects', { ...port, cookie: both })).status).toBe(200);
    expect((await viaTailnet('/pair', { ...port, cookie: both })).status).toBe(303);
    const [older, newer] = (await view()).devices.map((d) => d.id);
    expect(await (await local(`/api/access/devices/${newer}`, { method: 'DELETE' })).json()).toEqual({ removed: true });
    // "Remove" of the device paired last puts the browser out at that address: the older cookie beside the new one no longer lets it in
    expect((await viaTailnet('/api/projects', { ...port, cookie: both })).status).toBe(401);
    expect((await viaTailnet('/', { ...port, cookie: both })).status).toBe(401);
    expect((await viaTailnet('/pair', { ...port, cookie: both })).status).toBe(401);
    expect(await opens({ host: `${NAME}:8443`, 'x-forwarded-for': '100.64.0.7', 'x-forwarded-proto': 'https', origin: `https://${NAME}:8443`, cookie: both })).toBeNull();
    // the older cookie may be another origin's on this host: a browser that has only it keeps its access, and the device stays
    expect((await viaTailnet('/api/projects', { ...port, 'x-forwarded-proto': 'http', cookie: legacy })).status).toBe(200);
    expect((await view()).devices.map((d) => d.id)).toEqual([older!]);
    // the same at an address without a port, with the name from before the scheme joined it
    const bare = `seismic-device=${cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`)).split('=')[1]}`;
    const renamed = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: bare }));
    expect(renamed).toStartWith('seismic-device-https.');
    expect((await viaTailnet('/api/projects', { cookie: `${bare}; ${renamed}` })).status).toBe(200);
    const last = (await view()).devices.at(-1)!.id;
    await local(`/api/access/devices/${last}`, { method: 'DELETE' });
    expect((await viaTailnet('/api/projects', { cookie: `${bare}; ${renamed}` })).status).toBe(401);
    expect((await viaTailnet('/api/projects', { cookie: bare })).status).toBe(200);
    // a browser whose own cookie is of a device gone unused too long is not let in by an older one beside it either
    const aged = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: bare }));
    clock += UNUSED_MS - 1000;
    expect((await viaTailnet('/api/projects', { cookie: bare })).status).toBe(200);
    clock += 2000;
    expect((await viaTailnet('/api/projects', { cookie: `${bare}; ${aged}` })).status).toBe(401);
  });

  test('at addresses without a port the cookie is named for the scheme: Seismics at http:// and https:// of one host, paired in turn by one browser, keep their own', async () => {
    // this test's Seismic answers at https://NAME through `tailscale serve`; another one beside it at http://NAME, behind a proxy
    await turnOn();
    const home = join(dir, 'other');
    mkdirSync(home);
    const otherStore = new Store(':memory:');
    const otherAccess = new Access({ store: otherStore, home, tailscale: new Tailscale(fakeTailscale(join(dir, 'other-ts'))), now: () => clock });
    const otherProject = new ProjectRuntime({ repos: [{ path: join(dir, 'main') }] }, { store: otherStore, home, runtime: undefined as never, forge: noForge });
    const other = serve([otherProject], { transcriber: { transcribe: async () => ({ text: '', doubtful: false }) } }, 0, false, undefined, undefined, undefined, undefined, undefined, undefined, otherAccess);
    try {
      const otherLocal = (path: string, init: RequestInit = {}) => asOwner(() => other).fetch(new URL(path, other.url), init);
      await otherLocal('/api/access', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ remote: { via: 'hosts', hosts: [NAME] } }) });
      const otherCode = async () => ((await (await otherLocal('/api/access/pair', { method: 'POST' })).json()) as Pairing).code;

      // the browser's one jar for NAME: what each answer sets, sent along to both, a Secure cookie over HTTPS only
      const jar = new Map<string, { value: string; secure: boolean }>();
      const keep = (res: Response) => {
        const set = res.headers.get('set-cookie');
        if (!set) return res;
        const [pair, ...attributes] = set.split(';').map((p) => p.trim());
        const [name, value] = pair!.split('=') as [string, string];
        expect(name).toMatch(/^seismic-device-(http|https)\.[0-9a-f]{24}$/);
        jar.set(name, { value, secure: attributes.includes('Secure') });
        return res;
      };
      const cookies = (https: boolean) => [...jar].filter(([, c]) => https || !c.secure).map(([n, c]) => `${n}=${c.value}`).join('; ');
      const overHttps = (path: string) => viaTailnet(path, { cookie: cookies(true) }).then(keep);
      const overHttp = (path: string) =>
        fetch(new URL(path, other.url), { redirect: 'manual', headers: { host: NAME, 'x-forwarded-for': '100.64.0.7', 'x-forwarded-host': NAME, 'x-forwarded-proto': 'http', 'user-agent': IPHONE, cookie: cookies(false) } }).then(keep);

      expect((await overHttp(`/pair?code=${await otherCode()}`)).status).toBe(303);
      const [httpName] = [...jar.keys()] as [string];
      expect(httpName).toStartWith('seismic-device-http.');
      // the second pairing goes with the first one's cookie in the jar, and sets a cookie of its own beside it
      const secure = await overHttps(`/pair?code=${(await pairing()).code}`);
      expect(secure.headers.get('set-cookie')).toStartWith('seismic-device-https.');
      expect(secure.headers.get('set-cookie')).toContain('Secure');
      const httpsName = cookieOf(secure).split('=')[0]!;
      expect(jar.get(httpName)!.secure).toBe(false);
      expect(jar.size).toBe(2);
      // both let the browser in, each by its own cookie, the other's beside it
      expect((await overHttp('/api/projects')).status).toBe(200);
      expect((await overHttps('/api/projects')).status).toBe(200);
      // and neither takes the other's: alone in the jar, each one's cookie goes along and lets nobody in at the other
      const [http, https] = [jar.get(httpName)!, jar.get(httpsName)!];
      jar.delete(httpsName);
      expect(cookies(true)).toStartWith('seismic-device-http.');
      expect((await overHttps('/api/projects')).status).toBe(401);
      jar.set(httpsName, https).delete(httpName);
      // a browser keeps a Secure cookie off plain HTTP; one sent there all the same, a proxy's say, lets nothing in either
      expect(cookies(false)).toBe('');
      const sent = (cookie: string) => fetch(new URL('/api/projects', other.url), { headers: { host: NAME, 'x-forwarded-for': '100.64.0.7', 'x-forwarded-host': NAME, 'x-forwarded-proto': 'http', 'user-agent': IPHONE, cookie } });
      expect((await sent(`${httpsName}=${https.value}`)).status).toBe(401);
      expect((await sent(`${httpName}=${https.value}`)).status).toBe(401);
      expect((await sent(`${httpName}=${http.value}`)).status).toBe(200);
    } finally {
      otherAccess.stop();
      other.stop(true);
    }
  });

  test('a proxy that names neither http nor https as the scheme: the cookie goes by the connection\'s, under a name a browser keeps', async () => {
    await turnOn();
    for (const proto of ['ws', 'https;evil=1', 'HTTP ', '']) {
      const res = await viaTailnet(`/pair?code=${(await pairing()).code}`, { 'x-forwarded-proto': proto });
      expect(res.status).toBe(303);
      expect(cookieOf(res)).toStartWith('seismic-device-http.');
      expect(res.headers.get('set-cookie')).not.toContain('Secure');
    }
  });

  describe('POST /api/pair', () => {
    /** The desktop app's shell: no cookies, no browser headers. */
    const shellPairs = (code: unknown, headers: Record<string, string> = {}) =>
      viaTailnet('/api/pair', { 'content-type': 'application/json', 'user-agent': 'Seismic desktop', ...headers }, { method: 'POST', body: JSON.stringify({ code }) });
    const linkOf = async (res: Response) => {
      const { url } = (await res.json()) as { url: string };
      const at = new URL(url);
      return `${at.pathname}${at.search}`;
    };

    test.each(['link', 'code'])('overlapping first pairings by %s keep the newest enrollment when the old answer arrives last', async (method) => {
      await turnOn();
      const { jar, keep, header } = jarOf();
      const firstPair = async () => {
        const { code } = await pairing();
        return viaTailnet(method === 'link' ? await linkOf(await shellPairs(code)) : `/pair?code=${code}`, { cookie: header() });
      };
      const older = await firstPair();
      const newer = await firstPair();
      expect(older.status).toBe(303);
      expect(newer.status).toBe(303);
      const [oldDevice, newDevice] = (await view()).devices;
      expect(oldDevice!.pairedAt).toBe(newDevice!.pairedAt);
      const deviceFor = (cookie: string) => access.device(new Request(`https://${NAME}/`, { headers: { cookie } }))?.id;
      keep(newer);
      expect(deviceFor(header())).toBe(newDevice!.id);
      keep(older);
      expect(jar.size).toBe(2);
      expect(deviceFor(header())).toBe(newDevice!.id);
      expect(deviceFor(`${cookieOf(older)}; ${cookieOf(newer)}`)).toBe(newDevice!.id);
      keep(await viaTailnet(`/pair?code=${(await pairing()).code}`, { cookie: header() }));
      expect(jar.size).toBe(1);
      expect(deviceFor(header())).toBe(newDevice!.id);
    });

    test('a used renewal link for another device cannot replace the selected device’s cookies', async () => {
      await turnOn();
      const older = cookieOf(await viaTailnet(await linkOf(await shellPairs((await pairing()).code))));
      const newer = cookieOf(await viaTailnet(await linkOf(await shellPairs((await pairing()).code))));
      const link = await linkOf(await shellPairs((await pairing()).code));
      const lost = await viaTailnet(link, { cookie: older });
      expect(lost.status).toBe(303);
      const replay = await viaTailnet(link, { cookie: `${older}; ${newer}` });
      expect(replay.status).toBe(401);
      expect(replay.headers.getSetCookie()).toEqual([]);
      expect((await viaTailnet(link, { cookie: older })).headers.getSetCookie()).toEqual(lost.headers.getSetCookie());
    });

    test('an older first pairing beside a retired cookie does not block recovering the newer device', async () => {
      await turnOn();
      const link = async () => linkOf(await shellPairs((await pairing()).code));
      const older = cookieOf(await viaTailnet(await link()));
      const newer = cookieOf(await viaTailnet(await link()));
      const first = cookieOf(await viaTailnet(await link(), { cookie: newer }));
      const current = cookieOf(await viaTailnet(await link(), { cookie: first }));
      expect((await viaTailnet('/api/projects', { cookie: current })).status).toBe(200);

      const renewal = await link();
      const cookies = `${older}; ${newer}`;
      const response = await viaTailnet(renewal, { cookie: cookies });
      const recovered = await viaTailnet(renewal, { cookie: cookies });
      expect(recovered.status).toBe(303);
      expect(recovered.headers.getSetCookie()).toEqual(response.headers.getSetCookie());
      expect(access.device(new Request(`https://${NAME}/`, { headers: { cookie: cookieOf(recovered) } }))?.id)
        .toBe((await view()).devices.at(-1)?.id);
    });

    test('the right code buys a one-time link that pairs the window opening it, and the code is spent', async () => {
      await turnOn();
      const p = await pairing();
      const res = await shellPairs(p.code);
      expect(res.status).toBe(200);
      const body = (await res.clone().json()) as { url: string; expires: string };
      expect(body.url).toMatch(new RegExp(`^https://${NAME.replace(/\./g, '\\.')}/pair\\?token=[\\w-]{43}$`));
      expect(Date.parse(body.expires) - clock).toBe(LINK_MS);
      const link = await linkOf(res);
      // nothing paired yet: the shell holds a link, no cookie
      expect(res.headers.get('set-cookie')).toBeNull();
      expect((await view()).devices).toEqual([]);
      // the code is spent: neither the shell nor the QR code's address pairs with it again
      expect(await (await shellPairs(p.code)).json()).toMatchObject({ code: 'codeExpired' });
      expect((await viaTailnet(`/pair?code=${p.code}`)).status).toBe(401);
      // the window opens the link: its own cookie, named for this address, and on to the project
      const opened = await viaTailnet(link);
      expect(opened.status).toBe(303);
      expect(opened.headers.get('location')).toBe('/');
      expect(opened.headers.get('set-cookie')).toContain('HttpOnly');
      const cookie = cookieOf(opened);
      expect(cookie).toStartWith('seismic-device-https.');
      expect((await viaTailnet('/api/projects', { cookie })).status).toBe(200);
      const v = await view();
      expect(v.devices.map((d) => d.name)).toEqual(['iPhone · Safari']);
      expect(v.pairing?.paired?.name).toBe('iPhone · Safari');
      // the link pairs once; opened again in the browser it paired, it leads to the project
      expect((await viaTailnet(link)).status).toBe(401);
      const reopened = await viaTailnet(link, { cookie });
      expect(reopened.status).toBe(303);
      expect(reopened.headers.get('set-cookie')).toBeNull();
      expect((await view()).devices).toHaveLength(1);
    });

    test('a wrong code says so and spends a try, five spend the code; an old one has expired, and so has a link not opened within a minute', async () => {
      await turnOn();
      expect(await (await shellPairs('123456')).json()).toMatchObject({ code: 'codeExpired' });
      const p = await pairing();
      const wrong = p.code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 4; i++) {
        const res = await shellPairs(wrong);
        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({ code: 'wrongCode' });
      }
      expect((await shellPairs(wrong)).status).toBe(401);
      expect((await shellPairs(p.code)).status).toBe(410);
      const late = await pairing();
      clock += PAIRING_MS + 1;
      expect(await (await shellPairs(late.code)).json()).toMatchObject({ code: 'codeExpired' });
      const link = await linkOf(await shellPairs((await pairing()).code));
      clock += LINK_MS + 1;
      expect((await viaTailnet(link)).status).toBe(401);
      expect((await view()).devices).toEqual([]);
    });

    test('only JSON from a program at another address: not a form, not a page of another site, not this machine', async () => {
      await turnOn();
      const p = await pairing();
      expect((await viaTailnet('/api/pair', { 'content-type': 'text/plain' }, { method: 'POST', body: JSON.stringify({ code: p.code }) })).status).toBe(400);
      expect((await viaTailnet('/api/pair', { 'content-type': 'application/x-www-form-urlencoded' }, { method: 'POST', body: `code=${p.code}` })).status).toBe(400);
      expect((await shellPairs(Number(p.code))).status).toBe(400);
      expect((await shellPairs(p.code, { 'content-type': 'Application/JSON-extra' })).status).toBe(400);
      expect((await shellPairs(p.code, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' })).status).toBe(403);
      const here = await fetch(new URL('/api/pair', server.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: p.code }) });
      expect(here.status).toBe(409);
      expect(await here.json()).toMatchObject({ code: 'onThisMachine' });
      // none of that spent the code
      expect((await shellPairs(p.code)).status).toBe(200);
    });

    test.each(['Application/JSON', 'application/Json; charset=UTF-8'])('a JSON media type labeled %s can be traded for a working link', async (mediaType) => {
      await turnOn();
      const code = (await pairing()).code;
      const traded = await shellPairs(code, { 'content-type': mediaType });
      expect(traded.status).toBe(200);
      const opened = await viaTailnet(await linkOf(traded));
      expect(opened.status).toBe(303);
      expect((await viaTailnet('/api/projects', { cookie: cookieOf(opened) })).status).toBe(200);
    });

    test('"Pair again" with a fresh code: a window already paired keeps its device entry and gets a new credential', async () => {
      await turnOn();
      const cookie = cookieOf(await viaTailnet(await linkOf(await shellPairs((await pairing()).code))));
      const id = (await view()).devices[0]!.id;
      const again = await viaTailnet(await linkOf(await shellPairs((await pairing()).code)), { cookie });
      expect(again.status).toBe(303);
      const renewed = cookieOf(again);
      expect(renewed).toMatch(/^seismic-device-https\.[0-9a-f]{24}=/);
      expect((await viaTailnet('/api/projects', { cookie: renewed })).status).toBe(200);
      expect((await viaTailnet('/api/projects', { cookie })).status).toBe(401);
      expect((await view()).devices.map((d) => d.id)).toEqual([id]);
    });

    test('a "Pair again" link that expired before the window opened it says so, though the old cookie still lets the browser in', async () => {
      await turnOn();
      const first = await linkOf(await shellPairs((await pairing()).code));
      const cookie = cookieOf(await viaTailnet(first));
      const late = await linkOf(await shellPairs((await pairing()).code));
      clock += LINK_MS + 1;
      const opened = await viaTailnet(late, { cookie });
      expect(opened.status).toBe(401);
      expect(await opened.text()).toContain('wrong or has expired');
      // an unknown token too; only the link this browser was paired by leads on to the project
      expect((await viaTailnet('/pair?token=nothing-of-ours', { cookie })).status).toBe(401);
      expect((await viaTailnet(first, { cookie })).status).toBe(303);
      expect((await viaTailnet('/api/projects', { cookie })).status).toBe(200);
    });

    test('a code traded for a link goes from "Connect a phone" once the link has expired unused, and a new code comes', async () => {
      await turnOn();
      const p = await pairing();
      expect((await shellPairs(p.code)).status).toBe(200);
      // while the link holds, the dialog says the desktop app took the code, until the link expires
      expect((await view()).pairing).toMatchObject({ linked: true, expires: new Date(clock + LINK_MS).toISOString() });
      expect((await view()).pairing?.paired).toBeUndefined();
      clock += LINK_MS + 1;
      expect((await view()).pairing).toBeNull();
      expect((await pairing()).code).toMatch(/^\d{6}$/);
      // a link that was used keeps the dialog's "connected" as long as the code would have held
      const q = await pairing();
      await viaTailnet(await linkOf(await shellPairs(q.code)));
      clock += LINK_MS + 1;
      expect((await view()).pairing?.paired?.name).toBe('iPhone · Safari');
    });

    test('a code traded in its last minute stays in "Connect a phone" as long as its link holds, and the dialog then says the device connected', async () => {
      await turnOn();
      const p = await pairing();
      clock += PAIRING_MS - 10_000;
      const link = await linkOf(await shellPairs(p.code));
      // past the code's own deadline, the link still holds: the dialog keeps the code and asks for no new one
      clock += 30_000;
      expect((await view()).pairing?.code).toBe(p.code);
      expect((await view()).pairing?.linked).toBe(true);
      expect((await viaTailnet(link)).status).toBe(303);
      expect((await view()).pairing?.paired?.name).toBe('iPhone · Safari');
      expect((await view()).pairing?.linked).toBeUndefined();
      clock += LINK_MS;
      expect((await view()).pairing).toBeNull();
    });

    test('a used link leads its browser on to the project for a day, whatever other links come and go', async () => {
      await turnOn();
      const link = await linkOf(await shellPairs((await pairing()).code));
      clock += 30_000;
      const cookie = cookieOf(await viaTailnet(link));
      // a day from when it was used, not from when it was made
      clock += 24 * 3600_000 - 1;
      expect((await viaTailnet(link, { cookie })).status).toBe(303);
      clock += 1;
      // past the day, without any other pairing in between to clear it out
      expect((await viaTailnet(link, { cookie })).status).toBe(401);
      expect((await viaTailnet('/api/projects', { cookie })).status).toBe(200);
    });

    test('a link is built only on an address that is one of Seismic\'s as a whole, and the code is not spent otherwise', async () => {
      await turnOn();
      const p = await pairing();
      for (const host of [`${NAME}@evil.example`, `${NAME}:8443@evil.example`, `${NAME}/path`, `${NAME}:99999`, `${NAME}:x`, `${NAME}\\evil.example`]) {
        const res = await shellPairs(p.code, { host, 'x-forwarded-host': host });
        expect([400, 421]).toContain(res.status);
      }
      const ok = await shellPairs(p.code, { host: `${NAME}:8443`, 'x-forwarded-host': `${NAME}:8443` });
      expect(ok.status).toBe(200);
      expect(new URL(((await ok.json()) as { url: string }).url).host).toBe(`${NAME}:8443`);
    });

    test('a link stays usable when pairing the browser fails to write the device', async () => {
      await turnOn();
      const link = await linkOf(await shellPairs((await pairing()).code));
      const add = store.devices.add.bind(store.devices);
      store.devices.add = () => {
        throw new Error('disk full');
      };
      try {
        // straight to the route, as the server would hand it on: a throw there would end the test's server
        const from = { requestIP: () => ({ address: '100.64.0.7' }), port: server.port } as unknown as Bun.Server<unknown>;
        const req = new Request(new URL(link, server.url), { headers: { host: NAME, 'x-forwarded-for': '100.64.0.7', 'x-forwarded-host': NAME, 'x-forwarded-proto': 'https', 'user-agent': IPHONE } });
        await expect(access.pairRoute(req, from)).rejects.toThrow('disk full');
      } finally {
        store.devices.add = add;
      }
      const opened = await viaTailnet(link);
      expect(opened.status).toBe(303);
      expect((await viaTailnet('/api/projects', { cookie: cookieOf(opened) })).status).toBe(200);
    });

    test('two Seismics on one host, each paired through the shell, the links opened in one cookie jar: each keeps its own pairing', async () => {
      // this test's Seismic and another beside it, both behind the owner's proxy at NAME, on ports 8443 and 9443
      await turnOn({ via: 'hosts', hosts: [NAME] });
      const home = join(dir, 'other');
      mkdirSync(home);
      const otherStore = new Store(':memory:');
      const otherAccess = new Access({ store: otherStore, home, tailscale: new Tailscale(fakeTailscale(join(dir, 'other-ts'))), now: () => clock });
      const otherProject = new ProjectRuntime({ repos: [{ path: join(dir, 'main') }] }, { store: otherStore, home, runtime: undefined as never, forge: noForge });
      const other = serve([otherProject], { transcriber: { transcribe: async () => ({ text: '', doubtful: false }) } }, 0, false, undefined, undefined, undefined, undefined, undefined, undefined, otherAccess);
      try {
        const otherLocal = (path: string, init: RequestInit = {}) => asOwner(() => other).fetch(new URL(path, other.url), init);
        await otherLocal('/api/access', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ remote: { via: 'hosts', hosts: [NAME] } }) });
        const seismics = {
          [`${NAME}:8443`]: { server, code: async () => (await pairing()).code, devices: async () => (await view()).devices },
          [`${NAME}:9443`]: {
            server: other,
            code: async () => ((await (await otherLocal('/api/access/pair', { method: 'POST' })).json()) as Pairing).code,
            devices: async () => ((await (await otherLocal('/api/access')).json()) as AccessView).devices,
          },
        };
        type At = keyof typeof seismics;
        const [a, b] = Object.keys(seismics) as [At, At];
        const to = (at: At, path: string, headers: Record<string, string>, init: RequestInit = {}) =>
          fetch(new URL(path, seismics[at].server.url), { redirect: 'manual', ...init, headers: { host: at, 'x-forwarded-for': '100.64.0.7', 'x-forwarded-host': at, 'x-forwarded-proto': 'https', ...headers } });

        // the webview's one jar for NAME, whatever the port: what each answer sets, sent along to both
        // every cookie each answer sets or unsets, as a browser keeps them
        const { jar, keep, header: cookies } = jarOf();
        const window = async (at: At, path: string) => keep(await to(at, path, { 'user-agent': IPHONE, cookie: cookies() }));
        const pairThroughShell = async (at: At) => {
          const res = await to(at, '/api/pair', { 'content-type': 'application/json' }, { method: 'POST', body: JSON.stringify({ code: await seismics[at].code() }) });
          expect(res.status).toBe(200);
          const { url } = (await res.json()) as { url: string };
          expect(new URL(url).host).toBe(at);
          expect((await window(at, `${new URL(url).pathname}${new URL(url).search}`)).status).toBe(303);
        };

        await pairThroughShell(a);
        await pairThroughShell(b);
        const [aCookie, bCookie] = [...jar.keys()] as [string, string];
        expect(aCookie).toMatch(/^seismic-device-https-8443\.[0-9a-f]{24}$/);
        expect(bCookie).toMatch(/^seismic-device-https-9443\.[0-9a-f]{24}$/);
        expect((await window(a, '/api/projects')).status).toBe(200);
        expect((await window(b, '/api/projects')).status).toBe(200);
        // each Seismic turns away the other one's cookie when it is all the jar sends
        expect((await to(a, '/api/projects', { cookie: `${bCookie}=${jar.get(bCookie)}` })).status).toBe(401);
        expect((await to(b, '/api/projects', { cookie: `${aCookie}=${jar.get(aCookie)}` })).status).toBe(401);
        // pairing the first again keeps its own device under a new cookie, unsets its old one, and leaves the second's be
        const before = jar.get(bCookie);
        await pairThroughShell(a);
        expect(jar.get(bCookie)).toBe(before);
        expect([...jar.keys()].sort()).toEqual([expect.stringMatching(/^seismic-device-https-8443\.[0-9a-f]{24}$/), bCookie]);
        expect(jar.has(aCookie)).toBe(false);
        // and again: still each one cookie, the other Seismic's untouched
        await pairThroughShell(a);
        expect([...jar.keys()].filter((n) => n.startsWith('seismic-device-https-8443'))).toHaveLength(1);
        expect(jar.get(bCookie)).toBe(before);
        expect((await window(a, '/api/projects')).status).toBe(200);
        expect((await window(b, '/api/projects')).status).toBe(200);
        expect(await seismics[a].devices()).toHaveLength(1);
        expect(await seismics[b].devices()).toHaveLength(1);
      } finally {
        otherAccess.stop();
        other.stop(true);
      }
    });
  });

  test('a code typed into the page pairs too; a wrong one says so, and five spend it', async () => {
    await turnOn();
    const p = await pairing();
    const typed = (code: string) =>
      viaTailnet('/pair', { origin: `https://${NAME}`, 'content-type': 'application/x-www-form-urlencoded' }, { method: 'POST', body: `code=${encodeURIComponent(code)}` });
    const wrong = await typed('000000' === p.code ? '111111' : '000000');
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain('This code is wrong or has expired');
    expect((await typed(`${p.code.slice(0, 3)} ${p.code.slice(3)}`)).status).toBe(303);
    const q = await pairing();
    const other = q.code === '999999' ? '888888' : '999999';
    // another site sending the browser here with wrong codes spends none of the tries
    const link = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
    for (let i = 0; i < 5; i++) expect((await viaTailnet(`/pair?code=${other}`, link)).status).toBe(401);
    for (let i = 0; i < 4; i++) await typed(other);
    expect((await typed(q.code)).status).toBe(303);
    const s = await pairing();
    for (let i = 0; i < 5; i++) await typed(s.code === '999999' ? '888888' : '999999');
    expect((await typed(s.code)).status).toBe(401);
  });

  test('a code holds five minutes; a device unused for 90 days is no longer paired', async () => {
    await turnOn();
    const p = await pairing();
    clock += PAIRING_MS + 1;
    expect((await viaTailnet(`/pair?code=${p.code}`)).status).toBe(401);
    expect((await view()).pairing).toBeNull();
    const cookie = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`));
    clock += UNUSED_MS - 1000;
    expect((await viaTailnet('/', { cookie })).status).toBe(200);
    // used just now: the 90 days count from here
    clock += UNUSED_MS - 1000;
    expect((await viaTailnet('/', { cookie })).status).toBe(200);
    clock += UNUSED_MS + 1;
    expect((await viaTailnet('/', { cookie })).status).toBe(401);
  });

  test('a paired phone may not pair others, remove devices or change the setting', async () => {
    await turnOn();
    const cookie = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`));
    const own = { cookie, origin: `https://${NAME}`, 'content-type': 'application/json' };
    expect(await (await viaTailnet('/api/access', { cookie })).json()).toEqual({ local: false });
    expect((await viaTailnet('/api/access/pair', own, { method: 'POST' })).status).toBe(403);
    expect((await viaTailnet('/api/access', own, { method: 'PUT', body: JSON.stringify({ remote: null }) })).status).toBe(403);
    const id = (await view()).devices[0]!.id;
    expect((await viaTailnet(`/api/access/devices/${id}`, own, { method: 'DELETE' })).status).toBe(403);
    // another site in the phone's browser gets nothing either
    expect((await viaTailnet('/api/c/main/cards', { ...own, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, { method: 'POST', body: '{}' })).status).toBe(403);
    // nor does the page over plain HTTP under the same name
    expect((await viaTailnet('/api/c/main/cards', { ...own, origin: `http://${NAME}` }, { method: 'POST', body: '{}' })).status).toBe(403);
  });
});

describe('push', () => {
  /** A subscription as a phone's browser makes it. */
  const subscription = async () => {
    const keys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    return { endpoint: 'https://web.push.apple.com/QGx', keys: { p256dh: b64u(await crypto.subtle.exportKey('raw', keys.publicKey)), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } };
  };

  test("the manifest's icons and the service worker need no pairing and no key", async () => {
    await turnOn();
    for (const path of ['/icons/180.png', '/icons/512.png', '/sw.js']) {
      expect((await viaTailnet(path)).status).toBe(200);
      expect((await fetch(new URL(path, server.url))).status).toBe(200);
    }
    expect(await (await viaTailnet('/sw.js')).text()).toContain("addEventListener(\"push\"");
    // the rest still does
    expect((await viaTailnet('/api/push')).status).toBe(401);
  });

  test('a paired phone turns notifications on; a card that starts waiting is pushed to it, even while the owner uses a page here', async () => {
    await turnOn();
    const cookie = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`));
    const own = { cookie, origin: `https://${NAME}`, 'content-type': 'application/json' };
    const before = (await (await viaTailnet('/api/push', { cookie })).json()) as { key: string; on: boolean };
    expect(before.on).toBe(false);
    expect(Buffer.from(before.key, 'base64url')).toHaveLength(65);
    expect((await viaTailnet('/api/push', own, { method: 'PUT', body: JSON.stringify(await subscription()) })).status).toBe(204);
    expect(await (await viaTailnet('/api/push', { cookie })).json()).toEqual({ key: before.key, on: true });
    expect((await view()).devices[0]!.push).toBe(true);
    // this machine gets none
    expect(await (await local('/api/push', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(await subscription()) })).json()).toMatchObject({ code: 'onlyDevices' });

    const card = (title: string) => project.board.create({ title, body: '', x: 0, y: 0 }).id;
    const a = card('Login');
    project.board.work(a, { state: 'waiting', need: 'demo' });
    await until(async () => (await push.settled(), pushed.length === 1));
    expect(pushed).toEqual(['https://web.push.apple.com/QGx']);

    // the owner at a page here: the phone still receives what starts waiting
    const page = new (asOwner(() => server).WebSocket)(new URL('/api/c/main/ws', server.url.href.replace('http', 'ws')));
    await new Promise((r) => (page.onopen = r));
    page.send(JSON.stringify({ type: 'here' }));
    page.send(JSON.stringify({ type: 'ping' }));
    await new Promise<void>((resolve) => { page.onmessage = (event) => { if (JSON.parse(String(event.data)).type === 'pong') resolve(); }; });
    project.board.work(card('Export'), { state: 'waiting', need: 'question', detail: JSON.stringify({ question: { text: 'CSV?', options: [] } }) });
    await heard();
    await push.settled();
    expect(pushed).toHaveLength(1);
    pushTimers.shift()!();
    await push.settled();
    expect(pushed).toEqual(['https://web.push.apple.com/QGx', 'https://web.push.apple.com/QGx']);
    page.close();

    // “Remove” takes the subscription with it
    expect(push.subscribed((await view()).devices[0]!.id)).toBe(true);
    await local(`/api/access/devices/${(await view()).devices[0]!.id}`, { method: 'DELETE' });
    expect(store.devices.pushes()).toEqual([]);
  });

  test("the phone's page in view holds pushes off until it goes out of view or closes", async () => {
    await turnOn();
    const cookie = cookieOf(await viaTailnet(`/pair?code=${(await pairing()).code}`));
    const phone = () => opens({ host: NAME, 'x-forwarded-for': '100.64.0.7', 'x-forwarded-proto': 'https', origin: `https://${NAME}`, cookie }).then((ws) => ws!);
    const ws = await phone();
    ws.send(JSON.stringify({ type: 'here' }));
    await until(() => push.onADevice());
    ws.send(JSON.stringify({ type: 'away' }));
    await until(() => !push.onADevice());
    ws.send(JSON.stringify({ type: 'back' }));
    await until(() => push.onADevice());
    // a second page of the phone closing leaves the first holding them off; the last one closing lets go
    const other = await phone();
    other.close();
    await Bun.sleep(50);
    expect(push.onADevice()).toBe(true);
    ws.close();
    await until(() => !push.onADevice());
  });
});

describe('on another address', () => {
  const lan = machineAddresses().find((a) => !a.includes(':'));

  test.skipIf(!lan)("Seismic listens there too, in plain HTTP, and a phone there pairs as through Tailscale", async () => {
    const on = await turnOn({ via: 'address', address: lan });
    expect(on.address).toBe(`http://${lan}:${server.port}`);
    const there = (path: string, headers: Record<string, string> = {}) => fetch(`http://${lan}:${server.port}${path}`, { redirect: 'manual', headers: { 'user-agent': IPHONE, ...headers } });
    expect((await there('/')).status).toBe(401);
    const paired = await there(`/pair?code=${(await pairing()).code}`);
    expect(paired.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(paired.headers.get('set-cookie')).not.toContain('Secure');
    expect((await there('/', { cookie: cookieOf(paired) })).status).toBe(200);
    expect((await turnOn(null)).address).toBeNull();
    expect(await there('/').then(() => 'answered', () => 'gone')).toBe('gone');
  });

  test.skipIf(!lan)('a --lan start prints a link that pairs a browser at the other address; the owner\'s login link signs nothing in there', async () => {
    expect(await access.pairingLink()).toBeNull();
    await turnOn({ via: 'address', address: lan });
    const at = `http://${lan}:${server.port}`;
    const there = (url: string, headers: Record<string, string> = {}, init: RequestInit = {}) => fetch(url, { redirect: 'manual', ...init, headers: { 'user-agent': IPHONE, ...headers } });
    // the owner's key never goes over that plain-HTTP address
    expect((await there(access.owner.link(at))).headers.get('set-cookie')).toBeNull();
    const link = (await access.pairingLink())!;
    expect(link).toStartWith(`${at}/pair?code=`);
    const signed = await there(link);
    expect(signed.status).toBe(303);
    const cookie = cookieOf(signed);
    expect(cookie).toStartWith(`seismic-device-http-${server.port}.`);
    expect((await there(`${at}/api/projects`, { cookie })).status).toBe(200);
    // a paired device: no managing access, and the link pairs only once
    expect((await there(`${at}/api/access/pair`, { cookie, origin: at, 'sec-fetch-site': 'same-origin' }, { method: 'POST' })).status).toBe(403);
    expect((await there(link)).status).toBe(401);
  });

  test('an address that is not this machine’s is refused with a reason', async () => {
    expect((await turnOn({ via: 'address', address: '203.0.113.9' })).problem).toMatchObject({ code: 'listen' });
  });
});

describe('behind a reverse proxy', () => {
  const HOST = 'seismic.example.dev';
  const viaProxy = (path: string, headers: Record<string, string> = {}) =>
    fetch(new URL(path, server.url), { redirect: 'manual', headers: { host: HOST, 'x-forwarded-for': '100.64.0.7', 'x-forwarded-host': HOST, 'x-forwarded-proto': 'https', 'user-agent': IPHONE, ...headers } });

  test('the listed hosts are answered and pair like a tailnet phone, and no tailscale serve entry is made', async () => {
    expect((await viaProxy('/')).status).toBe(421);
    const on = await turnOn({ via: 'hosts', hosts: [HOST.toUpperCase(), 'not a host', HOST] });
    expect(on.remote).toEqual({ via: 'hosts', hosts: [HOST] });
    expect(on.address).toBe(`https://${HOST}`);
    expect((await viaProxy('/')).status).toBe(401);
    const paired = await viaProxy(`/pair?code=${(await pairing()).code}`);
    expect((await viaProxy('/', { cookie: cookieOf(paired) })).status).toBe(200);
    expect(existsSync(join(ts, 'calls')) && readFileSync(join(ts, 'calls'), 'utf8')).not.toContain('serve');
    expect((await viaProxy('/', { 'x-forwarded-host': 'evil.example' })).status).toBe(421);
    expect((await turnOn(null)).address).toBeNull();
    expect((await viaProxy('/')).status).toBe(421);
  });
});

test('a device is named by its browser', () => {
  expect(deviceName(IPHONE)).toBe('iPhone · Safari');
  expect(deviceName('Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36')).toBe('Android · Chrome');
  expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · Chrome');
});
