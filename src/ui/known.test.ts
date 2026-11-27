import { expect, test } from 'bun:test';
import { forgetAllHints, heardStorage, hintsOn, know, known, setHintsOn } from './known';

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

/** Runs `fn` with `store` as the page's local storage, and a page memory reset before and after. */
function withStorage(store: Storage, fn: () => void) {
  const was = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
  heardStorage(null, null);
  try {
    fn();
  } finally {
    if (was) Object.defineProperty(globalThis, 'localStorage', was);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
    heardStorage(null, null);
  }
}

/** A storage that refuses every write, as a browser with its storage full or blocked. */
function refusing(entries: Record<string, string>): Storage {
  const s = storage(entries);
  const no = () => {
    throw new Error('QuotaExceededError');
  };
  return { ...s, get length() { return s.length; }, setItem: no, removeItem: no };
}

test('a dismissal and the toggle hold in the page where the storage refuses them', () => {
  withStorage(refusing({ 'seismic-a-known': '1' }), () => {
    know('seismic-b-known');
    expect(known('seismic-b-known')).toBe(true);
    setHintsOn(false);
    expect(hintsOn()).toBe(false);
    setHintsOn(true);
    expect(() => forgetAllHints()).toThrow();
    expect(known('seismic-a-known')).toBe(true);
  });
});

test('a reset or dismissal in another tab reaches this page', () => {
  const store = storage({});
  withStorage(store, () => {
    know('seismic-a-known');
    store.removeItem('seismic-a-known');
    expect(known('seismic-a-known')).toBe(true);
    heardStorage('seismic-a-known', null);
    expect(known('seismic-a-known')).toBe(false);
    setHintsOn(true);
    store.setItem('seismic-hints-off', '1');
    heardStorage('seismic-hints-off', '1');
    expect(hintsOn()).toBe(false);
  });
});

test('turning hints off hides every hint and keeps which were dismissed', () => {
  withStorage(storage({}), () => {
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
  });
});
