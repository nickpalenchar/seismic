import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Item } from '../../../../../../core/types';
import type { Board } from '../../../../../board';
import { ProjectRuntime } from '../../../../../project';
import { serve } from '../../../../../server';
import { Store } from '../../../../../store';
import { asOwner, FakeRuntime, gitRepo, noForge } from '../../../../helpers/testing';

let dir: string;
let shop: Board;
let website: Board;
let server: ReturnType<typeof serve>;

// two projects on one store, as Seismic runs them: a card's URL names no project, a deleted card's neither
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seismic-restore-route-'));
  const store = new Store(':memory:');
  const project = (name: string) => {
    const repo = join(dir, name);
    gitRepo(repo, { 'README.md': 'hi\n' });
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
const restore = (card: string, send: (url: URL, init: RequestInit) => Promise<Response> = fetch) => send(new URL(`/api/v1/cards/${card}/restore`, server.url), { method: 'POST' });
const codeOf = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];

test('a deleted card comes back on the project it was on, answered with the card as the project shows it', async () => {
  const c = website.create({ title: 'A', x: 40, y: 60 });
  website.remove(c.id);
  const res = await restore(c.id);
  expect(res.status).toBe(200);
  const { card } = (await res.json()) as { card: Item };
  expect(card).toEqual(JSON.parse(JSON.stringify(website.item(c.id))));
  expect(card).toMatchObject({ id: c.id, title: 'A', x: 40, y: 60 });
  expect(shop.item(c.id)).toBeUndefined();
});

test('refused: an unknown card, no owner key', async () => {
  const c = shop.create({ title: 'A', x: 0, y: 0 });
  shop.remove(c.id);
  expect(await codeOf(await restore('nope'))).toEqual([404, 'unknownCard']);
  expect(await codeOf(await restore(c.id, globalThis.fetch))).toEqual([401, 'notOwner']);
  expect(shop.item(c.id)).toBeUndefined();
});
