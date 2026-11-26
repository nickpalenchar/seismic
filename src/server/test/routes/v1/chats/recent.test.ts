import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Board } from '../../../../board';
import { ProjectRuntime } from '../../../../project';
import { serve } from '../../../../server';
import { Store } from '../../../../store';
import { asOwner, FakeRuntime, gitRepo, noForge } from '../../../helpers/testing';

let dir: string;
let shop: ProjectRuntime;
let website: ProjectRuntime;
let server: ReturnType<typeof serve>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seismic-recent-chat-route-'));
  const store = new Store(':memory:');
  const project = (name: string) => {
    const repo = join(dir, name);
    gitRepo(repo, { 'README.md': 'hi\n' });
    return new ProjectRuntime({ repos: [{ path: repo }] }, { store, home: dir, runtime: new FakeRuntime(), forge: noForge });
  };
  [shop, website] = [project('shop'), project('website')] as [ProjectRuntime, ProjectRuntime];
  server = serve([shop, website], { transcriber: { transcribe: async () => ({ text: '', doubtful: false }), warm: () => {} } }, 0);
});
afterEach(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const { fetch } = asOwner(() => server);
const recent = (project?: string) => fetch(new URL(`/api/v1/chats/recent${project ? `?project=${project}` : ''}`, server.url));
const said = (board: Board, text: string) => board.addTalk(text, '');

test('the chat talked in last, none before anything was said, and a new word shows at once', async () => {
  expect(await (await recent(shop.id)).json()).toEqual({ chat: null });
  said(shop.board, 'first');
  const { chat } = (await (await recent(shop.id)).json()) as { chat: { id: number; at: string } };
  expect(chat.id).toBe(shop.board.chat());
  shop.board.newChat();
  said(shop.board, 'second');
  expect(((await (await recent(shop.id)).json()) as { chat: { id: number } }).chat.id).toBe(shop.board.chat());
  expect(((await (await recent(shop.id)).json()) as { chat: { id: number } }).chat.id).not.toBe(chat.id);
  expect(await (await recent(website.id)).json()).toEqual({ chat: null });
});

test('an unknown or missing project is a 404', async () => {
  expect((await recent('nope')).status).toBe(404);
  expect((await recent()).status).toBe(404);
});
