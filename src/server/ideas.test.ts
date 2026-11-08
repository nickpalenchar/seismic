import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from './project';
import { Store } from './db';
import { Explorers } from './explorers';
import { FakeRuntime, noForge, type FakeSession, gitRepo, heard, identify, until } from './testing';
import { git } from './workstations';

let dir: string;
let main: string;
let store: Store;
let runtime: FakeRuntime;
let project: ProjectRuntime;

const open = (clones = 1) =>
  new ProjectRuntime({ repos: [{ path: main, clones, settings: { land: 'pr' } }] }, { store, home: dir, runtime, forge: noForge, commandDelayMs: 10, permissionMode: 'acceptEdits', limitMargin: 10 });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-ideas-'));
  main = join(dir, 'main');
  gitRepo(main);
  mkdirSync(join(main, 'docs/plan'), { recursive: true });
  store = new Store(':memory:');
  runtime = new FakeRuntime();
  project = open();
});
afterEach(async () => {
  // git freeing a workstation in the background is done before its repository goes
  await Promise.all(project.repos.map((r) => r.workers.freed()));
  project.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

// the timers' work done, and the workers it started at work in their workstations
const settle = async (ms = 5) => {
  await new Promise((r) => setTimeout(r, ms));
  await Promise.all(project.repos.map((r) => r.workers.prepared()));
  await Promise.all(project.repos.map((r) => r.workers.freed()));
};
/** A plan doc lands on main, and Seismic reads it from there. */
const landDoc = async (file: string, text: string) => {
  writeFileSync(join(main, file), text);
  identify(main);
  git(main, 'add', '.');
  git(main, 'commit', '--quiet', '-m', `Plan ${file}`);
  await project.repos[0]!.read.refresh();
};
const board = () => project.board;
const item = (id: string) => board().item(id)!;
const idea = (title = 'Export für Vermieter', body = 'Vermieter wollen ihre Zählerstände.') => board().create({ idea: true, title, body, x: 0, y: 0 });
const explorer = () => runtime.sessions.filter((s) => s.spec.tools.some((t) => t.name === 'update_brief')).at(-1)!;
const talk = (id: string) => board().events(id).filter((e) => e.kind === 'talk').map((e) => [e.author, e.text]);
const turn = (s: FakeSession, reply: string, extra?: () => void) => {
  s.emit({ type: 'session', id: 'sess-1' });
  extra?.();
  s.call('reply', { text: reply });
  s.emit({ type: 'idle' });
};

describe('an idea', () => {
  test('starts as an idea: no worker, no workstation, nothing with the Koordinator', () => {
    const i = idea();
    expect(item(i.id)).toMatchObject({ state: 'idea', idea: { status: 'open', brief: '', thinking: false, yourTurn: false, questions: [] } });
    expect(runtime.sessions).toHaveLength(0);
    expect(() => project.act(i.id, { action: 'start' })).toThrow('only a planned card can be started');
  });

  test('is discussed with an agent that has a worker’s tools, keeps the brief and records decisions', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Lass uns das durchdenken.' });
    const s = explorer();
    // it checks what the text does not say (git, gh, the web) in the workers' permission mode
    expect(s.spec).toMatchObject({ permissionMode: 'acceptEdits', cwd: project.repos[0]!.read.path });
    expect(s.spec.readOnly).toBeUndefined();
    expect(s.spec.system).toContain('You have the tools a worker has');
    expect(s.spec.system).toContain('Nothing you do yourself starts work.');
    expect(project.repos[0]!.read.path).not.toBe(main);
    expect(s.spec.resume).toBeUndefined();
    expect(s.inbox[0]).toContain('The idea: “Export für Vermieter”.');
    expect(s.inbox[0]).toContain('Vermieter wollen ihre Zählerstände.');
    expect(s.inbox[0]).toContain('Lass uns das durchdenken.');
    expect(item(i.id).idea!.thinking).toBe(true);
    turn(s, 'CSV oder PDF?', () => {
      s.call('update_brief', { brief: '**Ziel:** Vermieter exportieren Zählerstände.' });
      s.call('record_decision', { question: 'Format?', answer: 'CSV' });
    });
    expect(s.closed).toBe(true);
    expect(item(i.id).idea).toEqual({ status: 'open', brief: '**Ziel:** Vermieter exportieren Zählerstände.', thinking: false, yourTurn: true, questions: [], variants: [], mocks: [] });
    expect(talk(i.id)).toEqual([
      ['owner', 'Lass uns das durchdenken.'],
      ['explorer', 'CSV oder PDF?'],
    ]);
    expect(board().decisions(null)).toMatchObject([{ card_id: i.id, question: 'Format?', answer: 'CSV', by: 'owner' }]);
  });

  test('keeps what its agent read and thought on the way to a reply, but not its words after it', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Was meinst du?' });
    const s = explorer();
    s.emit({ type: 'tool', name: 'Read', input: { file_path: '/repo/src/server/board.ts' } });
    s.emit({ type: 'text', text: 'Das Archiv nimmt keine Projekte auf.' });
    s.call('update_brief', { brief: '**Ziel:** Archiv für Projekte.' });
    s.emit({ type: 'tool', name: 'mcp__seismic__update_brief', input: {} });
    s.call('reply', { text: 'Ziel und Ist-Stand stehen im Stand. Eine offene Frage.' });
    s.emit({ type: 'text', text: 'Fertig.' });
    s.emit({ type: 'idle' });
    expect(board().events(i.id).filter((e) => e.author === 'explorer').map((e) => [e.kind, e.text])).toEqual([
      ['activity', 'Reads server/board.ts'],
      ['say', 'Das Archiv nimmt keine Projekte auf.'],
      ['activity', 'Updates where the idea stands'],
      ['talk', 'Ziel und Ist-Stand stehen im Stand. Eine offene Frage.'],
    ]);
  });

  test('its conversation goes on in the same session, and what the owner says during a turn waits for it', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Erstens.' });
    const first = explorer();
    first.emit({ type: 'session', id: 'sess-1' });
    project.act(i.id, { action: 'discuss', text: 'Zweitens.' });
    project.act(i.id, { action: 'discuss', text: 'Ach, vergiss das.' });
    expect(first.inbox).toHaveLength(1);
    // unread until its next turn, and until then the owner can take it back
    const [second, forget] = board().events(i.id).slice(-2);
    expect([second!.unread, forget!.unread]).toEqual([true, true]);
    project.act(i.id, { action: 'unsay', id: forget!.id });
    first.call('reply', { text: 'Zu erstens.' });
    first.emit({ type: 'idle' });
    // the queued message is the next turn of the same session
    expect(first.closed).toBe(false);
    expect(first.inbox[1]).toContain('Zweitens.');
    expect(first.inbox[1]).not.toContain('vergiss');
    const reply = board().events(i.id).find((e) => e.text === 'Zu erstens.')!;
    expect(board().events(i.id).find((e) => e.id === second!.id)).toMatchObject({ readAfter: reply.id });
    expect(() => project.act(i.id, { action: 'unsay', id: second!.id })).toThrow();
    first.call('reply', { text: 'Zu zweitens.' });
    first.emit({ type: 'idle' });
    expect(first.closed).toBe(true);
    // days later
    project.act(i.id, { action: 'discuss', text: 'Drittens.' });
    const later = explorer();
    expect(later).not.toBe(first);
    expect(later.spec.resume).toBe('sess-1');
    expect(later.inbox).toEqual(['The owner says:\n\nDrittens.']);
  });

  test('a session from scratch of an idea discussed before hears where it stands: the brief, its mocks, its prototypes and the conversation so far', async () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Lass uns das durchdenken.' });
    // a new idea has nothing to go on from
    expect(explorer().inbox[0]).not.toContain('discussed before');
    turn(explorer(), 'CSV oder PDF?', () => {
      explorer().call('update_brief', { brief: '**Varianten:** A CSV, B PDF.', mocks: [{ title: 'A CSV', html: '<pre>a;b</pre>' }] });
      explorer().call('plan_prototypes', { prototypes: [{ approach: 'B PDF', show: 'Ein PDF mit Zählerständen.' }] });
      // said during the turn, it is read after the reply
      project.act(i.id, { action: 'discuss', text: 'Und für Mieter?' });
    });
    turn(explorer(), 'Mieter später.');
    // however much the agents did since
    for (let n = 0; n < 600; n++) board().log(i.id, 'activity', 'explorer', `Liest Datei ${n}`);
    project.act(i.id, { action: 'prototype', text: 'Den Export-Knopf.' });
    await settle();
    const [prototype] = board()
      .snapshot()
      .items.filter((x) => x.prototypeOf === i.id);
    // the session is gone (Claude pruned it after weeks, say)
    board().work(i.id, { session_id: null });
    project.act(i.id, { action: 'discuss', text: 'Eher CSV.' });
    const s = explorer();
    expect(s.spec.resume).toBeUndefined();
    const first = s.inbox[0]!;
    expect(first).toContain('The idea: “Export für Vermieter”.');
    expect(first).toContain('The brief as you left it:\n\n**Varianten:** A CSV, B PDF.');
    expect(first).toContain('“A CSV”');
    expect(first).toContain('- B PDF: Ein PDF mit Zählerständen.');
    expect(first).toContain(`- “${prototype!.title}”, being built`);
    expect(first).toContain('Owner: Lass uns das durchdenken.\n\nYou: CSV oder PDF?\n\nOwner: Und für Mieter?\n\nYou: Mieter später.');
    // what the owner says now comes once, after where the idea stands
    expect(first.endsWith('The owner says:\n\nEher CSV.')).toBe(true);
    expect(first).not.toContain('Owner: Eher CSV.');
  });

  test('what the owner says in reply to a message of the discussion points the agent at it', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Erstens.' });
    const first = explorer();
    first.call('reply', { text: 'Zu erstens: zwei Wege, A und B.' });
    first.emit({ type: 'idle' });
    const said = board().events(i.id).findLast((e) => e.kind === 'talk' && e.author === 'explorer')!;
    project.act(i.id, { action: 'discuss', text: 'Nimm A.', replyTo: said.id });
    expect(explorer().inbox.at(-1)).toEndWith('The owner says:\n\n[In reply to your message: “Zu erstens: zwei Wege, A und B.”]\n\nNimm A.');
    expect(board().events(i.id).findLast((e) => e.author === 'owner')).toMatchObject({ kind: 'talk', text: 'Nimm A.', replyTo: said.id });
  });

  test('screenshots the owner adds reach the agent and stay in the conversation', () => {
    const i = idea();
    const id = project.images.save(new Uint8Array([1, 2, 3]), 'image/png');
    project.act(i.id, { action: 'discuss', text: 'So sieht die Seite heute aus', images: [id] });
    const s = explorer();
    expect(s.images[0]).toEqual([project.images.path(id)!]);
    expect(board().events(i.id).at(-1)).toMatchObject({ kind: 'talk', author: 'owner', images: [id] });
    // a second one during the turn waits, with its screenshot, for the turn to end
    const id2 = project.images.save(new Uint8Array([4]), 'image/png');
    project.act(i.id, { action: 'discuss', text: '', images: [id2] });
    turn(s, 'Verstehe.');
    expect(s.images[1]).toEqual([project.images.path(id2)!]);
  });

  test("a planned card's screenshots reach its exploration agent; built, the discussion's go to the task", () => {
    const task = project.images.save(new Uint8Array([1]), 'image/png');
    const c = board().create({ title: 'Seite bricht um', x: 0, y: 0, images: [task] });
    board().patch(c.id, { state: 'idea' });
    project.act(c.id, { action: 'discuss', text: 'Wie gehen wir das an?' });
    const s = explorer();
    expect(s.images[0]).toEqual([project.images.path(task)!]);
    expect(s.inbox[0]).toContain('The owner attached a screenshot to the card');
    const shown = project.images.save(new Uint8Array([2]), 'image/png');
    turn(s, 'Zwei Wege.');
    project.act(c.id, { action: 'discuss', text: 'Und hier auf dem Handy', images: [shown] });
    turn(explorer(), 'Verstehe.');
    project.act(c.id, { action: 'build' });
    expect(item(c.id).images).toEqual([task, shown]);
  });

  test('building with a chosen agent starts the worker with the chosen agent', () => {
    const chosen = { model: 'sonnet', effort: 'low' } as const;
    const c = board().create({ title: 'Seite bricht um', x: 0, y: 0 });
    board().patch(c.id, { state: 'idea' });
    project.act(c.id, { action: 'build', agent: chosen });
    expect(JSON.parse(board().row(c.id).agent_setting!)).toMatchObject(chosen);
  });

  test('a spoken message says so to the agent; a turn without reply still answers with its words', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Was kostet das?', spoken: true });
    expect(explorer().inbox[0]).toContain('speech recognition may have misheard');
    turn(explorer(), 'Etwa zwei Tage.');
    project.act(i.id, { action: 'discuss', text: 'Und dann?' });
    const s = explorer();
    s.emit({ type: 'text', text: 'Dann ein Plan-Doc.' });
    s.emit({ type: 'idle' });
    expect(talk(i.id).at(-1)).toEqual(['explorer', 'Dann ein Plan-Doc.']);
  });

  test('once its agent has replied the owner is next, until they answer', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Erstens.' });
    const s = explorer();
    s.emit({ type: 'session', id: 'sess-1' });
    expect(item(i.id).idea).toMatchObject({ thinking: true, yourTurn: false });
    project.act(i.id, { action: 'discuss', text: 'Zweitens.' });
    s.call('reply', { text: 'Zu erstens.' });
    s.emit({ type: 'idle' });
    // the owner's second message is still to be answered
    expect(item(i.id).idea).toMatchObject({ thinking: true });
    s.call('reply', { text: 'Zu zweitens.' });
    s.emit({ type: 'idle' });
    expect(item(i.id).idea).toMatchObject({ thinking: false, yourTurn: true, questions: [], variants: [] });
    project.act(i.id, { action: 'discuss', text: 'Drittens.' });
    expect(item(i.id).idea).toMatchObject({ thinking: true, yourTurn: false });
    // a turn that ends without words leaves nothing to answer
    explorer().emit({ type: 'idle' });
    expect(item(i.id).idea).toMatchObject({ thinking: false, yourTurn: false, questions: [] });
  });

  test('a turn that ends while its agent’s background work runs is no reply: the agent works on once that work wakes it', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Rechne das nach.' });
    const s = explorer();
    s.emit({ type: 'session', id: 'sess-1' });
    s.emit({ type: 'background', tasks: [{ id: 'b1', description: 'Download market data' }] });
    s.emit({ type: 'text', text: 'Still downloading the market data.' });
    s.emit({ type: 'idle', background: 1 });
    // its words show as it works on, and the owner is not next
    expect(s.closed).toBe(false);
    expect(item(i.id).idea).toMatchObject({ thinking: true, yourTurn: false });
    expect(talk(i.id)).toEqual([['owner', 'Rechne das nach.']]);
    expect(board().events(i.id).at(-1)).toMatchObject({ kind: 'say', text: 'Still downloading the market data.' });
    // what the owner says meanwhile goes in at once, and the turn answers it too
    project.act(i.id, { action: 'discuss', text: 'Nimm auch 2023.' });
    expect(s.inbox.at(-1)).toContain('Nimm auch 2023.');
    expect(board().events(i.id).at(-1)!.unread).toBeFalsy();
    s.emit({ type: 'idle', background: 1 });
    expect(s.closed).toBe(false);
    // the download ends and wakes the agent for a turn of its own
    s.emit({ type: 'background', tasks: [] });
    s.emit({ type: 'tool', name: 'Bash', input: { command: 'python3 sim.py' } });
    s.call('reply', { text: 'Mit 2023: 12 % weniger Ausgleichsenergie.' });
    s.emit({ type: 'idle', background: 0 });
    expect(s.closed).toBe(true);
    expect(item(i.id).idea).toMatchObject({ thinking: false, yourTurn: true });
    expect(talk(i.id)).toEqual([
      ['owner', 'Rechne das nach.'],
      ['owner', 'Nimm auch 2023.'],
      ['explorer', 'Mit 2023: 12 % weniger Ausgleichsenergie.'],
    ]);
  });

  test('a reply that it waits for its background work leaves the agent at work, and it replies again once that work wakes it', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Hol die Preise.' });
    const s = explorer();
    s.emit({ type: 'session', id: 'sess-1' });
    s.call('reply', { text: 'Der Download läuft im Hintergrund; ich melde mich, sobald er fertig ist.' });
    s.emit({ type: 'idle', background: 1 });
    expect(s.closed).toBe(false);
    expect(item(i.id).idea).toMatchObject({ thinking: true });
    s.emit({ type: 'background', tasks: [] });
    s.emit({ type: 'text', text: 'Die Preise sind da.' });
    s.call('reply', { text: '1284 Preise, im Schnitt 4,37 €.' });
    s.emit({ type: 'idle', background: 0 });
    expect(s.closed).toBe(true);
    expect(item(i.id).idea).toMatchObject({ thinking: false, yourTurn: true });
    expect(talk(i.id).slice(1)).toEqual([
      ['explorer', 'Der Download läuft im Hintergrund; ich melde mich, sobald er fertig ist.'],
      ['explorer', '1284 Preise, im Schnitt 4,37 €.'],
    ]);
    expect(board().idea(i.id).unread).toBeUndefined();
  });

  test('paused while it waits for its background work, the agent keeps what it has not answered', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Rechne das nach.' });
    const s = explorer();
    s.emit({ type: 'session', id: 'sess-1' });
    s.emit({ type: 'idle', background: 1 });
    project.act(i.id, { action: 'pause' });
    expect(s.closed).toBe(true);
    expect(board().idea(i.id).unread).toMatchObject({ why: 'paused', messages: [{ text: expect.stringContaining('Rechne das nach.') }] });
  });

  test('its agent waits for its background work no longer than its limit, nor long after that work ended without waking it', async () => {
    const explorers = new Explorers({ board: board(), runtime, pathFor: () => main, backgroundGrace: 5, backgroundLimit: 30 });
    const one = idea();
    explorers.discuss(one.id, 'Rechne das nach.');
    const s = runtime.last;
    s.emit({ type: 'text', text: 'Still downloading.' });
    s.emit({ type: 'idle', background: 1 });
    s.emit({ type: 'background', tasks: [] });
    await settle(20);
    // its last words are the reply after all
    expect(s.closed).toBe(true);
    expect(item(one.id).idea).toMatchObject({ thinking: false, yourTurn: true });
    expect(talk(one.id).at(-1)).toEqual(['explorer', 'Still downloading.']);
    const two = idea();
    explorers.discuss(two.id, 'Und das?');
    const t = runtime.last;
    t.emit({ type: 'idle', background: 1 });
    await settle(15);
    expect(t.closed).toBe(false);
    await until(() => t.closed);
    expect(item(two.id).idea).toMatchObject({ thinking: false, yourTurn: false });
  });

  test('its agent asks with answer options, which stand until the owner says something, and in its conversation after', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Los.' });
    const s = explorer();
    s.call('reply', {
      text: 'Zwei Fragen.',
      questions: [
        { question: 'Welches Format?', options: ['CSV', 'PDF', 'CSV'] },
        { question: 'Für wen?', options: ['Vermieter', 'Verwalter'], multiple: true },
        { question: 'Wann?', options: [], multiple: true },
        { question: ' ', options: ['x'] },
      ],
    });
    s.emit({ type: 'idle' });
    expect(item(i.id).idea).toMatchObject({
      yourTurn: true,
      questions: [
        { text: 'Welches Format?', options: ['CSV', 'PDF'] },
        { text: 'Für wen?', options: ['Vermieter', 'Verwalter'], multiple: true },
        { text: 'Wann?', options: [] },
      ],
    });
    expect(item(i.id).idea!.questions[0]!.multiple).toBeUndefined();
    expect(item(i.id).idea!.questions[2]!.multiple).toBeUndefined();
    expect(board().events(i.id).filter((e) => e.kind === 'question').map((e) => [e.author, e.text])).toEqual([
      ['explorer', 'Welches Format?\n– CSV\n– PDF'],
      ['explorer', 'Für wen? (multiple choice)\n– Vermieter\n– Verwalter'],
      ['explorer', 'Wann?'],
    ]);
    project.act(i.id, { action: 'discuss', text: '- **Welches Format?** CSV' });
    expect(item(i.id).idea).toMatchObject({ yourTurn: false, questions: [] });
    expect(explorer().inbox.at(-1)).toContain('- **Welches Format?** CSV');
  });

  test('its agent says what it would do in the owner’s place, which stands until the owner says something', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Los.' });
    let s = explorer();
    s.call('reply', {
      text: 'Eine Frage noch.',
      questions: [
        { question: 'Welches Format?', options: ['CSV', 'PDF'], pick: ['CSV '], pick_why: 'Vermieter rechnen in Excel weiter.' },
        { question: 'Für wen?', options: ['Vermieter', 'Verwalter'], multiple: true, pick: ['Vermieter', 'Mieter', 'Verwalter'], pick_why: 'Beide.' },
        { question: 'Wann?', options: ['Sofort', 'Später'], pick: ['Sofort', 'Später'], pick_why: 'Zwei sind eins zu viel.' },
        { question: 'Wie heißt es?', options: ['Export'], pick: ['Ausfuhr'], pick_why: 'Nicht unter den Optionen.' },
      ],
      next: { step: 'answer', why: 'Das Format entscheidet den Rest.' },
    });
    s.emit({ type: 'idle' });
    expect(item(i.id).idea).toMatchObject({
      questions: [
        { text: 'Welches Format?', pick: { options: ['CSV'], why: 'Vermieter rechnen in Excel weiter.' } },
        { text: 'Für wen?', pick: { options: ['Vermieter', 'Verwalter'], why: 'Beide.' } },
        // one option only where only one may be chosen
        { text: 'Wann?', pick: { options: ['Sofort'] } },
        { text: 'Wie heißt es?' },
      ],
      next: { step: 'answer', why: 'Das Format entscheidet den Rest.' },
    });
    expect(item(i.id).idea!.questions[3]!.pick).toBeUndefined();
    project.act(i.id, { action: 'discuss', text: '- **Welches Format?** CSV' });
    expect(item(i.id).idea!.next).toBeUndefined();
    s = explorer();
    // answering without questions, or a step there is no button for, is no suggestion
    s.call('reply', { text: 'Danke.', next: { step: 'answer', why: '?' } });
    s.emit({ type: 'idle' });
    expect(item(i.id).idea!.next).toBeUndefined();
    project.act(i.id, { action: 'discuss', text: 'Und jetzt?' });
    s = explorer();
    s.call('reply', { text: 'Bauen.', next: { step: 'deploy', why: '?' } });
    s.emit({ type: 'idle' });
    expect(item(i.id).idea!.next).toBeUndefined();
    project.act(i.id, { action: 'discuss', text: 'Und jetzt?' });
    s = explorer();
    s.call('reply', { text: 'Bauen.', next: { step: 'build', why: 'Der Stand reicht als Auftrag.' } });
    s.emit({ type: 'idle' });
    expect(item(i.id).idea!.next).toEqual({ step: 'build', why: 'Der Stand reicht als Auftrag.' });
  });

  test('what the owner says is offered for learning preferences', async () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Exporte immer als CSV.' });
    await settle();
    const learn = runtime.sessions.find((s) => s.spec.tools.some((t) => t.name === 'propose'))!;
    expect(learn.inbox[0]).toContain('words in the discussion of an idea: Exporte immer als CSV.');
  });

  test('a preference learned while its agent works reaches it once, with its next tool step', () => {
    board().addPreference('Antworten auf Deutsch.');
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Lass uns das durchdenken.' });
    const s = explorer();
    expect(s.spec.system).toContain('- Antworten auf Deutsch.');
    // what its instructions hold is nothing new
    expect(s.toolStep()).toBeUndefined();
    const id = board().addPreference('Varianten immer mit Aufwand.');
    expect(s.toolStep()).toContain('- Varianten immer mit Aufwand.');
    expect(s.toolStep()).toBeUndefined();
    board().setPreference(id, null);
    expect(s.toolStep()).not.toContain('Varianten immer mit Aufwand.');
    // silently: no message, no new turn
    expect(s.inbox).toHaveLength(1);
  });

  test('"Build it like this" starts it with the brief as its task', async () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Los.' });
    turn(explorer(), 'Gut.', () => explorer().call('update_brief', { brief: '**Ziel:** CSV-Export.' }));
    project.act(i.id, { action: 'build' });
    expect(item(i.id)).toMatchObject({ state: 'planned', body: '**Ziel:** CSV-Export.', title: 'Export für Vermieter', queue: { checking: true } });
    expect(item(i.id).idea).toBeUndefined();
    await settle();
    expect(item(i.id).state).toBe('working');
    const worker = runtime.sessions.find((s) => s.spec.tools.some((t) => t.name === 'ready_for_review'))!;
    expect(worker.inbox[0]).toContain('**Ziel:** CSV-Export.');
    expect(board().decisions(null).at(-1)).toMatchObject({ answer: 'Build it as the idea stands.' });
    expect(() => project.act(i.id, { action: 'discuss', text: 'Noch was.' })).toThrow('not an idea');
  });

  test('its agent shows variants as mocks, in its reply and under the brief, and the worker who builds it gets them', async () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Wie sähe der Knopf aus?' });
    const s = explorer();
    const a = { title: 'A Knopf oben', html: '<button style="float:right">Export</button>' };
    const b = { title: 'B Menü', html: '<select><option>Export</option></select>' };
    s.emit({ type: 'session', id: 'sess-1' });
    s.call('update_brief', { brief: '**Varianten:** A oder B.', mocks: [a, b, { title: 'C zu lang', html: 'x'.repeat(20001) }] });
    s.call('reply', { text: 'Zwei Varianten, siehe Stand. Und so sähe es im Dialog aus:', mocks: [{ title: '  Im   Dialog ', html: ' <dialog open>Export</dialog> ' }] });
    s.emit({ type: 'idle' });
    // a mock too long for a sketch is left out
    expect(item(i.id).idea!.mocks).toEqual([a, b]);
    expect(board().events(i.id).filter((e) => e.kind === 'talk').at(-1)!.mocks).toEqual([{ title: 'Im Dialog', html: '<dialog open>Export</dialog>' }]);
    expect(board().events(i.id).filter((e) => e.kind === 'talk' && e.author === 'owner')[0]!.mocks).toBeUndefined();

    // a brief without mocks keeps them; an empty list removes them
    project.act(i.id, { action: 'discuss', text: 'Nimm A.' });
    turn(explorer(), 'A steht.', () => explorer().call('update_brief', { brief: '**Entscheidungen:** A.' }));
    expect(item(i.id).idea).toMatchObject({ brief: '**Entscheidungen:** A.', mocks: [a, b] });
    project.act(i.id, { action: 'discuss', text: 'B weg.' });
    turn(explorer(), 'B ist raus.', () => explorer().call('update_brief', { brief: '**Entscheidungen:** A.', mocks: [a] }));
    expect(item(i.id).idea!.mocks).toEqual([a]);

    project.act(i.id, { action: 'build' });
    expect(item(i.id)).toMatchObject({ state: 'planned', brief: '**Entscheidungen:** A.', mocks: [a] });
    await settle();
    const worker = runtime.sessions.find((x) => x.spec.tools.some((t) => t.name === 'ready_for_review'))!;
    expect(worker.inbox[0]).toContain('A Knopf oben:\n\n```html\n<button style="float:right">Export</button>\n```');
  });

  test('a mock list can be emptied', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Los.' });
    turn(explorer(), 'Gut.', () => explorer().call('update_brief', { brief: 'x', mocks: [{ title: 'A', html: '<b>A</b>' }] }));
    project.act(i.id, { action: 'discuss', text: 'Ohne Mock.' });
    turn(explorer(), 'Gut.', () => explorer().call('update_brief', { brief: 'x', mocks: [] }));
    expect(item(i.id).idea!.mocks).toEqual([]);
  });

  test('a big idea becomes a plan: a worker starts on its plan doc at once, on the idea’s card', async () => {
    const i = idea();
    board().setIdea(i.id, { brief: '**Ziel:** Vermieterportal.' });
    project.act(i.id, { action: 'planDoc' });
    const c = item(i.id);
    expect(c).toMatchObject({ state: 'planned', title: 'Export für Vermieter', becomesPlan: true, brief: '**Ziel:** Vermieterportal.', queue: { checking: true } });
    expect(c.body).toContain('`docs/plan/`');
    expect(c.body).toContain('## Workstreams');
    expect(c.body).toContain('**Ziel:** Vermieterportal.');
    await settle();
    expect(item(i.id).state).toBe('working');
    const worker = runtime.sessions.find((s) => s.spec.tools.some((t) => t.name === 'ready_for_review'))!;
    expect(worker.inbox[0]).toContain('**Ziel:** Vermieterportal.');
  });

  test('a planned task of the owner’s becomes a plan the same way, on its own card', async () => {
    const c = board().create({ title: 'Mandanten', body: 'Jeder Kunde bekommt eigene Daten.', x: 0, y: 0 });
    board().work(c.id, { images: JSON.stringify(['shot.png']) });
    project.act(c.id, { action: 'planDoc' });
    const t = item(c.id);
    expect(t).toMatchObject({ state: 'planned', title: 'Mandanten', becomesPlan: true, queue: { checking: true }, images: ['shot.png'] });
    expect(t.brief).toBeUndefined();
    expect(t.body).toContain('Write a plan doc in `docs/plan/` from this task');
    expect(t.body).toContain('takes the place of this task');
    expect(t.body).toContain('Task: “Mandanten”\n\nJeder Kunde bekommt eigene Daten.');
    expect(board().decisionsOn(c.id).map((d) => [d.question, d.answer])).toEqual([['Task “Mandanten”: how to go on?', 'As a plan: a plan doc with workstreams first.']]);
    expect(board().events(c.id).at(-1)!.text).toBe('As a plan: an agent writes the plan doc; once it has landed, the plan takes the task’s place.');
    await settle();
    expect(item(c.id).state).toBe('working');
    const worker = runtime.sessions.find((s) => s.spec.tools.some((t) => t.name === 'ready_for_review'))!;
    expect(worker.inbox[0]).toContain('Jeder Kunde bekommt eigene Daten.');
    expect(worker.inbox[0]).toContain('## Workstreams');
    // once decided, and on a task someone has worked on, it is refused
    expect(() => project.act(c.id, { action: 'planDoc' })).toThrow(expect.objectContaining({ code: 'notPlannable' }));
    const worked = board().create({ title: 'Schon begonnen', x: 0, y: 0 });
    board().work(worked.id, { branch: 'obeya/x' });
    expect(() => project.act(worked.id, { action: 'planDoc' })).toThrow(expect.objectContaining({ code: 'notPlannable' }));
  });

  test('with its plan folder outside the repository, the worker writes the doc there under the name Seismic gives, and the plan takes the idea’s place once approved', async () => {
    const plans = join(dir, 'private-plans');
    mkdirSync(plans);
    writeFileSync(join(plans, 'export-fur-vermieter.md'), '# Schon da\n');
    project.shutdown();
    project = new ProjectRuntime(
      { repos: [{ path: main, clones: 1, settings: { land: 'pr', planDocs: { dir: plans, exclude: [] } } }] },
      { store, home: dir, runtime, forge: noForge, commandDelayMs: 10, permissionMode: 'acceptEdits', limitMargin: 10 },
    );
    const i = idea();
    project.act(i.id, { action: 'planDoc' });
    const file = `${plans.replaceAll('\\', '/')}/export-fur-vermieter-2.md`;
    expect(item(i.id).body).toContain(`Write a plan doc as \`${file}\`, in a folder of this machine outside the repository,`);
    expect(item(i.id).body).not.toContain('Verweis darauf');
    expect(JSON.parse(board().row(i.id).plan_docs!)).toEqual([file]);
    await settle();
    // another card of the same title, planned before that doc is written, gets a name of its own
    const twin = board().create({ title: 'Export für Vermieter', x: 0, y: 400 });
    project.act(twin.id, { action: 'planDoc' });
    expect(item(twin.id).body).toContain('export-fur-vermieter-3.md');
    await settle();
    const worker = runtime.sessions.find((s) => s.spec.tools.some((t) => t.name === 'ready_for_review'))!;
    // the folder is the worker's to write in, as its workstation
    expect(worker.spec.dirs).toEqual([plans.replaceAll('\\', '/')]);
    writeFileSync(file, '# Export\n\n## Ziel\n\nExport.\n\n## Workstreams\n\n- [ ] **W1:** CSV. Zuerst.\n');
    board().docsChanged();
    // read at once, the doc is a plan, but the idea stays until the owner approves it
    const plan = board().snapshot().items.find((x) => x.kind === 'plan' && x.title === 'Export')!;
    expect(plan.plan!.file).toBe(file);
    expect(plan.origin).toBeUndefined();
    const demo = join(dir, 'demo');
    mkdirSync(demo);
    writeFileSync(join(demo, 'index.html'), '<p>Plan</p>');
    await worker.call('ready_for_review', { summary: 'Plan geschrieben.', demo: { dir: demo, kind: 'html', page: { title: 'Export', text: 'Ein Plan.' } } });
    worker.emit({ type: 'idle' });
    await project.act(i.id, { action: 'approve' });
    // nothing is in the branch: approved, the card is done without a pull request
    expect(board().row(i.id).state).toBe('done');
    worker.emit({ type: 'idle' });
    expect(board().item(plan.id)!.origin).toBe(i.id);
    expect(board().item(i.id)).toBeUndefined();
    expect(board().planOf(i.id)!.id).toBe(plan.id);
  });

  test('parked or dropped it keeps its brief; talking to it opens it again', () => {
    const i = idea();
    board().setIdea(i.id, { brief: 'Stand.' });
    project.act(i.id, { action: 'park' });
    expect(item(i.id)).toMatchObject({ state: 'idea', idea: { status: 'parked', brief: 'Stand.' } });
    project.act(i.id, { action: 'drop' });
    expect(item(i.id).idea!.status).toBe('dropped');
    project.act(i.id, { action: 'discuss', text: 'Doch nochmal.' });
    expect(item(i.id).idea!.status).toBe('open');
    expect(() => project.act(board().create({ title: 'X', x: 0, y: 0 }).id, { action: 'drop' })).toThrow('not an idea');
  });

  test('a planned card of the owner’s can become an idea first, and its agent opens the discussion with what the card says', () => {
    const c = board().create({ title: 'Klon lädt sein Modell neu', body: 'Für jeden Clip.', x: 0, y: 0 });
    project.patch(c.id, { state: 'idea' });
    expect(item(c.id).idea).toMatchObject({ status: 'open', brief: '', thinking: true, yourTurn: false, questions: [] });
    const s = explorer();
    expect(s.spec.readOnly).toBeUndefined();
    expect(s.inbox[0]).toContain('“Klon lädt sein Modell neu”');
    expect(s.inbox[0]).toContain('Für jeden Clip.');
    expect(s.inbox[0]).toContain('chose to discuss it first');
    // the card's text is the starting point, not words of the owner's
    expect(talk(c.id)).toEqual([]);
    turn(s, 'Zwei Wege, siehe Stand.');
    expect(talk(c.id)).toEqual([['explorer', 'Zwei Wege, siehe Stand.']]);
    expect(item(c.id).idea).toMatchObject({ thinking: false, yourTurn: true });
    // saving the idea again starts nothing new
    project.patch(c.id, { state: 'idea' });
    expect(runtime.sessions).toHaveLength(1);
  });

  test('after a restart an idea whose agent was answering gets its reply', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Frage.' });
    explorer().emit({ type: 'session', id: 'sess-9' });
    project.shutdown();
    project = open();
    const s = explorer();
    expect(s.spec.resume).toBe('sess-9');
    expect(s.inbox[0]).toContain('Seismic was restarted');
  });

  test('planning waits for its agent’s reply, which changes the brief it decides on', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Nimm noch den PDF-Export auf.' });
    const s = explorer();
    s.emit({ type: 'session', id: 'sess-1' });
    expect(() => project.act(i.id, { action: 'planDoc' })).toThrow('still working on its reply');
    expect(item(i.id)).toMatchObject({ state: 'idea', idea: { thinking: true } });
    turn(s, 'PDF ist im Stand.');
    project.act(i.id, { action: 'planDoc' });
    expect(item(i.id).state).toBe('planned');
  });

  test('built during its agent’s reply, it is built once the reply is there, with the brief it leaves', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Nimm noch den PDF-Export auf.' });
    const s = explorer();
    s.emit({ type: 'session', id: 'sess-1' });
    project.act(i.id, { action: 'build' });
    project.act(i.id, { action: 'build' });
    expect(item(i.id)).toMatchObject({ state: 'idea', idea: { thinking: true, buildAfterReply: true } });
    expect(board().events(i.id).filter((e) => e.text.startsWith('Build it once the reply is there'))).toHaveLength(1);
    // the agent hears it with its next step, once: the brief it leaves becomes the task
    expect(s.toolStep()).toContain('The owner clicked "Build it like this" while you worked on this reply');
    expect(s.toolStep()).toBeUndefined();
    s.call('update_brief', { brief: '**Ziel:** CSV- und PDF-Export.' });
    s.call('reply', { text: 'PDF ist im Stand.' });
    expect(item(i.id).state).toBe('idea');
    s.emit({ type: 'idle' });
    expect(item(i.id)).toMatchObject({ state: 'planned', body: '**Ziel:** CSV- und PDF-Export.' });
    expect(board().decisions(null)).toMatchObject([{ card_id: i.id, answer: 'Build it as the idea stands.' }]);
  });

  test('built during its agent’s reply, it is not built when the reply asks questions', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Nimm noch den PDF-Export auf.' });
    const s = explorer();
    s.emit({ type: 'session', id: 'sess-1' });
    project.act(i.id, { action: 'build' });
    s.call('reply', { text: 'Eine Frage noch.', questions: [{ question: 'Auch Excel?', options: ['Ja', 'Nein'] }] });
    s.emit({ type: 'idle' });
    expect(item(i.id)).toMatchObject({ state: 'idea', idea: { thinking: false, yourTurn: true } });
    expect(item(i.id).idea!.buildAfterReply).toBeUndefined();
    expect(board().events(i.id).at(-1)).toMatchObject({ kind: 'state', text: 'Not built: the agent still has a question.' });
    // answered, the owner decides again
    project.act(i.id, { action: 'discuss', text: 'Nein.' });
    turn(explorer(), 'Gut, ohne Excel.');
    expect(item(i.id).state).toBe('idea');
  });

  test('built during its agent’s reply, it waits for what the owner says after too, and can be taken back', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Erstens.' });
    const s = explorer();
    s.emit({ type: 'session', id: 'sess-1' });
    project.act(i.id, { action: 'build' });
    project.act(i.id, { action: 'discuss', text: 'Zweitens.' });
    s.call('reply', { text: 'Zu erstens.' });
    s.emit({ type: 'idle' });
    // the second message goes in with the note, as the agent has not called a tool yet
    expect(s.inbox.at(-1)).toContain('Zweitens.');
    expect(s.inbox.at(-1)).toContain('"Build it like this"');
    expect(item(i.id)).toMatchObject({ state: 'idea', idea: { thinking: true, buildAfterReply: true } });
    project.act(i.id, { action: 'unbuild' });
    expect(board().events(i.id).at(-1)).toMatchObject({ kind: 'state', text: 'Not building it after all.' });
    s.call('reply', { text: 'Zu zweitens.' });
    s.emit({ type: 'idle' });
    expect(item(i.id)).toMatchObject({ state: 'idea', idea: { thinking: false, yourTurn: true } });
  });

  test('built during its agent’s reply, it is not built when the turn ends with an error, or when it is parked', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Erstens.' });
    project.act(i.id, { action: 'build' });
    explorer().emit({ type: 'error', message: 'rate limit' });
    expect(item(i.id).state).toBe('idea');
    expect(item(i.id).idea!.buildAfterReply).toBeUndefined();
    expect(board().events(i.id).at(-1)).toMatchObject({ kind: 'state', text: 'Not built: the reply did not come.' });
    project.act(i.id, { action: 'discuss', text: 'Hallo?' });
    project.act(i.id, { action: 'build' });
    project.act(i.id, { action: 'park' });
    expect(item(i.id).idea).toMatchObject({ status: 'parked', thinking: false });
    expect(item(i.id).idea!.buildAfterReply).toBeUndefined();
  });

  test('parked or dropped during a turn, what its agent has not answered goes to it first when the conversation goes on, across a restart', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Erstens.' });
    const first = explorer();
    first.emit({ type: 'session', id: 'sess-1' });
    const shot = project.images.save(new Uint8Array([1]), 'image/png');
    project.act(i.id, { action: 'discuss', text: 'Zweitens.', images: [shot] });
    project.act(i.id, { action: 'park' });
    expect(first.closed).toBe(true);
    expect(item(i.id).idea).toMatchObject({ status: 'parked', thinking: false });
    project.shutdown();
    project = open();
    expect(runtime.sessions.filter((x) => x.spec.tools.some((t) => t.name === 'update_brief'))).toHaveLength(1);
    project.act(i.id, { action: 'discuss', text: 'Drittens.' });
    const later = explorer();
    expect(later).not.toBe(first);
    expect(later.spec.resume).toBe('sess-1');
    expect(later.inbox[0]).toContain('The owner parked the idea while you were working on a reply');
    expect(later.inbox[0]!.indexOf('Erstens.')).toBeLessThan(later.inbox[0]!.indexOf('Zweitens.'));
    expect(later.inbox[0]!.indexOf('Zweitens.')).toBeLessThan(later.inbox[0]!.indexOf('Drittens.'));
    expect(later.images[0]).toEqual([project.images.path(shot)!]);
    // dropped in the middle of this turn, the three wait again, now as dropped
    project.act(i.id, { action: 'drop' });
    project.act(i.id, { action: 'discuss', text: 'Viertens.' });
    const again = explorer();
    expect(again.inbox[0]).toContain('The owner dropped the idea');
    expect(again.inbox[0]).toContain('Drittens.');
    turn(again, 'Zu allen vier.');
    // answered, nothing waits any more
    project.act(i.id, { action: 'discuss', text: 'Fünftens.' });
    expect(explorer().inbox).toEqual(['The owner says:\n\nFünftens.']);
  });

  test('its agent paused during a reply keeps what it has not answered, stays paused across a restart, and answers it once resumed', () => {
    const i = idea();
    expect(() => project.act(i.id, { action: 'pause' })).toThrow('not working on anything');
    project.act(i.id, { action: 'discuss', text: 'Erstens.' });
    const first = explorer();
    first.emit({ type: 'session', id: 'sess-1' });
    project.act(i.id, { action: 'pause' });
    expect(first.closed).toBe(true);
    expect(item(i.id)).toMatchObject({ paused: true, idea: { status: 'open', thinking: false } });
    expect(() => project.act(i.id, { action: 'pause' })).toThrow('paused already');
    project.shutdown();
    project = open();
    const explorers = () => runtime.sessions.filter((x) => x.spec.tools.some((t) => t.name === 'update_brief')).length;
    expect(explorers()).toBe(1);
    expect(item(i.id).paused).toBe(true);
    project.act(i.id, { action: 'resume' });
    const later = explorer();
    expect(later.spec.resume).toBe('sess-1');
    expect(later.inbox[0]).toContain('The owner paused you while you worked on a reply and has now let you go on');
    expect(later.inbox[0]).toContain('exit code 137');
    expect(later.inbox[0]).toContain('Erstens.');
    expect(item(i.id)).toMatchObject({ idea: { thinking: true } });
    expect(item(i.id).paused).toBeUndefined();
    expect(() => project.act(i.id, { action: 'resume' })).toThrow('not paused');
    turn(later, 'Zu Erstens.');
    expect(talk(i.id).at(-1)).toEqual(['explorer', 'Zu Erstens.']);
  });

  test('its agent paused at a safe point finishes its reply first, and is paused then', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Erstens.' });
    const first = explorer();
    first.emit({ type: 'session', id: 'sess-1' });
    project.act(i.id, { action: 'pause', safePoint: true });
    expect(first.closed).toBe(false);
    expect(item(i.id)).toMatchObject({ pausing: true, idea: { thinking: true } });
    turn(first, 'Zu Erstens.');
    expect(talk(i.id).at(-1)).toEqual(['explorer', 'Zu Erstens.']);
    expect(first.closed).toBe(true);
    expect(item(i.id)).toMatchObject({ paused: true, idea: { thinking: false } });
    expect(item(i.id).pausing).toBeUndefined();
    // the owner's words let it go on, as they do a paused one
    project.act(i.id, { action: 'discuss', text: 'Zweitens.' });
    expect(explorer().spec.resume).toBe('sess-1');
    expect(explorer().inbox[0]).toContain('Zweitens.');
    expect(item(i.id).paused).toBeUndefined();
  });

  test("paused with its project's agents, an idea's agent holds the project's queue until it is resumed", async () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Erstens.' });
    const first = explorer();
    first.emit({ type: 'session', id: 'sess-1' });
    project.pauseAgents();
    expect(project.board.project.paused).toBe(true);
    turn(first, 'Zu Erstens.');
    expect(item(i.id).paused).toBe(true);
    await heard();
    expect(project.board.project).toMatchObject({ paused: true, agents: { running: 0, paused: 1 } });
    project.resumeAgents();
    expect(project.board.project.paused).toBeUndefined();
    expect(explorer().spec.resume).toBe('sess-1');
    expect(item(i.id).paused).toBeUndefined();
  });

  test('told more while paused, its agent goes on with that and what it had not answered; parked, it is no longer paused', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Erstens.' });
    explorer().emit({ type: 'session', id: 'sess-1' });
    project.act(i.id, { action: 'pause' });
    project.act(i.id, { action: 'discuss', text: 'Zweitens.' });
    const next = explorer();
    expect(next.inbox[0]).toContain('The owner paused you while you worked on a reply');
    expect(next.inbox[0]!.indexOf('Erstens.')).toBeLessThan(next.inbox[0]!.indexOf('Zweitens.'));
    expect(item(i.id).paused).toBeUndefined();

    project.act(i.id, { action: 'pause' });
    project.act(i.id, { action: 'park' });
    expect(item(i.id).paused).toBeUndefined();
    expect(item(i.id).idea).toMatchObject({ status: 'parked', thinking: false });
    project.act(i.id, { action: 'discuss', text: 'Drittens.' });
    expect(explorer().inbox[0]).toContain('The owner parked the idea while you were working on a reply');
  });

  test('a turn that ends with an error keeps what it did not answer', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Erstens.' });
    const s = explorer();
    s.emit({ type: 'session', id: 'sess-1' });
    project.act(i.id, { action: 'discuss', text: 'Zweitens.' });
    s.emit({ type: 'error', message: 'rate limit' });
    expect(item(i.id).idea).toMatchObject({ status: 'open', thinking: false });
    project.act(i.id, { action: 'discuss', text: 'Hallo?' });
    const next = explorer();
    expect(next.inbox[0]).toContain('Your last turn ended with an error');
    expect(next.inbox[0]).toContain('Erstens.');
    expect(next.inbox[0]).toContain('Zweitens.');
    expect(next.inbox[0]).toContain('Hallo?');
  });

  test('its agent the usage limit stops waits on the card, with what the owner says meanwhile, and replies once it lifts', async () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Erstens.' });
    const s = explorer();
    s.emit({ type: 'session', id: 'sess-1' });
    s.emit({ type: 'error', message: "You've hit your session limit · resets 2:40pm (Europe/Berlin)", limit: { resetsAt: Date.now() + 20 } });
    s.emit({ type: 'idle' });
    // no error in its conversation: the card says when it goes on, and the agent still works on its reply
    expect(board().events(i.id).some((e) => e.kind === 'error' || e.text.includes('hit your'))).toBe(false);
    expect(item(i.id).idea).toMatchObject({ thinking: true });
    expect(Date.parse(item(i.id).limitedUntil!)).toBeGreaterThan(Date.now());
    expect(s.closed).toBe(false);
    project.act(i.id, { action: 'discuss', text: 'Zweitens.' });
    expect(s.inbox).toHaveLength(1);
    await settle(60);
    expect(item(i.id).limitedUntil).toBeUndefined();
    expect(s.inbox[1]).toContain('The usage limit that stopped your last turn has reset');
    s.call('reply', { text: 'Zu erstens.' });
    s.emit({ type: 'idle' });
    // what the owner said meanwhile is its next turn
    expect(s.inbox[2]).toContain('Zweitens.');
    expect(talk(i.id)).toEqual([
      ['owner', 'Erstens.'],
      ['owner', 'Zweitens.'],
      ['explorer', 'Zu erstens.'],
    ]);
  });

  test('its agent the usage limit stops when Seismic restarts runs into it again and waits anew; parked meanwhile, it waits no more', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Frage.' });
    explorer().emit({ type: 'session', id: 'sess-9' });
    explorer().emit({ type: 'error', message: "You've hit your session limit", limit: { resetsAt: Date.now() + 10_000 } });
    explorer().emit({ type: 'idle' });
    project.shutdown();
    project = open();
    expect(item(i.id).limitedUntil).toBeUndefined();
    const s = explorer();
    expect(s.inbox[0]).toContain('Seismic was restarted');
    s.emit({ type: 'error', message: "You've hit your session limit", limit: { resetsAt: Date.now() + 10_000 } });
    s.emit({ type: 'idle' });
    expect(item(i.id).limitedUntil).toBeDefined();
    project.act(i.id, { action: 'park' });
    expect(s.closed).toBe(true);
    expect(item(i.id).limitedUntil).toBeUndefined();
  });

  test('what waited for its agent’s turn when Seismic stopped reaches it after the restart', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Frage.' });
    explorer().emit({ type: 'session', id: 'sess-9' });
    project.act(i.id, { action: 'discuss', text: 'Noch eine.' });
    project.shutdown();
    project = open();
    const s = explorer();
    expect(s.spec.resume).toBe('sess-9');
    expect(s.inbox[0]).toContain('Noch eine.');
    expect(s.inbox[0]).not.toContain('Frage.');
  });
});

describe('a prototype', () => {
  const demoDir = (name = 'demo') => {
    const d = join(dir, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'demo.mp4'), '0');
    writeFileSync(join(d, 'captions.vtt'), 'WEBVTT\n\n00:00:00.351 --> 00:00:10.000\nSo sähe es aus.\n');
    return d;
  };
  const workers = () => runtime.sessions.filter((s) => s.spec.tools.some((t) => t.name === 'ready_for_review'));
  const worker = () => workers()[0]!;
  /** The worker of a card: workers start once git has prepared their workstations, in no set order. */
  const workerOf = (cardId: string) => workers().find((w) => w.spec.cwd === board().row(cardId).workstation)!;
  const prototypes = (ideaId: string) =>
    board()
      .snapshot()
      .items.filter((x) => x.prototypeOf === ideaId);
  const archived = (id: string) => board().archived().find((i) => i.id === id);
  /** The prototype's worker commits something on its branch, as a real one would. */
  const commit = (cardId: string, file: string) => {
    const ws = board().row(cardId).workstation!;
    identify(ws);
    writeFileSync(join(ws, file), 'prototyp\n');
    git(ws, 'add', '.');
    git(ws, 'commit', '--quiet', '-m', `Prototyp ${file}`);
  };
  const handOver = (s: FakeSession, summary: string, demo = 'demo') =>
    s.call('ready_for_review', { summary, demo: { dir: demoDir(demo), chapters: ['Knopf'] } });

  test('builds a throwaway prototype whose demo shows on the idea; discarded, it goes into the archive', async () => {
    const i = idea();
    board().setIdea(i.id, { brief: '**Ziel:** CSV-Export.', mocks: [{ title: 'Knopf', html: '<button>Export</button>' }] });
    project.act(i.id, { action: 'discuss', text: 'Zeig mal.' });
    turn(explorer(), 'Ein Prototyp hilft.');
    project.act(i.id, { action: 'prototype', text: 'Den Export-Knopf. Oben rechts in der Leiste.' });
    await settle();
    const [prototype] = prototypes(i.id);
    expect(prototype).toMatchObject({ state: 'working', title: 'Prototype: Export für Vermieter – Den Export-Knopf', from: i.id, body: 'Den Export-Knopf. Oben rechts in der Leiste.' });
    expect(item(i.id).state).toBe('idea');
    // while the prototype is built, the owner waits for it, not the idea for the owner
    expect(item(i.id).idea).toMatchObject({ yourTurn: false, thinking: false });
    // a reply to the owner meanwhile leaves them waiting for the prototype, unless it asks them something
    project.act(i.id, { action: 'discuss', text: 'Die Spalten stehen schon fest.' });
    turn(explorer(), 'Notiert. Jetzt zählt, was der Prototyp zeigt.');
    expect(item(i.id).idea).toMatchObject({ yourTurn: false, thinking: false });
    project.act(i.id, { action: 'discuss', text: 'Und das Format?' });
    explorer().call('reply', { text: 'Dazu eine Frage.', questions: [{ question: 'Auch Excel?', options: ['Ja', 'Nein'] }] });
    explorer().emit({ type: 'idle' });
    expect(item(i.id).idea).toMatchObject({ yourTurn: true, thinking: false });
    const w = worker();
    expect(w.inbox[0]).toContain('throwaway prototype');
    expect(w.inbox[0]).toContain('**Ziel:** CSV-Export.');
    expect(w.inbox[0]).toContain('<button>Export</button>');
    expect(w.inbox[0]).not.toContain('Before ready_for_review, run');
    // a prototype never lands, so it holds no files for the Koordinator
    expect(project.koordinator.inProgress()).toEqual([]);

    const ws = board().row(prototype!.id).workstation!;
    const branch = board().row(prototype!.id).branch!;
    await handOver(w, 'Knopf gebaut.');
    // the demo stays the prototype's, and shows on the idea under its title
    expect(item(i.id).demo).toBeUndefined();
    expect(item(i.id).prototypes).toMatchObject([{ id: prototype!.id, title: prototype!.title, demo: { chapters: [[0, 'Knopf']] } }]);
    expect(explorer().inbox.at(-1)).toContain('Knopf gebaut.');
    expect(explorer().inbox.at(-1)).toContain(prototype!.title);
    turn(explorer(), 'Der Knopf trägt; nimmst du ihn?');
    expect(item(i.id).idea).toMatchObject({ yourTurn: true });
    expect(item(prototype!.id)).toMatchObject({ state: 'waiting', need: 'demo' });

    // approving a prototype is having seen enough: it is discarded
    project.act(prototype!.id, { action: 'approve' });
    expect(board().item(prototype!.id)).toBeUndefined();
    await settle();
    expect(git(main, 'branch', '--list', branch)).toBe('');
    expect(git(ws, 'branch', '--list', branch)).toBe('');
    expect(project.repos[0]!.workstations.leasedBy(prototype!.id)).toBeNull();
    // in the archive with its demo, summary and log, and it stays there
    expect(archived(prototype!.id)).toMatchObject({ prototypeEnd: 'discarded', summary: 'Knopf gebaut.', demo: { chapters: [[0, 'Knopf']] } });
    expect(board().demoFiles(prototype!.id)).toEqual({ dir: join(dir, 'demo'), kind: 'video' });
    expect(board().events(prototype!.id).at(-1)!.text).toContain('Discarded');
    expect(() => board().unarchive(prototype!.id)).toThrow(expect.objectContaining({ code: 'prototypeEnded' }));
    // the idea still shows its demo
    expect(item(i.id).prototypes).toMatchObject([{ id: prototype!.id, prototypeEnd: 'discarded', demo: { chapters: [[0, 'Knopf']] } }]);
    expect(board().events(i.id).at(-1)!.text).toContain('discarded');
  });

  test('several run side by side, each with its approach, and the idea shows every demo', async () => {
    project.shutdown();
    project = open(3);
    const i = idea('Logo für Seismic');
    project.act(i.id, { action: 'prototype', text: 'Wortmarke: der Name in eigener Schrift' });
    project.act(i.id, { action: 'prototype', text: 'Bildmarke' });
    project.act(i.id, { action: 'prototype' });
    await settle();
    const all = prototypes(i.id);
    expect(all.map((p) => p.title)).toEqual(['Prototype: Logo für Seismic – Wortmarke', 'Prototype: Logo für Seismic – Bildmarke', 'Prototype: Logo für Seismic']);
    expect(all.every((p) => p.state === 'working')).toBe(true);
    // side by side below the idea, not on top of each other
    expect(new Set(all.map((p) => p.y)).size).toBe(1);
    expect(all[1]!.x - all[0]!.x).toBeGreaterThan(200);
    await handOver(workerOf(all[0]!.id), 'Wortmarke.', 'a');
    // the reply to one result, the others still built, leaves the owner waiting for them
    turn(explorer(), 'Die Wortmarke trägt.');
    expect(item(i.id).idea).toMatchObject({ yourTurn: false, thinking: false });
    await handOver(workerOf(all[1]!.id), 'Bildmarke.', 'b');
    expect(item(i.id).prototypes!.map((p) => [p.title, !!p.demo])).toEqual([
      ['Prototype: Logo für Seismic – Wortmarke', true],
      ['Prototype: Logo für Seismic – Bildmarke', true],
      ['Prototype: Logo für Seismic', false],
    ]);
    // a running prototype keeps a dropped idea on the project
    project.act(i.id, { action: 'drop' });
    expect(() => board().archive([i.id])).toThrow(expect.objectContaining({ code: 'prototypeRunning' }));
  });

  test('a second prototype with the same approach is numbered', async () => {
    project.shutdown();
    project = open(2);
    const i = idea();
    project.act(i.id, { action: 'prototype', text: 'Knopf' });
    await settle();
    project.act(prototypes(i.id)[0]!.id, { action: 'discard' });
    project.act(i.id, { action: 'prototype', text: 'Knopf' });
    await settle();
    expect(prototypes(i.id).map((p) => p.title)).toEqual(['Prototype: Export für Vermieter – Knopf (2)']);
  });

  test('the variants its agent planned start at once, one prototype each, and none twice', async () => {
    project.shutdown();
    project = open(4);
    const i = idea('Leinwand ordnen');
    project.act(i.id, { action: 'discuss', text: 'Zeig mir alle drei.' });
    turn(explorer(), 'Drei Prototypen geplant.', () =>
      explorer().call('plan_prototypes', {
        prototypes: [
          { approach: 'A Plasma-Felder', show: 'Gebiete als Metaballs.' },
          { approach: 'B Territorien', show: 'Gebiete als Voronoi.' },
          { approach: 'C Konturen', show: 'Gebiete als Hüllen.' },
          { approach: 'a plasma-felder', show: 'Doppelt.' },
        ],
      }),
    );
    expect(item(i.id).idea!.variants.map((v) => v.approach)).toEqual(['A Plasma-Felder', 'B Territorien', 'C Konturen']);
    // the owner leaves one out
    project.act(i.id, { action: 'prototype', variants: ['A Plasma-Felder', 'C Konturen'] });
    await settle();
    expect(prototypes(i.id).map((p) => [p.title, p.variant, p.state])).toEqual([
      ['Prototype: Leinwand ordnen – A Plasma-Felder', 'A Plasma-Felder', 'working'],
      ['Prototype: Leinwand ordnen – C Konturen', 'C Konturen', 'working'],
    ]);
    // each builds its own variant only
    expect(prototypes(i.id)[0]!.body).toBe('Gebiete als Metaballs.\n\nOnly this variant: B Territorien, C Konturen get prototypes of their own.');
    expect(workerOf(prototypes(i.id)[1]!.id).inbox[0]).toContain('Gebiete als Hüllen.');
    expect(board().events(i.id).at(-1)!.text).toBe('Prototypes started: “Prototype: Leinwand ordnen – A Plasma-Felder”, “Prototype: Leinwand ordnen – C Konturen”.');
    // without a choice (a spoken command): the planned ones that have none yet
    project.act(i.id, { action: 'prototype' });
    await settle();
    expect(prototypes(i.id).map((p) => p.variant)).toEqual(['A Plasma-Felder', 'C Konturen', 'B Territorien']);
    expect(() => project.act(i.id, { action: 'prototype' })).toThrow(expect.objectContaining({ code: 'variantsRunning' }));
    // a discarded variant can be tried again
    project.act(prototypes(i.id)[0]!.id, { action: 'discard' });
    project.act(i.id, { action: 'prototype' });
    await settle();
    expect(prototypes(i.id).at(-1)!.title).toBe('Prototype: Leinwand ordnen – A Plasma-Felder (2)');
    expect(() => project.act(i.id, { action: 'prototype', variants: ['D Gibt es nicht'] })).toThrow(expect.objectContaining({ code: 'invalid' }));
  });

  test('"Build this prototype" builds the idea on its branch; the others are discarded', async () => {
    project.shutdown();
    project = open(3);
    const i = idea();
    board().setIdea(i.id, { brief: '**Ziel:** CSV-Export.' });
    project.act(i.id, { action: 'prototype', text: 'Knopf' });
    project.act(i.id, { action: 'prototype', text: 'Menü' });
    await settle();
    const [chosen, other] = prototypes(i.id);
    const [w, wOther] = [workerOf(chosen!.id), workerOf(other!.id)];
    commit(chosen!.id, 'knopf.txt');
    commit(other!.id, 'menu.txt');
    // the chosen one's worker asked the owner something on its card
    w!.call('ask', { question: 'Knopf oben oder unten?', options: ['oben', 'unten'] });
    project.act(chosen!.id, { action: 'answer', text: 'oben' });
    await handOver(w!, 'Knopf oben gebaut; Export als CSV.');
    const ws = board().row(chosen!.id).workstation!;
    const otherWs = board().row(other!.id).workstation!;
    const otherBranch = board().row(other!.id).branch!;
    // the idea's agent takes in the answer, then the handover
    explorer().emit({ type: 'idle' });
    explorer().emit({ type: 'idle' });

    await project.act(chosen!.id, { action: 'buildPrototype' });
    // the idea is the feature now, in the prototype's workstation, on its branch under the idea's name
    const built = item(i.id);
    expect(built).toMatchObject({ state: 'planned', body: '**Ziel:** CSV-Export.', builtOn: chosen!.id });
    expect(built.idea).toBeUndefined();
    const row = board().row(i.id);
    expect(row.workstation).toBe(ws);
    expect(row.branch).toMatch(/^obeya\/export-fur-vermieter-/);
    expect(git(ws, 'branch', '--show-current')).toBe(row.branch!);
    expect(git(ws, 'log', '--format=%s', '-1')).toBe('Prototyp knopf.txt');
    expect(project.repos[0]!.workstations.leasedBy(i.id)).toBe(ws);
    // the chosen prototype goes into the archive as built, its worker stopped
    expect(w!.closed).toBe(true);
    expect(archived(chosen!.id)).toMatchObject({ prototypeEnd: 'built', summary: 'Knopf oben gebaut; Export als CSV.' });
    expect(project.repos[0]!.workstations.leasedBy(chosen!.id)).toBeNull();
    // the other one is discarded with its code
    expect(wOther!.closed).toBe(true);
    expect(archived(other!.id)).toMatchObject({ prototypeEnd: 'discarded' });
    await settle();
    expect(git(otherWs, 'branch', '--list', otherBranch)).toBe('');
    expect(prototypes(i.id)).toEqual([]);
    expect(board().decisions(null).at(-1)).toMatchObject({ card_id: i.id, answer: `Build it, on the prototype “${chosen!.title}”.` });

    // its worker goes on from the branch: the brief, the prototype's handover and the owner's answers
    await settle();
    expect(item(i.id).state).toBe('working');
    const builder = workers().at(-1)!;
    expect(builder.spec.cwd).toBe(ws);
    const brief = builder.inbox[0]!;
    expect(brief).toContain('**Ziel:** CSV-Export.');
    expect(brief).toContain('throwaway prototype');
    expect(brief).toContain('production quality');
    expect(brief).toContain('Knopf oben gebaut; Export als CSV.');
    expect(brief).toContain('- Knopf oben oder unten? → oben');
    expect(brief).toContain(`You are on branch ${row.branch}, which holds the prototype's commits`);
    expect(builder.spec.tools.some((t) => t.name === 'propose_card')).toBe(true);
  });

  test("a prototype's worker proposes building the idea on it instead of making cards", async () => {
    const i = idea();
    project.act(i.id, { action: 'prototype', text: 'Knopf' });
    await settle();
    const [prototype] = prototypes(i.id);
    const w = worker();
    expect(w.spec.tools.some((t) => t.name === 'propose_card')).toBe(false);
    expect(w.spec.system).toContain('propose_build');
    expect(w.call('propose_build', { reason: 'Der Owner hat den Knopf gewählt.' })).toContain('owner decides');
    expect(item(prototype!.id).buildProposal).toBe('Der Owner hat den Knopf gewählt.');
    expect(board().snapshot().items.filter((x) => x.state === 'proposal')).toEqual([]);
    // accepting it is "Build this prototype"
    await project.act(prototype!.id, { action: 'buildPrototype' });
    expect(item(i.id)).toMatchObject({ state: 'planned', builtOn: prototype!.id });
    expect(archived(prototype!.id)!.buildProposal).toBeUndefined();
  });

  test("its questions and the owner's answers reach the idea's agent, for the brief only", async () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Los.' });
    turn(explorer(), 'Ein Prototyp?');
    project.act(i.id, { action: 'prototype', text: 'Knopf' });
    await settle();
    const [prototype] = prototypes(i.id);
    worker().call('ask', { question: 'Welche Farbe?', options: ['Blau', 'Grün'] });
    project.act(prototype!.id, { action: 'answer', text: 'Blau' });
    const s = explorer();
    expect(s.inbox.at(-1)).toContain('“Welche Farbe?”');
    expect(s.inbox.at(-1)).toContain('The owner answered: Blau');
    // what it says on the way is no reply: the owner is not asked again
    s.call('update_brief', { brief: '**Entscheidungen:** Blau.' });
    s.emit({ type: 'text', text: 'Im Stand festgehalten.' });
    s.emit({ type: 'idle' });
    expect(item(i.id).idea).toMatchObject({ brief: '**Entscheidungen:** Blau.', yourTurn: false, thinking: false });
    expect(talk(i.id).at(-1)).toEqual(['explorer', 'Ein Prototyp?']);
  });

  test('"Build it like this" discards the prototypes still on the project', async () => {
    const i = idea();
    project.act(i.id, { action: 'prototype', text: 'Knopf' });
    await settle();
    const [prototype] = prototypes(i.id);
    project.act(i.id, { action: 'build' });
    expect(archived(prototype!.id)).toMatchObject({ prototypeEnd: 'discarded' });
    expect(item(i.id).builtOn).toBeUndefined();
  });

  test('"Make a plan" keeps the prototypes; once the plan stands, one of its workstreams is built on one', async () => {
    project.shutdown();
    project = open(3);
    const i = idea('Webseite');
    board().setIdea(i.id, { brief: '**Ziel:** Eine Seite. Über die Variante entscheiden die Prototypen.' });
    project.act(i.id, { action: 'prototype', text: 'Film zuerst' });
    project.act(i.id, { action: 'prototype', text: 'Manifest' });
    await settle();
    const [film, manifest] = prototypes(i.id);
    const w = workerOf(film!.id);
    commit(film!.id, 'film.html');
    await handOver(w!, 'Ruhige Seite mit großem Video oben.');
    explorer().emit({ type: 'idle' });

    // the plan doc's worker hears what the prototypes showed, so it does not plan them again
    project.act(i.id, { action: 'planDoc' });
    const task = item(i.id).body;
    expect(task).toContain(`“${film!.title}”, handed over like this:\n\nRuhige Seite mit großem Video oben.`);
    expect(task).toContain(`“${manifest!.title}”: still in progress.`);
    expect(task).toContain('So do not plan them again as workstreams');
    expect(task).toContain('Only the workstream that builds on the chosen prototype mentions prototypes');
    expect(prototypes(i.id).map((p) => p.id)).toEqual([film!.id, manifest!.id]);
    // building waits for the plan
    expect(() => project.act(film!.id, { action: 'buildPrototype' })).toThrow(expect.objectContaining({ code: 'planPending' }));

    // the plan doc lands: the plan takes the idea's place, and the idea goes to the archive
    await landDoc(
      'docs/plan/seite.md',
      '# Webseite\n\n## Ziel\n\nEine Seite.\n\n## Workstreams\n\n- [ ] **W1:** Lizenz. MIT.\n- [ ] **W2:** Seite bauen. Auf dem gewählten Prototyp.\n- [ ] **W3:** Aufräumen. Die alten Prototypen löschen.\n',
    );
    board().work(i.id, { state: 'live' });
    board().planDocsLanded(i.id, ['docs/plan/seite.md']);
    board().docsChanged();
    const plan = board().planOf(i.id)!;
    expect(plan.title).toBe('Webseite');
    expect(board().item(i.id)).toBeUndefined();
    const [w1, w2, w3] = board().snapshot().items.filter((x) => x.parent === plan.id);
    // the prototypes still name their idea
    expect(prototypes(i.id).map((p) => p.ideaTitle)).toEqual(['Webseite', 'Webseite']);

    // two workstreams mention prototypes: the owner chooses
    expect(() => project.act(film!.id, { action: 'buildPrototype' })).toThrow(expect.objectContaining({ code: 'workstreamMissing' }));
    board().work(w1!.id, { branch: 'obeya/lizenz' });
    expect(() => project.act(film!.id, { action: 'buildPrototype', workstream: w1!.id })).toThrow(expect.objectContaining({ code: 'workstreamStarted' }));
    expect(() => project.act(film!.id, { action: 'buildPrototype', workstream: i.id })).toThrow(expect.objectContaining({ code: 'invalid' }));

    const ws = board().row(film!.id).workstation!;
    // once the other one is under way, the plan doc names the workstream to build on the prototype
    board().work(w3!.id, { branch: 'obeya/aufraeumen' });
    await project.act(film!.id, { action: 'buildPrototype' });
    // the workstream takes over the prototype's workstation and branch, and starts
    expect(item(w2!.id).builtOn).toBe(film!.id);
    expect(item(w2!.id).prototypes!.map((p) => p.id)).toEqual([film!.id]);
    expect(board().row(w2!.id).workstation).toBe(ws);
    expect(git(ws, 'log', '--format=%s', '-1')).toBe('Prototyp film.html');
    expect(archived(film!.id)).toMatchObject({ prototypeEnd: 'built', builtInto: 'W2 “Seite bauen”', ideaTitle: 'Webseite' });
    expect(archived(manifest!.id)).toMatchObject({ prototypeEnd: 'discarded' });
    expect(prototypes(i.id)).toEqual([]);
    expect(board().decisions(plan.id).at(-1)).toMatchObject({ card_id: w2!.id, answer: `On the prototype “${film!.title}”.` });
    // the Koordinator estimates the scope of the plan doc's card first, then decides on the
    // workstream, which may build on W1 or W3: they have not landed
    await until(() => {
      for (const k of runtime.sessions.filter((x) => x.spec.tools.some((t) => t.name === 'scope'))) k.call('scope', { files: [], conflicts_with: [], reason: '' });
      return item(w2!.id).state === 'working' && workers().at(-1)?.inbox[0]?.includes('build this workstream on the prototype');
    });
    const brief = workers().at(-1)!.inbox[0]!;
    expect(brief).toContain('build this workstream on the prototype');
    expect(brief).toContain('Ruhige Seite mit großem Video oben.');
    expect(brief).toContain('This is workstream W2 of the plan “Webseite”.');
  });

  test('deleting a prototype discards it into the archive, workstation and all', async () => {
    const i = idea();
    project.act(i.id, { action: 'prototype', text: 'Knopf' });
    await settle();
    const [prototype] = prototypes(i.id);
    project.remove(prototype!.id);
    expect(archived(prototype!.id)).toMatchObject({ prototypeEnd: 'discarded' });
    await settle();
    expect(project.repos[0]!.workstations.leasedBy(prototype!.id)).toBeNull();
    expect(() => project.act(i.id, { action: 'buildPrototype' })).toThrow('not a prototype');
  });

  test('"Split off a task" starts the settled part as a task of its own; the idea stays with its conversation and prototypes', async () => {
    project.shutdown();
    project = open(3);
    const i = idea('Lese-Lern-App');
    const shot = project.images.save(new Uint8Array([1]), 'image/png');
    project.act(i.id, { action: 'discuss', text: 'So soll das Spiel aussehen.', images: [shot] });
    const s = explorer();
    s.emit({ type: 'session', id: 'sess-1' });
    s.call('update_brief', { brief: '**Ziel:** Lesen lernen. Die Spiellogik steht, die Bilder sind offen.' });
    s.call('plan_prototypes', { prototypes: [{ approach: 'P1 lokal', show: 'Bilder mit mflux.' }, { approach: 'P2 Cloud', show: 'Bilder mit Gemini.' }] });
    s.call('plan_split', { title: ' Lese-Lern-App:  Spiel und Lernlogik ', brief: '**Ziel:** Das Spiel mit Platzhalterbildern.' });
    s.call('reply', { text: 'Die Spiellogik kann los.', next: { step: 'splitOff', why: 'Die Spiellogik steht, die Bilder brauchen Prototypen.' } });
    s.emit({ type: 'idle' });
    expect(item(i.id).idea).toMatchObject({
      split: { title: 'Lese-Lern-App: Spiel und Lernlogik', brief: '**Ziel:** Das Spiel mit Platzhalterbildern.' },
      next: { step: 'splitOff' },
    });
    expect(board().events(i.id).some((e) => e.text === 'Marks a task to split off: “Lese-Lern-App: Spiel und Lernlogik”')).toBe(true);
    // one prototype runs, the other is still only planned
    project.act(i.id, { action: 'prototype', variants: ['P1 lokal'] });
    await settle();
    const [p1] = prototypes(i.id);

    project.act(i.id, { action: 'splitOff' });
    const task = board()
      .snapshot()
      .items.find((x) => x.title === 'Lese-Lern-App: Spiel und Lernlogik')!;
    expect(task).toMatchObject({ kind: 'task', state: 'planned', from: i.id, images: [shot], queue: { checking: true } });
    expect(task.body).toBe('**Ziel:** Das Spiel mit Platzhalterbildern.\n\nThe part of the idea “Lese-Lern-App” that is settled. What is still open there, the idea goes on discussing; it is not part of this task.');
    // the idea stays open with its brief, its planned and running prototypes; the split is used up
    expect(item(i.id)).toMatchObject({ state: 'idea', idea: { status: 'open', brief: '**Ziel:** Lesen lernen. Die Spiellogik steht, die Bilder sind offen.' } });
    expect(item(i.id).idea!.variants.map((v) => v.approach)).toEqual(['P1 lokal', 'P2 Cloud']);
    expect(item(i.id).idea!.split).toBeUndefined();
    expect(item(p1!.id).state).toBe('working');
    expect(board().decisions(null).at(-1)).toMatchObject({ card_id: i.id, answer: 'Split off a task: “Lese-Lern-App: Spiel und Lernlogik”.' });
    expect(board().events(i.id).some((e) => e.text === 'Task split off: “Lese-Lern-App: Spiel und Lernlogik” is now a task of its own; what is open stays here.')).toBe(true);
    // its agent hears what became of the part, and trims the brief to what is open
    const told = explorer();
    expect(told.inbox.at(-1)).toContain('the part you marked as settled is now the task “Lese-Lern-App: Spiel und Lernlogik”');
    expect(item(i.id).idea!.thinking).toBe(true);
    turn(told, 'Offen sind die Bilder.', () => told.call('update_brief', { brief: '**Ziel:** Bilder für die Lese-Lern-App.' }));
    expect(() => project.act(i.id, { action: 'splitOff' })).toThrow(expect.objectContaining({ code: 'noSplit' }));
    await settle();
    expect(item(task.id).state).toBe('working');
    expect(workers().some((w) => w.inbox[0]!.includes('**Ziel:** Das Spiel mit Platzhalterbildern.'))).toBe(true);
    // later the idea is built as before, and its prototypes go
    project.act(i.id, { action: 'build' });
    expect(item(i.id)).toMatchObject({ state: 'planned', body: '**Ziel:** Bilder für die Lese-Lern-App.' });
    expect(archived(p1!.id)).toMatchObject({ prototypeEnd: 'discarded' });
  });

  test('building the settled part waits for its agent’s reply, and is no step without a part marked', () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Was steht schon?' });
    let s = explorer();
    expect(s.spec.system).toContain('Building ends this conversation: the brief becomes the task, and the idea\'s prototypes, planned and running, are dropped.');
    expect(s.spec.system).toContain('the idea stays with this conversation, its open part and its prototypes, planned and running');
    expect(s.spec.system).toContain("The idea's prototypes stay, for the workstream that builds on them.");
    s.call('reply', { text: 'Noch nichts.', next: { step: 'splitOff', why: '?' } });
    s.emit({ type: 'idle' });
    expect(item(i.id).idea!.next).toBeUndefined();
    expect(() => project.act(i.id, { action: 'splitOff' })).toThrow(expect.objectContaining({ code: 'noSplit' }));
    project.act(i.id, { action: 'discuss', text: 'CSV steht, PDF noch nicht.' });
    s = explorer();
    s.emit({ type: 'session', id: 'sess-1' });
    s.call('plan_split', { title: 'CSV-Export', brief: '**Ziel:** CSV.' });
    expect(() => project.act(i.id, { action: 'splitOff' })).toThrow(expect.objectContaining({ code: 'ideaThinking' }));
    s.call('reply', { text: 'CSV kann los.', next: { step: 'splitOff', why: 'CSV steht.' } });
    s.emit({ type: 'idle' });
    expect(item(i.id).idea).toMatchObject({ split: { title: 'CSV-Export' }, next: { step: 'splitOff', why: 'CSV steht.' } });
    // a split without a brief, or emptied, is none
    project.act(i.id, { action: 'discuss', text: 'Doch alles zusammen.' });
    s = explorer();
    s.call('plan_split', { title: 'CSV-Export', brief: ' ' });
    turn(s, 'Dann alles zusammen.');
    expect(item(i.id).idea!.split).toBeUndefined();
    expect(board().events(i.id).some((e) => e.text === 'Marks no task to split off any more')).toBe(true);
  });
});

describe('by voice', () => {
  const reader = () => runtime.sessions.filter((s) => s.spec.tools.some((t) => t.name === 'act')).at(-1)!;

  test('"Ich will über … nachdenken" makes an idea whose agent opens the discussion', async () => {
    const heard = project.commander.hear('Ich will über Export für Vermieter nachdenken', {});
    await settle();
    reader().call('act', { actions: [{ do: 'new_idea', title: 'Export für Vermieter', body: 'Über Export für Vermieter nachdenken.' }], confirm: 'Neue Idee “Export für Vermieter”.' });
    const h = await heard;
    project.commander.arm(h.token!);
    await settle(30);
    const i = board()
      .snapshot()
      .items.find((x) => x.state === 'idea')!;
    expect(i.title).toBe('Export für Vermieter');
    expect(talk(i.id)).toEqual([['owner', 'Über Export für Vermieter nachdenken.']]);
    turn(explorer(), 'Für welche Vermieter?');
  });

  test('what the owner says on the open idea goes straight to its agent, without the Koordinator', () => {
    const i = idea();
    project.tell(i.id, 'eher als PDF', [], true);
    expect(talk(i.id)).toEqual([['owner', 'eher als PDF']]);
    expect(explorer().inbox[0]).toContain('eher als PDF');
    expect(explorer().inbox[0]).toContain('speech recognition may have misheard');
    expect(runtime.sessions.filter((s) => s.spec.tools.some((t) => t.name === 'act'))).toEqual([]);
  });

  test("its agent passes on what asks Seismic for something; the Koordinator reads it with the owner's words", async () => {
    const i = idea();
    project.tell(i.id, 'Mach daraus ein Projekt', [], true);
    const s = explorer();
    expect(s.spec.system).toContain('Pass those on with to_seismic');
    const result = s.call('to_seismic', { request: 'Plan this idea as a plan' }) as Promise<string>;
    await settle();
    const k = reader();
    expect(k.inbox[0]).toContain('passes on a request from what the owner told it, asking Seismic for something: "Plan this idea as a plan"');
    expect(k.inbox[0]).toContain('The owner\'s own words to it, spoken (speech recognition, may contain errors): "Mach daraus ein Projekt"');
    expect(k.inbox[0]).toContain('The owner has this card open');
    // the agent has the words already; planning waits for the reply it works on
    expect(k.call('act', { actions: [{ do: 'discuss', card: 'K1', text: 'Projekt' }], confirm: 'Ok.' })).toContain('reached this card');
    expect(k.call('act', { actions: [{ do: 'plan_doc', card: 'K1' }], confirm: 'Ok.' })).toContain("waits for the reply the idea's agent is working on");
    k.call('reply', { confirm: 'Planen geht per Klick, sobald deine Antwort da ist.' });
    expect(await result).toBe('Seismic: Planen geht per Klick, sobald deine Antwort da ist.');
    // the owner's words are on the card once, the Koordinator's answer under them
    expect(board().events(i.id).filter((e) => e.author === 'owner').map((e) => e.text)).toEqual(['Mach daraus ein Projekt']);
    expect(board().events(i.id).at(-1)).toMatchObject({ kind: 'say', author: 'koordinator', text: 'Planen geht per Klick, sobald deine Antwort da ist.' });
  });

  test('"nimm noch X auf und bau es dann" passes X on and builds once the reply is there, unless it asks questions', async () => {
    const i = idea();
    const heard = project.commander.hear('nimm noch PDF auf und bau es dann', { card: i.id });
    await settle();
    reader().call('act', {
      actions: [
        { do: 'discuss', card: 'K1', text: 'Nimm noch PDF auf.' },
        { do: 'build', card: 'K1' },
      ],
      confirm: 'PDF kommt dazu; gebaut wird nach der Antwort.',
    });
    reader().emit({ type: 'idle' });
    const h = await heard;
    expect(explorer().inbox[0]).toContain('Nimm noch PDF auf.');
    project.commander.arm(h.token!);
    await settle(30);
    expect(item(i.id)).toMatchObject({ state: 'idea', idea: { thinking: true, buildAfterReply: true } });
    // the Koordinator sees what waits
    const again = project.commander.hear('was ist mit der Idee', { card: i.id });
    await settle();
    expect(reader().inbox.at(-1)).toContain('[idea, its agent is working on its reply; built once the reply is there, unless it asks questions]');
    // planning still waits for the reply
    expect(reader().call('act', { actions: [{ do: 'plan_doc', card: 'K1' }], confirm: 'Wird geplant.' })).toContain('is still working on its reply');
    reader().call('reply', { text: 'Sie wird nach der Antwort gebaut.' });
    await again;
    turn(explorer(), 'PDF ist drin.', () => explorer().call('update_brief', { brief: '**Ziel:** CSV und PDF.' }));
    expect(item(i.id)).toMatchObject({ state: 'planned', body: '**Ziel:** CSV und PDF.' });
  });

  test('"bau diesen Prototyp" waits for the reply of its idea’s agent', async () => {
    const i = idea();
    project.act(i.id, { action: 'prototype', text: 'Knopf' });
    await settle();
    const prototype = board()
      .snapshot()
      .items.find((x) => x.prototypeOf === i.id)!;
    project.act(i.id, { action: 'discuss', text: 'Schon was zu sehen?' });
    expect(() => project.act(prototype.id, { action: 'buildPrototype' })).toThrow('still working on its reply');
  });

  test('"bau diesen Prototyp" on a prototype builds its idea on it', async () => {
    const i = idea();
    project.act(i.id, { action: 'prototype', text: 'Knopf' });
    await settle();
    const prototype = board()
      .snapshot()
      .items.find((x) => x.prototypeOf === i.id)!;
    const heard = project.commander.hear('bau diesen Prototyp', { card: prototype.id });
    await settle();
    expect(reader().inbox[0]).toContain(`"${prototype.title}" (prototype of K`);
    const tag = reader().inbox[0]!.match(/(K\d+) \[working\] "Prototyp/)![1];
    reader().call('act', { actions: [{ do: 'build', card: tag }], confirm: 'Die Idee wird auf diesem Prototyp gebaut.' });
    project.commander.arm((await heard).token!);
    await until(() => item(i.id).builtOn);
    expect(item(i.id)).toMatchObject({ builtOn: prototype.id });
  });

  test('"bau diesen Prototyp" builds the workstream its plan doc names once its idea is a plan', async () => {
    const i = idea('Webseite');
    project.act(i.id, { action: 'prototype', text: 'Film zuerst' });
    await settle();
    const prototype = board()
      .snapshot()
      .items.find((x) => x.prototypeOf === i.id)!;
    await landDoc('docs/plan/seite.md', '# Webseite\n\n## Ziel\n\nEine Seite.\n\n## Workstreams\n\n- [ ] **W1:** Seite bauen. Auf dem gewählten Prototyp.\n');
    board().work(i.id, { state: 'live' });
    board().planDocsLanded(i.id, ['docs/plan/seite.md']);
    board().docsChanged();
    const w1 = board()
      .snapshot()
      .items.find((x) => x.label === 'W1')!;
    const heard = project.commander.hear('bau diesen Prototyp', { card: prototype.id });
    await settle();
    const list = reader().inbox[0]!;
    expect(list).toContain('(prototype of the idea "Webseite", which became the plan K');
    const tag = list.match(/(K\d+) \[working\] "Prototyp/)![1];
    expect(list).toContain('build starts its workstream K');
    reader().call('act', { actions: [{ do: 'build', card: tag }], confirm: 'W1 wird auf diesem Prototyp gebaut.' });
    project.commander.arm((await heard).token!);
    await until(() => item(w1.id).builtOn);
    await settle();
    expect(item(w1.id)).toMatchObject({ builtOn: prototype.id });
  });

  test('"bau schon, was feststeht" builds the part its agent marked, and only then', async () => {
    const i = idea();
    const heard = project.commander.hear('bau schon mal, was feststeht', { card: i.id });
    await settle();
    expect(reader().call('act', { actions: [{ do: 'split_off', card: 'K1' }], confirm: 'Wird gebaut.' })).toContain('has marked no task to split off the idea');
    reader().call('reply', { text: 'Der Agent hat noch keine Teilaufgabe markiert.' });
    reader().emit({ type: 'idle' });
    await heard;
    board().setIdea(i.id, { split: { title: 'CSV-Export', brief: '**Ziel:** CSV.' }, next: { step: 'splitOff', why: 'CSV steht.' }, yourTurn: true });
    const again = project.commander.hear('mach, was du vorschlägst', { card: i.id });
    await settle();
    expect(reader().inbox.at(-1)).toContain('its agent would split_off next: CSV steht.');
    expect(reader().inbox.at(-1)).toContain('task its agent marked to split off now (split_off): "CSV-Export"');
    reader().call('act', { actions: [{ do: 'split_off', card: 'K1' }], confirm: '“CSV-Export” wird gebaut.' });
    project.commander.arm((await again).token!);
    await settle(30);
    expect(item(i.id).state).toBe('idea');
    expect(board().snapshot().items.find((x) => x.title === 'CSV-Export')).toMatchObject({ from: i.id, state: 'working' });
  });

  test('deciding on an idea waits for undo like any command', async () => {
    const i = idea();
    const heard = project.commander.hear('so bauen', { card: i.id });
    await settle();
    reader().call('act', { actions: [{ do: 'build', card: 'K1' }], confirm: '“Export für Vermieter” wird gebaut.' });
    const h = await heard;
    expect(h.token).toBeTruthy();
    project.commander.arm(h.token!);
    expect(item(i.id).state).toBe('idea');
    await settle(30);
    expect(item(i.id).state).toBe('working');
  });
});

describe('a new repository for an idea', () => {
  test("its agent picks one from the conversation, the whole value each time; the owner's pick on the card stands", async () => {
    const i = idea();
    project.act(i.id, { action: 'discuss', text: 'Bau es in ~/dev/super59, eigene Leinwand.' });
    await settle();
    const s = explorer();
    expect(s.spec.system).toContain('plan_repo');
    expect(s.call('plan_repo', { path: 'dev/super59' })).toContain('give it absolute or from ~');
    expect(s.call('plan_repo', { path: ' ~/dev/super59 ' })).toContain('a new repository at ~/dev/super59, with a project of its own');
    expect(item(i.id).newRepo).toEqual({ path: '~/dev/super59', project: true, by: 'agent' });
    expect(s.call('plan_repo', { path: '' })).toContain('No new repository');
    expect(item(i.id).newRepo).toBeUndefined();
    s.call('plan_repo', { path: '~/dev/super59', project: false });
    board().patch(i.id, { newRepo: { path: '~/dev/termine', project: true } });
    expect(s.call('plan_repo', { path: '~/dev/other' })).toContain('The owner picked the repository on the card themselves (a new one at ~/dev/termine)');
    expect(item(i.id).newRepo).toEqual({ path: '~/dev/termine', project: true, by: 'owner' });
  });
});
