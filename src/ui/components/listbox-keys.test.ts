


import { beforeEach, expect, mock, test } from 'bun:test';
import type { KeyboardEvent } from 'react';

let slots: unknown[] = [];
let cursor = 0;
let pending: (() => void)[] = [];

mock.module('react', () => ({
  useId: () => 'lb',
  useState: <T>(init: T) => {
    const i = cursor++;
    if (!(i in slots)) slots[i] = init;
    return [slots[i] as T, (v: T) => void (slots[i] = v)] as const;
  },
  useEffect: (fn: () => void, deps: unknown[]) => {
    const i = cursor++;
    const prev = slots[i] as unknown[] | undefined;
    if (!prev || deps.some((d, j) => !Object.is(d, prev[j]))) pending.push(fn);
    slots[i] = deps;
  },
  useRef: () => ({ current: null }),
}));

const { useListbox } = await import('./listbox');
type Options = Parameters<typeof useListbox>[0];

beforeEach(() => {
  slots = [];
  cursor = 0;
  pending = [];
});

const render = (opts: Options) => {
  cursor = 0;
  const box = useListbox(opts);
  const effects = pending;
  pending = [];
  effects.forEach((f) => f());
  return box;
};

interface Fake {
  key: string;
  shiftKey?: boolean;
  keyCode?: number;
  composing?: boolean;
}
const press = (box: ReturnType<typeof render>, k: Fake) => {
  const e = { key: k.key, shiftKey: !!k.shiftKey, keyCode: k.keyCode ?? 0, nativeEvent: { isComposing: !!k.composing }, prevented: false, preventDefault() { this.prevented = true; } };
  const took = box.onKeyDown(e as unknown as KeyboardEvent);
  return { took, prevented: e.prevented };
};
/** Presses keys one after another, rendering between them like React does after a state change. */
const walk = (opts: Options, keys: string[]) => {
  let box = render(opts);
  for (const key of keys) {
    press(box, { key });
    box = render(opts);
  }
  return box.active;
};
const base = (over: Partial<Options> = {}): Options => ({ count: 3, open: true, onPick() {}, ...over });

test('arrow keys clamp at the ends by default', () => {
  expect(walk(base(), ['ArrowUp'])).toBe(0);
  expect(walk(base(), ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown'])).toBe(2);
});

test('arrow keys wrap around the ends with wrap: true', () => {
  slots = [];
  expect(walk(base({ wrap: true }), ['ArrowUp'])).toBe(2);
  slots = [];
  expect(walk(base({ wrap: true }), ['ArrowDown', 'ArrowDown', 'ArrowDown'])).toBe(0);
});

test('an arrow key is taken, prevented and reported through onNavigate', () => {
  let navigated = 0;
  const box = render(base({ onNavigate: () => navigated++ }));
  expect(press(box, { key: 'ArrowDown' })).toEqual({ took: true, prevented: true });
  expect(navigated).toBe(1);
});

test('Enter picks the active option', () => {
  const picked: number[] = [];
  const opts = base({ onPick: (i) => picked.push(i) });
  let box = render(opts);
  press(box, { key: 'ArrowDown' });
  box = render(opts);
  expect(press(box, { key: 'Enter' })).toEqual({ took: true, prevented: true });
  expect(picked).toEqual([1]);
});

test('Tab picks only where pickKeys lists it', () => {
  const picked: number[] = [];
  const onPick = (i: number) => picked.push(i);
  expect(press(render(base({ onPick })), { key: 'Tab' })).toEqual({ took: false, prevented: false });
  expect(picked).toEqual([]);
  expect(press(render(base({ onPick, pickKeys: ['Tab'] })), { key: 'Tab' }).took).toBe(true);
  expect(picked).toEqual([0]);
});

test('Shift+Enter does not pick, nor does Shift+Tab', () => {
  const picked: number[] = [];
  const box = render(base({ onPick: (i) => picked.push(i), pickKeys: ['Tab'] }));
  expect(press(box, { key: 'Enter', shiftKey: true })).toEqual({ took: false, prevented: false });
  expect(press(box, { key: 'Tab', shiftKey: true }).took).toBe(false);
  expect(picked).toEqual([]);
});

test('Escape is the list’s only when open and onEscape is given', () => {
  let escaped = 0;
  const onEscape = () => escaped++;
  expect(press(render(base({ onEscape })), { key: 'Escape' })).toEqual({ took: true, prevented: true });
  expect(escaped).toBe(1);
  expect(press(render(base()), { key: 'Escape' }).took).toBe(false);
  expect(press(render(base({ onEscape, open: false })), { key: 'Escape' }).took).toBe(false);
  expect(escaped).toBe(1);
  expect(render(base({ onEscape })).field['data-esc']).toBe(true);
  expect(render(base()).field['data-esc']).toBeUndefined();
  expect(render(base({ onEscape, open: false })).field['data-esc']).toBeUndefined();
});

test('Escape still closes an open list with no options', () => {
  let escaped = 0;
  expect(press(render(base({ count: 0, onEscape: () => escaped++ })), { key: 'Escape' }).took).toBe(true);
  expect(escaped).toBe(1);
});

test('keys are left alone while the IME composes or reports keyCode 229', () => {
  let escaped = 0;
  let navigated = 0;
  const picked: number[] = [];
  const opts = base({ onPick: (i) => picked.push(i), onEscape: () => escaped++, onNavigate: () => navigated++ });
  let box = render(opts);
  box.setActive(1);
  box = render(opts);
  for (const key of ['Enter', 'ArrowDown', 'ArrowUp', 'Escape']) {
    for (const ime of [{ composing: true }, { keyCode: 229 }]) {
      expect(press(box, { key, ...ime })).toEqual({ took: false, prevented: false });
      box = render(opts);
      expect(box.active).toBe(1);
      expect(navigated).toBe(0);
    }
  }
  expect(picked).toEqual([]);
  expect(escaped).toBe(0);
});

test('a closed list or an empty one takes no navigation or pick keys', () => {
  expect(press(render(base({ open: false })), { key: 'ArrowDown' }).took).toBe(false);
  expect(press(render(base({ open: false })), { key: 'Enter' }).took).toBe(false);
  expect(press(render(base({ count: 0 })), { key: 'ArrowDown' }).took).toBe(false);
  expect(press(render(base({ count: 0 })), { key: 'Enter' }).took).toBe(false);
});

test('the active option goes back to the first when resetOn changes', () => {
  let opts = base({ resetOn: 'a' });
  expect(walk(opts, ['ArrowDown', 'ArrowDown'])).toBe(2);
  opts = base({ resetOn: 'a' });
  expect(render(opts).active).toBe(2);
  render(base({ resetOn: 'b' }));
  expect(render(base({ resetOn: 'b' })).active).toBe(0);
});

test('the active option is clamped to the count', () => {
  expect(walk(base(), ['ArrowDown', 'ArrowDown'])).toBe(2);
  const shrunk = render(base({ count: 2 }));
  expect(shrunk.active).toBe(1);
  expect(render(base({ count: 0 })).active).toBe(0);
  const picked: number[] = [];
  press(render(base({ count: 2, onPick: (i) => picked.push(i) })), { key: 'Enter' });
  expect(picked).toEqual([1]);
});
