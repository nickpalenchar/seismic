import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '../../../config';
import { ProjectRuntime } from '../../../project';
import { serve } from '../../../server';
import { Store } from '../../../store';
import type { UsageMeter } from '../../../usage';
import { asOwner, FakeRuntime, gitRepo, noForge } from '../../helpers/testing';

let dir: string;
let project: ProjectRuntime;
let server: ReturnType<typeof serve>;

let meters: boolean[];

let changed: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seismic-settings-route-'));
  const web = gitRepo(join(dir, 'web'));
  const store = new Store(':memory:');
  const config = new Config({ file: join(dir, 'home', 'projects.json'), source: 'args', started: [{ repos: [{ path: web }] }], store, running: () => ['web'], server: { port: 4417, home: dir, permissionMode: 'auto' }, ttsLock: join(dir, 'tts.lock') });
  project = new ProjectRuntime({ repos: [{ path: web }] }, { store, home: dir, runtime: new FakeRuntime(), forge: noForge, config });
  meters = [];
  changed = 0;
  const board = project.board;
  const tell = board.changed.bind(board);
  board.changed = () => (changed++, tell());
  const meter = { setOn: (on: boolean) => void meters.push(on), current: () => null, onChange: () => () => {} } as unknown as UsageMeter;
  server = serve([project], { transcriber: { transcribe: async () => ({ text: '', doubtful: false }), warm: () => {} } }, 0, false, config, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, [meter]);
});
afterEach(() => {
  server.stop(true);
  project.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const { fetch } = asOwner(() => server);
const call = async (method: string, path: string, body?: unknown, send: (url: URL, init: RequestInit) => Promise<Response> = fetch) => {
  const res = await send(new URL(path, server.url), { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};
const saved = () => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));

test('every setting reads together, by its name', async () => {
  const { settings } = (await call('GET', '/api/v1/settings')).body;
  expect(Object.keys(settings).sort()).toEqual(['agents', 'codexAutoReview', 'demo', 'language', 'motion', 'notifications', 'projectDefaults', 'theme', 'usageMeter']);
  expect(settings.theme).toEqual({ file: join(dir, 'settings.json'), chosen: null });
});

test('several settings saved at once, each as its own URL takes it, answered with all of them', async () => {
  const res = await call('PATCH', '/api/v1/settings', { theme: { theme: 'dark' }, notifications: { on: false }, usageMeter: { on: false } });
  expect(res.status).toBe(200);
  expect(res.body.settings).toMatchObject({ theme: { chosen: 'dark' }, notifications: { on: false }, usageMeter: { on: false }, motion: { chosen: null } });
  expect(saved()).toMatchObject({ theme: 'dark', notifications: false, usageMeter: false });
  expect(meters).toEqual([false]);
});

test('a name that is no setting refuses the whole patch before anything is saved; a value refused stops it there', async () => {
  expect(await call('PATCH', '/api/v1/settings', { theme: { theme: 'dark' }, colour: { on: true } })).toMatchObject({ status: 400, body: { code: 'invalid' } });
  expect((await call('GET', '/api/v1/settings/theme')).body.setting.chosen).toBeNull();
  expect(await call('PATCH', '/api/v1/settings', { theme: { theme: 'dark' }, notifications: { on: 'yes' } })).toMatchObject({ status: 400, body: { code: 'invalid' } });
  expect((await call('GET', '/api/v1/settings/theme')).body.setting.chosen).toBe('dark');
  expect(await call('PATCH', '/api/v1/settings', ['theme'])).toMatchObject({ status: 400, body: { code: 'invalid' } });
  expect(await call('PATCH', '/api/v1/settings', { theme: { theme: null } }, globalThis.fetch)).toMatchObject({ status: 401, body: { code: 'notOwner' } });
});
