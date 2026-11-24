// Checks the app's remote workspaces (docs/plan/remote-workspaces.md, desktop/src/desks/) in the
// webview of this machine, against a second Seismic that counts as remote: a proxy in front of it
// forwards as `tailscale serve` does, so it answers the shell as another machine would.
//
//   bun scripts/check-app-desks.ts <the app's program> [--ipv6] [--legacy-mic] [--debug-failures] [--minimized-takeover] [--keep]
//   Add --same-port-takeover or --quit-during-takeover for an isolated takeover check.
//   With --same-port-takeover, --failed-same-port-navigation simulates an uncommitted load.
//
// The program: a build from scripts/build-app.ts, or a debug build of the shell, which runs this
// checkout's server. On a Mac it has to be an app bundle: WKWebView keeps the cookies of a bare
// program for its run alone, so a pairing would not outlast the relaunch. In desktop/:
//   bun x tauri build --debug --bundles app --config '{"identifier":"im.seismic.desks-check","bundle":{"externalBin":null,"resources":null}}'
// then target/debug/bundle/macos/Seismic.app/Contents/MacOS/seismic. The check pairs, switches
// among workspaces, handles offline recovery and restores drafts through updates. It observes
// the native window count and the webview labels independently of the workspace list.

import { type Subprocess } from 'bun';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { release, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { ownerHeaders } from '../src/server/owner';
import { t } from '../src/ui/strings';
import { bad, check, exited, expect, failed, sleep, until } from './check-harness';

const args = process.argv.slice(2);
const programArg = args.find((a) => !a.startsWith('--'));
if (!programArg) {
  console.error("usage: bun scripts/check-app-desks.ts <the app's program> [--ipv6] [--legacy-mic] [--debug-failures] [--minimized-takeover] [--same-port-takeover] [--quit-during-takeover] [--keep]");
  process.exit(2);
}
const program = resolve(programArg);
const ROOT = resolve(import.meta.dir, '..');
const debugFailures = args.includes('--debug-failures');
const minimizedTakeover = args.includes('--minimized-takeover');
const samePortTakeover = args.includes('--same-port-takeover');
const failedSamePortNavigation = args.includes('--failed-same-port-navigation');
if (failedSamePortNavigation && !samePortTakeover) throw new Error('--failed-same-port-navigation requires --same-port-takeover');
const quitDuringTakeover = args.includes('--quit-during-takeover');
if (quitDuringTakeover && (process.platform !== 'darwin' || samePortTakeover)) {
  throw new Error('--quit-during-takeover requires macOS and a different-port takeover');
}
// On newer macOS, a debug app can exercise Big Sur's fail-closed path with real WebKit.
const forceLegacyMic = args.includes('--legacy-mic');
const legacyMic = process.platform === 'darwin' && (forceLegacyMic || Number(release().split('.')[0]) <= 20);

const dir = mkdtempSync(join(tmpdir(), 'seismic-desks-check-'));
const [home, remoteHome] = [join(dir, 'home'), join(dir, 'remote-home')];
mkdirSync(home);
mkdirSync(remoteHome);

// A real project supplies the desktop composer and its paste/upload path.
const repo = join(dir, 'lab');
mkdirSync(repo);
Bun.spawnSync(['git', 'init', '-q', repo]);
for (const workspaceHome of [home, remoteHome]) {
  writeFileSync(join(workspaceHome, 'projects.json'), JSON.stringify([{ name: 'Lab', repos: [{ path: repo }] }]));
}
// Take the launcher out of reach for one relaunch, even where a running executable is locked.
const launcherDir = join(dir, 'launcher');
symlinkSync(dirname(process.execPath), launcherDir, 'junction');

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
let busyChecks = 0;
let seedDraft = true;
// The next page request finds the remote gone, after its health check answered.
let nextPage: (() => Promise<void>) | undefined;
let liveComposer = false;
let reconnectRemote: (() => void) | undefined;
let replacementHello = false;
let imageUpload: (() => Promise<Response>) | undefined;
let pairRequests = 0;
let unrelatedPairing = false;
let unrelatedPageRequests = 0;
let rejectHealth = false;
let rejectedHealthChecks = 0;
let dropPage = false;
let pageError: 'http' | 'legacy' | undefined;
const startProxy = (port = proxyPort) => {
  return Bun.serve<{ upstream: WebSocket }>({
    port,
    hostname: useIPv6 ? '::1' : HOST,
    async fetch(req, server) {
      const url = new URL(req.url);
      if (req.method === 'POST' && url.pathname === '/api/pair') pairRequests++;
      if (unrelatedPairing) {
        if (url.pathname === '/api/pair') return Response.json({ url: new URL('/unrelated', req.url).href });
        if (url.pathname === '/unrelated') unrelatedPageRequests++;
        return Response.json({ service: 'unrelated' });
      }
      if (url.pathname === '/__seismic-check-frame') return new Response(FRAME, { headers: { 'content-type': 'text/html' } });
      if (url.pathname === '/__seismic-check-ipc') return new Response(IPC_FRAME, { headers: { 'content-type': 'text/html' } });
      if (req.method === 'POST' && url.pathname.endsWith('/images') && imageUpload) return imageUpload();
      if (nextPage && req.headers.get('accept')?.includes('text/html')) {
        server.timeout(req, 0);
        const held = nextPage;
        nextPage = undefined;
        await held();
      }
      if (pageError && req.headers.get('accept')?.includes('text/html')) {
        // Older webviews omit the HTTP status from navigation timing entries.
        const timing = pageError === 'legacy' ? "<script>performance.getEntriesByType = () => []</script>" : '';
        return new Response(timing + '<title>Service unavailable</title>', { status: 503, headers: { 'content-type': 'text/html' } });
      }
      if (dropPage && !req.headers.get('user-agent')?.startsWith('ureq/')) {
        dropPage = false;
        proxy.server?.stop(true);
        proxy.server = undefined;
        return new Promise<Response>(() => {});
      }
      if (onHealth && url.pathname === '/api/projects' && req.headers.get('user-agent')?.startsWith('ureq/')) {
        server.timeout(req, 0);
        await onHealth();
      }
      if (rejectHealth && url.pathname === '/api/projects' && req.headers.get('user-agent')?.startsWith('ureq/')) {
        rejectedHealthChecks++;
        return new Response(null, { status: 503 });
      }
      if (url.pathname === '/api/app-rebuilt' && remoteBusy) {
        busyChecks++;
        return Response.json({ now: false, kept: false });
      }
      const headers = new Headers(req.headers);
      headers.set('x-forwarded-for', '100.64.0.7');
      headers.set('x-forwarded-host', `${HOST}:${port}`);
      headers.set('x-forwarded-proto', 'http');
      if (liveComposer && req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        const ProxySocket = WebSocket as unknown as new (url: string, options: Bun.WebSocketOptions) => WebSocket;
        const upstream = new ProxySocket(remoteUrl.replace('http:', 'ws:') + url.pathname, { headers: {
          cookie: headers.get('cookie') ?? '', 'x-forwarded-for': '100.64.0.7',
          'x-forwarded-host': `${HOST}:${port}`, 'x-forwarded-proto': 'http',
        } });
        if (server.upgrade(req, { data: { upstream } })) return;
        upstream.close();
        return new Response(null, { status: 400 });
      }
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
      const res = await fetch(`${remoteUrl}${url.pathname}${url.search}`, { method: req.method, headers, body, redirect: 'manual' });
      // fetch has decoded the body already
      const back = new Headers(res.headers);
      back.delete('content-encoding');
      back.delete('content-length');
      return new Response(res.body, { status: res.status, headers: back });
    },
    websocket: {
      open(socket) {
        reconnectRemote = () => socket.close();
        const upstream = socket.data.upstream;
        upstream.onmessage = event => {
          if (replacementHello && typeof event.data === 'string') {
            const message = JSON.parse(event.data);
            if (message.type === 'hello') {
              socket.send(JSON.stringify({ ...message, server: 'check-replacement-server' }));
              return;
            }
          }
          socket.send(event.data);
        };
        upstream.onclose = () => socket.close();
        upstream.onerror = () => socket.close();
      },
      message(socket, data) {
        const upstream = socket.data.upstream;
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
        else upstream.addEventListener('open', () => upstream.send(data), { once: true });
      },
      close(socket) { socket.data.upstream.close(); },
    },
  });
};
const code = async () => ((await (await asOwner('/api/access/pair', { method: 'POST' })).json()) as { code: string }).code;

// ---------------------------------------------------------------- what the pages run, and where they report
type Done = { id: number; ok: boolean; value?: unknown; error?: string };
const todo: { id: number; label: string; kind: string; cmd: string; args?: unknown }[] = [];
const done = new Map<number, Done>();
const reports: Record<string, unknown>[] = [];
const polls = new Map<string, number>();
const MODULE = `
const base = new URL('.', import.meta.url);
const post = (path, body) => fetch(new URL(path, base), { method: 'POST', body: JSON.stringify(body) });
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
const outcome = (p) => p.then((value) => ({ ok: true, value }), (e) => ({ ok: false, error: String(e) }));
const metadata = window.__TAURI_INTERNALS__.metadata;
const label = metadata.currentWebview.label;
const identity = { label, window: metadata.currentWindow.label, windows: window.seismicCheckWindowCount };
let pollTurn = 0;
function startCommands(kind) {
  const start = () => void runCommands(kind, ++pollTurn);
  addEventListener('pagehide', () => { pollTurn++; });
  addEventListener('pageshow', (event) => { if (event.persisted) start(); });
  start();
}
async function runCommands(kind, turn) {
  while (turn === pollTurn) {
    const next = await fetch(new URL('todo?label=' + label + '&kind=' + kind, base))
      .then((res) => res.json()).catch(() => null);
    if (next && turn === pollTurn) {
      const work = next.cmd === 'check_eval' ? Promise.resolve().then(() => (0, eval)(next.args.js)) : invoke(next.cmd, next.args);
      void outcome(work).then((result) => post('done', { id: next.id, ...result }));
    } else await new Promise((r) => setTimeout(r, 200));
  }
}
if (location.origin === ${JSON.stringify(REMOTE)}) {
  // A restored page reads its handover before mounting the app.
  for (let n = 0; n < 60 && !document.getElementById('root')?.firstChild; n++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await Promise.race([
    window.seismicDraftsReady,
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  const entries = new Map([
    ...(window.seismicSnapshotSession?.() ?? Object.entries(sessionStorage)),
    ...(window.seismicDraftOverflow ?? []),
  ]);
  const out = { ...identity, kind: 'remote', href: location.href, mounted: !!document.getElementById('root')?.firstElementChild, handedOver: window.seismicApp?.handedOver, previousSession: entries.get('check-workspace-session') ?? null, previousDraft: entries.get('seismic-drafts-check') ?? null, previousWish: entries.get('seismic-wish-check') ?? null, previousConfig: entries.get('seismic-config-draft-check') ?? null };
  out.previousOverflowDraft = JSON.parse(entries.get('seismic-drafts-quota-check') ?? '{}')['card:q']?.text;
  out.previousOverflowConfig = JSON.parse(entries.get('seismic-config-draft-project:quota-check') ?? '{}').name;
  out.restoredInMemory = sessionStorage.getItem('seismic-drafts-quota-check') === null && out.previousOverflowDraft !== undefined;
  // Inspect the recovered drafts while storage is still full. Remove the fixture
  // filler before attempting any writes for the next step.
  for (const key of Object.keys(sessionStorage)) if (key.startsWith('quota-')) sessionStorage.removeItem(key);
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
  startCommands('remote');
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
  startCommands('status');
  async function checkStatus() {
    await new Promise((r) => setTimeout(r, 500));
    const help = document.getElementById('recovery-help');
    await post('result', {
      ...identity, kind: 'status', title: document.getElementById('title').textContent,
      documentTitle: document.title, why: document.getElementById('why').textContent,
      help: help?.textContent, helpHref: help?.href, desks: await outcome(invoke('desks')),
    });
  }
  addEventListener('pageshow', (event) => { if (event.persisted) void checkStatus(); });
  await checkStatus();
} else if (location.protocol === 'http:' && location.hostname === '127.0.0.1') {
  if (location.port === ${JSON.stringify(String(oldPort))} && location.pathname !== '/workspaces') history.replaceState(null, '', '/?takeover-check=kept');
  addEventListener('seismic-desks', async () => post('result', { kind: 'desksChanged', ...(await outcome(invoke('desks'))) }));
  await post('result', { ...identity, kind: 'local', href: location.href, minimized: window.seismicCheckMinimized });
  startCommands('local');
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
      const next = todo.findIndex((task) => task.label === label && task.kind === searchParams.get('kind'));
      return json(next === -1 ? null : todo.splice(next, 1)[0]);
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
const displayed = () => reports.findLast((r) => ['local', 'remote', 'status'].includes(String(r.kind)));
const send = (cmd: string, args?: Record<string, unknown>) => {
  const id = ++n;
  const page = displayed();
  todo.push({ id, label: String(page?.label), kind: String(page?.kind), cmd, args });
  return id;
};
const run = (cmd: string, args?: Record<string, unknown>) => {
  const id = send(cmd, args);
  return until(`${cmd} to answer`, 10_000, () => done.get(id));
};
const pasteScreenshot = `(async () => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10;
  const blob = await new Promise(resolve => canvas.toBlob(resolve));
  const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'capture.png', {type:'image/png'}));
  const event = new Event('paste', {bubbles:true,cancelable:true});
  Object.defineProperty(event, 'clipboardData', {value:transfer}); document.body.dispatchEvent(event);
  return event.defaultPrevented;
})()`;
const decideAttachment = async (button: string) => {
  const js = `(() => {
    const buttons = [...document.querySelectorAll('[role=alertdialog] button')];
    if (buttons.map(b => b.textContent).join('|') !== 'Switch after upload|Discard and switch|Go back') return false;
    const action = buttons.find(b => b.textContent === ${JSON.stringify(button)});
    if (!action || action.disabled) return false;
    action.click(); return true;
  })()`;
  await until('the three attachment choices', 6000, async () => (await run('check_eval', { js })).value === true);
};
// Hold the local composer at the response boundary so it can finish even after its server goes away.
const holdLocalScreenshot = async (image: string) => {
  const js = `(() => {
    const realFetch = window.fetch;
    window.fetch = (input, init) => {
      if (init?.method !== 'POST' || !String(input).endsWith('/images')) return realFetch(input, init);
      window.fetch = realFetch;
      return new Promise(resolve => {
        window.releaseScreenshot = () => resolve(Response.json({ id: ${JSON.stringify(image)} }));
      });
    };
  })()`;
  await run('check_eval', { js });
  const pasted = await run('check_eval', { js: pasteScreenshot });
  expect(pasted.value === true, 'the local project did not accept the pasted screenshot');
  await until('the local screenshot upload', 6000, async () =>
    (await run('check_eval', { js: "typeof window.releaseScreenshot === 'function'" })).value === true);
};
const releaseLocalScreenshot = () => run('check_eval', { js: 'window.releaseScreenshot(); delete window.releaseScreenshot' });
const expectConnectionProgress = () => until('connection progress on the visible workspace', 5000, async () => {
  const result = await run('check_eval', {
    js: "[document.visibilityState, document.querySelector('[role=dialog] [role=status]')?.textContent.trim()]",
  });
  return JSON.stringify(result.value) === '["visible","Connecting to workspace…"]';
});
const pairAfterUpload = async (cmd: 'add_desk' | 'pair_desk', args: Record<string, string>) => {
  const attempts = pairRequests;
  await holdLocalScreenshot(cmd + '-shot');
  const probe = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<void>();
  let uploadReleased = false;
  try {
    const cancelled = send(cmd, args);
    await decideAttachment('Go back');
    const result = await until('Go back to cancel pairing', 5000, () => done.get(cancelled));
    expect(result.error === 'cancelled' && pairRequests === attempts, JSON.stringify(result));
    const retry = send(cmd, args);
    await decideAttachment('Switch after upload');
    // The one-minute link cannot age while the upload is held because the POST hasn't happened.
    await sleep(400);
    expect(pairRequests === attempts && !done.has(retry), 'the code was spent while the attachment was pending');
    onHealth = () => { probe.resolve(); return answer.promise; };
    uploadReleased = true;
    await releaseLocalScreenshot();
    await Promise.race([probe.promise, sleep(5000).then(() => { throw new Error('no pairing health check'); })]);
    await expectConnectionProgress();
    return retry;
  } finally {
    onHealth = undefined;
    answer.resolve();
    if (!uploadReleased) await releaseLocalScreenshot();
  }
};
type Desks = { current: string | null; problem: string | null; list: { id: string; name: string; origin: string | null; local: boolean; open: boolean }[] };
const expectStatusCopy = (report: (typeof reports)[number]) => {
  const desks = (report.desks as { value?: Desks }).value;
  const workspace = desks?.list.find((desk) => desk.id === desks.current);
  if (!workspace?.origin) throw new Error(`Status has no remote workspace: ${JSON.stringify(report)}`);
  const strings = t.desktopPages.status;
  const title = strings.unresponsive(workspace.name);
  const problem = desks?.problem;
  const reason = problem === 'unreachable' || problem === 'notSeismic' || problem === 'notLoaded'
    ? strings[problem] : strings.check;
  expect(report.title === title && report.documentTitle === title && report.why === reason(workspace.origin), JSON.stringify(report));
  expect(report.help === strings.help && report.helpHref === 'https://seismic.im/docs/install/', JSON.stringify(report));
};
const report = async (kind: string, after = 0, timeout = 60_000) => {
  const result = await until(`the ${kind} page to report`, timeout, () => reports.slice(after).find((r) => r.kind === kind));
  if (kind === 'status') expectStatusCopy(result);
  return result;
};
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
  SEISMIC_PORT: String(samePortTakeover ? oldPort : 4600 + Math.floor(Math.random() * 300)),
  // the debug shell runs this checkout's server
  SEISMIC_CHECKOUT: ROOT,
  SEISMIC_BUN: join(launcherDir, basename(process.execPath)),
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
const startApp = () => Bun.spawn([program], { env, stdout: 'ignore', stderr: args.includes('--keep') ? 'inherit' : 'ignore' });
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

let app: Subprocess | undefined;
let terminal: Subprocess | undefined;
async function checkApp() {
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
  const description = quitDuringTakeover
    ? 'Quit stops the replacement server while the attachment dialog is open'
    : failedSamePortNavigation ? 'the queued reload recovers when same-port navigation never commits'
      : `taking over on ${samePortTakeover ? 'the same port' : 'a different port'} honors Go back and reconnects after the upload`;
  const transferred = await check(description, async () => {
    const oldLabel = String(initial.label);
    expect(String(initial.href).startsWith(`http://127.0.0.1:${oldPort}/`), JSON.stringify(initial));
    expect((await desks()).current === 'local', 'the original window cannot use its local capability');
    const before = reports.length;
    await holdLocalScreenshot('takeover-shot');
    if (samePortTakeover) {
      await run('check_eval', { js: `window.WebSocket = class extends WebSocket {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', ({ data }) => {
            if (JSON.parse(data).type === 'hello') window.checkReconnected = true;
          });
        }
      }` });
    }
    const res = await appApi('/api/app-takeover').catch((error) => {
      if (error.code !== 'ECONNRESET') throw error;
      return null;
    });
    expect(res === null || (res?.ok && (await res.json()).taking), 'the takeover did not start');
    if (quitDuringTakeover) {
      await until('the attachment dialog', 15_000, async () =>
        (await run('check_eval', { js: "!!document.querySelector('[role=alertdialog]')" })).value === true);
      const replacement = entry();
      expect(replacement && new URL(replacement.url).port !== String(oldPort), 'no replacement server');
      // Send the same standard termination request as macOS Quit, to this scratch app alone.
      const quit = Bun.spawnSync(['swift', '-e', `
        import AppKit
        guard NSRunningApplication(processIdentifier: ${app!.pid})?.terminate() == true else { exit(1) }
      `]);
      expect(quit.exitCode === 0, quit.stderr.toString());
      expect(await exited(app!, 15_000) === 0, 'the app did not quit with the upload still held');
      await until('Quit to stop the replacement server', 15_000, async () => {
        if (entry()) return false;
        const response = await fetch(`${replacement!.url}/api/projects`, { signal: AbortSignal.timeout(500) }).catch(() => null);
        return response === null;
      });
      return;
    }
    await decideAttachment('Go back');
    if (samePortTakeover) {
      await until('the old document to receive the new server hello', 15_000, async () =>
        (await run('check_eval', { js: 'window.checkReconnected === true' })).value === true);
    } else {
      // Keep the upload held long enough for another attachment poll.
      await sleep(400);
    }
    const kept = await run('check_eval', { js: "!document.querySelector('[role=alertdialog]') && !!window.releaseScreenshot" });
    expect(displayed()?.label === oldLabel && kept.value === true, 'Go back switched, cancelled the upload, or prompted again');
    const workspacesDuringReload = samePortTakeover && !failedSamePortNavigation;
    if (workspacesDuringReload) {
      send('open_desk', { id: 'local', page: '/workspaces?new' });
      // The request supersedes the earlier attachment check. Release the upload
      // only after the new check has reached the still-visible old document.
      await decideAttachment('Go back');
    }
    if (failedSamePortNavigation) writeFileSync(join(home, 'check-local-navigation-not-committed'), '');
    send('check_eval', { js: 'window.releaseScreenshot()' });
    const next = await until('the local page after sign-in', 60_000, () => reports.slice(before).find((r) =>
      r.kind === 'local' && new URL(String(r.href)).pathname !== '/login'));
    expect((await run('check_eval', { js: "JSON.stringify(Object.entries(sessionStorage))" })).value?.toString().includes('takeover-shot'), 'the screenshot was lost during reattachment');
    expect((new URL(String(next.href)).origin === new URL(String(initial.href)).origin) === samePortTakeover, JSON.stringify(next));
    expect(typeof next.label === 'string' && (next.label === oldLabel) === samePortTakeover, JSON.stringify(next));
    if (workspacesDuringReload) {
      await until('New Workspace on the reauthenticated document', 5000, async () =>
        (await run('check_eval', { js: "location.search === '?new' && !!document.querySelector('.desk-connect')" })).value === true);
    } else {
      expect(new URL(String(next.href)).searchParams.get('takeover-check') === 'kept', JSON.stringify(next));
    }
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
    expect((polls.get(oldLabel) !== polled) === samePortTakeover, 'unexpected polling from the original webview');
    return `${oldLabel} at ${new URL(String(initial.href)).origin} → ${next.label} at ${new URL(String(next.href)).origin}${minimizedTakeover ? ', both minimized' : ''}`;
  });
  expect(transferred, 'the local server was not taken over');
  if (samePortTakeover || quitDuringTakeover) return;
  let id = '';
  await check('this machine has its own workspace and nothing else', async () => {
    const d = await desks();
    expect(d.current === 'local' && d.list.length === 1 && d.list[0]!.local, JSON.stringify(d));
    return d.list[0]!.name;
  });
  await check('an in-place Workspaces request waits for the local page to handle it', async () => {
    const label = displayed()?.label;
    await until('the local route handler to start', 5000, async () =>
      (await run('check_eval', { js: "typeof window.seismicDeskPage === 'function'" })).value === true);
    const held = await run('check_eval', { js: `(() => {
      if (typeof window.seismicDeskPage !== 'function') return false;
      const ready = window.seismicDeskPage;
      window.seismicDeskPage = () => { window.checkDeskWaiting = true; return false; };
      window.checkDeskReady = () => { window.seismicDeskPage = ready; };
      return true;
    })()` });
    expect(held.value === true, 'the local page did not start');
    try {
      const first = send('open_desk', { id: 'local', page: '/workspaces' });
      await until('the shell to try the unready document', 5000, async () =>
        (await run('check_eval', { js: 'window.checkDeskWaiting === true' })).value === true);
      expect(!done.has(first), 'the shell reported success before the page handled it');
      const next = send('open_desk', { id: 'local', page: '/workspaces?new' });
      await until('the earlier destination to be superseded', 5000, () => done.get(first)?.error === 'superseded');
      await run('check_eval', { js: 'window.checkDeskReady()' });
      const answer = await until('the page to acknowledge New Workspace', 5000, () => done.get(next));
      expect(answer.ok && displayed()?.label === label, JSON.stringify(answer));
      await until('the form to open in place', 5000, async () =>
        (await run('check_eval', { js: "location.search === '?new' && !!document.querySelector('.desk-connect')" })).value === true);
      const back = await run('check_eval', { js: `[...document.querySelectorAll('.desks-page button')].find(b => b.textContent.trim() === 'Back').click()` });
      expect(back.ok, JSON.stringify(back));
    } finally {
      await run('check_eval', { js: 'window.checkDeskReady()' });
    }
  });
  await check('Workspaces reports the draft decision and only succeeds after navigation', async () => {
    const evaluate = async (js: string) => (await run('check_eval', { js })).value;
    const click = (selector: string, label: string) => evaluate(`(() => {
      const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) =>
        b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent.trim() === ${JSON.stringify(label)});
      if (!button) return false;
      button.click();
      return true;
    })()`);
    const name = "[...document.querySelectorAll('.cs-entry input')].find((input) => input.value === 'Lab' || input.value === 'Draft Lab')";
    await until('the project settings button', 5000, () => click('button', 'Settings of this project'));
    await until('project Configuration', 5000, () => click('#project-settings button', 'Configuration'));
    await until('the editable project name', 5000, () => evaluate(`(() => {
      const input = ${name};
      if (!input) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Draft Lab');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`));
    const at = await evaluate('location.href');
    const prompt = '[data-slot=confirm-dialog].cs-unsaved';
    const waitForPrompt = () => until('the unsaved changes prompt', 5000, () =>
      evaluate(`!!document.querySelector(${JSON.stringify(prompt)})`));
    const request = send('open_desk', { id: 'local', page: '/workspaces?new' });
    await waitForPrompt();
    expect(!done.has(request) && await evaluate('location.href') === at, 'New Workspace completed while asking');
    expect(await click(`${prompt} button`, 'Stay'), 'the Stay button was unavailable');
    const stayed = await until('Stay to cancel the request', 5000, () => done.get(request));
    expect(stayed.error === 'cancelled' && await evaluate(`${name}?.value`) === 'Draft Lab', JSON.stringify(stayed));
    const replaced = send('open_desk', { id: 'local', page: '/workspaces?new' });
    await waitForPrompt();
    expect((await run('open_desk', { id: 'local' })).ok, 'the current workspace could not be selected');
    await until('the first route to be superseded', 5000, () => done.get(replaced)?.error === 'superseded');
    await until('the superseded prompt to close', 5000, () =>
      evaluate(`!document.querySelector(${JSON.stringify(prompt)})`));
    const cog = send('open_desk', { id: 'local', page: '/workspaces?edit=local' });
    await waitForPrompt();
    expect(!done.has(cog) && await evaluate('location.href') === at, 'the cog completed while asking');
    expect(await click(`${prompt} button`, 'Discard and close'), 'the discard button was unavailable');
    const opened = await until('the requested route to open', 5000, () => done.get(cog));
    expect(opened.ok && await evaluate("location.pathname + location.search") === '/workspaces?edit=local', JSON.stringify(opened));
    await until('the local workspace settings', 5000, () => click('.desk-edit button', 'Close'));
    expect(await click('.desks-page button', 'Back'), 'the Back button was unavailable');
    expect(await evaluate('location.href') === at, 'Back did not return to the project');
    if (new URL(String(at)).searchParams.has('settings')) {
      await until('the project settings to reopen', 5000, () => click('button[aria-expanded=true]', 'Settings of this project'));
    }
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
  await check('Add refuses a pairing reply from an unrelated service', async () => {
    const label = displayed()?.label;
    unrelatedPairing = true;
    try {
      const result = await run('add_desk', { address: REMOTE, code: '123456' });
      expect(result.error === 'notSeismic' && (await desks()).list.length === 1, JSON.stringify(result));
      expect(displayed()?.label === label && unrelatedPageRequests === 0, 'the unrelated page was requested');
    } finally {
      unrelatedPairing = false;
    }
  });
  if (debugFailures) {
    await check('a saved workspace is reported and listed even if its first window fails', async () => {
      const before = reports.length;
      const attempts = pairRequests;
      writeFileSync(join(home, 'check-window-open-error'), '');
      const request = await pairAfterUpload('add_desk', { address: REMOTE, code: await code(), name: 'Studio' });
      const result = await until('the accepted add to report its failed open', 5000, () => done.get(request));
      const value = result.value as { id: string; opened: boolean } | undefined;
      expect(result.ok && value?.opened === false && pairRequests === attempts + 1, JSON.stringify(result));
      id = value!.id;
      await changedDesk(before, id, REMOTE);
      const saved = JSON.parse(readFileSync(join(home, 'app-desks.json'), 'utf8')) as { list: { id: string; url: string }[] };
      expect(saved.list.some((w) => w.id === id && w.url === REMOTE), 'the new workspace was not saved');
    });
  }
  const pairBefore = reports.length;
  const attempts = pairRequests;
  await pairAfterUpload(id ? 'pair_desk' : 'add_desk', { ...(id ? { id } : { address: REMOTE, name: 'Studio' }), code: await code() });
  const first = await report('remote', pairBefore) as Record<string, { ok: boolean; value?: unknown; error?: string }>;
  id ||= (first.desks!.value as Desks).current!;
  await check('pairing loads the remote address in the same native window', () => {
    expect(first.window === initial.window && Number(first.windows) === 1 && String(first.label) !== String(initial.label), JSON.stringify(first));
  });
  if (first) {
    await check("the window shows the remote project, signed in by the one-time link", () => {
      expect(String(first.href).startsWith(`${REMOTE}/`) && !String(first.href).includes('/pair'), String(first.href));
      expect((first.projects as unknown as number) === 200 && pairRequests === attempts + 1, `GET /api/projects: ${first.projects}`);
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
  // The destination reports success because switching retires the invoking document.
  const select = async (id: string, kind: string, waitForLocalServer = false) => {
    const before = reports.length;
    const previous = displayed();
    let request = send('open_desk', { id });
    const result = await until(`the ${kind} page to report after selection`, 15_000, () => {
      const answer = done.get(request);
      if (answer?.ok === false) {
        if (!waitForLocalServer || answer.error !== 'unreachable') return { error: answer.error };
        request = send('open_desk', { id });
      }
      const next = reports.slice(before).find((r) => r.kind === kind);
      return next ? { next } : undefined;
    });
    if (!result.next) throw new Error(result.error);
    const next = result.next;
    expect(next.window === previous?.window && next.windows === 1 && next.label !== previous?.label, JSON.stringify({ previous, next }));
    if (kind === 'status') expectStatusCopy(next);
    return next;
  };
  const reconnect = () => {
    const before = reports.length;
    const request = send('retry_desk');
    return until('the selected workspace to reconnect', 15_000, () => {
      const result = done.get(request);
      if (result?.ok === false) throw new Error(result.error);
      return reports.slice(before).find((r) => r.kind === 'remote');
    });
  };
  await check('Pair again verifies the current and proposed addresses before opening them', async () => {
    const local = await select('local', 'local');
    const other = startProxy(0);
    unrelatedPairing = true;
    try {
      for (const address of [REMOTE, `http://${HOST}:${other.port}`]) {
        const result = await run('pair_desk', { id, address, code: '123456' });
        expect(result.error === 'notSeismic', JSON.stringify(result));
      }
      expect((await desks()).list.find(d => d.id === id)?.origin === REMOTE, 'the saved workspace moved');
      expect(displayed()?.label === local.label && unrelatedPageRequests === 0, 'the unrelated page was requested');
    } finally {
      unrelatedPairing = false;
      other.stop(true);
    }
    await select(id, 'remote');
  });
  await check('switching local and back keeps the window, pairing, route, and drafts', async () => {
    const edited = await run('check_eval', { js: `history.replaceState(null, '', ${JSON.stringify(LAST_PAGE)}); sessionStorage.setItem('seismic-drafts-check', 'Draft before switching')` });
    expect(edited.ok, JSON.stringify(edited));
    const previous = String(first.label);
    const local = await select('local', 'local');
    expect((await desks()).current === 'local', JSON.stringify(local));
    const retired = polls.get(previous);
    await sleep(600);
    expect(polls.get(previous) === retired, 'the previous workspace still runs');
    const remote = await select(id, 'remote');
    expect(String(remote.href).endsWith(LAST_PAGE) && remote.previousDraft === 'Draft before switching' && remote.projects === 200, JSON.stringify(remote));
    expect((await desks()).list.filter((d) => d.open).map((d) => d.id).join() === id, 'more than the selected workspace was active');
  });
  await check('the last edit and route before the outgoing page is hidden survive switching', async () => {
    await select('local', 'local');
    const hit = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    onHealth = () => { hit.resolve(); return release.promise; };
    const before = reports.length;
    send('open_desk', { id });
    try {
      await Promise.race([hit.promise, sleep(6000).then(() => { throw new Error('no held health check'); })]);
      const edit = await run('check_eval', { js: `
        history.replaceState(null, '', '/?view=last-edit');
        sessionStorage.setItem('seismic-drafts-last-edit', 'edited during the switch');
        const snapshot = window.seismicSnapshotSession;
        window.seismicSnapshotSession = () => [...(snapshot?.() ?? Object.entries(sessionStorage)),
          ['seismic-drafts-capture-visibility', document.visibilityState]];
      ` });
      expect(edit.ok, JSON.stringify(edit));
    } finally {
      onHealth = undefined;
      release.resolve();
    }
    await report('remote', before);
    const local = await select('local', 'local');
    const saved = await run('check_eval', { js: "[sessionStorage.getItem('seismic-drafts-last-edit'), sessionStorage.getItem('seismic-drafts-capture-visibility')]" });
    expect(String(local.href).endsWith('/?view=last-edit') && JSON.stringify(saved.value) === JSON.stringify(['edited during the switch', 'hidden']), JSON.stringify({ local, saved }));
    await select(id, 'remote');
  });
  await check('a newer selection supersedes an earlier health check', async () => {
    await select('local', 'local');
    const hit = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    onHealth = () => { hit.resolve(); return release.promise; };
    const before = reports.length;
    try {
      const stale = send('open_desk', { id });
      await Promise.race([hit.promise, sleep(6000).then(() => { throw new Error('no held health check'); })]);
      expect((await run('open_desk', { id: 'local' })).ok, 'selecting the current workspace failed');
      const result = await until('the older selection to settle', 5000, () => done.get(stale));
      expect(result.error === 'superseded', JSON.stringify(result));
    } finally {
      onHealth = undefined;
      release.resolve();
    }
    await sleep(700);
    expect(reports.slice(before).every((r) => r.kind !== 'remote' && r.kind !== 'status'), 'an older request replaced the current page');
  });
  await check('selecting an offline workspace shows status and lets you switch away', async () => {
    proxy.server!.stop(true);
    proxy.server = undefined;
    const status = await select(id, 'status');
    const before = reports.length;
    const name = JSON.stringify((await desks()).list[0]!.name);
    send('check_eval', { js: `[...document.querySelectorAll('#others button')].find(button => button.textContent === ${name}).click()` });
    const local = await report('local', before, 15_000);
    expect(local.windows === 1 && local.window === status.window && local.label !== status.label, JSON.stringify(local));
  });
  await check('Try again reconnects the current workspace in the same view', async () => {
    const status = await select(id, 'status');
    proxy.server = startProxy();
    const remote = await reconnect();
    expect(remote.label === status.label && remote.windows === 1 && String(remote.href).endsWith(LAST_PAGE), JSON.stringify(remote));
  });
  await check('Try again keeps newer drafts that could only fit in memory', async () => {
    const edit = await run('check_eval', { js: `(async () => {
      history.replaceState(null, '', ${JSON.stringify(PAGE_BEFORE_BACK)});
      sessionStorage.setItem('seismic-config-draft-project:quota-check', ${JSON.stringify(STALE_CONFIG)});
      for (let size = 512 * 1024; size >= 16; size = Math.floor(size / 2)) {
        for (let i = 0; i < 20; i++) {
          try { sessionStorage.setItem('quota-' + size + '-' + i, 'x'.repeat(size)); } catch { break; }
        }
      }
      return (await import(${JSON.stringify(new URL('quota.js', harness.url).href)})).edit(${JSON.stringify(OVERFLOW_DRAFT)});
    })()` });
    expect(edit.value === true, JSON.stringify(edit));
    const before = reports.length;
    send('check_eval', { js: 'history.back()' });
    const status = await report('status', before, 12_000);
    const remote = await reconnect();
    expect(remote.label === status.label && remote.previousOverflowDraft === OVERFLOW_DRAFT && remote.previousOverflowConfig === OVERFLOW_DRAFT && String(remote.href).endsWith(PAGE_BEFORE_BACK), JSON.stringify(remote));
  });
  await check('rebuilding restores only the selected workspace and keeps parked drafts', async () => {
    await select('local', 'local');
    await run('check_eval', { js: "sessionStorage.setItem('seismic-drafts-check', 'Draft on this machine')" });
    await select(id, 'remote');
    const before = reports.length;
    remoteBusy = true;
    try {
      await relaunch();
      await until('the shell to check remote activity', 10_000, () => busyChecks >= 2);
      expect(!reports.slice(before).some((r) => ['local', 'remote', 'status'].includes(String(r.kind))), 'the app relaunched while the remote workspace was busy');
    } finally {
      remoteBusy = false;
    }
    const restored = await report('remote', before, 20_000);
    expect(restored.windows === 1 && restored.projects === 200 && restored.previousOverflowDraft === OVERFLOW_DRAFT, JSON.stringify(restored));
    // The selected remote can restore before the server on this machine has started.
    await select('local', 'local', true);
    const local = await run('check_eval', { js: "new Map(window.seismicSnapshotSession?.() ?? Object.entries(sessionStorage)).get('seismic-drafts-check')" });
    expect(local.value === 'Draft on this machine', JSON.stringify(local));
  });
  await check('two offline rebuilds keep the selected workspace and its drafts', async () => {
    proxy.server!.stop(true);
    proxy.server = undefined;
    const status = await select(id, 'status');
    expect(status.windows === 1, JSON.stringify(status));
    for (let i = 0; i < 2; i++) {
      const before = reports.length;
      await relaunch();
      const restored = await report('status', before, 20_000);
      expect(restored.windows === 1, JSON.stringify(restored));
    }
    proxy.server = startProxy();
    const remote = await reconnect();
    expect(remote.previousOverflowDraft === OVERFLOW_DRAFT && String(remote.href).endsWith(PAGE_BEFORE_BACK), JSON.stringify(remote));
  });
  await check('a finished page supersedes the load check started while it was slow', async () => {
    await select('local', 'local');
    const page = Promise.withResolvers<void>(), checking = Promise.withResolvers<void>(), old = Promise.withResolvers<void>();
    let probes = 0;
    nextPage = () => page.promise;
    onHealth = async () => { if (++probes === 2) { checking.resolve(); await old.promise; } };
    const before = reports.length;
    try {
      send('open_desk', { id });
      await Promise.race([checking.promise, sleep(22_000).then(() => { throw new Error('no timeout verification'); })]);
      page.resolve();
      await report('remote', before);
      await until('a new verification for the finished page', 4000, () => probes >= 3);
      old.resolve();
      await sleep(700);
      expect(displayed()?.kind === 'remote' && (await desks()).problem === null, 'stale check replaced the page');
    } finally {
      onHealth = undefined; page.resolve(); old.resolve(); nextPage = undefined;
    }
  });
  await check('a same-origin HTTP error shows recovery while the projects endpoint stays healthy', async () => {
    await select('local', 'local');
    pageError = 'http';
    try {
      const status = await select(id, 'status');
      expect((await desks()).problem === 'notLoaded', JSON.stringify(status));
      pageError = 'legacy';
      const before = reports.length;
      send('retry_desk');
      const again = await report('status', before, 40_000);
      expect(again.label === status.label && (await desks()).problem === 'notLoaded', JSON.stringify(again));
    } finally {
      pageError = undefined;
    }
    await reconnect();
  });
  await check('a workspace that goes away while its page loads shows status, also after Try again', async () => {
    await select('local', 'local');
    dropPage = true;
    const before = reports.length;
    send('open_desk', { id });
    const status = await report('status', before, 40_000);
    expect(status.windows === 1, JSON.stringify(status));
    expect((await desks()).problem === 'unreachable', 'the status page has no problem to show');
    // No document ran at the attempted origin. The shell must be able to park its backup.
    await select('local', 'local');
    const offline = await select(id, 'status');
    const again = reports.length;
    proxy.server = startProxy();
    dropPage = true;
    send('retry_desk');
    const second = await report('status', again, 40_000);
    expect(second.label === offline.label, JSON.stringify(second));
    const beforeRestart = reports.length;
    await relaunch();
    const restored = await report('status', beforeRestart, 20_000);
    proxy.server = startProxy();
    const remote = await reconnect();
    expect(remote.label === restored.label && remote.projects === 200, JSON.stringify(remote));
  });
  await check("selecting this machine while its server does not answer keeps the current workspace", async () => {
    const remote = displayed()!;
    // The process that listens: the server's entry names the process that started it.
    const port = new URL(entry()!.url).port;
    const pid = Number(Bun.spawnSync(['lsof', '-ti', `tcp:${port}`, '-sTCP:LISTEN']).stdout.toString().trim().split('\n')[0]);
    expect(pid > 0, `nothing listens on ${port}`);
    process.kill(pid, 'SIGSTOP');
    try {
      const result = await run('open_desk', { id: 'local' });
      expect(!result.ok && result.error === 'unreachable', JSON.stringify(result));
    } finally {
      process.kill(pid, 'SIGCONT');
    }
    await sleep(700);
    expect(displayed()?.label === remote.label && (await desks()).current === id, 'the remote workspace was replaced');
    await select('local', 'local');
    await select(id, 'remote');
    return 'unreachable, then selected once it answered';
  });
  await check('relaunch restores the selected remote draft with the local executable missing', async () => {
    const before = reports.length;
    renameSync(launcherDir, launcherDir + '.held');
    try {
      await relaunch();
      const restored = await report('remote', before, 20_000);
      expect(!entry() && restored.previousOverflowDraft === OVERFLOW_DRAFT, 'lost the remote draft or started the local server');
      expect((await run('open_desk', { id: 'local' })).error === 'unreachable', 'selected a missing local server');
    } finally {
      renameSync(launcherDir + '.held', launcherDir);
    }
    terminal = Bun.spawn([process.execPath, join(ROOT, 'src', 'server', 'main.ts'), '--port', String(oldPort)], { env, stdout: 'ignore', stderr: 'ignore' });
    await until('the terminal server to return', 15_000, () => entry()?.url.endsWith(':' + oldPort));
    await sleep(1200);
    await appApi('/api/app-takeover').catch(() => null);
    await until('the app-owned server after takeover', 20_000, () => entry() && !entry()!.url.endsWith(':' + oldPort));
  });
  await check('a remote document keeps its edits when the local child or terminal server stops', async () => {
    const remoteLabel = displayed()?.label;
    let draft = 'Draft before the stop.';
    await run('check_eval', { js: `sessionStorage.setItem('seismic-drafts-stop', ${JSON.stringify(draft)})` });
    for (const owner of ['shell', 'terminal']) {
      await appApi('/api/stop').catch(() => null);
      await until(`the ${owner} server to stop`, 20_000, () => !entry());
      await sleep(1600);
      const edit = await run('check_eval', { js: "sessionStorage.getItem('seismic-drafts-stop')" });
      expect(edit.value === draft && displayed()?.label === remoteLabel, JSON.stringify(edit));
      draft += ` Edited after the ${owner} server stopped.`;
      expect((await run('check_eval', { js: `sessionStorage.setItem('seismic-drafts-stop', ${JSON.stringify(draft)})` })).ok, 'edit failed');
      expect((await run('open_desk', { id: 'local' })).error === 'unreachable', 'stopped server selected');
      const port = free();
      terminal = Bun.spawn([process.execPath, join(ROOT, 'src', 'server', 'main.ts'), '--port', String(port)], {
        env, stdout: 'ignore', stderr: 'ignore',
      });
      await until('the restarted terminal server to answer', 15_000, async () => (await fetch(`http://127.0.0.1:${port}/api/projects`, { headers: ownerHeaders(home) })).ok);
      await sleep(1500);
    }
    await select('local', 'local');
    await select(id, 'remote');
    expect((await run('check_eval', { js: "sessionStorage.getItem('seismic-drafts-stop')" })).value === draft, 'parked edit missing');
  });
  if (debugFailures) {
    await check('a failed switch leaves the current page, window, and saved drafts in place', async () => {
      const local = await select('local', 'local');
      writeFileSync(join(home, 'check-window-open-error'), '');
      const failed = await run('open_desk', { id });
      expect(failed.error === 'window' && displayed()?.label === local.label, JSON.stringify(failed));
      const restored = await select(id, 'remote');
      expect(restored.previousOverflowDraft === OVERFLOW_DRAFT, JSON.stringify(restored));
    });
  }
  await check('a pending screenshot offers wait, discard, and go back', async () => {
    await select('local', 'local');
    liveComposer = true;
    await select(id, 'remote');
    for (const choice of ['Switch after upload', 'Discard and switch']) {
      const hit = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      const image = choice === 'Switch after upload' ? 'completed-shot' : 'discarded-shot';
      imageUpload = async () => { hit.resolve(); await release.promise; return Response.json({ id: image }); };
      try {
        const pasted = await run('check_eval', { js: pasteScreenshot });
        if (pasted.value !== true) throw new Error('the project did not accept the pasted screenshot: ' + JSON.stringify(await run('check_eval', { js: 'document.body.innerText.slice(0,300)' })));
        await Promise.race([hit.promise, sleep(5000).then(() => { throw new Error('no upload'); })]);
        const cancelled = send('open_desk', { id: 'local' });
        await decideAttachment('Go back');
        await until('Go back to cancel the selection', 5000, () => done.get(cancelled)?.error === 'cancelled');
        expect((await desks()).current === id, 'Go back left the workspace');
        const before = reports.length;
        send('open_desk', { id: 'local' });
        await decideAttachment(choice);
        if (choice === 'Switch after upload') {
          expect((await desks()).current === id, 'switched with the upload pending');
          await run('check_eval', { js: `window.WebSocket = class extends WebSocket {
            constructor(...args) {
              super(...args);
              this.addEventListener('message', ({ data }) => {
                if (JSON.parse(data).server === 'check-replacement-server') window.checkReplacementHello = true;
              });
            }
          }` });
          expect(reconnectRemote, 'the remote project has no WebSocket');
          replacementHello = true;
          reconnectRemote!();
          await until('the waiting document to hear from the replacement server', 6000, async () =>
            (await run('check_eval', { js: 'window.checkReplacementHello === true' })).value === true);
          release.resolve();
        }
        await report('local', before);
        replacementHello = false;
        release.resolve();
        await select(id, 'remote');
        const saved = await run('check_eval', { js: "JSON.stringify(Object.entries(sessionStorage))" });
        expect(String(saved.value).includes('completed-shot') && !String(saved.value).includes('discarded-shot'), 'unexpected saved screenshots');
      } finally {
        replacementHello = false;
        imageUpload = undefined; release.resolve();
      }
    }
  });
  await check('the current workspace stays visible while checking a recovered destination', async () => {
    const local = await select('local', 'local');
    await holdLocalScreenshot('fresh-health-shot');
    const before = reports.length;
    const previous = rejectedHealthChecks;
    const probe = Promise.withResolvers<void>();
    const answer = Promise.withResolvers<void>();
    rejectHealth = true;
    try {
      send('open_desk', { id });
      await decideAttachment('Switch after upload');
      expect(rejectedHealthChecks > previous, 'the initial probe did not see the destination unavailable');
      rejectHealth = false;
      onHealth = () => { probe.resolve(); return answer.promise; };
      await releaseLocalScreenshot();
      await Promise.race([probe.promise, sleep(5000).then(() => { throw new Error('no second health check'); })]);
      await expectConnectionProgress();
      expect(displayed()?.label === local.label, 'the current workspace changed during the probe');
    } finally {
      rejectHealth = false;
      onHealth = undefined;
      answer.resolve();
    }
    const result = await until('the destination to open', 10_000, () =>
      reports.slice(before).find(item => item.kind === 'remote' || item.kind === 'status'));
    expect(result.kind === 'remote' && result.projects === 200, JSON.stringify(result));
  });
  await check('switching to this machine needs a fresh sign-in link after waiting for an upload', async () => {
    const label = displayed()?.label;
    const key = join(home, 'owner.key');
    const hit = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    imageUpload = async () => { hit.resolve(); await release.promise; return Response.json({ id: 'kept-while-offline' }); };
    try {
      expect((await run('check_eval', { js: pasteScreenshot })).value === true, 'the project did not accept the screenshot');
      await Promise.race([hit.promise, sleep(5000).then(() => { throw new Error('no upload'); })]);
      const selection = send('open_desk', { id: 'local' });
      await decideAttachment('Switch after upload');
      // Keep the same server and port, but make a new sign-in request fail.
      renameSync(key, key + '.held');
      try {
        release.resolve();
        const result = await until('the local selection to finish', 5000, () => done.get(selection));
        expect(result.error === 'unreachable' && displayed()?.label === label, JSON.stringify(result));
      } finally {
        renameSync(key + '.held', key);
      }
      expect((await run('check_eval', { js: "JSON.stringify(Object.entries(sessionStorage))" })).value?.toString().includes('kept-while-offline'), 'the remote draft lost its screenshot');
    } finally {
      imageUpload = undefined;
      release.resolve();
    }
    await select('local', 'local');
    await select(id, 'remote');
  });
  await check('a later Workspaces destination replaces the one waiting on an attachment', async () => {
    const cases = [
      { first: undefined, next: '/workspaces?new', form: '.desk-connect' },
      { first: '/workspaces?new', next: `/workspaces?edit=${encodeURIComponent(id)}`, form: '.desk-edit' },
    ];
    for (const { first, next, form } of cases) {
      const hit = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      imageUpload = async () => { hit.resolve(); await release.promise; return Response.json({ id: 'destination-shot' }); };
      try {
        expect((await run('check_eval', { js: pasteScreenshot })).value === true, 'the project did not accept the screenshot');
        await Promise.race([hit.promise, sleep(5000).then(() => { throw new Error('no upload'); })]);
        const original = send('open_desk', { id: 'local', page: first });
        await decideAttachment('Switch after upload');
        const before = reports.length;
        send('open_desk', { id: 'local', page: next });
        await until('the previous destination to be superseded', 5000, () => done.get(original)?.error === 'superseded');
        // The new destination asks what to do with the same pending upload.
        await decideAttachment('Switch after upload');
        release.resolve();
        await until(`the local page at ${next}`, 10_000, () => reports.slice(before).find((r) => {
          if (r.kind !== 'local') return false;
          const at = new URL(String(r.href));
          return `${at.pathname}${at.search}` === next;
        }));
        await until('the requested Workspaces form', 5000, async () =>
          (await run('check_eval', { js: `!!document.querySelector(${JSON.stringify(form)})` })).value === true);
      } finally {
        imageUpload = undefined;
        release.resolve();
      }
      await select(id, 'remote');
    }
  });
  liveComposer = false;
  await check('removing a workspace cancels a pending switch without closing the window', async () => {
    const local = await select('local', 'local');
    const hit = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    onHealth = () => { hit.resolve(); return release.promise; };
    try {
      const pending = send('open_desk', { id });
      await Promise.race([hit.promise, sleep(6000).then(() => { throw new Error('no held health check'); })]);
      expect((await run('remove_desk', { id })).ok, 'removal failed');
      const result = await until('the pending selection to settle', 5000, () => done.get(pending));
      expect(!result.ok && !(await desks()).list.some((d) => d.id === id), JSON.stringify(result));
    } finally {
      onHealth = undefined;
      release.resolve();
    }
    expect(displayed()?.label === local.label && (await desks()).current === 'local', 'removal replaced the local page');
    const saved = JSON.parse(readFileSync(join(home, 'app-desks.json'), 'utf8')) as { list: { id: string }[] };
    expect(!saved.list.some((d) => d.id === id), 'removal was not saved');
  });
}
try {
  await checkApp();
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
