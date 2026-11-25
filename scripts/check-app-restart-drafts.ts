

















import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ownerHeaders } from '../src/server/owner';
import { check, exited, expect, failed, until } from './check-harness';

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const programArg = args.find((a) => !a.startsWith('--'));
if (!programArg) {
  console.error("usage: bun scripts/check-app-restart-drafts.ts <the app's program> [--keep]");
  process.exit(2);
}
const program = resolve(programArg);
const ROOT = resolve(import.meta.dir, '..');

const dir = mkdtempSync(join(tmpdir(), 'seismic-restart-drafts-check-'));
const home = join(dir, 'home');
const repo = join(dir, 'lab');
mkdirSync(home);
mkdirSync(repo);
Bun.spawnSync(['git', 'init', '-q', repo]);
writeFileSync(join(home, 'projects.json'), JSON.stringify([{ name: 'Lab', repos: [{ path: repo }] }]));

const free = () => {
  const s = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = s.port!;
  s.stop(true);
  return port;
};


type Report = { page: string; handedOver?: boolean; draft: string | null; view: string | null };
type Handover = { token: string; entries: [string, string][] };
type Gate = { captured?: Handover; response: ReturnType<typeof Promise.withResolvers<boolean>> };
let gate: Gate | undefined;
const armGate = (): Gate => (gate = { response: Promise.withResolvers<boolean>() });
const reports: Report[] = [];
type Command = { id: number; js: string };
const todo = new Map<string, Command>();
const done = new Map<number, { ok: boolean; value?: unknown; error?: string }>();
const MODULE = `
const base = new URL('.', import.meta.url);
const post = (path, body) => fetch(new URL(path, base), { method: 'POST', body: JSON.stringify(body) });
if (location.protocol === 'http:' && location.hostname === '127.0.0.1') {
  if (!document.getElementById('viewport')) await new Promise((ready) => {
    const observer = new MutationObserver(() => {
      if (document.getElementById('viewport')) { observer.disconnect(); ready(); }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  const page = crypto.randomUUID();
  await post('result', { page, handedOver: window.seismicApp?.handedOver,
    draft: sessionStorage.getItem('seismic-drafts-check'), view: sessionStorage.getItem('check-view') });
  for (;;) {
    const next = await fetch(new URL('todo?page=' + page, base)).then((r) => r.json());
    if (!next) continue;
    const result = await Promise.resolve().then(() => (0, eval)(next.js)).then((value) => ({ ok: true, value }), (e) => ({ ok: false, error: String(e) }));
    await post('done', { id: next.id, ...result });
  }
}
`;
const harness = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const cors = { 'access-control-allow-origin': '*' };
    const { pathname: path, searchParams } = new URL(req.url);
    if (path === '/handover-gate' && req.method === 'POST') {
      const pending = gate;
      if (!pending) return new Response(null, { status: 200 });
      pending.captured = await req.json();
      if (keep) console.log('Held the relaunched webview handover response');
      const deliver = await pending.response.promise;
      return new Response(null, { status: deliver ? 200 : 204 });
    }
    if (path === '/check.js') return new Response(MODULE, { headers: { ...cors, 'content-type': 'text/javascript' } });
    if (path === '/todo') {
      const page = searchParams.get('page') ?? '';
      const next = await until('the next page command', 2_000, () => todo.get(page), 50).catch(() => null);
      if (next) todo.delete(page);
      return Response.json(next, { headers: cors });
    }
    if (req.method === 'POST' && path === '/result') reports.push(JSON.parse(await req.text()));
    if (req.method === 'POST' && path === '/done') {
      const d = JSON.parse(await req.text());
      done.set(d.id, d);
    }
    return new Response(null, { status: 204, headers: cors });
  },
});
let n = 0;
const run = async (js: string) => {
  const id = ++n;
  todo.set(reports.at(-1)!.page, { id, js });
  const d = await until('the page to answer', 15_000, () => done.get(id));
  done.delete(id);
  expect(d.ok, d.error ?? 'failed');
  return d.value;
};
const report = (after: number, ms = 60_000) => until('the local page', ms, () => reports.length > after && reports.at(-1));
const field = "document.querySelector('#ksheet textarea')";
const writeDraft = (draft: string) => run(`(() => {
  const field = ${field};
  if (!field) throw new Error('the Seismic editor is missing');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(draft)});
  field.dispatchEvent(new Event('input', { bubbles: true }));
  return JSON.parse(sessionStorage.getItem('seismic-drafts-lab')).seismic.text;
})()`);


const port = free();
const local = `http://127.0.0.1:${port}`;
const lease = join(dir, 'app-lease');
writeFileSync(lease, '');


const preload = join(dir, 'gate.js');
writeFileSync(preload, `
const serve = Bun.serve;
Bun.serve = (options) => {
  const route = options.routes?.['/api/app-rebuilt/handover'];
  if (route) {
    options.idleTimeout = 120;
    const get = route.GET;
    route.GET = async (req, server) => {
      const response = await get(req, server);
      if (!response.ok || req.headers.has('x-seismic-check-probe')) return response;
      const gate = await fetch(${JSON.stringify(new URL('handover-gate', harness.url).href)}, {
        method: 'POST', body: await response.clone().text(),
      });
      return gate.status === 204 ? new Response(null, { status: 204 }) : response;
    };
  }
  return serve(options);
};
`);
const env: Record<string, string> = {
  ...(Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SEISMIC|OBEYA)_SUPERVISED$/.test(k))) as Record<string, string>),
  SEISMIC_HOME: home,
  SEISMIC_APP_CHECK: `${harness.url.href}check.js`,
  SEISMIC_APP_CHECK_LEASE: lease,
  SEISMIC_PORT: String(free()),
  
  SEISMIC_CHECKOUT: ROOT,
};
const terminal = Bun.spawn([process.execPath, '--preload', preload, join(ROOT, 'src', 'server', 'main.ts'), '--dev', '--idle-workers', '--port', String(port)], { env, stdout: 'ignore', stderr: keep ? 'inherit' : 'ignore' });
const handover = () => fetch(`${local}/api/app-rebuilt/handover`, {
  headers: { ...ownerHeaders(home), 'x-seismic-check-probe': '1' },
}).then((r) => r.json()) as Promise<Handover | null>;
let app: ReturnType<typeof Bun.spawn> | undefined;

/** Starts the shell again as a new build of it does, beside the terminal's server, with a draft and view state typed into the page. */
async function relaunch(draft: string) {
  await run(`sessionStorage.setItem('seismic-drafts-check', ${JSON.stringify(draft)}); sessionStorage.setItem('check-view', 'open'); true`);
  const before = reports.length;
  writeFileSync(join(home, 'check-queue-rebuild'), '');
  return report(before);
}

try {
  await until('the terminal server to answer', 60_000, async () => (await fetch(`${local}/api/projects`, { headers: ownerHeaders(home) })).ok);
  
  
  writeFileSync(join(home, 'app-windows.json'), JSON.stringify({ at: Date.now(), windows: [{
    desk: 'local', x: 40, y: 40, width: 900, height: 700, visible: false, next: '/',
  }] }));
  app = Bun.spawn([program], { env, stdout: 'ignore', stderr: keep ? 'inherit' : 'ignore' });
  const first = await Promise.race([
    report(0),
    app.exited.then((code) => { throw new Error(`The debug app exited at launch (${code}). Check its app identifier.`); }),
  ]);
  expect(first.page, 'the project canvas did not mount');
  expect(readFileSync(join(dir, 'app-lease.pid'), 'utf8') === String(app.pid), 'build the debug app from this checkout to enable scratch-run cleanup');

  await check('a relaunch beside a terminal server restores the draft and view state, and frees the server copy', async () => {
    const page = await relaunch('Unsent note before the first restart');
    expect(page.handedOver, JSON.stringify(page));
    expect(page.draft === 'Unsent note before the first restart', `draft: ${page.draft}`);
    expect(page.view === 'open', `view state: ${page.view}`);
    await until('the server copy to be freed', 5_000, async () => await handover() === null, 100);
  });

  await check('the canvas opens with the shell draft while its handover GET is held, then keeps it without the server copy', async () => {
    const draft = 'Unsent note before the second restart';
    await run("document.querySelector('#talk-docked button').click()");
    await until('the Seismic editor to open', 15_000, async () => await run(`!!${field}`), 100);
    expect(await writeDraft(draft) === draft, 'the starting editor draft was not saved');
    const pending = armGate();
    try {
      const page = await relaunch(draft);
      expect(page.handedOver, JSON.stringify(page));
      expect(new Map(pending.captured?.entries).get('seismic-drafts-check') === draft, 'the relaunched webview did not request the new server copy');
      await until('the native draft to show before delivery', 15_000, async () => await run(`${field}?.value`) === draft, 100);
      pending.response.resolve(false);
      expect(await run(`${field}?.value`) === draft, 'the shell draft disappeared');
      expect((await handover())?.token === pending.captured?.token, 'the undelivered copy was acknowledged');
    } finally {
      pending.response.resolve(false);
      gate = undefined;
    }
  });

  await check('a server-only draft and the open sheet return after startup, and the next edit is saved', async () => {
    const draft = 'A draft recovered from the terminal server';
    const draftKey = 'seismic-drafts-lab';
    const viewKey = 'seismic-kept-lab';
    await run(`(() => {
      const snapshot = window.seismicSnapshotSession;
      window.seismicSnapshotSession = () => snapshot().filter(([key]) => !${JSON.stringify([draftKey, viewKey])}.includes(key));
      const fetch = window.fetch;
      window.fetch = (url, init) => {
        if (url !== '/api/app-rebuilt/handover' || init?.method !== 'POST') return fetch(url, init);
        const body = JSON.parse(init.body);
        const entries = new Map(body.entries);
        entries.set(${JSON.stringify(draftKey)}, JSON.stringify({ seismic: { text: ${JSON.stringify(draft)}, images: [] } }));
        entries.set(${JSON.stringify(viewKey)}, JSON.stringify({ at: Date.now(), sheet: 'koordinator', scroll: [], drafts: [] }));
        return fetch(url, { ...init, body: JSON.stringify({ ...body, entries: [...entries] }) });
      };
    })()`);
    const pending = armGate();
    try {
      const page = await relaunch('Native draft carried alongside server-only state');
      expect(page.handedOver, JSON.stringify(page));
      expect(new Map(pending.captured?.entries).has(draftKey), 'the relaunched webview did not request the recovery draft');
      expect(await run(`!${field} && sessionStorage.getItem(${JSON.stringify(draftKey)}) === null`), 'the recovery draft or its sheet was present before delivery');
      pending.response.resolve(true);
      await until('the reopened sheet and its recovered editor text', 15_000, async () => await run(`${field}?.value`) === draft, 100);
      const edited = draft + ' and edited after recovery';
      expect(await writeDraft(edited) === edited, 'the next edit did not keep the recovered draft');
      await until('the recovered server copy to be freed', 5_000, async () => await handover() === null, 100);
    } finally {
      pending.response.resolve(false);
      gate = undefined;
    }
  });
} finally {
  
  rmSync(lease, { force: true });
  if (app && (await exited(app, 5_000)) === null) app.kill();
  
  terminal.kill();
  await exited(terminal, 5_000);
  harness.stop(true);
  if (!keep) rmSync(dir, { recursive: true, force: true });
  else console.log(`kept: ${dir}`);
}
process.exit(failed ? 1 : 0);
