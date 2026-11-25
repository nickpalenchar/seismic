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


beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seismic-share-route-'));
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
const share = (card: string, body: unknown, send: (url: URL, init: RequestInit) => Promise<Response> = fetch) =>
  send(new URL(`/api/v1/cards/${card}/share`, server.url), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('“Share on approval” off and on again, on the project the card is on, answered with the card', async () => {
  const c = website.create({ title: 'A', x: 0, y: 0 });
  const off = await share(c.id, { onApproval: false });
  expect(off.status).toBe(200);
  const { card } = (await off.json()) as { card: Item };
  expect(card.id).toBe(c.id);
  expect(card.demo?.notOnApproval).toBe(true);
  expect(website.item(c.id)?.demo?.notOnApproval).toBe(true);
  const on = (await (await share(c.id, { onApproval: true })).json()) as { card: Item };
  expect(on.card.demo?.notOnApproval).toBeUndefined();
  expect(website.item(c.id)?.demo?.notOnApproval).toBeUndefined();
});

test('refused: not a boolean, an unknown or deleted card, no owner key', async () => {
  const c = shop.create({ title: 'A', x: 0, y: 0 });
  const gone = shop.create({ title: 'B', x: 0, y: 0 });
  shop.remove(gone.id);
  const codeOf = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];
  expect(await codeOf(await share(c.id, { onApproval: 'no' }))).toEqual([400, 'invalid']);
  expect(await codeOf(await share('nope', { onApproval: false }))).toEqual([404, 'unknownCard']);
  expect(await codeOf(await share(gone.id, { onApproval: false }))).toEqual([404, 'unknownCard']);
  expect(await codeOf(await share(c.id, { onApproval: false }, globalThis.fetch))).toEqual([401, 'notOwner']);
  expect(shop.item(c.id)?.demo?.notOnApproval).toBeUndefined();
});
