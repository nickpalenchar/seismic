import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { filesIn, findDropped, localImage, safeName } from '../files';

test("a file's name goes into a path as one word, its extension kept", () => {
  expect(safeName('Rechnung März 2026.pdf')).toBe('Rechnung-März-2026.pdf');
  expect(safeName('../../etc/passwd')).toBe('passwd');
  expect(safeName('C:\\Users\\me\\log (1).txt')).toBe('log-1.txt');
  expect(safeName('.env')).toBe('env');
  expect(safeName('')).toBe('file');
});

test('the stored files a text names are found by their directories, each once', () => {
  const root = '/home/o/.seismic/files';
  const a = `${root}/shop/0b8e1c1e-2f4a-4e8e-9d3c-1f2e3d4c5b6a`;
  const b = `${root}/shop/9f8e7d6c-5b4a-4321-8765-0a1b2c3d4e5f`;
  const text = `Schau dir ${a}/Rechnung.pdf an und ${b}/log.txt, nochmal ${a}/Rechnung.pdf. Nicht /tmp/x/${a.slice(-36)}/y`;
  expect(filesIn(text, root)).toEqual([a, b]);
  expect(filesIn('nichts', root)).toEqual([]);
});

describe('a file dropped in a browser', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'seismic-drop-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const put = (rel: string, body = 'x', at = Date.UTC(2026, 9, 20)) => {
    const p = join(home, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
    utimesSync(p, at / 1000, at / 1000);
    return realpathSync(p);
  };
  const of = (name: string, size: number, modified = Date.UTC(2026, 9, 20)) => ({ name, size, modified });

  test('is found by name, size and time in the folders files come from', async () => {
    const p = put('Downloads/Rechnung März.pdf', '%PDF-1');
    expect(await findDropped(of('Rechnung März.pdf', 6), home)).toBe(p);
    
    const deep = put('Documents/a/b/report.xlsx', 'abc');
    expect(await findDropped(of('report.xlsx', 3), home)).toBe(deep);
    expect(await findDropped(of('notes.txt', 2), home)).toBeNull();
    const top = put('notes.txt', 'hi');
    expect(await findDropped(of('notes.txt', 2), home)).toBe(top);
  });

  test('is not taken for another file of its name, nor when two fit', async () => {
    put('Downloads/a.pdf', '12345');
    
    expect(await findDropped(of('a.pdf', 4), home)).toBeNull();
    expect(await findDropped(of('a.pdf', 5, Date.UTC(2026, 9, 21)), home)).toBeNull();
    
    put('Desktop/a.pdf', '12345');
    expect(await findDropped(of('a.pdf', 5), home)).toBeNull();
    
    put('Downloads/.cache/b.pdf', '1');
    expect(await findDropped(of('b.pdf', 1), home)).toBeNull();
    expect(await findDropped(of('../Downloads/a.pdf', 5), home)).toBeNull();
  });
});

test('the app hands on images by their path, and nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seismic-local-'));
  writeFileSync(join(dir, 'shot.PNG'), 'png');
  writeFileSync(join(dir, 'secret.txt'), 'x');
  expect(localImage(join(dir, 'shot.PNG'))).toEqual({ file: join(dir, 'shot.PNG'), type: 'image/png' });
  expect(localImage(join(dir, 'secret.txt'))).toBeNull();
  expect(localImage(join(dir, 'missing.png'))).toBeNull();
  expect(localImage('shot.PNG')).toBeNull();
  writeFileSync(join(dir, 'page.__proto__'), '<script>');
  expect(localImage(join(dir, 'page.__proto__'))).toBeNull();
  rmSync(dir, { recursive: true, force: true });
});
