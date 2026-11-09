import { describe, expect, test } from 'bun:test';
import { confirmShownMs, type Heard, undoShownMs } from '../api';
import { t } from '../strings';
import { type Clock, toastStore } from './toast';
import { MADE_SHOWN_MS, toldLines } from './told';

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

describe('the lines of commands', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  function told(opts: { inView?: (h: Heard) => boolean; undo?: (token: string) => Promise<{ undone: boolean }> } = {}) {
    const c = fakeClock();
    const s = toastStore(() => {}, c.clock);
    const heard: Heard[] = [];
    const went: string[] = [];
    const reading: boolean[] = [];
    const l = toldLines({
      toasts: s,
      onHeard: (h) => heard.push(h),
      inView: opts.inView ?? (() => false),
      onGo: (card) => went.push(card.id),
      undo: opts.undo ?? (async () => ({ undone: true })),
      onReading: (r) => reading.push(r),
    });
    /** A command whose reply the test delivers by hand. */
    function command(pending: string | null) {
      let reply!: (h: Heard) => void;
      const done = l.tell(pending, undefined, () => new Promise<Heard>((r) => (reply = r)));
      return { reply: async (h: Heard) => (reply(h), await done) };
    }
    return { ...c, s, l, heard, went, reading, command, texts: () => s.list().map((x) => x.text) };
  }

  test('a spoken command\'s reading line turns into its confirmation; a typed one has no line until then', async () => {
    const { s, command, texts } = told();
    const spoken = command('Reading …');
    expect(texts()).toEqual(['Reading …']);
    expect(s.list()[0]!.reading).toBe(true);
    await spoken.reply({ confirm: 'Done' });
    expect(texts()).toEqual(['Done']);
    expect(s.list()[0]!.reading).toBe(false);

    const typed = command(null);
    expect(texts()).toEqual(['Done']);
    await typed.reply({ confirm: 'Also done' });
    expect(texts()).toEqual(['Done', 'Also done']);
  });

  test('"Undo" shows for the undo window and the line goes after the confirmation time', async () => {
    const { s, command, tick } = told();
    const id = command('Reading …');
    await id.reply({ confirm: 'Archived', token: 'a', undoMs: 10_000 });
    expect(s.list()[0]!.undo).toBeDefined();
    tick(undoShownMs(10_000) - 1);
    expect(s.list()[0]!.undo).toBeDefined();
    tick(1);
    expect(s.list()).toHaveLength(1);
    expect(s.list()[0]!.undo).toBeUndefined();
    tick(confirmShownMs(10_000) - undoShownMs(10_000) - 1);
    expect(s.list()).toHaveLength(1);
    tick(1);
    expect(s.list()).toEqual([]);
  });

  test('a confirmation without undo goes after the shortest confirmation time', async () => {
    const { s, command, tick } = told();
    await command(null).reply({ confirm: 'Done' });
    tick(confirmShownMs() - 1);
    expect(s.list()).toHaveLength(1);
    tick(1);
    expect(s.list()).toEqual([]);
  });

  test('made() adds "Go to card" buttons and keeps the line 15 s longer', async () => {
    const { s, l, command, tick, went } = told();
    await command(null).reply({ confirm: 'Made', token: 'm' });
    tick(3000);
    l.made('m', [{ id: 'c1', title: 'One' }]);
    expect(s.list()[0]!.go!.map((g) => g.label)).toEqual([t.voice.goToCard]);
    s.list()[0]!.go![0]!.run();
    expect(went).toEqual(['c1']);
    tick(MADE_SHOWN_MS - 1);
    expect(s.list()).toHaveLength(1);
    tick(1);
    expect(s.list()).toEqual([]);

    await command(null).reply({ confirm: 'Two', token: 'n' });
    l.made('n', [{ id: 'c1', title: 'One' }, { id: 'c2', title: 'Two' }]);
    expect(s.list()[0]!.go!.map((g) => g.label)).toEqual([t.voice.goTo('One'), t.voice.goTo('Two')]);
    l.made('unknown', [{ id: 'c3', title: 'Three' }]);
    expect(s.list()[0]!.go).toHaveLength(2);
  });

  test('a quiet reply, or one the open conversation shows, gets no line, unless it has "Undo"', async () => {
    const { s, command, heard } = told({ inView: () => true });
    await command('Reading …').reply({ confirm: 'Quiet', quiet: true });
    expect(s.list()).toEqual([]);
    await command('Reading …').reply({ confirm: 'In view' });
    expect(s.list()).toEqual([]);
    await command(null).reply({ confirm: 'In view', token: 'u', undoMs: 5000 });
    expect(s.list().map((x) => x.text)).toEqual(['In view']);
    expect(s.list()[0]!.undo).toBeDefined();
    // a token without an undo window offers no "Undo": the open conversation shows it
    await command('Reading …').reply({ confirm: 'In view', token: 'v' });
    expect(s.list().map((x) => x.text)).toEqual(['In view']);
    // a quiet reply with an undo window keeps its line, which alone offers "Undo"
    await command('Reading …').reply({ confirm: 'Quiet', quiet: true, token: 'q', undoMs: 5000 });
    expect(s.list().map((x) => x.text)).toEqual(['In view', 'Quiet']);
    expect(s.list()[1]!.undo).toBeDefined();
    expect(heard).toHaveLength(5);
  });

  test('a line dismissed or swiped away while its command is read gets no confirmation later', async () => {
    const { s, command, texts } = told();
    const a = command('Reading …');
    s.remove(s.list()[0]!.id);
    await a.reply({ confirm: 'Late' });
    expect(texts()).toEqual([]);

    // a typed command's line was never there: nothing to dismiss, it gets its line
    const b = command(null);
    await b.reply({ confirm: 'On time' });
    expect(texts()).toEqual(['On time']);
  });

  test('a failed Undo frees the token: the server\'s renewed offer gets a line again', async () => {
    const { s, l, command, texts } = told({ undo: async () => Promise.reject(new Error('offline')) });
    await command(null).reply({ confirm: 'Archived', token: 'k', undoMs: 10_000 });
    s.list()[0]!.undo!();
    await flush();
    expect(texts()).toEqual([t.offlineError]);
    expect(s.list()[0]!.undo).toBeUndefined();
    l.show(undefined, { confirm: 'Archived', token: 'k', undoMs: 10_000 });
    expect(texts()).toEqual([t.offlineError, 'Archived']);
  });

  test('a too-late Undo frees the token; a done one removes the line', async () => {
    let undone = false;
    const { s, l, command, texts } = told({ undo: async () => ({ undone }) });
    await command(null).reply({ confirm: 'Archived', token: 'k', undoMs: 10_000 });
    s.list()[0]!.undo!();
    await flush();
    expect(texts()).toEqual([t.voice.tooLate]);
    l.show(undefined, { confirm: 'Archived', token: 'k', undoMs: 10_000 });
    expect(texts()).toEqual([t.voice.tooLate, 'Archived']);

    undone = true;
    s.list()[1]!.undo!();
    await flush();
    expect(texts()).toEqual([t.voice.tooLate]);
  });

  test('show() makes no second line for a token that already has one', async () => {
    const { s, l, command, texts } = told();
    await command(null).reply({ confirm: 'Archived', token: 'k', undoMs: 10_000 });
    l.show(undefined, { confirm: 'Archived', token: 'k', undoMs: 10_000 });
    expect(texts()).toEqual(['Archived']);
    l.show(undefined, { confirm: 'Another', token: 'j' });
    l.show({ id: 'c', title: 'C' }, { confirm: 'No token' });
    expect(texts()).toEqual(['Archived', 'Another', 'No token']);
    expect(s.list()[2]!.card).toEqual({ id: 'c', title: 'C' });
  });

  test('a restart is held while a command is read', async () => {
    const { command, reading } = told();
    const a = command('Reading …');
    expect(reading.at(-1)).toBe(true);
    await a.reply({ confirm: 'Done' });
    expect(reading.at(-1)).toBe(false);
  });
});
