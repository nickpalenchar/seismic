/**
 * Exercise the real detail buttons and portal dialogs, then the PR card's approval API.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import tailwind from 'bun-plugin-tailwind';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext } from 'playwright-core';
import { launchChromium } from '../../../plugin/lib/chromium';
import { generic } from '../../adapters/generic';
import type { CardAction } from '../../core/types';
import { artifact, until } from '../testing';
import { WorkerSupervisor } from './workerSupervisor';
import { git } from '../workstations';
import { board, dir, eachTest, main, manual, runtime, setWorkers, spaces, state, workers } from './fixture';

eachTest();
let browser: Browser;
let script: string;
let css: string;
beforeAll(async () => {
  const bundle = await Bun.build({ entrypoints: [join(import.meta.dir, '../../ui/testing/approval.tsx'), join(import.meta.dir, '../../ui/tailwind.css')], target: 'browser', plugins: [tailwind] });
  if (!bundle.success) throw new AggregateError(bundle.logs, 'Building the card detail browser fixture');
  script = await bundle.outputs.find((o) => o.path.endsWith('.js'))!.text();
  css = await bundle.outputs.find((o) => o.path.endsWith('.css'))!.text();
  browser = await launchChromium();
}, 60_000);
afterAll(async () => { await browser?.close(); }, 30_000);

for (const scenario of ['running', 'fixing', 'verifying', 'unsent', 'unsentDuringReview', 'open', 'reopenedDuringReview'] as const) {
  for (const direct of [true, false]) {
    test(`${direct ? 'Straight to main' : 'Approve (PR)'} on a PR card: ${scenario} confirmation cancels safely and preserves the approval route`, async () => {
      const picked = scenario === 'unsent' || scenario === 'unsentDuringReview';
      const open = picked || scenario === 'open' || scenario === 'reopenedDuringReview';
      const secondReview = scenario === 'unsentDuringReview' || scenario === 'reopenedDuringReview';
      const warnReview = secondReview || !open;
      setWorkers(new WorkerSupervisor({ board, runtime, workstations: spaces,
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
        if (!open) {
          workers.message(id, '', [], false, undefined, undefined, { 1: 'self' });
          if (scenario === 'verifying') await worker.call('resubmit_review_item', { items: [{ number: 1 }] });
        }
      }
      if (scenario === 'reopenedDuringReview') workers.reviews.ignore(id, [1]);
      if (secondReview) {
        writeFileSync(join(ws, 'export.ts'), 'export const ready = false;\n');
        git(ws, 'add', '.');
        git(ws, 'commit', '--quiet', '-m', 'Update export');
        await worker.call('ready_for_review', { summary: 'Updated.', demo: artifact() });
        worker.emit({ type: 'idle' });
        await until(() => runtime.sessions.filter((s) => s.spec.role === 'review').length === 2);
      }
      if (scenario === 'reopenedDuringReview') workers.reviews.reopen(id, 1);
      const activeReviewer = runtime.sessions.filter((s) => s.spec.role === 'review').at(-1)!;
      const before = structuredClone(board.item(id)!.review?.codeReview);
      const originalMain = git(origin, 'rev-parse', 'main');
      const actions: CardAction[] = [];
      const server = Bun.serve({ port: 0, async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === '/') return new Response('<!doctype html><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/tailwind.css"><div id="panel" style="display:block;position:relative;width:1100px;margin:20px"></div><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
        if (path === '/fixture.js') return new Response(script, { headers: { 'content-type': 'text/javascript' } });
        if (path === '/tailwind.css') return new Response(css, { headers: { 'content-type': 'text/css' } });
        if (path === '/style.css') return new Response(Bun.file(join(import.meta.dir, '../../ui/frost.css')));
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
        if (picked) {
          await page.getByRole('tab', { name: /Review/ }).click();
          await page.getByRole('button', { name: 'Fix it', exact: true }).click();
        }
        if (warnReview) {
          expect(await approval.getAttribute('data-variant')).toBe('review-warning');
          expect(await approval.innerText()).toContain(scenario === 'fixing' ? 'Fixing in progress' : 'Review in progress');
        }
        await approval.click();
        const dialog = page.getByRole('alertdialog', { name: open ? 'Review findings still open' : 'Approve without Review?' });
        await dialog.waitFor();
        const warning = await dialog.innerText();
        expect(warning.includes('Approving leaves it unanswered.')).toBe(open);
        expect(warning.includes('1 choice you picked is not sent yet and is dropped.')).toBe(picked);
        expect(warning.includes('This will stop the in-progress review')).toBe(warnReview);
        if (warnReview) expect(warning).toContain(direct ? 'move straight to landing' : 'approve the work for a pull request');
        expect(actions).toEqual([]);
        await dialog.getByRole('button', { name: open ? 'Go back' : 'Continue review', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        // Cancelling leaves the real server card, its review and origin/main untouched.
        expect(actions).toEqual([]);
        expect(state(id)).toBe('waiting:demo');
        expect(board.item(id)!.review?.codeReview).toEqual(before);
        expect(git(origin, 'rev-parse', 'main')).toBe(originalMain);
        expect(await page.locator('body').getAttribute('data-approved')).toBeNull();
        if (picked) expect(await page.getByRole('button', { name: 'Fix it', exact: true }).getAttribute('aria-pressed')).toBe('true');
        if (secondReview) expect(activeReviewer.closed).toBe(false);
        await approval.click();
        const confirmLabel = warnReview ? (direct ? 'Stop Review & land' : 'Stop Review & approve') : 'Approve anyway';
        const confirm = dialog.getByRole('button', { name: confirmLabel, exact: true });
        expect(await confirm.getAttribute('data-variant')).toBe(warnReview ? 'review-warning' : 'primary');
        await confirm.click();
        await page.locator('body[data-approved="true"]').waitFor();
        expect(actions).toEqual([direct ? { action: 'approve', direct: true } : { action: 'approve' }]);
        expect(state(id)).toBe(direct ? 'live' : 'inPr');
        if (secondReview) expect(activeReviewer.closed).toBe(true);
        expect(git(origin, 'rev-parse', 'main')).toBe(direct ? git(ws, 'rev-parse', 'HEAD') : originalMain);
        expect(errors).toEqual([]);
      } finally {
        await context?.close();
        await server.stop(true);
      }
    }, 30_000);
  }
}
