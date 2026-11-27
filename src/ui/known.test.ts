import { expect, test } from 'bun:test';
import { forgetAllHints, hintsOn, know, known, setHintsOn } from './known';

/** A Storage over a Map, as the browser's local storage. */
function storage(entries: Record<string, string>): Storage {
  const m = new Map(Object.entries(entries));
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}

test('resetting the hints removes every hint key and nothing else', () => {
  const store = storage({
    'seismic-review-pr-known': '1',
    'seismic-canvases-known': '1',
    'seismic-theme': 'dark',
    'seismic-paste-hint': 'card-a',
    'seismic.swipedAside': '1',
  });
  expect(forgetAllHints(store)).toBe(2);
  expect(store.getItem('seismic-review-pr-known')).toBeNull();
  expect(store.getItem('seismic-canvases-known')).toBeNull();
  expect(store.getItem('seismic-theme')).toBe('dark');
  expect(store.getItem('seismic-paste-hint')).toBe('card-a');
  expect(store.length).toBe(3);
});

test('turning hints off hides every hint and keeps which were dismissed', () => {
  const was = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage({}), configurable: true });
  try {
    know('seismic-a-known');
    expect([known('seismic-a-known'), known('seismic-b-known')]).toEqual([true, false]);
    setHintsOn(false);
    expect(hintsOn()).toBe(false);
    expect([known('seismic-a-known'), known('seismic-b-known')]).toEqual([true, true]);
    setHintsOn(true);
    expect([known('seismic-a-known'), known('seismic-b-known')]).toEqual([true, false]);
    forgetAllHints();
    expect(localStorage.length).toBe(0);
    expect([known('seismic-a-known'), known('seismic-b-known')]).toEqual([false, false]);
  } finally {
    if (was) Object.defineProperty(globalThis, 'localStorage', was);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});
