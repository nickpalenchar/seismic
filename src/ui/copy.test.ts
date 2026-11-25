import { afterAll, beforeEach, expect, test } from 'bun:test';
import { copyOrSelect } from './copy';


let clipboard: { writeText: (s: string) => Promise<void> } | undefined;
let secure = true;
let copies = false;
let written: string[] = [];
let selected: unknown[] = [];
const g = globalThis as Record<string, unknown>;
Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => clipboard });
Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, get: () => secure });
g.getSelection = () => ({ removeAllRanges: () => (selected = []), addRange: (r: { el: unknown }) => selected.push(r.el) });
g.document = {
  createRange: () => ({ el: null as unknown, selectNodeContents(el: unknown) { this.el = el; } }),
  execCommand: (c: string) => c === 'copy' && copies,
};
const el = { pre: true } as unknown as HTMLElement;

afterAll(() => {
  delete g.document;
  delete g.getSelection;
  delete (navigator as unknown as Record<string, unknown>).clipboard;
  delete g.isSecureContext;
});

beforeEach(() => {
  clipboard = { writeText: async (s) => void written.push(s) };
  secure = true;
  copies = false;
  written = [];
  selected = [];
});

test('the clipboard API gets the text as it is, and nothing is selected', async () => {
  expect(await copyOrSelect('ls -la\n  cd x', el)).toBe('copied');
  expect(written).toEqual(['ls -la\n  cd x']);
  expect(selected).toEqual([]);
});

test('on an insecure origin the block is selected and copied with the copy command, which leaves no selection behind', async () => {
  clipboard = undefined;
  secure = false;
  copies = true;
  expect(await copyOrSelect('x', el)).toBe('copied');
  expect(selected).toEqual([]);
});

test('where neither copies, the block stays selected for the system to copy', async () => {
  clipboard = { writeText: () => Promise.reject(new Error('denied')) };
  expect(await copyOrSelect('x', el)).toBe('selected');
  expect(selected).toEqual([el]);
});
