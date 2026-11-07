import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Board } from './board';
import { Store } from './db';
import { gitRepo, identify } from './testing';
import { git, gitOrNull, projectBaselineTag, Workspaces } from './workspaces';

let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'obeya-baseline-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));


describe('project git baselines', () => {
  for (const mode of ['worktrees', 'clones'] as const) {
    test(`${mode}: concurrent workstreams share a fixed tag through landings and restarts`, async () => {
      const repo = gitRepo(join(dir, 'repo'));
      const store = new Store(':memory:');
      const board = new Board(store, { id: 'c', name: 'C', repos: [{ id: 'home', name: 'Home', path: repo, branch: 'main' }] }, () => ({ docs: [], dirs: [] }));
      const ids = ['A', 'B', 'C'].map((title) => board.create({ title, x: 0, y: 0 }).id);
      const options = { mode, repoPath: repo, dir: join(dir, 'ws'), projectOf: () => 'project-1' };
      let spaces = new Workspaces(store, 'c', options);
      if (mode === 'clones') spaces.ensureClones(repo, 3);
      const original = git(repo, 'rev-parse', 'main');
      const tag = projectBaselineTag('project-1');
      const leases = ids.slice(0, 2).map((id, n) => spaces.lease(id, `obeya/w${n}`));
      await Promise.all(leases.map((l) => l.ready));
      for (const [n, lease] of leases.entries()) {
        expect(git(lease.path, 'rev-parse', `refs/tags/${tag}`)).toBe(original);
        expect(git(lease.path, 'config', '--get', `branch.obeya/w${n}.obeya-project-baseline`)).toBe(tag);
      }
      git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'Other work landed');
      spaces = new Workspaces(store, 'c', options);
      const next = spaces.lease(ids[2]!, 'obeya/later');
      await next.ready;
      expect(git(next.path, 'rev-parse', 'HEAD')).toBe(git(repo, 'rev-parse', 'main'));
      expect(git(next.path, 'rev-parse', `refs/tags/${tag}`)).toBe(original);
      expect(git(next.path, 'config', '--get', 'branch.obeya/later.obeya-project-baseline')).toBe(tag);
    });
  }

  test('disabled starts create no tag; enabling on an existing workspace configures it without moving its branch', async () => {
    const repo = gitRepo(join(dir, 'repo'));
    const store = new Store(':memory:');
    const board = new Board(store, { id: 'c', name: 'C', repos: [{ id: 'home', name: 'Home', path: repo, branch: 'main' }] }, () => ({ docs: [], dirs: [] }));
    const id = board.create({ title: 'A', x: 0, y: 0 }).id;
    let enabled = false;
    const spaces = new Workspaces(store, 'c', { mode: 'worktrees', repoPath: repo, dir: join(dir, 'ws'), projectOf: () => enabled ? 'p' : undefined });
    const first = spaces.lease(id, 'obeya/a');
    await first.ready;
    expect(git(repo, 'tag', '--list')).toBe('');
    git(first.path, 'commit', '--quiet', '--allow-empty', '-m', 'Earlier work');
    const head = git(first.path, 'rev-parse', 'HEAD');
    enabled = true;
    await spaces.lease(id, 'obeya/a').ready;
    expect(git(first.path, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(repo, 'rev-parse', `refs/tags/${projectBaselineTag('p')}`)).toBe(git(repo, 'rev-parse', 'main'));
    enabled = false;
    await spaces.lease(id, 'obeya/a').ready;
    expect(git(first.path, 'config', '--get', 'branch.obeya/a.obeya-project-baseline')).toBe(projectBaselineTag('p'));
  });

  test('a conflicting clone tag refuses preparation and releases the lease', async () => {
    const repo = gitRepo(join(dir, 'repo'));
    const store = new Store(':memory:');
    const board = new Board(store, { id: 'c', name: 'C', repos: [{ id: 'home', name: 'Home', path: repo, branch: 'main' }] }, () => ({ docs: [], dirs: [] }));
    const id = board.create({ title: 'A', x: 0, y: 0 }).id;
    const tag = projectBaselineTag('p');
    git(repo, 'tag', tag);
    const spaces = new Workspaces(store, 'c', { mode: 'clones', repoPath: repo, dir: join(dir, 'ws'), projectOf: () => 'p' });
    const [clone] = spaces.ensureClones(repo, 1);
    identify(clone!);
    git(clone!, 'commit', '--quiet', '--allow-empty', '-m', 'Other commit');
    git(clone!, 'tag', '-f', tag);
    await expect(spaces.lease(id, 'obeya/a').ready!).rejects.toThrow('differs');
    expect(spaces.leasedBy(id)).toBeNull();
    expect(gitOrNull(clone!, 'config', '--get', 'branch.obeya/a.obeya-project-baseline')).toBeNull();
  });
});
