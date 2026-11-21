import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '../../../../config';
import { ProjectRuntime } from '../../../../project';
import { serve } from '../../../../server';
import { Store } from '../../../../store';
import type { UsageMeter } from '../../../../usage';
import { asOwner, FakeRuntime, gitRepo, noForge } from '../../../helpers/testing';

let dir: string;
let project: ProjectRuntime;
let server: ReturnType<typeof serve>;
/** What the usage meter was set to, save by save. */
let meters: boolean[];
/** How often the project was told its cards changed. */
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

test('each setting reads and saves on its own, keeping the other settings in the file', async () => {
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ later: 1 }));
  expect((await call('GET', '/api/v1/settings/notifications')).body).toEqual({ setting: { file: join(dir, 'settings.json'), on: null } });
  expect((await call('PUT', '/api/v1/settings/notifications', { on: true })).body.setting.on).toBe(true);
  expect((await call('PUT', '/api/v1/settings/theme', { theme: 'dark' })).body.setting.chosen).toBe('dark');
  expect((await call('PUT', '/api/v1/settings/language', { conversation: 'en' })).body.setting.conversationChosen).toBe('en');
  expect((await call('PUT', '/api/v1/settings/projectDefaults', { suggestCards: false })).body.setting.defaults.suggestCards).toBe(false);
  expect((await call('PUT', '/api/v1/settings/agents', { worker: { model: 'opus' } })).body.setting.agents.worker.model).toBe('opus');
  expect(saved()).toMatchObject({ later: 1, notifications: true, theme: 'dark', conversationLanguage: 'en' });
  expect((await call('GET', '/api/v1/settings/theme')).body.setting.chosen).toBe('dark');
});

test('what a save sets going besides the file: the usage meters, the pages following "Ask for feedback"', async () => {
  await call('PUT', '/api/v1/settings/usageMeter', { on: false });
  await call('PUT', '/api/v1/settings/usageMeter', { on: true });
  expect(meters).toEqual([false, true]);
  const before = changed;
  expect((await call('PUT', '/api/v1/settings/feedbackPrompt', { on: true })).body.setting.on).toBe(true);
  expect(changed).toBeGreaterThan(before);
});

test('refused: a setting there is not, a value the setting does not take, a body that is no object, no owner key', async () => {
  expect(await call('GET', '/api/v1/settings/colour')).toMatchObject({ status: 404, body: { code: 'unknownSetting' } });
  expect(await call('PUT', '/api/v1/settings/colour', { on: true })).toMatchObject({ status: 404, body: { code: 'unknownSetting' } });
  expect(await call('PUT', '/api/v1/settings/notifications', { on: 'yes' })).toMatchObject({ status: 400, body: { code: 'invalid' } });
  expect(await call('PUT', '/api/v1/settings/theme', { theme: 'pink' })).toMatchObject({ status: 400, body: { code: 'invalid' } });
  expect(await call('PUT', '/api/v1/settings/notifications', [true])).toMatchObject({ status: 400, body: { code: 'invalid' } });
  expect(await call('PUT', '/api/v1/settings/notifications', { on: true }, globalThis.fetch)).toMatchObject({ status: 401, body: { code: 'notOwner' } });
  expect((await call('GET', '/api/v1/settings/notifications')).body.setting.on).toBeNull();
});
