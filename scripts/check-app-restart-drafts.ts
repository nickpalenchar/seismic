// Checks that the app's own window keeps its unsent drafts when its shell starts again beside a
// server started from a terminal (desktop/src/update.rs, `start_again`), the path a new build of a
// shell installed from a checkout takes. The page hands what a reload keeps to the server, and the
// shell samples the drafts itself before it exits; the new page restores both.
//
//   bun scripts/check-app-restart-drafts.ts <the app's program> [--keep]
//
// The program: a debug build of the shell, which runs this checkout's server; on a Mac an app bundle
// (scripts/check-app-desks.ts tells how to build one), with an identifier of its own
// (`"identifier":"im.seismic.restart-drafts-check"`): a running app of the same identifier takes
// over a second launch, which then ends at once. It checks, against a scratch home and a
// terminal server:
//   - a relaunch restores the draft and the view state, and the new page frees the server's copy;
//   - a relaunch whose server copy is gone before the new page reads it (consumed, expired, or
//     the read cut short) still restores the draft from the shell's own snapshot.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ownerHeaders } from '../src/server/owner';
import { check, exited, expect, failed, until } from './check-harness';

const args = process.argv.slice(2);
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

// ---------------------------------------------------------------- what the page runs, and where it reports
type Report = { label: string; handedOver?: boolean; draft: string | null; view: string | null; mounted: boolean };
const reports: Report[] = [];
const todo: { id: number; label: string; js: string }[] = [];
const done = new Map<number, { ok: boolean; value?: unknown; error?: string }>();
const MODULE = `
const base = new URL('.', import.meta.url);
const post = (path, body) => fetch(new URL(path, base), { method: 'POST', body: JSON.stringify(body) });
const label = window.__TAURI_INTERNALS__.metadata.currentWebview.label;
if (location.protocol === 'http:' && location.hostname === '127.0.0.1') {
  for (let n = 0; n < 100 && !document.getElementById('root')?.firstChild; n++) await new Promise((r) => setTimeout(r, 50));
  const entries = new Map(window.seismicSnapshotSession?.() ?? Object.entries(sessionStorage));
  await post('result', { label, handedOver: window.seismicApp?.handedOver, mounted: !!document.getElementById('root')?.firstChild,
    draft: entries.get('seismic-drafts-check') ?? null, view: entries.get('check-view') ?? null });
  for (;;) {
    const next = await fetch(new URL('todo?label=' + label, base)).then((r) => r.json()).catch(() => null);
    if (!next) { await new Promise((r) => setTimeout(r, 200)); continue; }
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
    if (path === '/check.js') return new Response(MODULE, { headers: { ...cors, 'content-type': 'text/javascript' } });
    if (path === '/todo') {
      const next = todo.findIndex((t) => t.label === searchParams.get('label'));
      return Response.json(next === -1 ? null : todo.splice(next, 1)[0], { headers: cors });
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
  todo.push({ id, label: reports.at(-1)!.label, js });
  const d = await until('the page to answer', 10_000, () => done.get(id));
  expect(d.ok, d.error ?? 'failed');
  return d.value;
};
const report = (after: number, ms = 60_000) => until('the local page', ms, () => reports.length > after && reports.at(-1));

// ---------------------------------------------------------------- the terminal's server and the app beside it
const port = free();
const local = `http://127.0.0.1:${port}`;
const env: Record<string, string> = {
  ...(Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SEISMIC|OBEYA)_SUPERVISED$/.test(k))) as Record<string, string>),
  SEISMIC_HOME: home,
  SEISMIC_APP_CHECK: `${harness.url.href}check.js`,
  SEISMIC_PORT: String(free()),
  // the debug shell runs this checkout's server
  SEISMIC_CHECKOUT: ROOT,
};
const terminal = Bun.spawn([process.execPath, join(ROOT, 'src', 'server', 'main.ts'), '--port', String(port)], { env, stdout: 'ignore', stderr: 'ignore' });
const handover = (init: RequestInit = {}, query = '') => fetch(`${local}/api/app-rebuilt/handover${query}`, { ...init, headers: ownerHeaders(home) });
let app: ReturnType<typeof Bun.spawn> | undefined;

/** Starts the shell again as a new build of it does, beside the terminal's server, with a draft and view state typed into the page. */
async function relaunch(draft: string, whileStarting?: () => Promise<void>) {
  await run(`sessionStorage.setItem('seismic-drafts-check', ${JSON.stringify(draft)}); sessionStorage.setItem('check-view', 'open'); true`);
  const before = reports.length;
  writeFileSync(join(home, 'check-queue-rebuild'), '');
  await whileStarting?.();
  return report(before);
}

try {
  await until('the terminal server to answer', 60_000, async () => (await fetch(`${local}/api/projects`, { headers: ownerHeaders(home) })).ok);
  // The shell starts again only while its window is in front or hidden (`may_relaunch`): hidden,
  // it does so without taking the focus of whoever uses the machine, and stays hidden after.
  writeFileSync(join(home, 'app-windows.json'), JSON.stringify({ at: Date.now(), windows: [{
    desk: 'local', x: 40, y: 40, width: 900, height: 700, visible: false, next: '/',
  }] }));
  app = Bun.spawn([program], { env, stdout: 'ignore', stderr: args.includes('--keep') ? 'inherit' : 'ignore' });
  await report(0);

  await check('a relaunch beside a terminal server restores the draft and view state, and frees the server copy', async () => {
    const page = await relaunch('Unsent note before the first restart');
    expect(page.handedOver && page.mounted, JSON.stringify(page));
    expect(page.draft === 'Unsent note before the first restart', `draft: ${page.draft}`);
    expect(page.view === 'open', `view state: ${page.view}`);
    await until('the server copy to be freed', 5_000, async () => (await (await handover()).json()) === null, 100);
  });

  await check('a relaunch whose server copy is gone before the new page reads it keeps the draft', async () => {
    let dropped = false;
    const page = await relaunch('Unsent note before the second restart', async () => {
      // As soon as the old page has handed over, take the copy away, as an answer the new page
      // never received used to.
      const kept = await until('the old page to hand over', 30_000, async () => (await (await handover()).json()) as { token: string } | null, 20);
      await handover({ method: 'DELETE' }, `?token=${encodeURIComponent(kept.token)}`);
      dropped = (await (await handover()).json()) === null;
    });
    expect(dropped, 'the server copy could not be taken away');
    expect(page.handedOver && page.mounted, JSON.stringify(page));
    expect(page.draft === 'Unsent note before the second restart', `draft: ${page.draft}`);
  });
} finally {
  await fetch(`${local}/api/stop`, { method: 'POST', headers: ownerHeaders(home) }).catch(() => null);
  await exited(terminal, 15_000);
  terminal.kill();
  // the relaunched shell is another process than the one this script started
  Bun.spawnSync(['pkill', '-f', program]);
  if (app && app.exitCode === null && (await exited(app, 5_000)) === null) app.kill();
  harness.stop(true);
  if (!args.includes('--keep')) rmSync(dir, { recursive: true, force: true });
  else console.log(`kept: ${dir}`);
}
process.exit(failed ? 1 : 0);
