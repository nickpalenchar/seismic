import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Notice } from '../core/types';
import type { BadRequest } from './board';
import { Projects } from './project';
import { Config } from './config';
import { Store } from './store';
import { FakeRuntime, gitRepo, noForge, until } from './testing';
import { git } from './workstations';

let dir: string;
let globalConfig: string | undefined;
let store: Store;
let runtime: FakeRuntime;
let set: Projects;
let config: Config;
let notices: Notice[];

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-new-repo-'));
  // git's name and e-mail, which the first commit of a new repository is made under
  globalConfig = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = join(dir, 'gitconfig');
  writeFileSync(join(dir, 'gitconfig'), '[user]\n\tname = Ada Lovelace\n\temail = ada@example.com\n');
  const docs = gitRepo(join(dir, 'docs'));
  const configs = [{ name: 'Docs', repos: [{ path: docs }] }];
  writeFileSync(join(dir, 'projects.json'), JSON.stringify(configs));
  store = new Store(':memory:');
  runtime = new FakeRuntime();
  config = new Config({
    file: join(dir, 'projects.json'),
    source: 'file',
    started: configs,
    store,
    running: () => set.all().map((c) => c.id),
    server: { port: 4417, home: dir, permissionMode: 'auto' },
    apply: (configs, ids) => set.apply(configs, ids),
  });
  set = new Projects(configs, { store, home: join(dir, 'home'), runtime, forge: noForge, config, newRepoHoldMs: 30, restartIntervalMs: 5 });
  notices = [];
  docsProject().board.onNotice((n) => notices.push(n));
});
afterEach(() => {
  set.shutdown();
  if (globalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = globalConfig;
  rmSync(dir, { recursive: true, force: true });
});

const docsProject = () => set.get('docs')!;
const refused = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as BadRequest).code;
  }
};

/** An idea on the Docs project, discussed, with a screenshot, a decision and its agent's pick of a new repository at `path`. */
function idea(path: string, project = true) {
  const c = docsProject();
  const shot = c.images.save(PNG, 'image/png');
  const card = c.board.create({ idea: true, title: 'Class schedule', x: 0, y: 0, images: [shot] });
  c.board.setIdea(card.id, { brief: '**Goal** A schedule for the class.' });
  c.board.log(card.id, 'talk', 'owner', 'A separate repo for it, please.');
  c.board.decide({ plan_id: null, card_id: card.id, question: 'Where?', answer: 'A repository of its own.', by: 'owner' });
  c.board.setNewRepo(card.id, { path, project, by: 'agent' }, 'agent');
  return card;
}

describe('building an idea in a new repository', () => {
  test('after the undo window, Seismic creates the repository and a project named after it, and the idea moves there with everything and starts', async () => {
    const path = join(dir, 'dev', 'super59');
    const card = idea(path);
    const follower = docsProject().board.create({ title: 'Invite the parents', x: 600, y: 0, from: card.id });
    docsProject().board.createGroup('School', [card.id, follower.id]);
    docsProject().act(card.id, { action: 'build' });
    // held for the owner to take it back: nothing made yet
    expect(docsProject().board.item(card.id)!.idea?.newRepo).toMatchObject({ path, project: true, due: expect.any(String) });
    expect(existsSync(path)).toBe(false);
    await until(() => set.get('super59'));
    const there = set.get('super59')!;
    // a local repository with its first commit, under git's name, and no remote
    expect(git(path, 'log', '--format=%an %s')).toBe('Ada Lovelace First commit');
    expect(existsSync(join(path, '.gitignore'))).toBe(true);
    expect(git(path, 'remote')).toBe('');
    expect(JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')).at(-1)).toEqual({ planBaselines: true, archive: 'manual', rightClick: 'groups', suggest: { category: true, complexity: true, priority: true }, codeReviews: { on: false, mode: 'auto' }, repos: [{ path }] });
    expect(there.board.project.name).toBe('super59');
    // the card is there, decided as „So bauen“ decides it, with its conversation, decisions and screenshot, out of its group
    await until(() => there.board.item(card.id)?.queue || there.board.item(card.id)?.state === 'working');
    const moved = there.board.item(card.id)!;
    expect(moved.body).toBe('**Goal** A schedule for the class.');
    expect(moved.repo).toBe('super59');
    expect(moved.group).toBeUndefined();
    expect(moved.idea?.newRepo).toBeUndefined();
    expect(there.board.events(card.id).map((e) => e.text)).toEqual(
      expect.arrayContaining(['A separate repo for it, please.', expect.stringContaining('Docs'), expect.stringContaining('Build it')]),
    );
    expect(there.board.decisions(null).map((d) => d.answer)).toEqual(expect.arrayContaining(['A repository of its own.', expect.stringContaining(path)]));
    expect(there.images.path(moved.images![0]!)).toBeTruthy();
    // nothing of it stays on Docs: its sheet says where it went, and a page that has it open follows it
    expect(docsProject().board.item(card.id)).toBeUndefined();
    expect(docsProject().board.snapshot().talk.at(-1)).toMatchObject({ moved: { card: card.id, title: 'Class schedule', project: 'super59', projectName: 'super59' } });
    expect(notices).toContainEqual(expect.objectContaining({ cardId: card.id, movedTo: 'super59' }));
    // the card that stayed still names it, on the other project
    expect(docsProject().board.item(follower.id)).toMatchObject({ from: card.id, fromElsewhere: { project: 'super59', projectName: 'super59', title: 'Class schedule' } });
    expect(docsProject().board.snapshot().groups.map((g) => g.name)).toEqual(['School']);
  });

  test('its worker hears that the repository is new, and sets it up', async () => {
    const path = join(dir, 'super59');
    const card = idea(path);
    docsProject().act(card.id, { action: 'build' });
    await until(() => runtime.sessions.some((s) => s.spec.role === 'worker' && s.inbox[0]?.includes('Class schedule')), 10_000);
    const brief = runtime.sessions.find((s) => s.spec.role === 'worker')!.inbox[0]!;
    expect(brief).toContain('This repository is new');
    expect(brief).toContain('obeya:settings');
    expect(brief).toContain('CLAUDE.md');
    expect(brief).toContain('The agent harnesses that can work on this machine, for the allow list the skill `obeya:settings` drafts: Claude Code');
  });

  test('„Rückgängig“ in the undo window leaves everything as it was', async () => {
    const path = join(dir, 'super59');
    const card = idea(path);
    docsProject().act(card.id, { action: 'build' });
    docsProject().act(card.id, { action: 'stayHere' });
    await new Promise((r) => setTimeout(r, 80));
    expect(existsSync(path)).toBe(false);
    expect(set.all().map((c) => c.id)).toEqual(['docs']);
    const now = docsProject().board.item(card.id)!;
    expect(now.state).toBe('idea');
    expect(now.idea?.newRepo).toEqual({ path, project: true, by: 'agent' });
    expect(refused(() => docsProject().act(card.id, { action: 'stayHere' }))).toBe('newRepoGone');
  });

  test('a step that fails takes back those before it, and the card says why', async () => {
    // a repository named like the project it would leave: its project would have the same id
    const path = join(dir, 'elsewhere', 'docs');
    const card = idea(path);
    docsProject().act(card.id, { action: 'build' });
    await until(() => docsProject().board.events(card.id).some((e) => e.kind === 'error'));
    expect(existsSync(join(dir, 'elsewhere'))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8'))).toHaveLength(1);
    const now = docsProject().board.item(card.id)!;
    expect(now.state).toBe('idea');
    expect(now.idea?.newRepo?.due).toBeUndefined();
    expect(docsProject().board.events(card.id).at(-1)!.text).toContain('Repository not created');
  });

  test('without a project of its own, the repository joins this project and the card works in it', async () => {
    const path = join(dir, 'super59');
    const task = docsProject().board.create({ title: 'Schedule', body: 'Build it.', x: 0, y: 0 });
    docsProject().board.patch(task.id, { newRepo: { path, project: false } });
    docsProject().act(task.id, { action: 'start' });
    await until(() => docsProject().board.item(task.id)?.repo === 'super59');
    expect(docsProject().board.project.repos.map((r) => r.id)).toEqual(['docs', 'super59']);
    expect(set.all().map((c) => c.id)).toEqual(['docs']);
    await until(() => docsProject().board.item(task.id)!.state !== 'planned' || docsProject().board.item(task.id)!.queue);
  });

  test('a folder that is a repository already is taken as it is; one inside another repository is refused', async () => {
    const path = gitRepo(join(dir, 'existing'));
    const head = git(path, 'rev-parse', 'HEAD');
    const card = idea(path);
    docsProject().act(card.id, { action: 'build' });
    await until(() => set.get('existing'));
    expect(git(path, 'rev-parse', 'HEAD')).toBe(head);
    const inside = idea(join(dir, 'docs', 'sub'));
    docsProject().act(inside.id, { action: 'build' });
    await until(() => docsProject().board.events(inside.id).some((e) => e.kind === 'error'));
    expect(docsProject().board.events(inside.id).at(-1)!.text).toContain('lies inside the repository');
    expect(existsSync(join(dir, 'docs', 'sub'))).toBe(false);
  });

  test('a folder that is a repository of a project already is refused at once', () => {
    const card = idea(join(dir, 'docs'));
    expect(refused(() => docsProject().act(card.id, { action: 'build' }))).toBe('newRepoPath');
  });

  test('in the undo window the card takes no other way on, and its agent does not change the target', () => {
    const card = idea(join(dir, 'super59'));
    docsProject().act(card.id, { action: 'build' });
    expect(refused(() => docsProject().act(card.id, { action: 'planDoc' }))).toBe('newRepoDue');
    expect(docsProject().board.setNewRepo(card.id, { path: join(dir, 'other'), project: true, by: 'agent' }, 'agent')).toBe(false);
    expect(docsProject().board.item(card.id)!.idea?.newRepo?.due).toBeTruthy();
    docsProject().act(card.id, { action: 'stayHere' });
  });

  test('a failed step removes only the folders Seismic created, not what came beside them', async () => {
    mkdirSync(join(dir, 'parent'));
    const sibling = join(dir, 'parent', 'beta');
    mkdirSync(sibling);
    // named like the project it would leave: the configuration refuses it
    const card = idea(join(dir, 'parent', 'new', 'docs'));
    docsProject().act(card.id, { action: 'build' });
    await until(() => docsProject().board.events(card.id).some((e) => e.kind === 'error'));
    expect(existsSync(join(dir, 'parent', 'new'))).toBe(false);
    expect(existsSync(sibling)).toBe(true);
  });

  test('a link to a repository of a project counts as that repository; a path neither absolute nor from ~ is refused', () => {
    symlinkSync(join(dir, 'docs'), join(dir, 'link'));
    expect(refused(() => docsProject().act(idea(join(dir, 'link')).id, { action: 'build' }))).toBe('newRepoPath');
    expect(refused(() => docsProject().act(idea('~someone/project').id, { action: 'build' }))).toBe('newRepoPath');
  });

  test('a task snoozed to start later makes its new repository when it starts', async () => {
    const path = join(dir, 'later');
    const task = docsProject().board.create({ title: 'Later', body: 'Later.', x: 0, y: 0 });
    docsProject().board.patch(task.id, { newRepo: { path, project: true } });
    docsProject().act(task.id, { action: 'snooze', until: new Date(Date.now() + 60_000).toISOString() });
    docsProject().act(task.id, { action: 'wake' });
    await until(() => set.get('later')?.board.item(task.id));
  });

  test("what the owner picked on the card, the idea's agent does not change; the owner's pick of an existing repository takes the new one off", () => {
    const c = docsProject();
    const card = c.board.create({ idea: true, title: 'X', x: 0, y: 0 });
    expect(c.board.setNewRepo(card.id, { path: '~/dev/a', project: true, by: 'agent' }, 'agent')).toBe(true);
    c.board.patch(card.id, { newRepo: { path: '~/dev/b', project: false } });
    expect(c.board.setNewRepo(card.id, { path: '~/dev/c', project: true, by: 'agent' }, 'agent')).toBe(false);
    expect(c.board.item(card.id)!.idea?.newRepo).toEqual({ path: '~/dev/b', project: false, by: 'owner' });
    c.board.patch(card.id, { repo: 'docs' });
    expect(c.board.item(card.id)!.idea?.newRepo).toBeUndefined();
    // and stands too
    expect(c.board.setNewRepo(card.id, { path: '~/dev/d', project: true, by: 'agent' }, 'agent')).toBe(false);
  });
});

describe('the Koordinator across projects', () => {
  test('a new card goes onto another project the owner names, and starts there; a follow-up names its card on this one', async () => {
    const other = gitRepo(join(dir, 'shop'));
    await config.save([...config.current(), { name: 'Shop', repos: [{ path: other }] }]);
    const shop = set.get('shop')!;
    const docs = docsProject();
    const shot = docs.images.save(PNG, 'image/png');
    const id = docs.run({ do: 'newCard', title: 'Checkout', body: 'Build the checkout.', start: true, project: 'shop', images: [shot] }) as string;
    expect(docs.board.item(id)).toBeUndefined();
    expect(shop.board.item(id)).toMatchObject({ title: 'Checkout', repo: 'shop' });
    expect(shop.images.path(shot)).toBeTruthy();
    await until(() => shop.board.item(id)!.queue || shop.board.item(id)!.state === 'working');
    const from = docs.board.create({ title: 'Plan the shop', x: 0, y: 0 });
    const follow = docs.run({ do: 'newCard', title: 'Payment', body: 'Payment.', start: false, project: 'shop', from: from.id }) as string;
    expect(shop.board.item(follow)).toMatchObject({ from: from.id, fromElsewhere: { project: 'docs', projectName: 'Docs', title: 'Plan the shop' } });
    // the card it follows up on shows it in its conversation, with the project it went onto
    expect(docs.board.events(from.id).at(-1)).toMatchObject({ kind: 'state', author: 'obeya', made: { card: follow, title: 'Payment', project: 'shop' } });
  });
});
