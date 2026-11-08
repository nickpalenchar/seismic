import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from './project';
import type { StoredShare } from './board';
import { Store } from './store';
import { FakeRuntime, gitRepo, heard, noForge } from './testing';

// A project the size of a long-used one: hundreds of archived cards, a few hundred of them with a
// shared page, a hundred on the project, ideas with hundreds of prototypes. Many cards landing one
// after the other change it dozens of times in a row, and sharing a demo looks up every shared card;
// the server answers nothing while that runs.

let dir: string;
let project: ProjectRuntime;
let store: Store;
let onProject: string[];
let archived: string[];
let ideas: string[];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-board-size-'));
  const repo = gitRepo(join(dir, 'app'), { 'docs/plan/plan.md': '# App\n\n## Goal\n\nG.\n\n## Workstreams\n\n- [ ] **W1:** One.\n- [ ] **W2:** Two.\n' });
  store = new Store(join(dir, 'obeya.db'));
  project = new ProjectRuntime({ name: 'App', repos: [{ path: repo, clones: 2 }] }, { store, home: dir, runtime: new FakeRuntime(), forge: noForge });
  const c = project.board.project.id;
  const body = 'What the card asks for, in a few sentences, as the owner wrote it. '.repeat(6);
  const rows = store.addCards(Array.from({ length: 900 }, (_, n) => ({ project_id: c, kind: 'task' as const, state: 'live' as const, title: `Card ${n}`, body, x: (n % 30) * 400, y: Math.floor(n / 30) * 300 })));
  rows.forEach((r, n) => {
    const demo = join(dir, 'demos', r.id);
    mkdirSync(demo, { recursive: true });
    writeFileSync(join(demo, 'demo.mp4'), 'video');
    if (n % 2) writeFileSync(join(demo, 'poster.jpg'), 'poster');
    const shown = { kind: 'video' as const, chapters: [[0, 'Before'], [20, 'After']] as [number, string][], page: { title: `Card ${n}`, text: body } };
    store.updateCard(r.id, {
      demo: {
        latest: { dir: demo, ...shown },
        // a page published before the newest page changes: the Koordinator's sheet offers to share it again
        ...(n % 3 === 0 ? { share: { slug: `card-${n}`, url: `https://demos.example/card-${n}`, demos: [{ dir: demo, shown }], version: '' } as unknown as StoredShare } : {}),
      },
      ...(n < 800 ? { archived_at: new Date(Date.now() - n * 60_000).toISOString() } : {}),
    });
  });
  archived = rows.slice(0, 800).map((r) => r.id);
  onProject = rows.slice(800).map((r) => r.id);
  // ideas tried out in prototypes, most of them in the archive by now with their prototypes, many of those shared
  const idea = store.addCards(Array.from({ length: 80 }, (_, n) => ({ project_id: c, kind: 'task' as const, state: 'idea' as const, title: `Idea ${n}`, body, x: n * 400, y: 9000 })));
  ideas = idea.map((r) => r.id);
  const prototypes = store.addCards(idea.flatMap((r, n) => Array.from({ length: 4 }, (_, v) => ({ project_id: c, kind: 'task' as const, state: 'live' as const, title: `Idea ${n}, variant ${v}`, body, x: n * 400 + v * 100, y: 9300, from_id: r.id, idea: { prototypeOf: r.id } }))));
  prototypes.forEach((r, n) => {
    const demo = join(dir, 'demos', r.id);
    mkdirSync(demo, { recursive: true });
    writeFileSync(join(demo, 'demo.mp4'), 'video');
    const shown = { kind: 'video' as const, chapters: [[0, 'Variant']] as [number, string][], page: { title: r.title ?? '', text: body } };
    store.updateCard(r.id, {
      demo: {
        latest: { dir: demo, ...shown },
        ...(n % 2 === 0 ? { share: { slug: `prototype-${n}`, url: `https://demos.example/prototype-${n}`, demos: [{ dir: demo, shown }], version: '' } as unknown as StoredShare } : {}),
      },
      ...(n < 280 ? { archived_at: new Date(Date.now() - n * 60_000).toISOString() } : {}),
    });
  });
  idea.slice(0, 70).forEach((r, n) => store.cards.update(r.id, { archived_at: new Date(Date.now() - n * 60_000).toISOString() }));
  // the server sends each change to the pages that show the project
  project.board.onChange(() => JSON.stringify(project.board.snapshot()));
  project.board.changed();
});

afterAll(() => {
  project.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

test('a project with hundreds of archived and shared cards: a run of changes holds the server up for far less than half a second', async () => {
  await heard();
  const board = project.board;
  // the time the server's process computes, not the time on the clock: beside other test files
  // (`bun test --parallel`) on a runner with few cores, it also waits for a core, which says
  // nothing about the code (a run that takes under 100 ms on a laptop took 700 ms on the clock in CI)
  let longest = 0;
  for (let round = 0; round < 3; round++) {
    const start = process.cpuUsage();
    // a landing: each card moves on, says so, and is read back between the writes, as the workers do
    for (const id of onProject.slice(round * 30, round * 30 + 30)) {
      board.work(id, { status_line: `Landing ${round}` });
      board.item(id);
      board.log(id, 'state', 'obeya', 'Landed on main.');
      board.item(id);
      board.work(id, { landed: JSON.stringify({}) });
      // its page is looked up among the archived ones
      board.card(archived[(round * 30 + onProject.indexOf(id)) % archived.length]!);
    }
    // what listens to the board hears of it once the run is through
    await heard();
    const used = process.cpuUsage(start);
    longest = Math.max(longest, (used.user + used.system) / 1000);
  }
  expect(longest).toBeLessThan(500);
});

test('sharing looks up every shared card, archived ones with their prototypes, after a change without holding the server up', async () => {
  await heard();
  const board = project.board;
  const shared = board.sharedRows().map((r) => r.id);
  expect(shared.length).toBeGreaterThan(400);
  let longest = 0;
  for (let round = 0; round < 3; round++) {
    const start = process.cpuUsage();
    // a landing shares its demo: the board changed, and the pass over the shared pages looks up each card
    board.work(onProject[round]!, { status_line: `Sharing ${round}` });
    expect(shared.filter((id) => board.card(id)).length).toBe(shared.length);
    await heard();
    const used = process.cpuUsage(start);
    longest = Math.max(longest, (used.user + used.system) / 1000);
  }
  expect(longest).toBeLessThan(500);
});

test('an archived card looked up on its own is the card the archive lists, with its prototypes', () => {
  const board = project.board;
  board.changed();
  const idea = ideas[3]!;
  const prototype = store.ideas.prototypes(board.project.id).find((r) => r.prototype_of === idea)!.id;
  const alone = [board.card(idea), board.card(prototype)];
  expect(alone[0]!.idea!.prototypes!.map((p) => p.title)).toEqual([0, 1, 2, 3].map((v) => `Idea 3, variant ${v}`));
  expect(alone[1]!.idea?.ideaTitle).toBe('Idea 3');
  const archive = board.archived();
  expect(alone).toEqual([archive.find((i) => i.id === idea), archive.find((i) => i.id === prototype)]);
});
