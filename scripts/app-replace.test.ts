import { afterAll, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { asides, replace } from './app-replace';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-replace-test-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A bundle as Tauri leaves it, its program saying which build it is. */
function bundle(name: string, build: string) {
  const at = path.join(dir, name);
  fs.mkdirSync(path.join(at, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(at, 'Contents', 'MacOS', 'seismic'), build);
  return at;
}
const program = (at: string) => fs.readFileSync(path.join(at, 'Contents', 'MacOS', 'seismic'), 'utf8');

test.skipIf(process.platform !== 'darwin')('the bundle of a shell that still runs stays on disk until nothing has it open', async () => {
  const to = path.join(dir, 'Seismic (checkout).app');
  bundle('Seismic (checkout).app', 'first');
  
  const shell = Bun.spawn(['tail', '-f', path.join(to, 'Contents', 'MacOS', 'seismic')]);
  await Bun.sleep(200);

  replace(bundle('second.app', 'second'), to);
  expect(program(to)).toBe('second');
  const [running] = asides(to);
  expect(asides(to)).toHaveLength(1);
  expect(program(running!)).toBe('first');

  
  replace(bundle('third.app', 'third'), to);
  expect(program(to)).toBe('third');
  expect(asides(to)).toEqual([running!]);

  shell.kill();
  await shell.exited;
  replace(bundle('fourth.app', 'fourth'), to);
  expect(program(to)).toBe('fourth');
  expect(asides(to)).toEqual([]);
});
