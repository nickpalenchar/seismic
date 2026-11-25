import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilePresence } from '../file-presence';

let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'seismic-presence-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('a file is looked at once; the answer stays until a refresh looks again', async () => {
  let flips = 0;
  const p = new FilePresence(() => flips++);
  const file = join(dir, 'poster.jpg');
  expect(p.there(file)).toBe(false);
  writeFileSync(file, 'x');
  
  expect(p.there(file)).toBe(false);
  await p.refresh();
  expect(p.there(file)).toBe(true);
  expect(flips).toBe(1);
  
  await p.refresh();
  expect(flips).toBe(1);
  rmSync(file);
  await p.refresh();
  expect(p.there(file)).toBe(false);
  expect(flips).toBe(2);
});

test('a path nobody asked for in a while is forgotten, and looked at afresh when asked for again', async () => {
  const p = new FilePresence(() => {}, 5);
  const file = join(dir, 'demo.mp4');
  expect(p.there(file)).toBe(false);
  writeFileSync(file, 'x');
  await new Promise((r) => setTimeout(r, 20));
  await p.refresh();
  expect(p.there(file)).toBe(true);
});

test('refreshes with nothing asked in between do not forget what was seen', async () => {
  const p = new FilePresence(() => {});
  const file = join(dir, 'poster.jpg');
  expect(p.there(file)).toBe(false);
  await p.refresh();
  await p.refresh();
  writeFileSync(file, 'x');
  
  expect(p.there(file)).toBe(false);
});

test('refreshes asked for while one runs share the look that follows it, and resolve once it saw the disk', async () => {
  let flips = 0;
  const p = new FilePresence(() => flips++);
  const file = join(dir, 'a');
  expect(p.there(file)).toBe(false);
  const first = p.refresh();
  writeFileSync(file, 'x');
  p.there(file);
  const second = p.refresh();
  expect(second).not.toBe(first);
  expect(p.refresh()).toBe(second);
  
  await second;
  expect(p.there(file)).toBe(true);
  expect(flips).toBe(1);
});

test('refreshSoon looks again at most once in a gap, however often it is asked', async () => {
  let flips = 0;
  const p = new FilePresence(() => flips++);
  const file = join(dir, 'a');
  expect(p.there(file)).toBe(false);
  writeFileSync(file, 'x');
  for (let i = 0; i < 5; i++) p.refreshSoon(30);
  await new Promise((r) => setTimeout(r, 15));
  expect(p.there(file)).toBe(true);
  expect(flips).toBe(1);
});
