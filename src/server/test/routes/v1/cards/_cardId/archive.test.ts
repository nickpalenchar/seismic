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

// two projects on one store, as Seismic runs them: a card's URL names no project, an archived card's neither
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seismic-archive-route-'));
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
const post = (card: string, action: 'archive' | 'unarchive', send: (url: URL, init: RequestInit) => Promise<Response> = fetch) =>
  send(new URL(`/api/v1/cards/${card}/${action}`, server.url), { method: 'POST' });
const codeOf = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];
const finished = (board: Board, title: string) => {
  const c = board.create({ title, x: 0, y: 0 });
  board.patch(c.id, { state: 'live' });
  return c;
};

test('a finished card archived on the project it is on, answered with the card as the archive shows it; unarchived, it is back', async () => {
  const c = finished(website, 'A');
  const res = await post(c.id, 'archive');
  expect(res.status).toBe(200);
  const { card } = (await res.json()) as { card: Item };
  expect(card.id).toBe(c.id);
  expect(card.archivedAt).toBeTruthy();
  expect(website.item(c.id)).toBeUndefined();
  expect(card).toEqual(JSON.parse(JSON.stringify(website.archived().find((i) => i.id === c.id))));
  const back = await post(c.id, 'unarchive');
  expect(back.status).toBe(200);
  const again = ((await back.json()) as { card: Item }).card;
  expect(again).toEqual(JSON.parse(JSON.stringify(website.item(c.id))));
  expect(again.archivedAt).toBeUndefined();
});

test('refused: a card not finished, one not archived, an unknown card, no owner key', async () => {
  const open = shop.create({ title: 'A', x: 0, y: 0 });
  const c = finished(shop, 'B');
  expect(await codeOf(await post(open.id, 'archive'))).toEqual([400, 'notDone']);
  expect(await codeOf(await post(c.id, 'unarchive'))).toEqual([400, 'notArchived']);
  expect(await codeOf(await post('nope', 'archive'))).toEqual([404, 'unknownCard']);
  expect(await codeOf(await post('nope', 'unarchive'))).toEqual([404, 'unknownCard']);
  expect(await codeOf(await post(c.id, 'archive', globalThis.fetch))).toEqual([401, 'notOwner']);
  expect(shop.item(c.id)?.archivedAt).toBeUndefined();
});
