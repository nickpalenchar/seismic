import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundledSkills, type SkillPlace, Skills, skillsOf } from './skills';

describe('bundledSkills', () => {
  test('lists the shipped skills under the plugin name; a damaged plugin lists what is there', () => {
    expect(bundledSkills().map((s) => s.name)).toContain('seismic:demo');
    const plugin = mkdtempSync(join(tmpdir(), 'seismic-plugin-'));
    try {
      expect(bundledSkills(plugin)).toEqual([]);
      mkdirSync(join(plugin, 'skills', 'empty'), { recursive: true });
      mkdirSync(join(plugin, 'skills', 'titles'), { recursive: true });
      writeFileSync(join(plugin, 'skills', 'titles', 'SKILL.md'), '---\ndescription: Names cards.\n---\n');
      expect(bundledSkills(plugin).map((s) => s.name)).toEqual(['seismic:titles']);
    } finally {
      rmSync(plugin, { recursive: true, force: true });
    }
  });
});

describe('skillsOf', () => {
  test('keeps the skills and commands of the repository, the user and plugins, and of Claude Code its skills alone, in that order', () => {
    const skills = skillsOf(
      [
        { name: 'review', description: ' Reviews the branch (project) ', argumentHint: '<branch>' },
        { name: 'compact', description: 'Compacts the conversation', argumentHint: '', builtin: true },
        { name: 'code-review', description: 'Reviews the diff', argumentHint: '', builtin: true },
        { name: 'seismic:demo', description: '(obeya) Records a demo', argumentHint: '' },
        { name: 'review', description: 'A second one of that name', argumentHint: '' },
        { name: 'changelog', description: 'Writes the changelog entry,\nfrom the commits (user)', argumentHint: '' },
      ],
      new Set(['code-review', 'review', 'seismic:demo', 'changelog']),
    );
    // the repository's first, then the user's, the plugins', Claude Code's own; descriptions on one line
    expect(skills).toEqual([
      { name: 'review', description: 'Reviews the branch (project)', hint: '<branch>' },
      { name: 'changelog', description: 'Writes the changelog entry,' },
      { name: 'seismic:demo', description: '(obeya) Records a demo' },
      { name: 'code-review', description: 'Reviews the diff' },
    ]);
  });
});

describe('Skills', () => {
  const place: SkillPlace = { cwd: '/repo', plugins: ['/plugin'], untrusted: false };
  const lister = () => {
    const asked: SkillPlace[] = [];
    let answer = [{ name: 'one', description: 'first' }];
    return {
      asked,
      set: (name: string) => (answer = [{ name, description: name }]),
      list: async (p: SkillPlace) => (asked.push(p), answer),
    };
  };

  test('asks once for a place while a list is fresh, and the same question only once at a time', async () => {
    const l = lister();
    let now = 0;
    const skills = new Skills(l.list, () => now);
    const [a, b] = await Promise.all([skills.of(place), skills.of(place)]);
    expect(a).toEqual([{ name: 'one', description: 'first' }]);
    expect(b).toEqual(a);
    expect(l.asked).toHaveLength(1);
    now = 60_000;
    await skills.of(place);
    expect(l.asked).toHaveLength(1);
    // another place is asked of its own
    await skills.of({ ...place, untrusted: true });
    expect(l.asked).toHaveLength(2);
  });

  test('an old list serves while it is asked afresh behind it', async () => {
    const l = lister();
    let now = 0;
    const skills = new Skills(l.list, () => now);
    await skills.of(place);
    l.set('two');
    now = 10 * 60_000;
    expect(await skills.of(place)).toEqual([{ name: 'one', description: 'first' }]);
    await Promise.resolve();
    expect(await skills.of(place)).toEqual([{ name: 'two', description: 'two' }]);
  });

  test('a list that fails is empty and asked again next time', async () => {
    let fail = true;
    const skills = new Skills(async () => {
      if (fail) throw new Error('no login');
      return [{ name: 'one', description: 'first' }];
    });
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(await skills.of(place)).toEqual([]);
    } finally {
      console.error = quiet;
    }
    fail = false;
    expect(await skills.of(place)).toEqual([{ name: 'one', description: 'first' }]);
  });
});
