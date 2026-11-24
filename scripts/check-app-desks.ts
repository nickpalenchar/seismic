// Checks the app's remote workspaces (docs/plan/remote-workspaces.md, desktop/src/desks/) in the
// webview of this machine, against a second Seismic that counts as remote: a proxy in front of it
// forwards as `tailscale serve` does, so it answers the shell as another machine would.
//
//   bun scripts/check-app-desks.ts <the app's program> [--ipv6] [--legacy-mic] [--debug-failures] [--minimized-takeover] [--keep]
//
// The program: a build from scripts/build-app.ts, or a debug build of the shell, which runs this
// checkout's server. On a Mac it has to be an app bundle: WKWebView keeps the cookies of a bare
// program for its run alone, so a pairing would not outlast the relaunch. In desktop/:
//   bun x tauri build --debug --bundles app --config '{"identifier":"im.seismic.desks-check","bundle":{"externalBin":null,"resources":null}}'
// then target/debug/bundle/macos/Seismic.app/Contents/MacOS/seismic. It checks:
//   - taking over a local server on a new port replaces the local webview and its permissions;
//   - this machine's page lists the workspaces and pairs one over HTTP: a bad address, a wrong code
//     and an address already on the list are refused, the right code opens the workspace's window at
//     its one-time link, signed in, the list and the page's name follow;
//   - the remote page lists the workspaces and gets the microphone, but cannot change the list, and a
//     sandboxed frame of it gets no microphone;
//   - on macOS, the bundled postMessage gate lets a main-frame probe reach the IPC decoder and
//     drops the probes sent from same-origin and sandboxed subframes;
//   - across two relaunches the offline workspace keeps its status page and unsent draft;
//   - another relaunch keeps a workspace with a health check still running;
//   - with --debug-failures, retrying a failed restore recovers the unsent draft;
//   - a signed-out remote page leaves the local update free to finish;
//   - removing the workspace emits the native window's Destroyed event.
// The page reports through SEISMIC_APP_CHECK (desktop/src/window/), which imports this script's
// module into each window's own page and a remote window's status page. This machine's page runs the
// shell commands the script sends it (`/todo`). Prints one line per check; exits 1 when one failed.

import { type Subprocess } from 'bun';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { release, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ownerHeaders } from '../src/server/owner';
import { bad, check, exited, expect, failed, sleep, until } from './check-harness';

const args = process.argv.slice(2);
const programArg = args.find((a) => !a.startsWith('--'));
if (!programArg) {
  console.error("usage: bun scripts/check-app-desks.ts <the app's program> [--ipv6] [--legacy-mic] [--debug-failures] [--minimized-takeover] [--keep]");
  process.exit(2);
}
const program = resolve(programArg);
const ROOT = resolve(import.meta.dir, '..');
const debugFailures = args.includes('--debug-failures');
const minimizedTakeover = args.includes('--minimized-takeover');
// On newer macOS, a debug app can exercise Big Sur's fail-closed path with real WebKit.
const forceLegacyMic = args.includes('--legacy-mic');
const legacyMic = process.platform === 'darwin' && (forceLegacyMic || Number(release().split('.')[0]) <= 20);

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
const useIPv6 = args.includes('--ipv6');
const HOST = useIPv6 ? '[::1]' : 'localhost';
const proxyPort = free();
const oldPort = free();
const REMOTE = `http://${HOST}:${proxyPort}`;
const LAST_PAGE = '/p/lab?view=table#draft';
const PAGE_BEFORE_BACK = '/p/lab?view=canvas#new-anchor';
const OVERFLOW_DRAFT = 'The latest edit lives only in memory. '.repeat(40);
const STALE_CONFIG = '{"name":"Older stored settings"}';
const quotaFixture = join(dir, 'quota.ts');
writeFileSync(quotaFixture, `
  import { snapshotSession } from ${JSON.stringify(join(ROOT, 'src/ui/api'))};
  import { draftSession } from ${JSON.stringify(join(ROOT, 'src/ui/draftSession'))};
  import { keepDrafts, updateDraft } from ${JSON.stringify(join(ROOT, 'src/ui/draft'))};
  import { keepConfigDraft } from ${JSON.stringify(join(ROOT, 'src/ui/configDraft'))};
  export function edit(text) {
    keepDrafts(draftSession, 'quota-check');
    updateDraft('card:q', { text });
    keepConfigDraft(draftSession, 'project:quota-check', { name: text }, { name: 'Saved name' });
    draftSession.setItem('seismic-drafts-check', 'Edited just before Back');
    draftSession.setItem('seismic-wish-check', 'New issue just before Back');
    draftSession.setItem('seismic-config-draft-check', 'New settings just before Back');
    window.seismicSnapshotSession = snapshotSession;
    return sessionStorage.getItem('seismic-drafts-quota-check') === null && draftSession.getItem('seismic-drafts-quota-check') !== null &&
      sessionStorage.getItem('seismic-config-draft-project:quota-check') === ${JSON.stringify(STALE_CONFIG)};
  }
`);
let quotaBundle: Promise<string> | undefined;
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
const IPC_PROBES = { top: 73111801, same: 73111802, sandbox: 73111803 };
const IPC_FRAME = `<!doctype html><script>
  const probe = new URL(location.href).searchParams.get('probe');
  const bridge = window.webkit?.messageHandlers?.ipc;
  let sent = false;
  if (bridge) {
    // A number in place of a command is inert, but it leaves an identifiable decoder error.
    bridge.postMessage(JSON.stringify({ cmd: ${JSON.stringify(IPC_PROBES)}[probe] }));
    sent = true;
  }
  parent.postMessage({ probe, origin: self.origin, sent }, '*');
</script>`;
const IPC_CHECK = `async () => {
  const marks = ${JSON.stringify(IPC_PROBES)};
  const decoded = [];
  const original = console.error;
  console.error = (...args) => {
    for (const [probe, mark] of Object.entries(marks)) {
      if (args.some((value) => String(value).includes(String(mark)))) decoded.push(probe);
    }
    original.apply(console, args);
  };
  const frames = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const probeFrame = (kind) => new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frames.push(frame);
    if (kind === 'sandbox') frame.sandbox = 'allow-scripts';
    frame.src = '/__seismic-check-ipc?probe=' + kind;
    const receive = (event) => {
      if (event.source === frame.contentWindow) finish(event.data);
    };
    const timer = setTimeout(() => finish(null), 5000);
    function finish(value) {
      clearTimeout(timer);
      removeEventListener('message', receive);
      resolve(value);
    }
    addEventListener('message', receive);
    document.body.append(frame);
  });
  try {
    const reports = await Promise.all([probeFrame('same'), probeFrame('sandbox')]);
    window.webkit?.messageHandlers?.ipc?.postMessage(JSON.stringify({ cmd: marks.top }));
    for (let i = 0; i < 40 && !decoded.includes('top'); i++) await sleep(50);
    await sleep(500);
    return { frames: reports, decoded };
  } finally {
    console.error = original;
    for (const frame of frames) frame.remove();
  }
}`;
let onHealth: (() => Promise<void>) | undefined;
let remoteBusy = false;
let signedOut = false;
let busyChecks = 0;
let proxyError = 0;
let expireServerHandover = false;
let acknowledgedHandovers = 0;
let seedDraft = true;
let delayHandover: (() => Promise<void>) | undefined;
let stallRestore: { body: boolean; reached: () => void; release: Promise<void> } | undefined;
const startProxy = (port = proxyPort) => {
  return Bun.serve({
    port,
    hostname: useIPv6 ? '::1' : HOST,
    async fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === '/__seismic-check-frame') return new Response(FRAME, { headers: { 'content-type': 'text/html' } });
      if (url.pathname === '/__seismic-check-ipc') return new Response(IPC_FRAME, { headers: { 'content-type': 'text/html' } });
      if (onHealth && url.pathname === '/api/projects' && req.headers.get('user-agent')?.startsWith('ureq/')) {
        server.timeout(req, 0);
        await onHealth();
      }
      if (proxyError && url.pathname === '/api/app-rebuilt') {
        return new Response('Upstream unavailable', { status: proxyError });
      }
      if (expireServerHandover && url.pathname === '/api/app-rebuilt/handover' && req.method === 'GET') {
        return Response.json(null);
      }
      if (stallRestore && url.pathname === '/api/app-rebuilt/handover' && req.method === 'GET') {
        server.timeout(req, 0); // Only the client may end this request before the harness releases it.
        const { body, reached, release } = stallRestore;
        reached();
        if (!body) {
          await release;
          return Response.json(null);
        }
        const bytes = new TextEncoder();
        return new Response(new ReadableStream({
          start(stream) {
            stream.enqueue(bytes.encode('['));
            void release.then(() => {
              try { stream.enqueue(bytes.encode(']')); stream.close(); } catch {} // The deadline may have cancelled it.
            });
          },
        }), { headers: { 'content-type': 'application/json' } });
      }
      if (signedOut && url.pathname === '/api/app-rebuilt') {
        return Response.json({ code: 'notPaired' }, { status: 401 });
      }
      if (signedOut && url.pathname === '/') {
        return new Response('<h1 id="signed-out">This device is not paired</h1>', { headers: { 'content-type': 'text/html' } });
      }
      if (url.pathname === '/api/app-rebuilt' && remoteBusy) {
        busyChecks++;
        return Response.json({ now: false, kept: false });
      }
      const headers = new Headers(req.headers);
      headers.set('x-forwarded-for', '100.64.0.7');
      headers.set('x-forwarded-host', `${HOST}:${port}`);
      headers.set('x-forwarded-proto', 'http');
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
      const res = await fetch(`${remoteUrl}${url.pathname}${url.search}`, { method: req.method, headers, body, redirect: 'manual' });
      if (url.pathname === '/api/app-rebuilt/handover' && req.method === 'POST' && res.ok) {
        acknowledgedHandovers++;
        await delayHandover?.();
      }
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
let backToStatus = false;
let editBeforeBack = false;
let draftRevision = 0;
let rememberLastPage = false;
let statusAction: { name: string; open?: boolean } | undefined;
const polls = new Map<string, number>();
const MODULE = `
const base = new URL('.', import.meta.url);
const post = (path, body) => fetch(new URL(path, base), { method: 'POST', body: JSON.stringify(body) });
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
const outcome = (p) => p.then((value) => ({ ok: true, value }), (e) => ({ ok: false, error: String(e) }));
if (location.origin === ${JSON.stringify(REMOTE)} && document.getElementById('signed-out')) {
  await post('result', { kind: 'signedOut', title: document.getElementById('signed-out').textContent });
} else if (location.origin === ${JSON.stringify(REMOTE)}) {
  // A restored page reads its handover before mounting the app.
  for (let n = 0; n < 60 && !document.getElementById('root')?.firstChild; n++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const entries = new Map(window.seismicSnapshotSession?.() ?? Object.entries(sessionStorage));
  const out = { kind: 'remote', href: location.href, label: window.__TAURI_INTERNALS__.metadata.currentWindow.label, mounted: !!document.getElementById('root')?.firstElementChild, handedOver: window.seismicApp?.handedOver, previousSession: entries.get('check-workspace-session') ?? null, previousDraft: entries.get('seismic-drafts-check') ?? null, previousWish: entries.get('seismic-wish-check') ?? null, previousConfig: entries.get('seismic-config-draft-check') ?? null };
  out.previousOverflowDraft = JSON.parse(entries.get('seismic-drafts-quota-check') ?? '{}')['card:q']?.text;
  out.previousOverflowConfig = JSON.parse(entries.get('seismic-config-draft-project:quota-check') ?? '{}').name;
  out.restoredInMemory = sessionStorage.getItem('seismic-drafts-quota-check') === null && out.previousOverflowDraft !== undefined;
  for (const key of Object.keys(localStorage)) if (key.startsWith('seismic-check-storage-fill-')) localStorage.removeItem(key);
  sessionStorage.setItem('check-workspace-session', 'kept');
  sessionStorage.setItem('seismic-wish-check', 'Unsent issue for Lab');
  sessionStorage.setItem('seismic-config-draft-check', 'Unapplied settings for Lab');
  if ((await (await fetch(new URL('seed-draft', base))).json()).seed) sessionStorage.setItem('seismic-drafts-check', 'Unsent note for Lab');
  else sessionStorage.removeItem('seismic-drafts-check');
  out.desks = await outcome(invoke('desks'));
  out.add = await outcome(invoke('add_desk', { address: 'https://elsewhere.example', code: '123456' }));
  out.rename = await outcome(invoke('rename_desk', { id: 'local', name: 'Taken over' }));
  out.remove = await outcome(invoke('remove_desk', { id: 'local' }));
  out.projects = (await fetch('/api/projects')).status;
  out.genericWindowControl = await outcome(invoke('plugin:window|internal_toggle_maximize'));
  out.genericDrag = await outcome(invoke('plugin:window|start_dragging'));
  await post('result', out);
  if ((await (await fetch(new URL('remember-page', base))).json()).now) {
    history.replaceState(null, '', ${JSON.stringify(LAST_PAGE)});
    await post('result', { kind: 'lastPage', href: location.href });
  }
  const back = await (await fetch(new URL('back-to-status', base))).json();
  if (back.now) {
    if (back.edit) {
      history.replaceState(null, '', ${JSON.stringify(PAGE_BEFORE_BACK)});
      sessionStorage.setItem('seismic-config-draft-project:quota-check', ${JSON.stringify(STALE_CONFIG)});
      const prefix = 'seismic-check-storage-fill-';
      const fill = (store) => {
        for (let size = 512 * 1024; size >= 16; size = Math.floor(size / 2)) {
          for (let index = 0; index < 20; index++) {
            try { store.setItem(prefix + size + '-' + index, 'x'.repeat(size)); }
            catch { break; }
          }
        }
        try { store.setItem(prefix + 'probe', 'x'.repeat(512)); return false; }
        catch (error) { return error.name === 'QuotaExceededError'; }
        finally { store.removeItem(prefix + 'probe'); }
      };
      const { edit } = await import(new URL('quota.js', base).href);
      const localFull = fill(localStorage);
      const sessionFull = fill(sessionStorage);
      const text = ${JSON.stringify(OVERFLOW_DRAFT)} + back.edit;
      await post('result', { kind: 'profileQuota', localFull, sessionFull, overflow: edit(text), revision: back.edit });
    }
    history.back();
  }
  if (${process.platform === 'darwin'}) await post('result', { kind: 'ipcGate', ...(await (${IPC_CHECK})()) });
  const mic = { kind: 'remoteMic', secure: isSecureContext };
  const capture = (options) => outcome(Promise.race([
    Promise.resolve().then(() => {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('Media devices are unavailable', 'NotSupportedError');
      return navigator.mediaDevices.getUserMedia(options);
    })
      .then((s) => (s.getTracks().forEach((t) => t.stop()), 'granted')),
    new Promise((_, no) => setTimeout(() => no(new Error('no answer in 8 s')), 8000)),
  ]));
  mic.mic = await capture({ audio: true });
  if (${legacyMic}) {
    mic.camera = await capture({ video: true });
    mic.legacyApi = typeof navigator.getUserMedia === 'function' || typeof navigator.webkitGetUserMedia === 'function';
  }
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
  let openingButton;
  async function checkStatus() {
    await new Promise((r) => setTimeout(r, 500));
    await post('result', { kind: 'status', title: document.getElementById('title').textContent, why: document.getElementById('why').textContent, desks: await outcome(invoke('desks')) });
    for (;;) {
      if ((await (await fetch(new URL('retry', base))).json()).now) break;
      const action = await (await fetch(new URL('status-action', base))).json();
      if (action) {
        const button = [...document.querySelectorAll('#others button')].find((b) => b.textContent === action.name);
        if (action.open && button) {
          openingButton = button;
          button.focus();
          button.click();
        }
        await post('result', { kind: 'statusAction', name: action.name, notice: document.getElementById('open-result').textContent, focused: !!button && document.activeElement === button, same: !!button && button === openingButton });
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    document.getElementById('retry').click();
  }
  addEventListener('pageshow', (event) => { if (event.persisted) void checkStatus(); });
  await checkStatus();
} else if (location.protocol === 'http:' && location.hostname === '127.0.0.1') {
  const label = window.__TAURI_INTERNALS__.metadata.currentWindow.label;
  if (location.port === ${JSON.stringify(String(oldPort))}) history.replaceState(null, '', '/?takeover-check=kept');
  addEventListener('seismic-desks', async () => post('result', { kind: 'desksChanged', ...(await outcome(invoke('desks'))) }));
  await post('result', { kind: 'local', href: location.href, label, minimized: window.seismicCheckMinimized });
  for (;;) {
    const next = await (await fetch(new URL('todo?label=' + label, base))).json();
    if (next) void outcome(invoke(next.cmd, next.args)).then((result) => post('done', { id: next.id, ...result }));
    else await new Promise((r) => setTimeout(r, 200));
  }
}
`;
const harness = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const cors = { 'access-control-allow-origin': '*' };
    const { pathname: path, searchParams } = new URL(req.url);
    const json = (v: unknown) => Response.json(v, { headers: cors });
    if (path === '/check.js') return new Response(MODULE, { headers: { ...cors, 'content-type': 'text/javascript' } });
    if (path === '/quota.js') {
      const bundle = await (quotaBundle ??= Bun.build({ entrypoints: [quotaFixture], target: 'browser' }).then(async (built) => {
        if (!built.success || !built.outputs[0]) throw new Error(built.logs.join('\n'));
        return built.outputs[0].text();
      }));
      return new Response(bundle, { headers: { ...cors, 'content-type': 'text/javascript' } });
    }
    if (path === '/seed-draft') return json({ seed: seedDraft });
    if (path === '/todo') {
      const label = searchParams.get('label') ?? '';
      polls.set(label, (polls.get(label) ?? 0) + 1);
      return json(todo.shift() ?? null);
    }
    if (path === '/retry') return json({ now: retryNow });
    if (path === '/remember-page') {
      const now = rememberLastPage;
      rememberLastPage = false;
      return json({ now });
    }
    if (path === '/status-action') {
      const action = statusAction;
      statusAction = undefined;
      return json(action ?? null);
    }
    if (path === '/back-to-status') {
      const now = backToStatus;
      const edit = now && editBeforeBack ? ++draftRevision : 0;
      if (now) retryNow = backToStatus = false;
      if (edit) editBeforeBack = false;
      return json({ now, edit });
    }
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
const report = (kind: string, after = 0, timeout = 60_000) => until(`the ${kind} page to report`, timeout, () => reports.slice(after).find((r) => r.kind === kind));
const fromStatus = async (name: string, open = false) => {
  const before = reports.length;
  statusAction = { name, open };
  return report('statusAction', before, 5_000);
};
type Desks = { current: string | null; problem: string | null; list: { id: string; name: string; origin: string | null; local: boolean; open: boolean }[] };
const desks = async () => (await run('desks')).value as Desks;
const changedDesk = (after: number, id: string, origin: string) => until('the workspace list to refresh', 5_000, () =>
  reports.slice(after).some((r) => r.kind === 'desksChanged' && r.ok === true &&
    (r.value as Desks).list.some((w) => w.id === id && w.origin === origin && !w.open)),
);

const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  SEISMIC_HOME: home,
  SEISMIC_APP_CHECK: `${harness.url.href}check.js`,
  // WebKit's mock microphone on a Mac without one (desktop/src/window/microphone/macos.rs)
  SEISMIC_APP_CHECK_FAKE_MIC: '1',
  ...(legacyMic && forceLegacyMic ? { SEISMIC_APP_CHECK_LEGACY_MIC: '1' } : {}),
  ...(process.platform === 'win32' ? { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--use-fake-device-for-media-stream' } : {}),
  SEISMIC_PORT: String(4600 + Math.floor(Math.random() * 300)),
  // the debug shell runs this checkout's server
  SEISMIC_CHECKOUT: ROOT,
  SEISMIC_BUN: process.execPath,
};
delete env.SEISMIC_SUPERVISED;
delete env.OBEYA_SUPERVISED;
delete env.SEISMIC_FROM_APP;
delete env.OBEYA_FROM_APP;
const entry = () => {
  try {
    return JSON.parse(readFileSync(join(home, 'server.json'), 'utf8')) as { url: string; pid: number };
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
let terminal: Subprocess | undefined;
try {
  await until('the remote Seismic to answer', 60_000, async () => (await fetch(`${remoteUrl}/api/projects`, { headers: ownerHeaders(remoteHome) }).catch(() => null))?.ok);
  const on = await asOwner('/api/access', { method: 'PUT', body: JSON.stringify({ remote: { via: 'hosts', hosts: ['localhost'] } }) });
  expect(on.ok, `the remote's access: ${on.status} ${await on.text()}`);
  proxy.server = startProxy();

  // ---------------------------------------------------------------- pairing from this machine's page
  terminal = Bun.spawn([process.execPath, join(ROOT, 'src', 'server', 'main.ts'), '--port', String(oldPort)], {
    env,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await until('the terminal server to answer', 60_000, async () => {
    const res = await fetch(`http://127.0.0.1:${oldPort}/api/projects`, { headers: ownerHeaders(home) });
    return res.ok;
  });
  if (minimizedTakeover) {
    writeFileSync(join(home, 'app-windows.json'), JSON.stringify({ at: Date.now(), windows: [{
      desk: 'local', x: 40, y: 40, width: 900, height: 700, minimized: true, visible: false, next: '/',
    }] }));
  }
  app = startApp();
  const initial = await report('local');
  const transferred = await check('taking over on a different port replaces the local webview and keeps local commands', async () => {
    const oldLabel = String(initial.label);
    expect(String(initial.href).startsWith(`http://127.0.0.1:${oldPort}/`), JSON.stringify(initial));
    expect((await desks()).current === 'local', 'the original window cannot use its local capability');
    const before = reports.length;
    const res = await appApi('/api/app-takeover').catch((error) => {
      if (error.code !== 'ECONNRESET') throw error;
      return null;
    });
    expect(res === null || (res?.ok && (await res.json()).taking), 'the takeover did not start');
    const next = await report('local', before);
    expect(new URL(String(next.href)).origin !== new URL(String(initial.href)).origin, JSON.stringify(next));
    expect(typeof next.label === 'string' && next.label !== oldLabel, JSON.stringify(next));
    expect(new URL(String(next.href)).searchParams.get('takeover-check') === 'kept', JSON.stringify(next));
    if (minimizedTakeover) {
      expect(initial.minimized === true && next.minimized === true, JSON.stringify({ initial, next }));
    }
    expect((await desks()).current === 'local', 'the replacement window cannot use its local capability');
    if (process.platform === 'darwin') {
      const drag = await run('workspace_start_dragging');
      expect(drag.ok, JSON.stringify(drag));
    }
    const polled = polls.get(oldLabel);
    await sleep(1000);
    expect(polls.get(oldLabel) === polled, 'the previous webview is still running');
    return `${oldLabel} at ${new URL(String(initial.href)).origin} → ${next.label} at ${new URL(String(next.href)).origin}${minimizedTakeover ? ', both minimized' : ''}`;
  });
  expect(transferred, 'the local server was not taken over');
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
  if (debugFailures) {
    await check('a saved workspace is reported and listed even if its first window fails', async () => {
      const before = reports.length;
      writeFileSync(join(home, 'check-window-open-error'), '');
      const result = await run('add_desk', { address: REMOTE, code: await code(), name: 'Studio' });
      const value = result.value as { id: string; opened: boolean } | undefined;
      expect(result.ok && value?.opened === false, JSON.stringify(result));
      id = value!.id;
      await changedDesk(before, id, REMOTE);
      const saved = JSON.parse(readFileSync(join(home, 'app-desks.json'), 'utf8')) as { list: { id: string; url: string }[] };
      expect(saved.list.some((w) => w.id === id && w.url === REMOTE), 'the new workspace was not saved');
    });
  }
  const paired = await check('the right code pairs, and the workspace opens in a window of its own', async () => {
    const r = id ? await run('pair_desk', { id, code: await code() }) : await run('add_desk', { address: REMOTE, code: await code(), name: 'Studio' });
    expect(r.ok, JSON.stringify(r));
    const value = r.value as { id?: string; opened: boolean };
    expect(value?.opened === true, JSON.stringify(r));
    id = value.id ?? id;
    const d = await until('the window to open', 20_000, async () => (await desks()).list.find((w) => w.id === id && w.open));
    return `${d.name} at ${d.origin}`;
  });
  expect(paired, 'the remote workspace did not pair');
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
    await check('generic window controls are unavailable to a workspace', () => {
      for (const control of [first.genericWindowControl, first.genericDrag]) {
        expect(control?.ok === false && /not allowed/i.test(control.error ?? ''), JSON.stringify(control));
      }
    });
  }
  if (process.platform === 'darwin') {
    await check('the bundled macOS IPC decoder receives only the main-frame probe', async () => {
      const result = await report('ipcGate');
      const frames = result.frames as { probe: string; origin: string; sent: boolean }[];
      expect(frames[0]?.probe === 'same' && frames[0].sent && frames[0].origin === REMOTE, JSON.stringify(result));
      expect(frames[1]?.probe === 'sandbox' && frames[1].sent && frames[1].origin === 'null', JSON.stringify(result));
      expect(JSON.stringify(result.decoded) === '["top"]', JSON.stringify(result));
      return 'both subframes sent a probe and the decoder saw only the main frame';
    });
  }
  const mic = (await report('remoteMic').catch((e) => (bad("the remote page's microphone", String(e.message)), null))) as Record<string, unknown> | null;
  if (mic) {
    await check(legacyMic ? 'the legacy Mac guard denies capture in a secure context' : 'the remote page gets the microphone in a secure context', () => {
      const result = mic.mic as { ok: boolean; error?: string };
      expect(mic.secure === true, JSON.stringify(mic));
      if (legacyMic) {
        const camera = mic.camera as typeof result;
        expect(mic.legacyApi === false, JSON.stringify(mic));
        for (const device of [result, camera]) expect(!device.ok && /^(NotAllowedError|NotSupportedError):/.test(device.error ?? ''), JSON.stringify(mic));
        return 'microphone and camera denied';
      }
      expect(result.ok, JSON.stringify(mic));
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

  await check('a rebuild waits for remote activity and preserves the remote session', async () => {
    const before = reports.length;
    remoteBusy = true;
    try {
      await relaunch();
      await until('the shell to check remote activity', 10_000, () => busyChecks >= 2);
      expect(!reports.slice(before).some((r) => r.kind === 'local'), 'the app relaunched while the remote workspace was busy');
    } finally {
      remoteBusy = false;
    }
    const restored = await report('remote', before);
    expect(restored.previousSession === 'kept' && restored.projects === 200, JSON.stringify(restored));
    await report('local', before);
  });

  await check('a stuck handover response does not delay the restart or lose the draft', async () => {
    const before = reports.length;
    const held = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    delayHandover = () => {
      held.resolve();
      return release.promise;
    };
    try {
      await relaunch();
      await Promise.race([held.promise, sleep(10_000).then(() => { throw new Error('the proxy did not receive handover'); })]);
      await report('local', before);
      const restored = await report('remote', before);
      expect(restored.previousDraft === 'Unsent note for Lab', JSON.stringify(restored));
    } finally {
      delayHandover = undefined;
      release.resolve();
    }
  });

  for (const body of [false, true]) {
    await check(`the workspace renders with its draft while handover GET stalls on ${body ? 'the body' : 'headers'}`, async () => {
      const before = reports.length;
      const reached = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      stallRestore = { body, reached: reached.resolve, release: release.promise };
      try {
        await relaunch();
        await Promise.race([reached.promise, sleep(10_000).then(() => { throw new Error('the proxy did not see the restore request'); })]);
        const restored = await report('remote', before, 8_000);
        expect(restored.mounted === true && restored.previousDraft === 'Unsent note for Lab', JSON.stringify(restored));
        await report('local', before);
        return String(restored.previousDraft);
      } finally {
        stallRestore = undefined;
        release.resolve();
      }
    });
  }

  for (const error of [502, 503]) {
    await check(`an HTTP ${error} from the remote proxy allows the update and keeps the draft`, async () => {
      const before = reports.length;
      proxyError = error;
      try {
        await relaunch();
        const restored = await report('remote', before);
        expect(restored.previousDraft === 'Unsent note for Lab', JSON.stringify(restored));
        await report('local', before);
      } finally {
        proxyError = 0;
      }
    });
  }

  await check('a successful handover keeps a local draft even if the server copy expires', async () => {
    const before = reports.length;
    const writes = acknowledgedHandovers;
    expireServerHandover = true;
    rememberLastPage = true;
    try {
      await relaunch();
      const restored = await report('remote', before);
      expect(acknowledgedHandovers > writes, 'the remote server never accepted its handover');
      expect(restored.previousDraft === 'Unsent note for Lab' && restored.previousSession === null, JSON.stringify(restored));
      expect(restored.previousWish === 'Unsent issue for Lab' && restored.previousConfig === 'Unapplied settings for Lab', JSON.stringify(restored));
      expect((await report('lastPage', before)).href === `${REMOTE}${LAST_PAGE}`, 'the fixture did not visit the page that should be restored');
      await report('local', before);
    } finally {
      expireServerHandover = false;
      rememberLastPage = false;
    }
  });

  await check('a duplicate app launch leaves the installer snapshot for the primary', async () => {
    const path = join(home, 'app-windows.json');
    const snapshot = JSON.stringify({ at: Date.now(), installer: true, windows: [] });
    writeFileSync(path, snapshot);
    const secondary = startApp();
    try {
      expect((await exited(secondary, 10_000)) === 0, 'the duplicate app did not exit');
      expect(readFileSync(path, 'utf8') === snapshot, 'the duplicate modified the installer snapshot');
      expect((await desks()).current === 'local', 'the primary stopped responding');
    } finally {
      if (secondary.exitCode === null) secondary.kill();
      rmSync(path, { force: true });
    }
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
  if (debugFailures) {
    await check('opening from status shows progress, keeps focus on refresh and reports a native failure', async () => {
      const port = free();
      const other = startProxy(port);
      const address = `http://${HOST}:${port}`;
      const fault = join(home, 'check-window-open-error');
      const release = Promise.withResolvers<void>();
      const checking = Promise.withResolvers<void>();
      let otherId: string | undefined;
      try {
        writeFileSync(fault, '');
        const added = await run('add_desk', { address, code: await code(), name: 'Studio' });
        const value = added.value as { id: string; opened: boolean };
        otherId = value?.id;
        expect(added.ok && value?.opened === false, JSON.stringify(added));
        onHealth = () => { checking.resolve(); return release.promise; };
        writeFileSync(fault, '');
        const opening = await fromStatus('Studio', true);
        expect(opening.notice === 'Opening Studio …' && opening.focused, JSON.stringify(opening));
        await Promise.race([checking.promise, sleep(5_000).then(() => { throw new Error('no open health check'); })]);

        expect((await run('rename_desk', { id: otherId, name: 'Side studio' })).ok, 'the list refresh did not start');
        const refreshed = await until<Record<string, unknown>>('the focused workspace button to refresh', 5_000, async () => {
          const state = await fromStatus('Side studio');
          return state.same === true ? state : undefined;
        });
        expect(refreshed.focused && refreshed.notice === 'Opening Studio …', JSON.stringify(refreshed));

        onHealth = undefined;
        release.resolve();
        await until('the native window error to show', 5_000, async () => {
          const state = await fromStatus('Side studio');
          return state.notice === 'Couldn’t open Side studio. Try again.';
        });
        expect(!(await desks()).list.find((d) => d.id === otherId)?.open, 'the failed window still appears open');
        await fromStatus('Side studio', true);
        await until('retrying the workspace open to succeed', 5_000, async () => (await desks()).list.find((d) => d.id === otherId)?.open);
      } finally {
        onHealth = undefined;
        release.resolve();
        rmSync(fault, { force: true });
        if (otherId) await run('remove_desk', { id: otherId });
        other.stop(true);
      }
    });
  }
  const afterStatus = reports.length;
  proxy.server = startProxy();
  backToStatus = true;
  retryNow = true;
  const again = (await report('remote', afterStatus).catch((e) => (bad('Try again', String(e.message)), null))) as Record<string, unknown> | null;
  if (again) {
    await check('Try again restores the offline draft after two relaunches', () => {
      expect(String(again.href).startsWith(`${REMOTE}/`) && again.projects === 200, `${again.href}, projects ${again.projects}`);
      expect(again.previousDraft === 'Unsent note for Lab', JSON.stringify(again));
      expect(again.href === `${REMOTE}${LAST_PAGE}`, `Try again lost the saved page (${again.href})`);
      return String(again.previousDraft);
    });
    let edited = reports.length;
    await check('Try again works after going Back to a recovered status page', async () => {
      const revisited = await report('status', afterStatus, 10_000);
      const state = (revisited.desks as { value: Desks }).value;
      expect(state.problem === null && revisited.title === 'Lab' && String(revisited.why).includes(REMOTE), JSON.stringify(revisited));
      const before = reports.length;
      edited = before;
      editBeforeBack = true;
      backToStatus = true;
      retryNow = true;
      const reopened = await report('remote', before, 10_000);
      expect(reopened.projects === 200 && reopened.label === again.label, JSON.stringify(reopened));
      expect(reopened.href === `${REMOTE}${LAST_PAGE}`, `the history retry lost the saved page (${reopened.href})`);
    });
    await check('Try again restores memory-only edits in the same native window', async () => {
      await report('status', edited, 10_000);
      const quota = await report('profileQuota', edited, 5_000);
      expect(quota.sessionFull === true && quota.overflow === true, JSON.stringify(quota));
      const before = reports.length;
      const pid = entry()?.pid;
      editBeforeBack = backToStatus = retryNow = true;
      const reopened = await report('remote', before, 10_000);
      expect(reopened.label === again.label && entry()?.pid === pid, 'the workspace or local server was replaced');
      const latest = OVERFLOW_DRAFT + quota.revision;
      expect(reopened.restoredInMemory === true && reopened.previousOverflowDraft === latest && reopened.previousOverflowConfig === latest, 'the latest edits were not restored in memory');
      expect(reopened.href === `${REMOTE}${PAGE_BEFORE_BACK}`, JSON.stringify(reopened));
      edited = before;
      return 'the latest conversation and settings edits';
    });
    await check('pairing again at the same address also restores the latest departing edits', async () => {
      await report('status', edited, 10_000);
      const quota = await report('profileQuota', edited, 5_000);
      const before = reports.length;
      editBeforeBack = backToStatus = true;
      const paired = await run('pair_desk', { id, code: await code() });
      expect(paired.ok, JSON.stringify(paired));
      const reopened = await report('remote', before, 10_000);
      const latest = OVERFLOW_DRAFT + quota.revision;
      expect(reopened.label === again.label && reopened.previousOverflowDraft === latest && reopened.previousOverflowConfig === latest, 're-pair did not recover the latest edits in the existing window');
      edited = before;
    });
    await check('drafts survive two restarts from status with a full browser profile', async () => {
      try {
        await report('status', edited, 10_000);
        const quota = await report('profileQuota', edited, 5_000);
        expect(quota.localFull === true && quota.sessionFull === true && quota.overflow === true, JSON.stringify(quota));
        expireServerHandover = true;
        const writes = acknowledgedHandovers;
        proxy.server?.stop(true);
        for (let i = 0; i < 2; i++) {
          const before = reports.length;
          await relaunch();
          await report('status', before, 15_000);
          await report('local', before, 15_000);
        }
        proxy.server = startProxy();
        const before = reports.length;
        retryNow = true;
        const restored = await report('remote', before, 10_000);
        expect(acknowledgedHandovers === writes, 'the server accepted handover from a status page');
        expect(restored.previousDraft === 'Edited just before Back' && restored.previousWish === 'New issue just before Back' &&
          restored.previousConfig === 'New settings just before Back' && restored.previousSession === null, JSON.stringify(restored));
        const latest = OVERFLOW_DRAFT + quota.revision;
        expect(restored.previousOverflowDraft === latest && restored.previousOverflowConfig === latest, 'the edits that did not fit in session storage were lost');
        expect(restored.href === `${REMOTE}${PAGE_BEFORE_BACK}`, `Try again lost the in-page address (${restored.href})`);
        return 'conversation, issue, and settings drafts';
      } finally {
        expireServerHandover = editBeforeBack = backToStatus = retryNow = false;
      }
    });
  }
  await check('a pending status retry cannot overwrite a re-pair', async () => {
    const before = reports.length;
    retryNow = false;
    proxy.server?.stop(true);
    await relaunch();
    await report('status', before);
    await report('local', before);
    const pending = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    onHealth = async () => {
      pending.resolve();
      await release.promise;
    };
    try {
      proxy.server = startProxy();
      retryNow = true;
      await Promise.race([pending.promise, sleep(10_000).then(() => { throw new Error('no status retry'); })]);
      const afterRetry = reports.length;
      const paired = await run('pair_desk', { id, code: await code() });
      expect(paired.ok, JSON.stringify(paired));
      const restored = await report('remote', afterRetry);
      expect(restored.projects === 200 && (restored.desks as { value: Desks }).value.problem === null, JSON.stringify(restored));
    } finally {
      onHealth = undefined;
      release.resolve();
    }
    const afterPair = reports.length;
    await sleep(1000);
    expect(!reports.slice(afterPair).some((r) => r.kind === 'remote' || r.kind === 'status'), 'the stale retry navigated the window');
  });
  await check('a signed-out workspace leaves the local update free to finish', async () => {
    signedOut = true;
    try {
      const before = reports.length;
      await relaunch();
      await report('signedOut', before);
      await report('local', before);
      // The remote document now has no app hooks, like the real sign-in page.
      const beforeSignedOut = reports.length;
      await relaunch();
      const signedOutPage = await report('signedOut', beforeSignedOut);
      await report('local', beforeSignedOut);
      expect((await desks()).current === 'local', 'the local window did not come back');
      return String(signedOutPage.title);
    } finally {
      signedOut = false;
    }
  });
  await check('a second relaunch remembers a workspace whose first health check is still pending', async () => {
    const reached = Promise.withResolvers<void>();
    const unblock = Promise.withResolvers<void>();
    let checks = 0;
    try {
      seedDraft = false;
      const before = reports.length;
      await relaunch();
      await report('local', before);
      await report('remote', before); // The fixture has just removed its sample draft.

      onHealth = async () => {
        if (++checks === 1) {
          reached.resolve();
          await unblock.promise;
        }
      };
      const first = reports.length;
      await relaunch();
      await report('local', first);
      await Promise.race([reached.promise, sleep(10_000).then(() => { throw new Error('no pending health check'); })]);
      expect(!reports.slice(first).some((r) => r.kind === 'remote' || r.kind === 'status'), 'the first restore has already opened a window');

      seedDraft = true;
      const second = reports.length;
      await relaunch();
      const restored = await report('remote', second, 10_000);
      expect(checks >= 2 && restored.previousDraft === null && restored.projects === 200, JSON.stringify({ checks, restored }));
    } finally {
      seedDraft = true;
      onHealth = undefined;
      unblock.resolve();
    }
  });
  if (debugFailures) {
    await check('a draft survives when a workspace finishes restoring during restart capture', async () => {
      const held = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const pause = join(home, 'check-pause-placement');
      const paused = join(home, 'check-placement-paused');
      onHealth = () => { held.resolve(); return release.promise; };
      expireServerHandover = true;
      try {
        const first = reports.length;
        await relaunch();
        await report('local', first);
        await Promise.race([held.promise, sleep(10_000).then(() => { throw new Error('no pending health check'); })]);
        for (const name of readdirSync(home).filter((name) => name.startsWith('check-drafts-received-'))) rmSync(join(home, name));
        writeFileSync(pause, '');
        await relaunch();
        await until('placement capture to pause after readiness', 10_000, () => existsSync(paused));

        onHealth = undefined;
        release.resolve();
        const connected = await report('remote', first, 8_000);
        expect(connected.previousDraft === 'Unsent note for Lab', JSON.stringify(connected));
        const received = join(home, `check-drafts-received-${connected.label}`);
        await until('the restored document to acknowledge its draft', 8_000, () => existsSync(received));

        const second = reports.length;
        rmSync(paused);
        const restored = await report('remote', second, 15_000);
        expect(restored.previousDraft === 'Unsent note for Lab' && restored.previousSession === null, JSON.stringify(restored));
        return String(restored.previousDraft);
      } finally {
        onHealth = undefined;
        expireServerHandover = false;
        release.resolve();
        rmSync(pause, { force: true });
        rmSync(paused, { force: true });
      }
    });
    await check('a failed startup restore keeps its draft for the next explicit open', async () => {
      const failure = join(home, 'check-window-open-error');
      const before = reports.length;
      expireServerHandover = true;
      writeFileSync(failure, '');
      try {
        await relaunch();
        await report('local', before);
        await until('the forced restore failure', 10_000, () => !existsSync(failure));
        expect((await desks()).list.find((w) => w.id === id)?.open === false, 'the first restore did not fail');
        const reopened = await run('open_desk', { id });
        expect(reopened.ok, JSON.stringify(reopened));
        const restored = await report('remote', before, 10_000);
        expect(restored.previousDraft === 'Unsent note for Lab' && restored.previousSession === null, JSON.stringify(restored));
        return String(restored.previousDraft);
      } finally {
        expireServerHandover = false;
        rmSync(failure, { force: true });
      }
    });
  }
  await check('removing the workspace destroys its native window', async () => {
    const page = reports.findLast((r) => r.kind === 'remote');
    expect(typeof page?.label === 'string', 'the open workspace did not report its native window label');
    const destroyed = join(home, `check-destroyed-${page!.label}`);
    rmSync(destroyed, { force: true });
    const r = await run('remove_desk', { id });
    expect(r.ok, JSON.stringify(r));
    await until('the removed workspace window to emit Destroyed', 10_000, () => existsSync(destroyed));
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
      const opening = run('open_desk', { id });
      const paired = await run('pair_desk', { id, code: await code() });
      expect(paired.ok, JSON.stringify(paired));
      const opened = await opening;
      expect(opened.ok, JSON.stringify(opened));
      const page = await report('remote', before);
      expect(page.projects === 200, JSON.stringify(page));
    });
    expect((await desks()).list.find((w) => w.id === id)?.open, 'the paired window is missing');
  });
  await check('removal cancels an in-flight health check', async () => {
    await withPendingHealth(async () => {
      const opening = run('open_desk', { id });
      const removed = await run('remove_desk', { id });
      expect(removed.ok, JSON.stringify(removed));
      const cancelled = await opening;
      expect(!cancelled.ok && cancelled.error === 'unknown', JSON.stringify(cancelled));
    });
    expect(!(await desks()).list.some((w) => w.id === id), 'the removed workspace is still listed');
  });
  await check('a snapshot write error keeps windows open and a queued rebuild can retry', async () => {
    const added = await run('add_desk', { address: REMOTE, code: await code(), name: 'Lab' });
    expect(added.ok, JSON.stringify(added));
    const recoveryId = (added.value as { id: string }).id;
    const path = join(home, 'app-windows.json');
    const previous = entry();
    expect(previous, 'the local server is missing');
    mkdirSync(path);
    try {
      const before = reports.length;
      if (debugFailures) writeFileSync(join(home, 'check-queue-rebuild'), '');
      else await relaunch();
      await report('local', before);
      const d = await desks();
      expect(entry()?.pid !== previous?.pid, 'the local server did not restart');
      expect(d.list.find((w) => w.id === recoveryId)?.open, 'the remote workspace window closed');
      expect(!reports.slice(before).some((r) => r.kind === 'remote' || r.kind === 'status'), 'the remote window reloaded');
      if (debugFailures) {
        const resumed = entry()?.pid;
        await sleep(3_500); // Span another automatic report while the target is still blocked.
        expect(entry()?.pid === resumed, 'a blocked rebuild stopped the resumed local server again');
        const afterRepair = reports.length;
        rmSync(path, { recursive: true, force: true });
        await report('remote', afterRepair, 20_000);
        await report('local', afterRepair, 20_000);
        expect(entry()?.pid !== resumed, 'the queued rebuild did not retry after the snapshot path was repaired');
      }
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
    id = recoveryId;
  });
  if (debugFailures) {
    await check('a changed address is saved and refreshed even if its replacement window fails', async () => {
      const port = free();
      const other = startProxy(port);
      const address = `http://${HOST}:${port}`;
      try {
        const before = reports.length;
        writeFileSync(join(home, 'check-window-open-error'), '');
        const result = await run('pair_desk', { id, address, code: await code() });
        expect(result.ok && (result.value as { opened: boolean })?.opened === false, JSON.stringify(result));
        await changedDesk(before, id, address);
        const saved = JSON.parse(readFileSync(join(home, 'app-desks.json'), 'utf8')) as { list: { id: string; url: string }[] };
        expect(saved.list.some((w) => w.id === id && w.url === address), 'the changed address was not saved');
      } finally {
        other.stop(true);
      }
    });
  }
  await check("this machine's workspace stays", async () => {
    const r = await run('remove_desk', { id: 'local' });
    expect(!r.ok && r.error === 'local', JSON.stringify(r));
  });
} finally {
  await appApi('/api/stop').catch(() => null);
  await until('the local server to stop', 30_000, () => !entry()).catch(() => null);
  if (app && app.exitCode === null && (await exited(app, 5_000)) === null) app.kill();
  proxy.server?.stop(true);
  terminal?.kill();
  remote.kill();
  harness.stop(true);
  if (!args.includes('--keep')) rmSync(dir, { recursive: true, force: true });
  else console.log(`kept: ${dir}`);
}
process.exit(failed ? 1 : 0);
