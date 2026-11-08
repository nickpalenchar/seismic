import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generic } from '../adapters/generic';
import { Board } from './board';
import { Store } from './store';
import { artifact, FakeRuntime, type FakeSession, gitRepo } from './testing';
import { WorkRetro } from './work-retro';
import { Workers } from './workers';
import { Workstations } from './workstations';

const SAMPLE = join(import.meta.dir, 'fixtures', 'transcript.jsonl');
const CODEX = join(import.meta.dir, 'fixtures', 'codex-rollout.jsonl');

let dir: string;
let main: string;
let board: Board;
let runtime: FakeRuntime;
let retro: WorkRetro;
let workers: Workers;
/** The transcript file of each session id; the others have none. */
let files: Record<string, string>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-wr-'));
  main = gitRepo(join(dir, 'main'));
  const store = new Store(':memory:');
  board = new Board(store, { id: 'c', name: 'C', repos: [{ id: 'home', name: 'Home', path: main, branch: 'main' }] }, () => ({ docs: [], dirs: [] }));
  runtime = new FakeRuntime();
  files = {};
  retro = new WorkRetro({ board, runtime, pathFor: () => main, transcript: (id) => files[id] ?? null, every: 3, ramp: [] });
  const workstations = new Workstations(store, 'c', { mode: 'worktrees', repoPath: main, dir: join(dir, 'ws') });
  workers = new Workers({ board, runtime, workstations, adapter: { ...generic, land: 'main', workstations: 'worktrees' }, onWorkEnded: (id, ws) => retro.ended(id, ws) });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const settle = () => new Promise((r) => setTimeout(r, 5));
const noteSessions = () => runtime.sessions.filter((s) => s.spec.tools.some((t) => t.name === 'note'));
const retroSessions = () => runtime.sessions.filter((s) => s.spec.tools.some((t) => t.name === 'card'));

test('friction notes and work proposals follow an English-only preference', async () => {
  board.addPreference('Agents speak and write to me in English only.');
  files = { a: SAMPLE, b: SAMPLE };
  ran('A', 'a');
  await settle();
  const notes = noteSessions()[0]!;
  expect(notes.spec.system).toContain('- Agents speak and write to me in English only.');
  expect(notes.spec.tools.find((t) => t.name === 'note')!.description).toContain('unless an explicit standing preference names another language');
  await note({ what: 'Repeated setup steps' });
  ran('B', 'b');
  await note({ what: 'Repeated setup steps' });
  ran('C', 'c');
  await settle();
  const review = retroSessions()[0]!;
  expect(review.spec.system).toContain('- Agents speak and write to me in English only.');
  expect(review.spec.tools.find((t) => t.name === 'card')!.description).toContain('unless an explicit standing preference names another language');
  expect(review.spec.tools.find((t) => t.name === 'rule')!.description).toContain('basis in English unless an explicit standing preference names another language');
  review.call('done', {});
  review.emit({ type: 'idle' });
});

/** A card that ran in the given sessions and whose work ended. */
function ran(title: string, ...sessions: string[]) {
  const c = board.create({ title, x: 0, y: 0 });
  sessions.slice(0, -1).forEach((s) => board.log(c.id, 'state', 'obeya', `Started from scratch. The earlier run (session ${s}) is kept for the work retrospective.`));
  if (sessions.length) board.work(c.id, { session_id: sessions.at(-1)! });
  retro.ended(c.id);
  return c;
}

/** Answers the open notes session with these notes. */
async function note(...notes: { what: string; cost?: string; fix?: string }[]) {
  await settle();
  const s = noteSessions().at(-1)! as FakeSession;
  for (const n of notes) s.call('note', { cost: 'a few steps', fix: 'a script', ...n });
  s.call('done', {});
  s.emit({ type: 'idle' });
  await settle();
}

describe('Work retrospective', () => {
  test('a finished card’s runs become friction notes, written as a small job from the excerpt', async () => {
    files = { s1: SAMPLE };
    const a = ran('A', 's1', 's2');
    await settle();
    const s = noteSessions()[0]!;
    expect(s.spec).toMatchObject({ readOnly: true, role: 'chores', cwd: main });
    // the earlier run's transcript is read too; the later one has none
    expect(s.inbox[0]).toContain('The card: "A"');
    expect(s.inbox[0]).toContain("unknown option '--port=4500'");
    await note({ what: 'bun run dev has no --port flag' }, { what: 'the demo script failed and was rewritten' });
    expect(board.friction('home', null)).toMatchObject([
      { cardId: a.id, title: 'A', what: 'bun run dev has no --port flag', cost: 'a few steps', fix: 'a script' },
      { cardId: a.id, what: 'the demo script failed and was rewritten' },
    ]);
    expect(board.events(a.id).at(-1)).toMatchObject({ author: 'koordinator', text: 'Work retrospective, friction noted:\n– bun run dev has no --port flag Cost: a few steps What would have prevented it: a script\n– the demo script failed and was rewritten Cost: a few steps What would have prevented it: a script' });
  });

  test('a Codex run is read from its rollout and counts toward the repository’s retrospective like a Claude run', async () => {
    files = { 'codex:thread': CODEX };
    const c = ran('Codex card', 'codex:thread');
    await settle();
    expect(noteSessions()[0]!.inbox[0]).toContain("unknown option '--port=4500'");
    await note({ what: 'bun run dev has no --port flag' });
    expect(board.friction('home', null)).toMatchObject([{ cardId: c.id, what: 'bun run dev has no --port flag' }]);
    expect(board.setting('work_retro_cards:home')).toBe('1');
  });

  test('a run without a transcript, or without anything gone wrong, gets no session; a card that never ran does not count', async () => {
    ran('Never ran');
    ran('No transcript', 's9');
    await settle();
    expect(noteSessions()).toHaveLength(0);
    expect(board.setting('work_retro_cards:home')).toBe('1');
  });

  test('a worker status name-resolution slip produces no friction-notes session', async () => {
    const file = join(dir, 'status.jsonl');
    writeFileSync(file, [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'report', input: { status: 'Checking' } }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', is_error: true, content: '<tool_use_error>Error: No such tool available: report</tool_use_error>' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'b', name: 'mcp__seismic__report', input: { status: 'Checking' } }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'b', is_error: false, content: 'Status updated.' }] } }),
    ].join('\n'));
    files = { status: file };
    ran('Status', 'status');
    await settle();
    expect(noteSessions()).toHaveLength(0);
    expect(board.friction('home', null)).toHaveLength(0);
  });

  test('every few finished cards a retrospective in the repository proposes cards and CLAUDE.md lines for friction on two cards or more', async () => {
    files = { a: SAMPLE, b: SAMPLE };
    ran('A', 'a');
    await note({ what: 'wrong flag for the dev server' });
    ran('B', 'b');
    await note({ what: 'wrong flag for the dev server again' });
    expect(retroSessions()).toHaveLength(0);
    ran('C', 'c');
    await settle();
    const s = retroSessions()[0]! as FakeSession;
    expect(s.spec).toMatchObject({ readOnly: true, cwd: main });
    expect(s.spec.model).toBeUndefined();
    expect(s.inbox[0]).toContain('K1 "A":\n- wrong flag for the dev server');
    expect(s.inbox[0]).toContain('K2 "B":');
    expect(board.setting('work_retro_cards:home')).toBe('0');

    expect(s.call('card', { title: 'Skript für den Dev-Server', body: 'Baue es.', basis: 'Nur A.', cards: ['K1'] })).toContain('at least two cards');
    expect(s.call('card', { title: 'Skript `scripts/dev.ts` für den Dev-Server', body: 'Ein Skript, das den Server startet.', basis: 'Auf “A” und “B” falsche Flags.', cards: ['K1', 'K2', 'K7'] })).toBe('Proposed.');
    expect(s.call('rule', { rule: 'Der Dev-Server startet mit -p <port>.', basis: 'Auf “A” und “B” falsche Flags.', cards: ['K1', 'K2'] })).toBe('Proposed.');
    s.call('card', { title: 'Noch eins', body: '…', basis: '…', cards: ['K1', 'K2'] });
    expect(s.call('card', { title: 'Zu viel', body: '…', basis: '…', cards: ['K1', 'K2'] })).toContain('At most 3');
    s.emit({ type: 'idle' });

    const card = board.snapshot().items.find((i) => i.title === 'Skript `scripts/dev.ts` für den Dev-Server')!;
    expect(card).toMatchObject({ state: 'proposal', retro: 'Auf “A” und “B” falsche Flags.', repo: 'home' });
    expect(card.from).toBeUndefined();
    expect(card.body).toContain('Ein Skript, das den Server startet.');
    expect(board.events(card.id).at(-1)!.text).toContain(`Cards: “A”, “B”.`);
    expect(board.preferences('proposed')).toMatchObject([{ text: 'Der Dev-Server startet mit -p <port>.', target: 'home', review: true }]);
  });

  test('the next retrospective reads only the newer notes, and hears of proposals dismissed before', async () => {
    files = { a: SAMPLE, b: SAMPLE, c: SAMPLE };
    ran('A', 'a');
    await note({ what: 'old friction' });
    retro.now('home');
    await settle();
    const first = retroSessions()[0]! as FakeSession;
    first.call('card', { title: 'Skill für Demos', body: '…', basis: 'Demos scheitern.', cards: ['K1', 'K1'] });
    first.emit({ type: 'idle' });
    await settle();
    // a proposal needs two different cards
    expect(board.snapshot().items.filter((i) => i.retro)).toHaveLength(0);
    const p = board.proposeRetro('home', { title: 'Skill für Demos', body: '…', basis: 'Demos scheitern auf A und B.' });
    board.remove(p.id);
    const q = board.proposeRetro('home', { title: 'Skript für Starts', body: '…', basis: 'Starts dauern.' });
    board.accept(q.id);

    ran('B', 'b');
    await note({ what: 'new friction' });
    retro.now('home');
    await settle();
    const second = retroSessions()[1]!;
    expect(second.inbox[0]).toContain('new friction');
    expect(second.inbox[0]).not.toContain('old friction');
    expect(second.inbox[0]).toContain('dismissed (do not propose them again, in other words either):\n- card "Skill für Demos" (Demos scheitern auf A und B.)');
    expect(second.inbox[0]).toContain('- card "Skript für Starts" (taken)');
  });

  test('workers who each worked out how to run the app: the retrospective proposes the recipe for “So läuft die App”', async () => {
    const now = { checks: ['bun test'], setup: '', softPaths: ['docs/'], run: '' };
    retro = new WorkRetro({ board, runtime, pathFor: () => main, transcript: (id) => files[id] ?? null, every: 2, ramp: [], settingsFor: () => now });
    board.showSettings(() => now);
    files = { a: SAMPLE, b: SAMPLE };
    const a = ran('Login-Seite', 'a');
    await settle();
    // the notes see what the repository's settings say, so a recipe worked out shows as friction with its value
    expect(noteSessions()[0]!.inbox[0]).toContain('- run ("How to run the app": the recipe every worker reads, in prose: how to start the app, what to do after which kind of change, where it gives its address, the login and test data for a demo): (empty)');
    await note({ what: 'searched how to start the app', fix: 'set run: bun run dev -p 4500' });
    const b = ran('Warenkorb', 'b');
    await note({ what: 'tried three ways to start the app', fix: 'set run: bun run dev -p 4500, log in as demo' });
    await settle();
    const s = retroSessions()[0]! as FakeSession;
    expect(s.inbox[0]).toContain("The repository's settings in Seismic now");
    expect(s.inbox[0]).toContain('- checks (the commands a worker runs before it hands its work over): "bun test"');
    expect(s.inbox[0]).toContain('- run ("How to run the app": the recipe every worker reads, in prose: how to start the app, what to do after which kind of change, where it gives its address, the login and test data for a demo): (empty)');

    expect(s.call('setting', { field: 'run', value: 'bun run dev -p 4500', basis: 'Nur einer.', cards: ['K1'] })).toContain('at least two cards');
    expect(s.call('setting', { field: 'run', value: '  ', basis: '…', cards: ['K1', 'K2'] })).toContain('value is missing');
    const recipe = 'bun run dev -p 4500\nAnmelden als demo@example.com';
    expect(s.call('setting', { field: 'run', value: recipe, basis: 'Auf “Login-Seite” und “Warenkorb” suchten die Agenten, wie die App startet.', cards: ['K1', 'K2'] })).toBe('Proposed.');
    expect(s.call('setting', { field: 'run', value: 'anders', basis: '…', cards: ['K1', 'K2'] })).toContain('already waits');
    expect(s.call('setting', { field: 'checks', value: 'bun test\nbun run typecheck\n', basis: '…', cards: ['K1', 'K2'] })).toBe('Proposed.');
    s.emit({ type: 'idle' });

    expect(board.snapshot().settingProposals).toEqual([
      {
        id: expect.any(Number),
        repo: 'home',
        field: 'run',
        value: recipe,
        basis: 'Auf “Login-Seite” und “Warenkorb” suchten die Agenten, wie die App startet.',
        cards: [
          { id: a.id, title: 'Login-Seite' },
          { id: b.id, title: 'Warenkorb' },
        ],
        now: '',
      },
      expect.objectContaining({ field: 'checks', value: ['bun test', 'bun run typecheck'], now: ['bun test'] }),
    ]);
    // no card on the project: it waits with Seismic beside the rules
    expect(board.snapshot().items.filter((i) => i.state === 'proposal')).toHaveLength(0);

    // the next retrospective hears what became of them
    const [run, checks] = board.snapshot().settingProposals!;
    board.decideSetting(run!.id, 'rejected');
    board.decideSetting(checks!.id, 'repository');
    ran('Suche', 'a');
    await note({ what: 'again' });
    retro.now('home');
    await settle();
    const next = retroSessions()[1]!;
    expect(next.inbox[0]).toContain(`- setting run = ${JSON.stringify(recipe)} (Auf “Login-Seite” und “Warenkorb” suchten die Agenten, wie die App startet.)`);
    expect(next.inbox[0]).toContain('- setting checks = ["bun test","bun run typecheck"] (taken)');
  });

  test('a new repository’s first retrospectives come after its first finished card, 2 more and 4 more, then at the usual beat', async () => {
    retro = new WorkRetro({ board, runtime, pathFor: () => main, transcript: () => null, every: 3 });
    const runs: number[] = [];
    for (let i = 1; i <= 13; i++) {
      ran(`Karte ${i}`, `s${i}`);
      await retro.idle();
      if (board.setting('work_retro_runs:home') !== String(runs.length)) runs.push(i);
    }
    expect(runs).toEqual([1, 3, 7, 10, 13]);
    // the owner's own retrospective counts as one, and the count starts again
    retro.now('home');
    await retro.idle();
    expect([board.setting('work_retro_runs:home'), board.setting('work_retro_cards:home')]).toEqual(['6', '0']);
  });

  test('asked for with nothing noted, the owner hears so', async () => {
    const notices: string[] = [];
    board.onNotice((n) => notices.push(n.text));
    board.setSetting('work_retro_cards:home', '2');
    retro.now('home');
    await retro.idle();
    expect(retroSessions()).toHaveLength(0);
    expect(notices).toEqual(['Work retrospective for Home: no friction to read since the last one.']);
    expect(board.setting('work_retro_cards:home')).toBe('0');
  });

  test('a card started again from scratch keeps its earlier run, and its work ending reads both', async () => {
    files = { s1: SAMPLE, s2: SAMPLE };
    const c = board.create({ title: 'Neu gestartet', x: 0, y: 0 });
    await workers.start(c.id);
    runtime.last.emit({ type: 'session', id: 's1' });
    await workers.stop(c.id);
    await workers.start(c.id);
    expect(board.events(c.id).some((e) => e.text.includes('(session s1) is kept for the work retrospective'))).toBe(true);
    const worker = runtime.last;
    worker.emit({ type: 'session', id: 's2' });
    await worker.call('ready_for_review', { summary: 'Fertig.', demo: artifact() });
    worker.emit({ type: 'idle' });
    // approved without a change: nothing lands, and the card is done once its worker's turn ends
    await workers.approve(c.id);
    worker.emit({ type: 'idle' });
    await settle();
    const s = noteSessions()[0]!;
    expect(s.inbox[0]).toContain("The excerpt of its worker's 2 runs");
    expect(s.inbox[0]).toContain('Run 1 of 2');
  });
});
