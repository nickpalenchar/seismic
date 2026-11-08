import { describe, expect, test } from 'bun:test';
import { type Clock, toastStore } from './toast';

/** A clock the test moves on by hand. */
function fakeClock() {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    set: (fn, ms) => {
      timers.set(++next, { at: now + ms, fn });
      return next;
    },
    clear: (h) => void timers.delete(h as number),
  };
  function tick(ms: number) {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, x]) => x.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = until;
  }
  return { clock, tick };
}

function store() {
  const c = fakeClock();
  const s = toastStore(() => {}, c.clock);
  const texts = () => s.list().map((x) => x.text);
  return { s, tick: c.tick, texts };
}

describe('the toast store', () => {
  test('a toast in a slot takes the place of the one there; others stack, newest last', () => {
    const { s, texts } = store();
    s.show({ kind: 'command', text: 'Reading' });
    s.show({ slot: 'ack', kind: 'wait', text: 'Approving' });
    s.show({ kind: 'warning', text: 'Queued', dismiss: true });
    s.show({ slot: 'ack', kind: 'confirm', text: 'Approved' });
    expect(texts()).toEqual(['Reading', 'Queued', 'Approved']);
    s.show({ kind: 'warning', text: 'Queued too', dismiss: true });
    expect(texts()).toEqual(['Reading', 'Queued', 'Approved', 'Queued too']);
  });

  test('a toast goes after its time; one without stays until dismissed', () => {
    const { s, tick, texts } = store();
    s.show({ kind: 'confirm', text: 'Archived', stayMs: 7000 });
    const w = s.show({ kind: 'warning', text: 'Queued', dismiss: true });
    tick(6999);
    expect(texts()).toEqual(['Archived', 'Queued']);
    tick(1);
    expect(texts()).toEqual(['Queued']);
    tick(60 * 60_000);
    expect(texts()).toEqual(['Queued']);
    s.remove(w);
    expect(texts()).toEqual([]);
  });

  test('a toast that replaces another stands even where the old one\'s maker takes it away again', () => {
    const { s, texts } = store();
    const old: number = s.show({ slot: 'ack', kind: 'wait', text: 'Approving', onGone: () => s.remove(old) });
    const id = s.show({ slot: 'ack', kind: 'confirm', text: 'Approved' });
    expect(texts()).toEqual(['Approved']);
    expect(s.has(id)).toBe(true);
  });

  test('a replaced toast takes its timer with it', () => {
    const { s, tick, texts } = store();
    s.show({ slot: 'ack', kind: 'confirm', text: 'Archived', stayMs: 1000 });
    tick(900);
    s.show({ slot: 'ack', kind: 'wait', text: 'Approving' });
    tick(10_000);
    expect(texts()).toEqual(['Approving']);
  });

  test('"Undo" goes after its window, the toast staying', () => {
    const { s, tick } = store();
    const id = s.show({ kind: 'confirm', text: 'Archived', undo: () => {}, undoMs: 3000, stayMs: 7000 });
    tick(2999);
    expect(s.list()[0]!.undo).toBeDefined();
    tick(1);
    expect(s.list()[0]!.undo).toBeUndefined();
    expect(s.has(id)).toBe(true);
    tick(4000);
    expect(s.has(id)).toBe(false);
  });

  test('an update restarts the timers it names and keeps the others', () => {
    const { s, tick } = store();
    const id = s.show({ kind: 'command', text: 'Done', stayMs: 5000 });
    tick(4000);
    s.update(id, { go: [{ id: 'c1', label: 'Go to card', run: () => {} }], stayMs: 15_000 });
    tick(14_999);
    expect(s.list()[0]!.go).toHaveLength(1);
    tick(1);
    expect(s.list()).toEqual([]);
    s.update(id, { text: 'late' });
    expect(s.list()).toEqual([]);
  });

  test('whoever made a toast hears it is gone, once, however it went', () => {
    const { s, tick } = store();
    const gone: string[] = [];
    const a = s.show({ kind: 'command', text: 'a', onGone: () => gone.push('a') });
    s.show({ kind: 'command', text: 'b', stayMs: 100, onGone: () => gone.push('b') });
    s.show({ slot: 'ack', kind: 'confirm', text: 'c', onGone: () => gone.push('c') });
    s.show({ slot: 'ack', kind: 'confirm', text: 'd' });
    s.remove(a);
    s.remove(a);
    tick(100);
    expect(gone).toEqual(['c', 'a', 'b']);
  });
});
