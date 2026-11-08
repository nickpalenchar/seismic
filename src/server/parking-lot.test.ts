import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentStage } from '../core/agents';
import { ProjectRuntime } from './project';
import { Store } from './store';
import { FakeRuntime, gitRepo, noForge } from './testing';

let dir: string;
let store: Store;
let project: ProjectRuntime;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-lot-'));
  const main = join(dir, 'main');
  gitRepo(main);
  mkdirSync(join(main, 'docs/plan'), { recursive: true });
  store = new Store(':memory:');
  project = new ProjectRuntime({ repos: [{ path: main, clones: 1, settings: { land: 'main' } }] }, { store, home: dir, runtime: new FakeRuntime(), forge: noForge, commandDelayMs: 10 });
});
afterEach(() => {
  project.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const item = (id: string) => project.board.item(id)!;

describe('the parking lot', () => {
  test('a planned task is parked, stays planned, leaves the Agents sheet\'s All tab and comes back', () => {
    const c = project.board.create({ title: 'Later', x: 0, y: 0 });
    project.act(c.id, { action: 'park' });
    expect(item(c.id).parkingLot).toBeTruthy();
    expect(item(c.id).state).toBe('planned');
    expect(agentStage(item(c.id))).toBeUndefined();
    project.act(c.id, { action: 'unpark' });
    expect(item(c.id).parkingLot).toBeUndefined();
    expect(agentStage(item(c.id))).toBe('planned');
  });

  test('starting a parked task takes it out of the parking lot', async () => {
    const c = project.board.create({ title: 'Later', x: 0, y: 0 });
    project.act(c.id, { action: 'park' });
    await project.act(c.id, { action: 'start' });
    expect(item(c.id).parkingLot).toBeUndefined();
  });

  test('a card that is parked already cannot be parked again', () => {
    const c = project.board.create({ title: 'Later', x: 0, y: 0 });
    project.act(c.id, { action: 'park' });
    expect(() => project.act(c.id, { action: 'park' })).toThrow(expect.objectContaining({ code: 'notParkable' }));
  });

  test('a task that waits for the owner is stopped and parked', async () => {
    const runtime = new FakeRuntime();
    project.shutdown();
    project = new ProjectRuntime({ repos: [{ path: join(dir, 'main'), clones: 1, settings: { land: 'main' } }] }, { store, home: dir, runtime, forge: noForge, commandDelayMs: 10 });
    const c = project.board.create({ title: 'Ask', x: 0, y: 0 });
    await project.act(c.id, { action: 'start' });
    for (let n = 0; n < 100 && !runtime.sessions.some((x) => x.spec.tools?.some((t) => t.name === 'ask')); n++) await new Promise((r) => setTimeout(r, 50));
    runtime.sessions.find((x) => x.spec.tools?.some((t) => t.name === 'ask'))!.call('ask', { question: 'CSV or Excel?', options: ['CSV', 'Excel'] });
    expect(item(c.id).state).toBe('waiting');
    await project.act(c.id, { action: 'park' });
    expect(item(c.id).state).toBe('planned');
    expect(item(c.id).parkingLot).toBeTruthy();
  });
});
