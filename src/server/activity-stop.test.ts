import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './db';
import { ProjectRuntime } from './project';
import { FakeRuntime, gitRepo, noForge, until } from './testing';

let dir: string;
let project: ProjectRuntime;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-activity-'));
  const main = join(dir, 'main');
  gitRepo(main);
  mkdirSync(join(main, 'docs/plan'), { recursive: true });
  project = new ProjectRuntime({ repos: [{ path: main, clones: 2, settings: { land: 'main' } }] }, { store: new Store(':memory:'), home: dir, runtime: new FakeRuntime(), forge: noForge, commandDelayMs: 10 });
});
afterEach(() => {
  project.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const codes = (id: string) => project.board.activityRows([project.board.project.id], undefined, 100).filter((r) => r.cardId === id).reverse().map((r) => r.code);

test('stopped: the owner stops a worker', async () => {
  const c = project.board.create({ title: 'Work', x: 0, y: 0 });
  await project.act(c.id, { action: 'start' });
  await until(() => project.board.item(c.id)!.state === 'working');
  await project.act(c.id, { action: 'stop' });
  expect(codes(c.id)).toContain('stopped');
});
