// The names stored in other places (repositories, git, browsers) from before the rename keep working beside the new ones.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readShared } from '../adapters';
import { OLD_KEY_HEADER, KEY_HEADER, Owner } from './owner';
import { commitShared } from './shared-settings';
import { gitRepo, identify } from './testing';
import { readTheme } from './theme';
import { branchName, CARD_BRANCH, detectedBranch, git, isCardBranch, OLD_CARD_BRANCH, oldPlanBaselineTag, planBaselineTag } from './workstations';

const root = mkdtempSync(join(tmpdir(), 'seismic-stored-names-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const repo = (files: Record<string, string>) => {
  const r = gitRepo(join(root, `r${n++}`), { 'README.md': 'hi\n', ...files });
  identify(r);
  return r;
};

describe('.seismic/ in repositories', () => {
  test('is read first, then .obeya/; the theme comes from the folder that is read', () => {
    const settings = (land: string) => `{ "land": "${land}" }\n`;
    expect(readShared(repo({ '.seismic/settings.json': settings('pr') })).settings).toEqual({ land: 'pr' });
    expect(readShared(repo({ '.obeya/settings.json': settings('main') })).settings).toEqual({ land: 'main' });
    const both = repo({ '.obeya/settings.json': settings('main'), '.obeya/theme.css': ':root{--a:1}', '.seismic/settings.json': settings('pr'), '.seismic/theme.css': ':root{--a:2}' });
    expect(readShared(both).settings).toEqual({ land: 'pr' });
    expect(readTheme(both, readShared(both).seismicTree)!.css).toContain('--a:2');
    const old = repo({ '.obeya/theme.css': ':root{--a:3}' });
    expect(readTheme(old, readShared(old).seismicTree)!.css).toContain('--a:3');
  });

  test('Seismic writes its settings to the folder the repository has, and to .seismic/ where it has neither', async () => {
    const where = async (files: Record<string, string>) => {
      const r = repo(files);
      await commitShared(r, { land: 'pr' });
      return git(r, 'ls-tree', '-r', '--name-only', 'HEAD', '--', '.seismic', '.obeya').split('\n').filter(Boolean);
    };
    expect(await where({})).toEqual(['.seismic/settings.json']);
    expect(await where({ '.obeya/settings.json': '{ "checks": ["x"] }\n' })).toEqual(['.obeya/settings.json']);
    expect(await where({ '.seismic/settings.json': '{}\n', '.obeya/settings.json': '{}\n' })).toEqual(['.obeya/settings.json', '.seismic/settings.json']);
    const kept = repo({ '.obeya/settings.json': '{ "checks": ["x"] }\n' });
    await commitShared(kept, { land: 'pr' });
    expect(readShared(kept).settings).toEqual({ land: 'pr', checks: ['x'] });
  });
});

describe('seismic/ branches and tags', () => {
  test('new cards branch as seismic/…, and both prefixes are card branches', () => {
    expect(branchName('Export readings', 'abcdef123')).toBe('seismic/export-readings-abcdef');
    expect(CARD_BRANCH).toBe('seismic/');
    expect(isCardBranch('seismic/x-1')).toBe(true);
    expect(isCardBranch(`${OLD_CARD_BRANCH}x-1`)).toBe(true);
    expect(isCardBranch('main')).toBe(false);
    expect(planBaselineTag('p')).toBe('seismic/project/p/baseline');
    expect(oldPlanBaselineTag('p')).toBe('obeya/project/p/baseline');
  });

  test('the main branch is detected whichever prefix the cards in the repository have', () => {
    for (const prefix of ['seismic/', 'obeya/']) {
      const r = repo({});
      git(r, 'branch', `${prefix}card-abc123`);
      git(r, 'checkout', '--quiet', `${prefix}card-abc123`);
      expect(detectedBranch(r)).toBe('main');
    }
  });
});

describe('owner key header and cookie', () => {
  const owner = new Owner();
  const req = (headers: Record<string, string>) => new Request('http://127.0.0.1:4417/api/projects', { headers });

  test('the new header and cookie name admit, and so do the old ones', () => {
    expect(owner.admits(req({ [KEY_HEADER]: owner.key }), 4417)).toBe(true);
    expect(owner.admits(req({ [OLD_KEY_HEADER]: owner.key }), 4417)).toBe(true);
    expect(owner.admits(req({ cookie: `seismic-4417=${owner.key}` }), 4417)).toBe(true);
    expect(owner.admits(req({ cookie: `obeya-4417=${owner.key}` }), 4417)).toBe(true);
    expect(owner.admits(req({ cookie: `seismic-4418=${owner.key}` }), 4417)).toBe(false);
    expect(owner.admits(req({ [KEY_HEADER]: 'guessed', [OLD_KEY_HEADER]: owner.key }), 4417)).toBe(false);
    expect(owner.admits(req({}), 4417)).toBe(false);
  });

  test('signing in sets only the new cookie', () => {
    const res = owner.login(new Request(owner.link('http://127.0.0.1:4417')), 4417);
    const set = res.headers.get('set-cookie')!;
    expect(set).toStartWith('seismic-4417=');
    expect(set).not.toContain('obeya-');
  });
});
