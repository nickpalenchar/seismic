import { beforeEach, expect, test } from 'bun:test';
import { api } from './api';
import { closeWish, keepWish, openWish, wishNow } from './wish';

const m = new Map<string, string>();
const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
const KEY = 'obeya-wish-shop';
(globalThis as { window?: object }).window ??= {};

const calls: Parameters<typeof api.writeWish>[0][] = [];
api.writeWish = async (w) => {
  calls.push(w);
  return { title: `Issue: ${w.said}`, body: `${w.said}\n\nSeismic 0.4.0 · macOS · app` };
};
const written = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  calls.length = 0;
  closeWish();
});

const misaligned = { said: 'Die Zeile „Wunsch oder Fehler melden“ ist nicht horizontal ausgerichtet.' };

test('a draft with only a title gives way to the wish Seismic drafted, which is written from its words alone', async () => {
  // the draft the page kept, back after a reload
  m.set(KEY, JSON.stringify({ title: 'Archive filter loses focus', body: '', images: [] }));
  keepWish(store, 'shop');
  openWish(misaligned);
  expect(wishNow().pending).toBeUndefined();
  await written();
  expect(calls).toEqual([{ said: misaligned.said, app: false }]);
  expect(wishNow().issue).toMatchObject({ title: `Issue: ${misaligned.said}`, from: misaligned });
  // its link opens that draft again as it stands, after a reload too
  closeWish();
  openWish(misaligned);
  expect(wishNow()).toMatchObject({ open: true, pending: undefined, writing: false });
  expect(calls).toHaveLength(1);
  expect(JSON.parse(m.get(KEY)!).from).toEqual(misaligned);
});

test('a draft with text or screenshots stays, and the new wish waits for the owner to decide', () => {
  for (const issue of [
    { title: 'Archive filter loses focus', body: 'Typing in the filter loses focus.\n\nSeismic 0.4.0 · macOS · app' },
    { title: '', body: 'Seismic 0.4.0 · macOS · app', images: ['shot-1'] },
  ]) {
    wishNow().issue = { images: [], ...issue };
    openWish(misaligned);
    expect(wishNow()).toMatchObject({ open: true, pending: misaligned, issue });
    expect(calls).toHaveLength(0);
  }
});
