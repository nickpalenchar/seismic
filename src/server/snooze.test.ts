import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { needsYou, snoozeOf } from '../core/types';
import { ProjectRuntime } from './project';
import { Store } from './store';
import { FakeRuntime, type FakeSession, gitRepo, noForge, until } from './testing';

let dir: string;
let main: string;
let store: Store;
let runtime: FakeRuntime;
let project: ProjectRuntime;

const open = () => new ProjectRuntime({ repos: [{ path: main, clones: 1, settings: { land: 'main' } }] }, { store, home: dir, runtime, forge: noForge, commandDelayMs: 10 });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-snooze-'));
  main = join(dir, 'main');
  gitRepo(main);
  mkdirSync(join(main, 'docs/plan'), { recursive: true });
  store = new Store(':memory:');
  runtime = new FakeRuntime();
  project = open();
});
afterEach(() => {
  project.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const board = () => project.board;
const item = (id: string) => board().item(id)!;
const workers = () => project.repos[0]!.workers;
const last = (id: string) => board().events(id).at(-1)!;
const HOUR = 60 * 60_000;
/** A time from now, as the agent or the browser sends it. */
const later = (ms: number) => new Date(Date.now() + ms).toISOString();

/** A card at work, its session known as `sess-1`. */
async function atWork(): Promise<{ id: string; s: FakeSession }> {
  const c = board().create({ title: 'Fan test', x: 0, y: 0 });
  await workers().start(c.id);
  const s = runtime.last;
  s.emit({ type: 'session', id: 'sess-1' });
  s.emit({ type: 'tool', name: 'Bash', input: { command: 'ha automation reload' } });
  return { id: c.id, s };
}

describe('the agent snoozes itself', () => {
  test('its session ends with its turn, the card holds no slot and needs nobody, and a restart touches nothing', async () => {
    const { id, s } = await atWork();
    const until = later(30 * HOUR);
    expect(s.call('snooze', { until, why: 'Check the test result' })).toContain('End your turn now');
    expect(item(id).hold).toEqual({ reason: 'snoozed', since: expect.any(String), until: new Date(until).toISOString(), by: 'agent', why: 'Check the test result' });
    expect(last(id)).toMatchObject({ kind: 'state', author: 'worker', text: expect.stringMatching(/^Snoozed until .* · Check the test result$/) });
    // its closing words repeat the snooze
    s.emit({ type: 'text', text: 'I will get back to you tomorrow morning.' });
    s.emit({ type: 'idle' });
    expect(s.closed).toBe(true);
    expect(workers().busyCards()).toEqual([]);
    expect(board().events(id).some((e) => e.text === 'I will get back to you tomorrow morning.')).toBe(false);
    expect(item(id)).toMatchObject({ state: 'working', hold: { reason: 'snoozed', by: 'agent' } });
    expect(needsYou(item(id))).toBe(false);
    expect(item(id).question).toBeUndefined();

    // a restart starts no session for it, and the time comes all the same
    const n = runtime.sessions.length;
    project.shutdown();
    project = open();
    expect(runtime.sessions.length).toBe(n);
    project.wakeDue(Date.parse(until) - 1000);
    expect(runtime.sessions.length).toBe(n);
    project.wakeDue(Date.parse(until) + 1000);
    expect(runtime.last.spec.resume).toBe('sess-1');
    expect(runtime.last.inbox[0]).toContain('the time you snoozed until, to: Check the test result');
    expect(item(id)?.hold?.reason).not.toBe('snoozed');
    expect(last(id)).toMatchObject({ kind: 'state', author: 'obeya', text: 'Woke up: the time has come' });
    expect(workers().busyCards()).toEqual([id]);
  });

  test('a note from the owner wakes it early, and so does what Seismic has for it', async () => {
    const { id, s } = await atWork();
    s.call('snooze', { until: later(10 * HOUR), why: 'Check' });
    s.emit({ type: 'idle' });
    workers().message(id, 'Schau jetzt schon mal nach.');
    expect(runtime.last.spec.resume).toBe('sess-1');
    expect(runtime.last.inbox[0]).toContain('the owner wakes you early');
    expect(runtime.last.inbox[0]).toContain('Schau jetzt schon mal nach.');
    expect(item(id)?.hold?.reason).not.toBe('snoozed');
    expect(board().events(id).some((e) => e.kind === 'state' && e.author === 'owner' && e.text === 'Woke up: woken by you')).toBe(true);

    runtime.last.call('snooze', { until: later(10 * HOUR), why: 'Check' });
    runtime.last.emit({ type: 'idle' });
    workers().prEvent(id, 'Check rot.', 'A check of your pull request failed: test.');
    expect(runtime.last.inbox[0]).toContain('what follows wakes you early');
    expect(runtime.last.inbox[0]).toContain('A check of your pull request failed');
    expect(board().events(id).some((e) => e.text === 'Woke up: news for the agent')).toBe(true);
  });

  test('the owner moves the time it snoozed until: woken then, it hears so', async () => {
    const { id, s } = await atWork();
    s.call('snooze', { until: later(10 * HOUR), why: 'Check' });
    s.emit({ type: 'idle' });
    const soon = later(HOUR);
    project.act(id, { action: 'snooze', until: soon });
    expect(item(id)?.hold).toMatchObject({ by: 'agent', why: 'Check', moved: true });
    project.wakeDue(Date.parse(soon) + 1);
    expect(runtime.last.inbox[0]).toContain('you snoozed, to: Check, and the owner moved the time to now.');
    // woken early after the owner moved it, it hears both
    runtime.last.call('snooze', { until: later(10 * HOUR), why: 'Check' });
    runtime.last.emit({ type: 'idle' });
    project.act(id, { action: 'snooze', until: later(20 * HOUR) });
    project.act(id, { action: 'wake' });
    expect(runtime.last.inbox[0]).toContain('You snoozed, to: Check, and the owner moved the time to');
    expect(runtime.last.inbox[0]).toContain('the owner wakes you early');
  });

  test('a time that passed, or no time, is refused; a question in the same turn wins over the snooze', async () => {
    const { id, s } = await atWork();
    expect(s.call('snooze', { until: later(-HOUR), why: 'x' })).toContain('has passed');
    expect(s.call('snooze', { until: 'tomorrow morning', why: 'x' })).toContain('ISO 8601');
    expect(item(id)?.hold?.reason).not.toBe('snoozed');
    s.call('snooze', { until: later(HOUR * 5), why: 'x' });
    s.call('ask', { question: 'Doch lieber gleich?' });
    s.emit({ type: 'idle' });
    expect(item(id)?.hold?.reason).not.toBe('snoozed');
    expect(item(id)).toMatchObject({ state: 'waiting', need: 'question' });
    expect(s.closed).toBe(false);
    // the card waits for the owner: nothing to snooze until they answered
    expect(s.call('snooze', { until: later(HOUR * 5), why: 'x' })).toContain('Not snoozed');
  });

  test('on its handover, as the owner asks: the handover stands, the card leaves them until then, and the agent goes on then', async () => {
    const { id, s } = await atWork();
    s.emit({ type: 'idle' });
    board().work(id, { state: 'waiting', need: 'review' });
    workers().message(id, 'Check again in three days.');
    const until = later(72 * HOUR);
    expect(s.call('snooze', { until, why: 'Check the log again' })).toContain('Snoozed until');
    s.emit({ type: 'idle' });
    expect(s.closed).toBe(true);
    expect(item(id)).toMatchObject({ state: 'waiting', need: 'review', hold: { reason: 'snoozed', by: 'agent' } });
    expect(item(id).review?.answering).toBeUndefined();
    expect(needsYou(item(id))).toBe(false);
    expect(board().events(id).some((e) => e.text.startsWith('The agent stopped'))).toBe(false);

    project.wakeDue(Date.parse(until) + 1000);
    expect(runtime.last.spec.resume).toBe('sess-1');
    expect(runtime.last.inbox[0]).toContain('the time you snoozed until, to: Check the log again');
    // at work towards what it told them, the card still waits for approval
    expect(item(id)).toMatchObject({ state: 'waiting', need: 'review', review: { answering: true } });
    expect(item(id)?.hold?.reason).not.toBe('snoozed');
    expect(needsYou(item(id))).toBe(false);
  });

  test('approved while its agent snoozed on its handover: it wakes no more', async () => {
    const { id, s } = await atWork();
    s.emit({ type: 'idle' });
    board().work(id, { state: 'waiting', need: 'review' });
    workers().message(id, 'Check again in three days.');
    s.call('snooze', { until: later(72 * HOUR), why: 'x' });
    s.emit({ type: 'idle' });
    await workers().approve(id);
    expect(item(id)?.hold?.reason).not.toBe('snoozed');
  });

  test('stopping a snoozed card plans it again, not snoozed', async () => {
    const { id, s } = await atWork();
    s.call('snooze', { until: later(HOUR * 5), why: 'x' });
    s.emit({ type: 'idle' });
    project.act(id, { action: 'stop' });
    expect(item(id).state).toBe('planned');
    expect(item(id)?.hold?.reason).not.toBe('snoozed');
  });
});

describe('the agent snoozes until another card gets somewhere', () => {
  /** Another card at work on the project. */
  const other = (title = 'Make the Linux tests green') => {
    const c = board().create({ title, x: 0, y: 0 });
    board().work(c.id, { state: 'working', branch: 'obeya/linux' });
    return c.id;
  };

  test('until that card is done: it wakes once its work is on main, and hears so', async () => {
    const fix = other();
    const { id, s } = await atWork();
    expect(s.call('snooze', { card: 'make the linux tests green', why: 'Move the day' })).toContain('Snoozed until the card “Make the Linux tests green” is done');
    expect(item(id).hold).toEqual({ reason: 'snoozed', since: expect.any(String), on: { card: fix, title: 'Make the Linux tests green', state: 'done' }, by: 'agent', why: 'Move the day' });
    expect(last(id)).toMatchObject({ kind: 'state', author: 'worker', text: 'Snoozed until “Make the Linux tests green” is done · Move the day' });
    s.emit({ type: 'idle' });
    expect(s.closed).toBe(true);
    const n = runtime.sessions.length;
    // it waits for the owner's approval: not done yet
    board().work(fix, { state: 'waiting', need: 'demo' });
    project.wakeDue(Date.now() + 400 * 24 * HOUR);
    expect(runtime.sessions.length).toBe(n);
    board().work(fix, { state: 'live' });
    project.wakeDue();
    expect(runtime.last.spec.resume).toBe('sess-1');
    expect(runtime.last.inbox[0]).toContain('The card “Make the Linux tests green” is done: its work is on main');
    expect(runtime.last.inbox[0]).toContain('to: Move the day');
    expect(item(id)?.hold?.reason).not.toBe('snoozed');
    expect(last(id)).toMatchObject({ author: 'obeya', text: 'Woke up: “Make the Linux tests green” is done' });
  });

  test('until it waits for the owner, at the latest at a time: whichever comes first wakes it', async () => {
    other('Export demo');
    const { id, s } = await atWork();
    const until = later(5 * HOUR);
    s.call('snooze', { card: 'Export', state: 'waits_for_owner', until, why: 'Compare' });
    expect(last(id).text).toMatch(/^Snoozed until “Export demo” waits for you, at the latest .* · Compare$/);
    s.emit({ type: 'idle' });
    project.wakeDue(Date.parse(until) + 1);
    expect(runtime.last.inbox[0]).toContain('you snoozed until the card “Export demo” waits for the owner');
    expect(runtime.last.inbox[0]).toContain('has not got there yet');
  });

  test('a card that asks the owner is one that waits for them', async () => {
    const demo = other('Export demo');
    const { s } = await atWork();
    s.call('snooze', { card: 'Export demo', state: 'waits_for_owner', why: 'Compare' });
    s.emit({ type: 'idle' });
    board().work(demo, { state: 'waiting', need: 'question' });
    project.wakeDue();
    expect(runtime.last.inbox[0]).toContain('waits for the owner now');
  });

  test('a state the card passes through between two ticks wakes it all the same', async () => {
    const demo = other('Export demo');
    const { s } = await atWork();
    s.call('snooze', { card: 'Export demo', state: 'waits_for_owner', why: 'Compare' });
    s.emit({ type: 'idle' });
    board().work(demo, { state: 'waiting', need: 'question' });
    await Bun.sleep(5);
    board().work(demo, { state: 'working', need: null });
    expect(runtime.last.inbox[0]).toContain('waits for the owner now');
  });

  test('an idea whose questions wait for the owner waits for them', async () => {
    const idea = board().create({ idea: true, title: 'Export-Formate', body: 'Welche?', x: 0, y: 0 });
    board().work(idea.id, {}, { discussion: { status: 'open', brief: '', yourTurn: false, thinking: true, questions: [] } });
    const { s } = await atWork();
    s.call('snooze', { card: 'Export-Formate', state: 'waits_for_owner', why: 'x' });
    s.emit({ type: 'idle' });
    board().work(idea.id, {}, { discussion: { status: 'open', brief: '', yourTurn: true, questions: [] } });
    project.wakeDue();
    expect(runtime.last.inbox[0]).toContain('waits for the owner now');
  });

  test('the card stopped, archived or removed: it wakes, as that card no longer gets there', async () => {
    const fix = other();
    const { s } = await atWork();
    s.call('snooze', { card: 'Make the Linux tests green', why: 'x' });
    s.emit({ type: 'idle' });
    board().work(fix, { state: 'planned' });
    project.wakeDue();
    expect(runtime.last.inbox[0]).toContain('The owner stopped the card “Make the Linux tests green”');

    const gone = other('Weg damit');
    runtime.last.call('snooze', { card: 'Weg damit', why: 'x' });
    runtime.last.emit({ type: 'idle' });
    board().remove(gone);
    project.wakeDue();
    expect(runtime.last.inbox[0]).toContain('The card “Weg damit” is gone from the project.');
  });

  test('a card nobody can find, one done already, several alike, or neither card nor time is refused', async () => {
    other('Linux-Tests');
    other('Linux-Build');
    const done = board().create({ title: 'Fertig', x: 0, y: 0 });
    board().work(done.id, { state: 'live' });
    const { id, s } = await atWork();
    expect(s.call('snooze', { card: 'Windows', why: 'x' })).toContain('no card on the project is called “Windows”');
    expect(s.call('snooze', { card: 'Linux', why: 'x' })).toContain('several cards have “Linux” in their title');
    // a finished card makes no part of a title ambiguous
    expect(s.call('snooze', { card: 'ertig', why: 'x' })).toContain('no card on the project is called “ertig”');
    expect(s.call('snooze', { card: 'Fertig', why: 'x' })).toContain('is done already');
    expect(s.call('snooze', { why: 'x' })).toContain('give until, card, or both');
    expect(s.call('snooze', { card: 'Fan test', why: 'x' })).toContain('no card on the project');
    expect(item(id)?.hold?.reason).not.toBe('snoozed');
  });
});

describe('the owner snoozes a card', () => {
  test('at work: its worker stops at once as on a pause, Seismic’s messages wait, and at the time it goes on with them', async () => {
    const { id, s } = await atWork();
    const until = later(14 * HOUR);
    project.act(id, { action: 'snooze', until });
    expect(s.closed).toBe(true);
    expect(workers().busyCards()).toEqual([]);
    expect(item(id)).toMatchObject({ state: 'working', hold: { reason: 'snoozed', by: 'owner' } });
    expect(last(id)).toMatchObject({ kind: 'state', author: 'owner', text: expect.stringMatching(/^Snoozed until /) });
    const n = runtime.sessions.length;
    workers().prEvent(id, 'Check rot.', 'A check of your pull request failed: test.');
    expect(runtime.sessions.length).toBe(n);
    project.wakeDue(Date.parse(until) + 1);
    const inbox = runtime.last.inbox[0]!;
    expect(runtime.last.spec.resume).toBe('sess-1');
    expect(inbox).toContain('The owner snoozed you until');
    expect(inbox).toContain('exit code 137');
    expect(inbox).toContain('While you were snoozed, Seismic had this for you');
    expect(inbox).toContain('A check of your pull request failed');
    expect(item(id)?.hold?.reason).not.toBe('snoozed');
    expect(item(id)?.hold?.reason).not.toBe('paused');
    expect(last(id).text).toBe('Woke up: the time has come');
  });

  test('waiting for them: it leaves them and comes back at the time; nothing goes to its agent', async () => {
    const { id, s } = await atWork();
    s.call('ask', { question: 'CSV oder Excel?' });
    s.emit({ type: 'idle' });
    expect(needsYou(item(id))).toBe(true);
    const n = runtime.sessions.length;
    const inbox = s.inbox.length;
    const until = later(3 * HOUR);
    project.act(id, { action: 'snooze', until });
    expect(item(id)).toMatchObject({ state: 'waiting', need: 'question', hold: { reason: 'snoozed', by: 'owner', waiting: true } });
    expect(needsYou(item(id))).toBe(false);
    // the owner changes the time
    const changed = later(5 * HOUR);
    project.act(id, { action: 'snooze', until: changed });
    expect(snoozeOf(item(id))!.until).toBe(new Date(changed).toISOString());
    project.wakeDue(Date.parse(until) + 1);
    expect(item(id)?.hold?.reason).toBe('snoozed');
    project.wakeDue(Date.parse(changed) + 1);
    expect(item(id)?.hold?.reason).not.toBe('snoozed');
    expect(needsYou(item(id))).toBe(true);
    expect(runtime.sessions.length).toBe(n);
    expect(s.inbox.length).toBe(inbox);
  });

  test('waiting for them, answered all the same: snoozed no longer', async () => {
    const { id, s } = await atWork();
    s.call('ask', { question: 'CSV oder Excel?' });
    s.emit({ type: 'idle' });
    project.act(id, { action: 'snooze', until: later(3 * HOUR) });
    project.act(id, { action: 'answer', text: 'CSV' });
    expect(item(id).state).toBe('working');
    expect(item(id)?.hold?.reason).not.toBe('snoozed');
  });

  test('“Wake it now” wakes it at once, whoever snoozed it', async () => {
    const { id, s } = await atWork();
    s.call('snooze', { until: later(30 * HOUR), why: 'Check' });
    s.emit({ type: 'idle' });
    project.act(id, { action: 'wake' });
    expect(runtime.last.spec.resume).toBe('sess-1');
    expect(runtime.last.inbox[0]).toContain('You snoozed until');
    expect(runtime.last.inbox[0]).toContain('the owner wakes you early, without words, so tell them with reply where things stand');
    expect(last(id)).toMatchObject({ author: 'owner', text: 'Woke up: woken by you' });
    expect(() => project.act(id, { action: 'wake' })).toThrow('not snoozed');
  });

  test('an idea whose agent replied, until tomorrow; a queued card or a past time is refused', () => {
    const i = board().create({ idea: true, title: 'Export', body: 'Vermieter wollen ihn.', x: 0, y: 0 });
    board().work(i.id, {}, { discussion: { status: 'open', brief: '', yourTurn: true, questions: [] } });
    expect(needsYou(item(i.id))).toBe(true);
    project.act(i.id, { action: 'snooze', until: later(20 * HOUR) });
    expect(item(i.id)?.hold).toMatchObject({ waiting: true });
    expect(needsYou(item(i.id))).toBe(false);
    project.act(i.id, { action: 'wake' });
    expect(needsYou(item(i.id))).toBe(true);

    const p = board().create({ title: 'Geplant', x: 0, y: 0 });
    project.act(p.id, { action: 'start' });
    expect(() => project.act(p.id, { action: 'snooze', until: later(HOUR) })).toThrow('neither planned, at work nor waiting');
    expect(() => project.act(i.id, { action: 'snooze', until: later(-HOUR) })).toThrow('within the coming year');
  });
});

describe('edges a review found', () => {
  test('a restart notice that comes after the snooze keeps it: the session ends after the turn the notice starts, background work or not', async () => {
    const { id, s } = await atWork();
    s.call('snooze', { until: later(10 * HOUR), why: 'x' });
    s.emit({ type: 'idle', more: true });
    expect(s.closed).toBe(false);
    s.emit({ type: 'idle', background: 1 });
    expect(s.closed).toBe(true);
    expect(workers().busyCards()).toEqual([]);
    expect(item(id)?.hold?.reason).toBe('snoozed');
  });

  test('its pull request closed while the agent snoozes: the question reaches the owner, snoozed no longer', async () => {
    const { id, s } = await atWork();
    board().work(id, { state: 'inPr', pr: JSON.stringify({ url: 'https://github.com/acme/app/pull/7', number: 7, seen: [], reported: [] }) });
    s.call('snooze', { until: later(10 * HOUR), why: 'x' });
    s.emit({ type: 'idle' });
    workers().prClosed(id);
    expect(item(id)?.hold?.reason).not.toBe('snoozed');
    expect(board().events(id).some((e) => e.text === 'Woke up: the card needs you')).toBe(true);
    expect(needsYou(item(id))).toBe(true);
  });

  test('snoozing a card that waits for the owner leaves its background work running, and its pause offered', async () => {
    const { id, s } = await atWork();
    s.call('ask', { question: 'CSV?' });
    s.emit({ type: 'idle', background: 1 });
    project.act(id, { action: 'snooze', until: later(HOUR * 3) });
    expect(s.closed).toBe(false);
    expect(item(id)).toMatchObject({ agent: { inTurn: true }, hold: { reason: 'snoozed', waiting: true } });
    project.act(id, { action: 'pause' });
    expect(s.closed).toBe(true);
  });

  test('a worker that waited for the restart after the landing and snoozed hears of the restart, which wakes it', async () => {
    const { id, s } = await atWork();
    board().work(id, { state: 'live', landed: JSON.stringify({ commit: 'abc', restarts: true, waits: true }) });
    s.call('snooze', { until: later(10 * HOUR), why: 'x' });
    s.emit({ type: 'idle' });
    project.shutdown();
    project = open();
    expect(runtime.last.inbox[0]).toContain('Seismic has started again and runs main with your change now.');
    expect(JSON.parse(board().row(id).landed!)).toEqual({ commit: 'abc' });
    expect(item(id)?.hold?.reason).not.toBe('snoozed');
  });
});

describe('the Koordinator waits on a card', () => {
  test('a new card of the command is waited on by its id, and its getting done takes the step up by itself', async () => {
    const heard = project.commander.hear('create a task for the repo, and then another one for the canvas', {});
    await until(() => runtime.sessions.length === 1);
    const k = runtime.last;
    k.call('act', {
      actions: [
        { do: 'new_card', title: 'Create repository', body: 'git init', start: false },
        { do: 'wait_for', on: 'Create repository', text: 'New card “Create canvas”, not started.' },
      ],
      confirm: 'New task “Create repository”; once it is done, I will create “Create canvas”.',
    });
    k.emit({ type: 'idle' });
    project.commander.arm((await heard).token!);
    await until(() => board().snapshot().talk[0]!.waits);
    const repo = board().snapshot().items.find((i) => i.title === 'Create repository')!;
    expect(board().snapshot().talk[0]!.waits).toEqual([{ card: repo.id, title: 'Create repository', state: 'done' }]);

    // its agent, asking Seismic for the step itself, hears that Seismic takes it
    expect(await project.forward(repo.id, 'Create the canvas.')).toContain('Seismic itself takes these steps once your card is done: New card “Create canvas”, not started. If you asked for one of them, it is not missing');
    // done: the board's change wakes the Koordinator, without the owner saying anything
    board().work(repo.id, { state: 'done' });
    await until(() => k.inbox.length === 2);
    expect(k.inbox[1]).toContain('the card "Create repository" is done');
    k.call('act', { actions: [{ do: 'new_card', title: 'Create canvas', body: '', start: false }], confirm: 'New task “Create canvas”.' });
    k.emit({ type: 'idle' });
    await until(() => board().snapshot().items.some((i) => i.title === 'Create canvas'));
    expect(board().snapshot().talk.map((t) => [t.said, t.reply, t.after?.met])).toEqual([
      ['create a task for the repo, and then another one for the canvas', 'New task “Create repository”; once it is done, I will create “Create canvas”.', undefined],
      ['', 'New task “Create canvas”.', 'reached'],
    ]);
  });
});

describe('a card that starts later', () => {
  // the timers' work done, and the workers it started at work in their workstations
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 5));
    await Promise.all(project.repos.map((r) => r.workers.prepared()));
  };
  const DAY = 24 * HOUR;
  const worker = () => runtime.sessions.findLast((x) => x.spec.role === 'worker')!;

  test('proposed with a start time: accepted, it is planned and snoozed until then, survives a restart, and starts at the time through the Koordinator', async () => {
    const { id: src, s } = await atWork();
    const at = later(14 * DAY);
    expect(s.call('propose_card', { title: 'Check the filing', task: 'Check whether the bank has registered the filing.', reason: 'Only visible in two weeks.', start_at: at })).toContain('Proposed');
    const p = board().snapshot().items.find((i) => i.state === 'proposal')!;
    expect(p.idea?.proposal).toMatchObject({ startAt: new Date(at).toISOString() });
    // the reviser rewrites the text, not when it starts
    board().revised(p.id, { title: 'Check the filing', task: 'Check whether the bank has registered both filings.', reason: 'Only visible in two weeks.', questions: [] });
    expect(item(p.id).idea!.proposal!.startAt).toBe(new Date(at).toISOString());

    project.act(p.id, { action: 'accept' });
    expect(item(p.id)).toMatchObject({ state: 'planned', hold: { reason: 'snoozed', until: new Date(at).toISOString(), by: 'agent', start: true, why: 'Only visible in two weeks.' } });
    expect(item(p.id).queue).toBeUndefined();
    expect(needsYou(item(p.id))).toBe(false);
    expect(last(p.id)).toMatchObject({ kind: 'state', text: expect.stringMatching(/^Snoozed until .* · Only visible in two weeks\.$/) });

    // its source card's work is done by then, and the one clone free
    await project.act(src, { action: 'stop' });
    project.shutdown();
    project = open();
    project.wakeDue(Date.parse(at) - 1000);
    expect(item(p.id).queue).toBeUndefined();
    project.wakeDue(Date.parse(at) + 1000);
    expect(item(p.id)?.hold?.reason).not.toBe('snoozed');
    expect(item(p.id).queue).toMatchObject({ checking: true });
    expect(board().events(p.id).some((e) => e.text === 'Woke up: the time has come')).toBe(true);
    await settle();
    expect(item(p.id).state).toBe('working');
    // its worker reads the task as due now, not as two weeks off
    expect(worker().inbox[0]).toContain('The agent that proposed this card set it to start at');
    expect(worker().inbox[0]).toContain('that time has come');
  });

  test('the owner changes the start time or takes it away; a time that has passed when accepting starts it at once', () => {
    const b = board().create({ title: 'B', x: 0, y: 0 });
    const p = board().propose(b.id, { title: 'Nachsehen', task: 'T', reason: 'R', startAt: later(3 * DAY) });
    const sooner = later(DAY);
    project.act(p.id, { action: 'startAt', at: sooner });
    expect(item(p.id).idea!.proposal!.startAt).toBe(new Date(sooner).toISOString());
    expect(() => project.act(p.id, { action: 'startAt', at: later(-HOUR) })).toThrow('within the coming year');
    project.act(p.id, { action: 'startAt', at: null });
    expect(item(p.id).idea!.proposal!.startAt).toBeUndefined();
    project.act(p.id, { action: 'accept' });
    expect(item(p.id)?.hold?.reason).not.toBe('snoozed');
    expect(item(p.id).queue).toMatchObject({ checking: true });

    const q = board().propose(b.id, { title: 'Verpasst', task: 'T', reason: 'R', startAt: later(-HOUR) });
    project.act(q.id, { action: 'accept' });
    expect(item(q.id)?.hold?.reason).not.toBe('snoozed');
    expect(item(q.id).queue).toMatchObject({ checking: true });
    // its worker hears all the same that the time has come
    expect(board().row(q.id).unheard).toContain('that time has come');

    // kept as planned only, or taken on as an idea, it waits for no time
    const r = board().propose(b.id, { title: 'Nur geplant', task: 'T', reason: 'R', startAt: later(DAY) });
    project.act(r.id, { action: 'accept', start: false });
    expect(item(r.id)).toMatchObject({ state: 'planned' });
    expect(item(r.id)?.hold?.reason).not.toBe('snoozed');
  });

  test('propose_card refuses a start time that has passed or is no time', async () => {
    const { s } = await atWork();
    expect(s.call('propose_card', { title: 'X', task: 'T', reason: 'R', start_at: later(-HOUR) })).toContain('has passed');
    expect(s.call('propose_card', { title: 'X', task: 'T', reason: 'R', start_at: 'in zwei Wochen' })).toContain('ISO 8601');
    expect(board().snapshot().items.some((i) => i.state === 'proposal')).toBe(false);
  });

  test('a planned card the owner snoozes starts at the time; started or woken earlier, it starts now and its worker hears so', async () => {
    const c = board().create({ title: 'Montags-Export', body: 'Export bauen.', x: 0, y: 0 });
    const until = later(2 * DAY);
    project.act(c.id, { action: 'snooze', until });
    expect(item(c.id)).toMatchObject({ state: 'planned', hold: { reason: 'snoozed', by: 'owner', start: true, until: new Date(until).toISOString() } });
    expect(last(c.id)).toMatchObject({ kind: 'state', author: 'owner', text: expect.stringMatching(/^Snoozed until /) });
    // the owner changes the time
    const changed = later(3 * DAY);
    project.act(c.id, { action: 'snooze', until: changed });
    expect(item(c.id)?.hold).toMatchObject({ by: 'owner', start: true, until: new Date(changed).toISOString() });
    project.wakeDue(Date.parse(until) + 1);
    expect(item(c.id).queue).toBeUndefined();
    // “Start” on the card starts it now, as “Wake it now” does
    project.act(c.id, { action: 'start' });
    expect(item(c.id)?.hold?.reason).not.toBe('snoozed');
    expect(item(c.id).queue).toMatchObject({ checking: true });
    expect(board().events(c.id).some((e) => e.author === 'owner' && e.text === 'Woke up: woken by you')).toBe(true);
    await settle();
    expect(item(c.id).state).toBe('working');
    expect(worker().inbox[0]).toContain('The owner set this card aside to start at');
    expect(worker().inbox[0]).toContain('the owner started it earlier, now');

    const d = board().create({ title: 'Zweiter', x: 0, y: 0 });
    project.act(d.id, { action: 'snooze', until: later(DAY) });
    project.act(d.id, { action: 'wake' });
    expect(item(d.id)?.hold?.reason).not.toBe('snoozed');
    expect(item(d.id).queue).toMatchObject({ checking: true });
  });

  test('a new card the owner wants done later is planned and starts at the time, not at once; a time passed in the undo window starts it now', async () => {
    const until = later(40 * DAY);
    const id = project.run({ do: 'newCard', title: 'Depots einrichten', body: 'Anfang Dezember.', start: true, until, place: { x: 0, y: 0 } }) as string;
    expect(item(id)).toMatchObject({ state: 'planned', hold: { reason: 'snoozed', by: 'owner', start: true, until } });
    expect(item(id).queue).toBeUndefined();
    project.wakeDue(Date.parse(until) + 1);
    expect(item(id)?.hold?.reason).not.toBe('snoozed');
    expect(item(id).queue).toMatchObject({ checking: true });

    const passed = project.run({ do: 'newCard', title: 'Gleich', body: '', start: true, until: later(-1000), place: { x: 0, y: 0 } }) as string;
    expect(item(passed)?.hold?.reason).not.toBe('snoozed');
    expect(item(passed).queue).toMatchObject({ checking: true });
  });

  test('a snoozed planned card that is no longer planned to start is snoozed no longer, nor one archived and brought back', () => {
    const c = board().create({ title: 'Erst Montag', x: 0, y: 0 });
    project.act(c.id, { action: 'snooze', until: later(DAY) });
    board().work(c.id, { state: 'idea' });
    expect(item(c.id)?.hold?.reason).not.toBe('snoozed');

    // a stopped card, snoozed, archived, and back after its time: nothing starts it
    const d = board().create({ title: 'Gestoppt', x: 0, y: 0 });
    board().work(d.id, { branch: 'obeya/gestoppt' });
    const until = later(HOUR);
    project.act(d.id, { action: 'snooze', until });
    board().archive([d.id]);
    board().unarchive(d.id);
    project.wakeDue(Date.parse(until) + 1);
    expect(item(d.id)?.hold?.reason).not.toBe('snoozed');
    expect(item(d.id).queue).toBeUndefined();
  });
});
