import { expect, test } from 'bun:test';
import { keepConfigDraft, keptConfigDraft } from './configDraft';

const store = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

test('a draft not saved yet comes back after a reload, until it is saved', () => {
  const s = store();
  const saved = { voice: 'say' };
  keepConfigDraft(s, 'demo', { voice: 'piper' }, saved);
  expect(keptConfigDraft<{ voice: string }>(s, 'demo', saved)).toEqual({ voice: 'piper' });
  // saved meanwhile: what is saved now is the draft, nothing to bring back
  expect(keptConfigDraft(s, 'demo', { voice: 'piper' })).toBeNull();
  keepConfigDraft(s, 'demo', { voice: 'piper' }, { voice: 'piper' });
  expect(s.m.size).toBe(0);
});

test('the canvases keep their draft with the ids they had, and each draft its own place', () => {
  const s = store();
  type K = { draft: { name: string }[]; origin: (string | null)[] };
  const of = (k: K) => k.draft;
  const saved = [{ name: 'obeya' }];
  const k: K = { draft: [{ name: 'Seismic' }], origin: ['obeya'] };
  keepConfigDraft(s, 'canvases', k, saved, of);
  expect(keptConfigDraft(s, 'demo', {})).toBeNull();
  expect(keptConfigDraft<K>(s, 'canvases', saved, of)).toEqual(k);
  // put back as saved: forgotten
  keepConfigDraft(s, 'canvases', { draft: saved, origin: ['obeya'] }, saved, of);
  expect(keptConfigDraft<K>(s, 'canvases', saved, of)).toBeNull();
});

test('a Qwen3 voice is a clone for a built-in speaker or a sample of the narration language', async () => {
  const { qwen3IsClone } = await import('../../plugin/skills/demo/lib/voice-choices.ts');
  expect(qwen3IsClone({ language: 'en' })).toBe(true);
  expect(qwen3IsClone({ language: 'en', voiceName: 'Founder' })).toBe(true);
  expect(qwen3IsClone({ language: 'en', voiceName: 'ryan' })).toBe(false);
  expect(qwen3IsClone({ language: 'en', voiceName: 'ryan', references: { de: '/a.wav' } })).toBe(false);
  expect(qwen3IsClone({ language: 'de', voiceName: 'ryan', references: { de: '/a.wav' } })).toBe(true);
});
