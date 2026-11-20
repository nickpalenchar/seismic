import { afterEach, beforeEach, expect, test } from 'bun:test';
import { sectionOfSetting, showSettingsAt, takeSettingsFocus } from './focus';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  Object.assign(globalThis, {
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    window: Object.assign(new EventTarget(), {}),
  });
});
afterEach(() => {
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  delete (globalThis as { window?: unknown }).window;
});

test('a proposed setting opens the section that holds it', () => {
  for (const k of ['setup', 'checks', 'run', 'softPaths']) expect(sectionOfSetting(k)).toBe('environment');
  expect(sectionOfSetting('artifacts')).toBe('demos');
  expect(sectionOfSetting('branch')).toBe('git');
  expect(sectionOfSetting('planDocs')).toBe('git');
});

test('the place to open at waits for the sheet of its project, and is taken once', () => {
  showSettingsAt({ project: 'b', repo: 'b', section: 'agents', field: 'slots' });
  expect(takeSettingsFocus('a')).toBeNull();
  expect(takeSettingsFocus('b')).toEqual({ project: 'b', repo: 'b', section: 'agents', field: 'slots' });
  expect(takeSettingsFocus('b')).toBeNull();
});
