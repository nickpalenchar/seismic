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
let board: Board;
let server: ReturnType<typeof serve>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seismic-stop-route-'));
  const repo = join(dir, 'shop');
  gitRepo(repo, { 'README.md': 'hi\n' });
  const project = new ProjectRuntime({ repos: [{ path: repo }] }, { store: new Store(':memory:'), home: dir, runtime: new FakeRuntime(), forge: noForge });
  board = project.board;
  server = serve([project], { transcriber: { transcribe: async () => ({ text: '', doubtful: false }), warm: () => {} } }, 0);
});
afterEach(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const { fetch } = asOwner(() => server);
const post = (card: string, body?: unknown, send: (url: URL, init: RequestInit) => Promise<Response> = fetch) =>
  send(new URL(`/api/v1/cards/${card}/stop`, server.url), { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const codeOf = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];
const cardOf = async (res: Response) => ((await res.json()) as { card: Item }).card;

test("a card's agent stopped is answered with the card, planned again", async () => {
  const c = board.create({ title: 'A', x: 0, y: 0 });
  board.work(c.id, { state: 'working' });
  const res = await post(c.id);
  expect(res.status).toBe(200);
  const card = await cardOf(res);
  expect(card.state).toBe('planned');
  expect(card).toEqual(JSON.parse(JSON.stringify(board.item(c.id))));
});

test('refused: a card no agent works on, an unknown card, no owner key', async () => {
  const c = board.create({ title: 'A', x: 0, y: 0 });
  expect(await codeOf(await post(c.id))).toEqual([400, 'noAgent']);
  expect(await codeOf(await post('nope'))).toEqual([404, 'unknownCard']);
  board.work(c.id, { state: 'working' });
  expect(await codeOf(await post(c.id, undefined, globalThis.fetch))).toEqual([401, 'notOwner']);
  expect(board.item(c.id)?.state).toBe('working');
});
