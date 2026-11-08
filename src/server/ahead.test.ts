import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from './project';
import { Store } from './store';
import { FakeRuntime, gitRepo, noForge, until } from './testing';

let dir: string;
let main: string;
let store: Store;
let runtime: FakeRuntime;
let project: ProjectRuntime;

const open = () => new ProjectRuntime({ repos: [{ path: main, clones: 1 }] }, { store, home: dir, runtime, forge: noForge, commandDelayMs: 10, permissionMode: 'acceptEdits', limitMargin: 10 });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-ahead-'));
  main = join(dir, 'main');
  gitRepo(main);
  store = new Store(':memory:');
  runtime = new FakeRuntime();
  project = open();
});
afterEach(() => {
  project.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const board = () => project.board;
const asker = () => runtime.sessions.filter((s) => s.spec.tools.some((t) => t.name === 'answer_owner')).at(-1)!;
const talk = (id: string) => board().events(id).filter((e) => e.kind === 'talk').map((e) => [e.author, e.text]);
const planned = () => board().create({ title: 'Export invoices', body: 'Add a PDF export.', x: 0, y: 0 });

/** The agent answers what it was asked. */
async function answers(text: string) {
  const s = asker();
  s.call('answer_owner', { text });
  s.emit({ type: 'idle' });
  await until(() => s.closed);
}

describe('asking on a card before its start', () => {
  test('words on a planned card are answered by an agent while the card stays planned', async () => {
    const card = planned();
    project.tell(card.id, 'Is there a PDF library already?', [], false);
    await until(() => asker());
    expect(asker().inbox[0]).toContain('Is there a PDF library already?');
    expect(asker().inbox[0]).toContain('Add a PDF export.');
    // at work on the card, which the owner can pause
    expect(board().item(card.id)?.inTurn).toBe(true);
    await answers('No, none yet.');
    expect(talk(card.id)).toEqual([
      ['owner', 'Is there a PDF library already?'],
      ['koordinator', 'No, none yet.'],
    ]);
    const after = board().item(card.id)!;
    expect(after.state).toBe('planned');
    expect(after.inTurn).toBeUndefined();
    expect(runtime.sessions.some((s) => s.spec.role === 'worker')).toBe(false);
  });

  test('the next message resumes the session and what comes during a turn waits for the next one, unread', async () => {
    const card = planned();
    project.tell(card.id, 'First?', [], false);
    await until(() => asker());
    const first = asker();
    first.emit({ type: 'session', id: 's-1' });
    project.tell(card.id, 'And second?', [], false);
    const waiting = board().events(card.id).find((e) => e.text === 'And second?')!;
    expect(waiting.unread).toBe(true);
    await answers('One.');
    await until(() => asker() !== first);
    expect(asker().spec.resume).toBe('s-1');
    expect(asker().inbox[0]).toContain('And second?');
    expect(board().events(card.id).find((e) => e.text === 'And second?')?.unread).toBeUndefined();
    await answers('Two.');
    // in the log in the order they came; the conversation shows the second words where the agent read them, after its first answer
    const events = board().events(card.id);
    const one = events.find((e) => e.text === 'One.')!;
    expect(events.find((e) => e.text === 'And second?')?.readAfter).toBeGreaterThanOrEqual(one.id);
    expect(events.find((e) => e.text === 'Two.')).toBeDefined();
  });

  test('a session that cannot be resumed is replaced by one that gets the conversation so far', async () => {
    const card = planned();
    project.tell(card.id, 'First?', [], false);
    await until(() => asker());
    asker().emit({ type: 'session', id: 's-1' });
    await answers('One.');
    project.tell(card.id, 'Second?', [], false);
    await until(() => asker().spec.resume === 's-1');
    asker().emit({ type: 'error', message: 'no conversation found' });
    await until(() => !asker().spec.resume && asker().inbox[0]?.includes('First?'));
    expect(asker().inbox[0]).toContain('The owner: First?');
    expect(asker().inbox[0]).toContain('Seismic: One.');
    expect(asker().inbox[0]).toContain('Second?');
  });

  test('the worker that starts the card gets the conversation with its task', async () => {
    const card = planned();
    project.tell(card.id, 'Should it use jsPDF?', [], false);
    await until(() => asker());
    await answers('Yes, it is small.');
    project.act(card.id, { action: 'start' });
    await until(() => runtime.sessions.some((s) => s.spec.role === 'worker'));
    const worker = runtime.sessions.find((s) => s.spec.role === 'worker')!;
    expect(worker.inbox[0]).toContain('Add a PDF export.');
    expect(worker.inbox[0]).toContain('The owner: Should it use jsPDF?');
    expect(worker.inbox[0]).toContain('Seismic: Yes, it is small.');
  });

  test('pausing ends the turn and keeps the question; resuming answers it', async () => {
    const card = planned();
    project.tell(card.id, 'Question?', [], false);
    await until(() => asker());
    const first = asker();
    project.act(card.id, { action: 'pause' });
    await until(() => first.closed);
    expect(board().item(card.id)?.paused).toBeTruthy();
    expect(board().item(card.id)?.inTurn).toBeUndefined();
    project.act(card.id, { action: 'resume' });
    await until(() => asker() !== first);
    expect(asker().inbox[0]).toContain('Question?');
    await answers('Answer.');
    expect(talk(card.id).map(([, t]) => t)).toEqual(['Question?', 'Answer.']);
  });

  test('words not read yet can be taken back', async () => {
    const card = planned();
    project.tell(card.id, 'First?', [], false);
    await until(() => asker());
    project.tell(card.id, 'Never mind this.', [], false);
    const id = board().events(card.id).find((e) => e.text === 'Never mind this.')!.id;
    project.act(card.id, { action: 'unsay', id });
    await answers('One.');
    expect(talk(card.id).map(([, t]) => t)).toEqual(['First?', 'One.']);
    expect(runtime.sessions.filter((s) => s.spec.tools.some((t) => t.name === 'answer_owner'))).toHaveLength(1);
  });

  test('a stopped card keeps the notes for its worker: nothing answers them', () => {
    const card = planned();
    board().work(card.id, { branch: 'obeya/export', session_id: 'earlier' });
    project.tell(card.id, 'Remember the logo.', [], false);
    expect(runtime.sessions.some((s) => s.spec.tools.some((t) => t.name === 'answer_owner'))).toBe(false);
    expect(board().events(card.id).some((e) => e.kind === 'hint' && e.unread)).toBe(true);
  });

  test('a question left unanswered by a restart is answered after it', async () => {
    const card = planned();
    project.tell(card.id, 'Before the restart?', [], false);
    await until(() => asker());
    project.shutdown();
    runtime = new FakeRuntime();
    project = open();
    await until(() => runtime.sessions.some((s) => s.spec.tools.some((t) => t.name === 'answer_owner')));
    expect(asker().inbox[0]).toContain('Before the restart?');
  });
});
