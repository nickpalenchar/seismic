import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Item } from '../../../../../core/types';
import type { Board } from '../../../../board';
import { ProjectRuntime } from '../../../../project';
import { serve } from '../../../../server';
import { Store } from '../../../../store';
import { asOwner, FakeRuntime, gitRepo, noForge } from '../../../helpers/testing';

let dir: string;
let shop: Board;
let website: Board;
let server: ReturnType<typeof serve>;

// two projects on one store, as Seismic runs them: a card's URL names no project
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seismic-card-route-'));
  const store = new Store(':memory:');
  const project = (name: string) => {
    const repo = join(dir, name);
    gitRepo(repo, { 'README.md': 'hi\n', 'docs/plan/plan.md': '# Site\n\n## Goal\n\nG.\n\n## Workstreams\n\n- [ ] **W1:** One.\n' });
    return new ProjectRuntime({ repos: [{ path: repo }] }, { store, home: dir, runtime: new FakeRuntime(), forge: noForge });
  };
  const projects = [project('shop'), project('website')];
  [shop, website] = projects.map((p) => p.board) as [Board, Board];
  server = serve(projects, { transcriber: { transcribe: async () => ({ text: '', doubtful: false }), warm: () => {} } }, 0);
});
afterEach(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const { fetch } = asOwner(() => server);
const patch = (card: string, body: unknown, send: (url: URL, init: RequestInit) => Promise<Response> = fetch) =>
  send(new URL(`/api/v1/cards/${card}`, server.url), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const codeOf = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];

test('a card edited on the project it is on, answered with the card as the project shows it', async () => {
  const c = website.create({ title: 'A', x: 0, y: 0 });
  const res = await patch(c.id, { title: 'Checkout', body: 'Pay by card.', x: 120, y: 40, priority: 'high' });
  expect(res.status).toBe(200);
  const { card } = (await res.json()) as { card: Item };
  expect(card).toMatchObject({ id: c.id, title: 'Checkout', body: 'Pay by card.', x: 120, y: 40 });
  expect(card.labels?.priority).toBe('high');
  expect(card).toEqual(JSON.parse(JSON.stringify(website.item(c.id))));
});

test("a plan's fold goes the same way", async () => {
  const plan = website.items().find((i) => i.kind === 'plan')!;
  const { card } = (await (await patch(plan.id, { collapsed: true })).json()) as { card: Item };
  expect(card.plan?.collapsed).toBe(true);
});

test('refused: changes that are no object or not allowed, an unknown or deleted card, no owner key', async () => {
  const c = shop.create({ title: 'A', x: 0, y: 0 });
  const gone = shop.create({ title: 'B', x: 0, y: 0 });
  shop.remove(gone.id);
  expect(await codeOf(await patch(c.id, ['title']))).toEqual([400, 'invalid']);
  expect(await codeOf(await patch(c.id, null))).toEqual([400, 'invalid']);
  expect(await codeOf(await patch(c.id, { state: 'nonsense' }))).toEqual([400, 'invalid']);
  expect(await codeOf(await patch('nope', { title: 'X' }))).toEqual([404, 'unknownCard']);
  expect(await codeOf(await patch(gone.id, { title: 'X' }))).toEqual([404, 'unknownCard']);
  expect(await codeOf(await patch(c.id, { title: 'X' }, globalThis.fetch))).toEqual([401, 'notOwner']);
  expect(shop.item(c.id)?.title).toBe('A');
});

const remove = (card: string, send: (url: URL, init: RequestInit) => Promise<Response> = fetch) => send(new URL(`/api/v1/cards/${card}`, server.url), { method: 'DELETE' });

test('a card deleted on the project it is on, answered with nothing; its undo brings it back', async () => {
  const c = website.create({ title: 'A', x: 0, y: 0 });
  const res = await remove(c.id);
  expect(res.status).toBe(204);
  expect(website.item(c.id)).toBeUndefined();
  // the undo is still the project's route
  expect((await fetch(new URL(`/api/c/${website.project.id}/cards/${c.id}/restore`, server.url), { method: 'POST' })).status).toBe(204);
  expect(website.item(c.id)?.title).toBe('A');
});

test('a deletion refused: an unknown or deleted card, no owner key', async () => {
  const c = shop.create({ title: 'A', x: 0, y: 0 });
  const gone = shop.create({ title: 'B', x: 0, y: 0 });
  shop.remove(gone.id);
  expect(await codeOf(await remove('nope'))).toEqual([404, 'unknownCard']);
  expect(await codeOf(await remove(gone.id))).toEqual([404, 'unknownCard']);
  expect(await codeOf(await remove(c.id, globalThis.fetch))).toEqual([401, 'notOwner']);
  expect(shop.item(c.id)?.title).toBe('A');
});
