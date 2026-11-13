// Exercise the real detail buttons and portal dialogs, then the PR card's approval API.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import tailwind from 'bun-plugin-tailwind';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext } from 'playwright-core';
import { launchChromium } from '../../plugin/lib/chromium';
import { generic } from '../adapters/generic';
import type { CardAction } from '../core/types';
import { artifact, until } from './testing';
import { Workers } from './workers';
import { git } from './workstations';
import { board, dir, eachTest, main, manual, runtime, setWorkers, spaces, state, workers } from './workers-fixture';

eachTest();
let browser: Browser;
let script: string;
let css: string;
beforeAll(async () => {
  const bundle = await Bun.build({ entrypoints: [join(import.meta.dir, '../ui/testing/approval.tsx'), join(import.meta.dir, '../ui/tailwind.css')], target: 'browser', plugins: [tailwind] });
  if (!bundle.success) throw new AggregateError(bundle.logs, 'Building the card detail browser fixture');
  script = await bundle.outputs.find((o) => o.path.endsWith('.js'))!.text();
  css = await bundle.outputs.find((o) => o.path.endsWith('.css'))!.text();
  browser = await launchChromium();
}, 60_000);
afterAll(async () => { await browser?.close(); }, 30_000);

for (const scenario of ['running', 'fixing', 'verifying', 'unsent', 'unsentDuringReview'] as const) {
  for (const direct of [true, false]) {
    test(`${direct ? 'Straight to main' : 'Approve (PR)'} on a PR card: ${scenario} confirmation cancels safely and preserves the approval route`, async () => {
      const unsent = scenario === 'unsent' || scenario === 'unsentDuringReview';
      setWorkers(new Workers({ board, runtime, workstations: spaces,
        adapter: { ...generic, land: 'pr', direct: true, workstations: 'clones' },
        codeReviews: () => ({ on: true, mode: 'auto' }),
      }));
      const origin = join(dir, 'approval-origin.git');
      git(dir, 'clone', '--quiet', '--bare', main, origin);
      const id = manual().id;
      await workers.start(id);
      await until(() => runtime.sessions.length > 0);
      const worker = runtime.sessions.find((s) => s.spec.role !== 'review')!;
      const ws = board.row(id).workstation!;
      git(ws, 'remote', 'set-url', 'origin', origin);
      writeFileSync(join(ws, 'export.ts'), 'export const ready = true;\n');
      git(ws, 'add', '.');
      git(ws, 'commit', '--quiet', '-m', 'Export');
      await worker.call('ready_for_review', { summary: 'Ready.', demo: artifact() });
      worker.emit({ type: 'idle' });
      await until(() => runtime.sessions.some((s) => s.spec.role === 'review'));
      const reviewer = runtime.sessions.find((s) => s.spec.role === 'review')!;
      if (scenario !== 'running') {
        reviewer.call('review', { items: [{ title: 'Validate export names', text: 'Check invalid names.', severity: 'minor' }], verdicts: [], regressions: [] });
        reviewer.emit({ type: 'idle' });
        await until(() => board.item(id)!.review?.codeReview?.state === 'done');
        if (!unsent) {
          workers.message(id, '', [], false, undefined, undefined, { 1: 'self' });
          if (scenario === 'verifying') await worker.call('resubmit_review_item', { items: [{ number: 1 }] });
        }
      }
      if (scenario === 'unsentDuringReview') {
        writeFileSync(join(ws, 'export.ts'), 'export const ready = false;\n');
        git(ws, 'add', '.');
        git(ws, 'commit', '--quiet', '-m', 'Update export');
        await worker.call('ready_for_review', { summary: 'Updated.', demo: artifact() });
        worker.emit({ type: 'idle' });
        await until(() => runtime.sessions.filter((s) => s.spec.role === 'review').length === 2);
      }
      const before = structuredClone(board.item(id)!.review?.codeReview);
      const originalMain = git(origin, 'rev-parse', 'main');
      const actions: CardAction[] = [];
      const server = Bun.serve({ port: 0, async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === '/') return new Response('<!doctype html><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/tailwind.css"><div id="panel" style="display:block;position:relative;width:1100px;margin:20px"></div><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
        if (path === '/fixture.js') return new Response(script, { headers: { 'content-type': 'text/javascript' } });
        if (path === '/tailwind.css') return new Response(css, { headers: { 'content-type': 'text/css' } });
        if (path === '/style.css') return new Response(Bun.file(join(import.meta.dir, '../ui/frost.css')));
        if (path === '/fixture') return Response.json({ item: board.item(id), repo: { id: 'home', name: 'Home', path: main, branch: 'main', pullRequests: true, direct: true } });
        if (path.endsWith('/act')) {
          const action = await req.json() as CardAction;
          actions.push(action);
          if (action.action === 'approve') await workers.approve(id, { direct: !!action.direct });
          return new Response(null, { status: 204 });
        }
        if (path.endsWith('/events') || path.endsWith('/skills')) return Response.json([]);
        if (path.endsWith('/diff')) return Response.json(null);
        if (path.endsWith('/app')) return Response.json({ up: false });
        return new Response('<p>Export ready.</p>', { headers: { 'content-type': 'text/html' } });
      } });
      let context: BrowserContext | undefined;
      try {
        context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(server.url.href);
        const approval = page.getByRole('button', { name: direct ? /^Straight to main/ : /^Approve \(PR\)/ });
        await approval.waitFor();
        if (unsent) {
          await page.getByRole('tab', { name: /Review/ }).click();
          await page.getByRole('button', { name: 'Fix it', exact: true }).click();
        } else {
          expect(await approval.getAttribute('data-variant')).toBe('review-warning');
          expect(await approval.innerText()).toContain(scenario === 'fixing' ? 'Fixing in progress' : 'Review in progress');
        }
        await approval.click();
        const dialog = page.getByRole('alertdialog', { name: unsent ? 'Choices not sent yet' : 'Approve without Review?' });
        await dialog.waitFor();
        expect(actions).toEqual([]);
        await dialog.getByRole('button', { name: unsent ? 'Go back' : 'Continue review', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        // Cancelling leaves the real server card, its review and origin/main untouched.
        expect(actions).toEqual([]);
        expect(state(id)).toBe('waiting:demo');
        expect(board.item(id)!.review?.codeReview).toEqual(before);
        expect(git(origin, 'rev-parse', 'main')).toBe(originalMain);
        expect(await page.locator('body').getAttribute('data-approved')).toBeNull();
        if (unsent) expect(await page.getByRole('button', { name: 'Fix it', exact: true }).getAttribute('aria-pressed')).toBe('true');
        await approval.click();
        await dialog.getByRole('button', { name: unsent ? 'Approve and close items' : 'Stop Review & land', exact: true }).click();
        await page.locator('body[data-approved="true"]').waitFor();
        expect(actions).toEqual([direct ? { action: 'approve', direct: true } : { action: 'approve' }]);
        expect(state(id)).toBe(direct ? 'live' : 'inPr');
        expect(git(origin, 'rev-parse', 'main')).toBe(direct ? git(ws, 'rev-parse', 'HEAD') : originalMain);
        expect(errors).toEqual([]);
      } finally {
        await context?.close();
        await server.stop(true);
      }
    }, 30_000);
  }
}
