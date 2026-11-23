// Checks the app's remote workspaces (docs/plan/remote-workspaces.md, desktop/src/desks/) in the
// webview of this machine, against a second Seismic that counts as remote: a proxy in front of it
// forwards as `tailscale serve` does, so it answers the shell as another machine would.
//
//   bun scripts/check-app-desks.ts <the app's program> [--keep]
//
// The program: a build from scripts/build-app.ts, or a debug build of the shell, which runs this
// checkout's server. On a Mac it has to be an app bundle: WKWebView keeps the cookies of a bare
// program for its run alone, so a pairing would not outlast the relaunch. In desktop/:
//   bun x tauri build --debug --bundles app --config '{"identifier":"im.seismic.desks-check","bundle":{"externalBin":null,"resources":null}}'
// then target/debug/bundle/macos/Seismic.app/Contents/MacOS/seismic. It checks:
//   - this machine's page lists the workspaces and pairs one over HTTP: a bad address, a wrong code
//     and an address already on the list are refused, the right code opens the workspace's window at
//     its one-time link, signed in, the list and the page's name follow;
//   - the remote page lists the workspaces and gets the microphone, but cannot change the list, and a
//     sandboxed frame of it gets no microphone;
//   - across two relaunches the offline workspace keeps its status page, whose Try again
//     takes it to the workspace once it answers, still signed in;
//   - removing the workspace closes its window.
// The page reports through SEISMIC_APP_CHECK (desktop/src/window/), which imports this script's
// module into each window's own page and a remote window's status page. This machine's page runs the
// shell commands the script sends it (`/todo`). Prints one line per check; exits 1 when one failed.

import { type Subprocess } from 'bun';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ownerHeaders } from '../src/server/owner';
import { bad, check, exited, expect, failed, sleep, until } from './check-harness';

const args = process.argv.slice(2);
const programArg = args.find((a) => !a.startsWith('--'));
if (!programArg) {
  console.error("usage: bun scripts/check-app-desks.ts <the app's program> [--keep]");
  process.exit(2);
}
const program = resolve(programArg);
const ROOT = resolve(import.meta.dir, '..');

const dir = mkdtempSync(join(tmpdir(), 'seismic-desks-check-'));
const [home, remoteHome] = [join(dir, 'home'), join(dir, 'remote-home')];
mkdirSync(home);
mkdirSync(remoteHome);

// ---------------------------------------------------------------- the remote Seismic, behind a proxy
const free = () => {
  const s = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = s.port!;
  s.stop(true);
  return port;
};
const remotePort = free();
const remoteUrl = `http://127.0.0.1:${remotePort}`;
const remote = Bun.spawn(['bun', join(ROOT, 'src', 'server', 'main.ts'), '--port', String(remotePort)], {
  env: Object.fromEntries(Object.entries({ ...process.env, SEISMIC_HOME: remoteHome }).filter(([k]) => !/^(SEISMIC|OBEYA)_SUPERVISED$/.test(k))) as Record<string, string>,
  stdout: 'ignore',
  stderr: 'ignore',
});
const asOwner = (path: string, init: RequestInit = {}) => fetch(`${remoteUrl}${path}`, { ...init, headers: { ...ownerHeaders(remoteHome), 'content-type': 'application/json', ...init.headers } });

// Localhost is a secure context for media capture. Forwarded headers make this a remote
// device to the server, even though the webview and both servers are on the same machine.
const proxy: { server?: ReturnType<typeof Bun.serve> } = {};
const HOST = 'localhost';
const proxyPort = free();
const REMOTE = `http://${HOST}:${proxyPort}`;
const FRAME = `<!doctype html>
<script>
  const report = (result) => parent.postMessage({ origin: self.origin, result }, '*');
  (async () => {
    if (!navigator.mediaDevices?.getUserMedia) return report('unavailable');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      report('granted');
    } catch (error) {
      report(error.name);
    }
  })();
</script>`;
let onHealth: (() => Promise<void>) | undefined;
const startProxy = () => {
  proxy.server = Bun.serve({
    port: proxyPort,
    hostname: HOST,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/__seismic-check-frame') return new Response(FRAME, { headers: { 'content-type': 'text/html' } });
      if (url.pathname === '/api/projects' && req.headers.get('user-agent')?.startsWith('ureq/')) await onHealth?.();
      const headers = new Headers(req.headers);
      headers.set('x-forwarded-for', '100.64.0.7');
      headers.set('x-forwarded-host', `${HOST}:${proxyPort}`);
      headers.set('x-forwarded-proto', 'http');
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
      const res = await fetch(`${remoteUrl}${url.pathname}${url.search}`, { method: req.method, headers, body, redirect: 'manual' });
      // fetch has decoded the body already
      const back = new Headers(res.headers);
      back.delete('content-encoding');
      back.delete('content-length');
      return new Response(res.body, { status: res.status, headers: back });
    },
  });
};
const code = async () => ((await (await asOwner('/api/access/pair', { method: 'POST' })).json()) as { code: string }).code;

// ---------------------------------------------------------------- what the pages run, and where they report
type Done = { id: number; ok: boolean; value?: unknown; error?: string };
const todo: { id: number; cmd: string; args?: unknown }[] = [];
const done = new Map<number, Done>();
const reports: Record<string, unknown>[] = [];
let retryNow = false;
const MODULE = `
const base = new URL('.', import.meta.url);
const post = (path, body) => fetch(new URL(path, base), { method: 'POST', body: JSON.stringify(body) });
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
const outcome = (p) => p.then((value) => ({ ok: true, value }), (e) => ({ ok: false, error: String(e) }));
if (location.origin === ${JSON.stringify(REMOTE)}) {
  const out = { kind: 'remote', href: location.href };
  out.desks = await outcome(invoke('desks'));
  out.add = await outcome(invoke('add_desk', { address: 'https://elsewhere.example', code: '123456' }));
  out.rename = await outcome(invoke('rename_desk', { id: 'local', name: 'Taken over' }));
  out.remove = await outcome(invoke('remove_desk', { id: 'local' }));
  out.projects = (await fetch('/api/projects')).status;
  await post('result', out);
  const mic = { kind: 'remoteMic', secure: isSecureContext };
  mic.mic = await outcome(Promise.race([
    Promise.resolve().then(() => navigator.mediaDevices.getUserMedia({ audio: true }))
      .then((s) => (s.getTracks().forEach((t) => t.stop()), 'granted')),
    new Promise((_, no) => setTimeout(() => no(new Error('no answer in 8 s')), 8000)),
  ]));
  // A sandboxed frame reports its effective origin and the outcome of its capture attempt.
  mic.frameMic = await new Promise((done) => {
    const f = document.createElement('iframe');
    f.sandbox = 'allow-scripts';
    f.allow = 'microphone';
    f.src = '/__seismic-check-frame';
    addEventListener('message', (e) => { if (e.source === f.contentWindow) done(e.data); });
    setTimeout(() => done(null), 8000);
    document.body.append(f);
  });
  await post('result', mic);
} else if (location.pathname.endsWith('/status.html')) {
  await new Promise((r) => setTimeout(r, 500));
  await post('result', { kind: 'status', title: document.getElementById('title').textContent, why: document.getElementById('why').textContent, desks: await outcome(invoke('desks')) });
  for (;;) {
    if ((await (await fetch(new URL('retry', base))).json()).now) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  document.getElementById('retry').click();
} else if (location.protocol === 'http:') {
  await post('result', { kind: 'local', href: location.href });
  for (;;) {
    const next = await (await fetch(new URL('todo', base))).json();
    if (next) await post('done', { id: next.id, ...(await outcome(invoke(next.cmd, next.args))) });
    else await new Promise((r) => setTimeout(r, 200));
  }
}
`;
const harness = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const cors = { 'access-control-allow-origin': '*' };
    const path = new URL(req.url).pathname;
    const json = (v: unknown) => Response.json(v, { headers: cors });
    if (path === '/check.js') return new Response(MODULE, { headers: { ...cors, 'content-type': 'text/javascript' } });
    if (path === '/todo') return json(todo.shift() ?? null);
    if (path === '/retry') return json({ now: retryNow });
    if (req.method === 'POST' && path === '/result') reports.push(JSON.parse(await req.text()));
    if (req.method === 'POST' && path === '/done') {
      const d = JSON.parse(await req.text()) as Done;
      done.set(d.id, d);
    }
    return new Response(null, { status: 204, headers: cors });
  },
});

let n = 0;
/** Runs a shell command as this machine's page: its outcome. */
const run = async (cmd: string, args?: Record<string, unknown>) => {
  const id = ++n;
  todo.push({ id, cmd, args });
  return until(`${cmd} to answer`, 30_000, () => done.get(id));
};
const report = (kind: string, after = 0) => until(`the ${kind} page to report`, 60_000, () => reports.slice(after).find((r) => r.kind === kind));
type Desks = { current: string | null; problem: string | null; list: { id: string; name: string; origin: string | null; local: boolean; open: boolean }[] };
const desks = async () => (await run('desks')).value as Desks;

const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  SEISMIC_HOME: home,
  SEISMIC_APP_CHECK: `${harness.url.href}check.js`,
  // WebKit's mock microphone on a Mac without one (desktop/src/window/microphone/macos.rs)
  SEISMIC_APP_CHECK_FAKE_MIC: '1',
  ...(process.platform === 'win32' ? { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--use-fake-device-for-media-stream' } : {}),
  SEISMIC_PORT: String(4600 + Math.floor(Math.random() * 300)),
  // the debug shell runs this checkout's server
  SEISMIC_CHECKOUT: ROOT,
  SEISMIC_BUN: process.execPath,
};
delete env.SEISMIC_SUPERVISED;
delete env.OBEYA_SUPERVISED;
const entry = () => {
  try {
    return JSON.parse(readFileSync(join(home, 'server.json'), 'utf8')) as { url: string };
  } catch {
    return null;
  }
};
const startApp = () => Bun.spawn([program], { env, stdout: 'ignore', stderr: 'ignore' });
const appApi = async (path: string, body?: object) => {
  const e = entry();
  if (!e) return;
  return fetch(`${e.url}${path}`, {
    method: 'POST',
    headers: { ...ownerHeaders(home), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};
const relaunch = async () => {
  const res = await appApi('/api/app-update', { rebuilt: true }).catch((error) => {
    // The server can finish shutting down before it sends the response. The next shell must report.
    if (error.code !== 'ECONNRESET') throw error;
    return null;
  });
  expect(res === null || (res?.ok && (await res.json()).updating), 'the shell update did not start');
};

/** Relaunches with the proxy holding the shell's first health request open. */
const withPendingHealth = async (action: () => Promise<void>) => {
  const pending = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  onHealth = () => {
    pending.resolve();
    return release.promise;
  };
  const before = reports.length;
  try {
    await relaunch();
    await report('local', before);
    await Promise.race([pending.promise, sleep(10_000).then(() => { throw new Error('no health request'); })]);
    await action();
  } finally {
    onHealth = undefined;
    release.resolve();
  }
  // A stale open would load a remote or status page as soon as its check comes back.
  const halfway = reports.length;
  await sleep(2000);
  expect(!reports.slice(halfway).some((r) => r.kind === 'remote' || r.kind === 'status'), 'a stale health check opened another page');
};

let app: Subprocess | undefined;
try {
  await until('the remote Seismic to answer', 60_000, async () => (await fetch(`${remoteUrl}/api/projects`, { headers: ownerHeaders(remoteHome) }).catch(() => null))?.ok);
  const on = await asOwner('/api/access', { method: 'PUT', body: JSON.stringify({ remote: { via: 'hosts', hosts: [HOST] } }) });
  expect(on.ok, `the remote's access: ${on.status} ${await on.text()}`);
  startProxy();

  // ---------------------------------------------------------------- pairing from this machine's page
  app = startApp();
  await report('local').catch((e) => bad("this machine's page", String(e.message)));
  let id = '';
  await check('this machine has its own workspace and nothing else', async () => {
    const d = await desks();
    expect(d.current === 'local' && d.list.length === 1 && d.list[0]!.local, JSON.stringify(d));
    return d.list[0]!.name;
  });
  await check('an address of no Seismic is refused', async () => {
    const r = await run('add_desk', { address: 'ftp://studio', code: '123456' });
    expect(!r.ok && r.error === 'address', JSON.stringify(r));
  });
  await check('a wrong code is refused, and no window opens', async () => {
    const right = await code();
    const r = await run('add_desk', { address: REMOTE, code: right === '000000' ? '000001' : '000000' });
    expect(!r.ok && r.error === 'wrongCode', JSON.stringify(r));
    expect((await desks()).list.length === 1, 'the list grew');
  });
  await check('the right code pairs, and the workspace opens in a window of its own', async () => {
    const r = await run('add_desk', { address: REMOTE, code: await code(), name: 'Studio' });
    expect(r.ok, JSON.stringify(r));
    id = (r.value as { id: string }).id;
    const d = await until('the window to open', 20_000, async () => (await desks()).list.find((w) => w.id === id && w.open));
    return `${d.name} at ${d.origin}`;
  });
  const first = (await report('remote').catch((e) => (bad('the remote page', String(e.message)), null))) as Record<string, { ok: boolean; value?: unknown; error?: string }> | null;
  if (first) {
    await check("the remote window shows the workspace's own project, signed in by the one-time link", () => {
      expect(String(first.href).startsWith(`${REMOTE}/`) && !String(first.href).includes('/pair'), String(first.href));
      expect((first.projects as unknown as number) === 200, `GET /api/projects: ${first.projects}`);
      return String(first.href);
    });
    await check('the remote page lists the workspaces, its own as the current one', () => {
      const d = first.desks!.value as Desks;
      expect(first.desks!.ok && d.current === id && d.list.length === 2, JSON.stringify(first.desks));
    });
    await check('the remote page cannot change the list', () => {
      for (const k of ['add', 'rename', 'remove']) expect(!first[k]!.ok && /not allowed/i.test(first[k]!.error ?? ''), `${k}: ${JSON.stringify(first[k])}`);
      return first.remove!.error;
    });
  }
  const mic = (await report('remoteMic').catch((e) => (bad("the remote page's microphone", String(e.message)), null))) as Record<string, unknown> | null;
  if (mic) {
    await check('the remote page gets the microphone in a secure context', () => {
      expect(mic.secure === true && (mic.mic as { ok: boolean }).ok, JSON.stringify(mic));
    });
    await check('a sandboxed frame of the remote page gets no microphone', () => {
      const frame = mic.frameMic as { origin: string; result: string } | null;
      expect(frame?.origin === 'null' && ['NotAllowedError', 'SecurityError', 'unavailable'].includes(frame.result), JSON.stringify(mic.frameMic));
      return frame!.result;
    });
  }
  await check('a second workspace at the same address is refused', async () => {
    const r = await run('add_desk', { address: `${REMOTE}/`, code: await code() });
    expect(!r.ok && r.error === 'known', JSON.stringify(r));
  });
  await check('renaming shows on the list', async () => {
    const r = await run('rename_desk', { id, name: 'Lab' });
    expect(r.ok, JSON.stringify(r));
    expect((await desks()).list.find((w) => w.id === id)?.name === 'Lab', 'not renamed');
  });

  // ---------------------------------------------------------------- after a relaunch, while the workspace is down
  proxy.server?.stop(true);
  const before = reports.length;
  await relaunch();
  const status = (await report('status', before).catch((e) => (bad('the status page', String(e.message)), null))) as Record<string, unknown> | null;
  if (status) {
    await check('after a relaunch the workspace window comes back; down, it shows the status page', () => {
      expect(/Lab does not answer/.test(String(status.title)), String(status.title));
      expect(String(status.why).includes(REMOTE), String(status.why));
      return `${status.title}: ${status.why}`;
    });
    await check('the status page lists the workspaces to open instead', () => {
      const d = (status.desks as { value: Desks }).value;
      expect(d.current === id && d.problem === 'unreachable' && d.list.length === 2, JSON.stringify(d));
    });
  }
  await check('after a second relaunch the offline workspace still has its window', async () => {
    await report('local', before);
    const beforeSecond = reports.length;
    await relaunch();
    const again = await report('status', beforeSecond);
    const d = (again.desks as { value: Desks }).value;
    expect(d.current === id && d.problem === 'unreachable' && d.list.find((w) => w.id === id)?.open, JSON.stringify(d));
    await report('local', beforeSecond);
    return String(again.title);
  });
  const afterStatus = reports.length;
  startProxy();
  retryNow = true;
  const again = (await report('remote', afterStatus).catch((e) => (bad('Try again', String(e.message)), null))) as Record<string, unknown> | null;
  if (again) {
    await check('Try again takes the window to the workspace, still signed in', () => {
      expect(String(again.href).startsWith(`${REMOTE}/`) && again.projects === 200, `${again.href}, projects ${again.projects}`);
    });
  }
  await check('removing the workspace closes its window', async () => {
    const r = await run('remove_desk', { id });
    expect(r.ok, JSON.stringify(r));
    const d = await desks();
    expect(d.list.length === 1 && d.list[0]!.local, JSON.stringify(d));
    const saved = JSON.parse(readFileSync(join(home, 'app-desks.json'), 'utf8')) as { list: unknown[] };
    expect(saved.list.length === 1, JSON.stringify(saved));
  });
  const added = await run('add_desk', { address: REMOTE, code: await code(), name: 'Lab' });
  expect(added.ok, JSON.stringify(added));
  id = (added.value as { id: string }).id;
  await check('pairing takes over a pending health check and keeps one tracked window', async () => {
    await withPendingHealth(async () => {
      const before = reports.length;
      const opened = await run('open_desk', { id });
      expect(opened.ok, JSON.stringify(opened));
      const paired = await run('pair_desk', { id, code: await code() });
      expect(paired.ok, JSON.stringify(paired));
      const page = await report('remote', before);
      expect(page.projects === 200, JSON.stringify(page));
    });
    expect((await desks()).list.find((w) => w.id === id)?.open, 'the paired window is missing');
  });
  await check('removal cancels an in-flight health check', async () => {
    await withPendingHealth(async () => {
      const removed = await run('remove_desk', { id });
      expect(removed.ok, JSON.stringify(removed));
    });
    expect(!(await desks()).list.some((w) => w.id === id), 'the removed workspace is still listed');
  });
  await check("this machine's workspace stays", async () => {
    const r = await run('remove_desk', { id: 'local' });
    expect(!r.ok && r.error === 'local', JSON.stringify(r));
  });
} finally {
  await appApi('/api/stop').catch(() => null);
  await until('the local server to stop', 30_000, () => !entry()).catch(() => null);
  if (app && app.exitCode === null && (await exited(app, 5_000)) === null) app.kill();
  proxy.server?.stop(true);
  remote.kill();
  harness.stop(true);
  if (!args.includes('--keep')) rmSync(dir, { recursive: true, force: true });
  else console.log(`kept: ${dir}`);
}
process.exit(failed ? 1 : 0);
