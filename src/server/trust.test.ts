import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readShared } from '../adapters';
import { gitRepo } from './testing';
import { git } from './workspaces';
import { canonical, codexAsTrusted, commandsOf, heldGroups, trustTakenOver, withoutHeld } from './trust';

describe("a repository's commands", () => {
  test('are its stop and keep and its Claude Code settings; what is empty is none', () => {
    expect(commandsOf({ settings: { checks: ['bun test'], app: { run: 'bun dev', stop: 'make stop', keep: ' ' } }, claude: { '.mcp.json': { id: 'a1', text: '{}' } } })).toEqual({
      app: { stop: 'make stop' },
      claude: { '.mcp.json': { id: 'a1', text: '{}' } },
    });
    expect(commandsOf({ settings: { app: { run: 'bun dev' } } })).toEqual({});
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 }));
  });

  test("are held where they differ from what the owner trusted, unless this machine's values stand in for all of a group", () => {
    const now = { app: { stop: 'make stop' }, claude: { '.mcp.json': { id: 'a1', text: '{}' } } };
    expect(heldGroups(now, null)).toEqual(['app', 'claude']);
    expect(heldGroups(now, { ...now, app: { stop: 'other' } })).toEqual(['app']);
    expect(heldGroups(now, now)).toEqual([]);
    expect(heldGroups(now, null, { app: { stop: 'x', keep: 'y' } })).toEqual(['claude']);
    // a stop of this machine's alone leaves the repository's keep held
    expect(heldGroups(now, null, { app: { stop: 'x' } })).toEqual(['app', 'claude']);
  });

  test('held, they go from the settings, the rest of their fields stays', () => {
    const s = { checks: ['bun test'], app: { run: 'bun dev', stop: 'make stop' } };
    expect(withoutHeld(s, ['app'])).toEqual({ checks: ['bun test'], app: { run: 'bun dev' } });
    expect(withoutHeld({ app: { stop: 'make stop' } }, ['app'])).toEqual({});
    expect(withoutHeld(s, ['claude'])).toEqual(s);
  });

  test("taken over from this machine's values into the file, they are the owner's own", () => {
    expect(trustTakenOver(null, { app: { stop: 'make stop', run: 'bun dev' } }, { app: { stop: 'make stop' } })).toEqual({ app: { stop: 'make stop' } });
    // a keep the owner trusted before, beside the stop of theirs
    expect(trustTakenOver({ app: { keep: 'k' } }, { app: { stop: 's', keep: 'k' } }, { app: { stop: 's' } })).toEqual({ app: { stop: 's', keep: 'k' } });
    // a trusted keep that went, beside a stop that stays, is not: the stop now stops what it kept
    expect(trustTakenOver({ app: { stop: 's', keep: 'k' } }, { app: { stop: 's' } }, undefined)).toBeNull();
    // someone else's stop that came with it is not
    expect(trustTakenOver(null, { app: { stop: 'evil' }, checks: ['x'] }, { checks: ['x'] })).toBeNull();
  });
});

describe("a workspace's Codex configuration", () => {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-codex-trust-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('is held on the default branch like the others, until the owner trusts it', () => {
    const repo = gitRepo(join(dir, 'held'), { '.codex/config.toml': 'model = "x"\n' });
    const now = commandsOf(readShared(repo));
    expect(Object.keys(now.codex!)).toEqual(['.codex/config.toml']);
    expect(heldGroups(now, null)).toEqual(['codex']);
    expect(heldGroups(now, now)).toEqual([]);
  });

  test('counts only where it is to the byte what the owner trusted, a change of its own included', () => {
    const repo = gitRepo(join(dir, 'ws'), { '.codex/config.toml': 'model = "x"\n', '.codex/rules/a.rules': 'r\n' });
    const trusted = commandsOf(readShared(repo)).codex;
    expect(codexAsTrusted(repo, trusted)).toBe(true);
    expect(codexAsTrusted(repo, undefined)).toBe(false);
    // a blank line git keeps apart, though the text read for the dialog is trimmed
    writeFileSync(join(repo, '.codex/config.toml'), 'model = "x"\n\n');
    expect(codexAsTrusted(repo, trusted)).toBe(false);
    git(repo, 'checkout', '--quiet', '--', '.codex/config.toml');
    writeFileSync(join(repo, '.codex/hooks.json'), '{}');
    expect(codexAsTrusted(repo, trusted)).toBe(false);
    unlinkSync(join(repo, '.codex/hooks.json'));
    unlinkSync(join(repo, '.codex/rules/a.rules'));
    expect(codexAsTrusted(repo, trusted)).toBe(false);
    git(repo, 'checkout', '--quiet', '--', '.codex');
    expect(codexAsTrusted(repo, trusted)).toBe(true);
  });

  test('compares by SHA-256 in a repository whose objects are named so', () => {
    const repo = join(dir, 'sha256');
    git(dir, 'init', '--quiet', '--object-format=sha256', '-b', 'main', repo);
    git(repo, 'config', 'user.email', 'a@b'); git(repo, 'config', 'user.name', 'a');
    mkdirSync(join(repo, '.codex'));
    writeFileSync(join(repo, '.codex/config.toml'), 'model = "x"\n');
    git(repo, 'add', '.codex'); git(repo, 'commit', '--quiet', '-m', 'codex');
    const trusted = commandsOf(readShared(repo)).codex;
    expect(trusted!['.codex/config.toml']!.id).toHaveLength(64);
    expect(codexAsTrusted(repo, trusted)).toBe(true);
  });

  test('never counts with a symbolic link in it, which may point where the agent writes', () => {
    const repo = gitRepo(join(dir, 'link'), { 'shared.toml': 'model = "x"\n', '.codex/rules/a.rules': 'r\n' });
    symlinkSync('../shared.toml', join(repo, '.codex/config.toml'));
    git(repo, 'add', '.codex');
    git(repo, 'commit', '--quiet', '-m', 'link');
    const trusted = commandsOf(readShared(repo)).codex;
    expect(Object.keys(trusted!)).toEqual(['.codex/config.toml', '.codex/rules/a.rules']);
    expect(codexAsTrusted(repo, trusted)).toBe(false);
  });
});
