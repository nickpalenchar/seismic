import { expect, test } from 'bun:test';
import { skillListing, skillPlugins } from '../../../llms/skills/attachedSkills';
import { labelsSkill } from '../../../llms/skills/labels';
import { titlesSkill } from '../../../llms/skills/titles';
import { SEISMIC_PLUGIN } from '../../../demo';
import { SeismicSkill } from '../../../llms/skills/seismicSkill';
import { SEISMIC_SKILLS, seismicSkills } from '../../../llms/skills/registry';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a skill reads its name and description from its file, and its instructions without the front matter', () => {
  expect(labelsSkill.name).toBe('seismic:labels');
  expect(labelsSkill.description).toStartWith('Judge a card');
  expect(labelsSkill.getInstructions()).toStartWith('# Judging a card');
  expect(labelsSkill.getInstructions()).not.toContain('name: labels');
  expect(labelsSkill.toListing()).toEqual({ name: 'seismic:labels', description: labelsSkill.description });
});

test('Claude loads each plugin once; the others are told the files', () => {
  expect(skillPlugins([labelsSkill, titlesSkill])).toEqual([SEISMIC_PLUGIN]);
  const lines = skillListing([labelsSkill, titlesSkill]);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain(labelsSkill.file);
});

test('every folder of the plugin has a skill in the registry', () => {
  const folders = readdirSync(join(SEISMIC_PLUGIN, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(SEISMIC_PLUGIN, 'skills', e.name, 'SKILL.md')));
  expect(SEISMIC_SKILLS.map((s) => s.name).sort()).toEqual(folders.map((e) => `seismic:${e.name}`).sort());
  for (const s of seismicSkills()) expect(s.description).not.toBe('');
});

test('a damaged plugin lists the skills that are there', () => {
  const plugin = mkdtempSync(join(tmpdir(), 'seismic-plugin-'));
  try {
    mkdirSync(join(plugin, 'skills', 'titles'), { recursive: true });
    writeFileSync(join(plugin, 'skills', 'titles', 'SKILL.md'), '---\ndescription: Names cards.\n---\nBody.\n');
    const list = seismicSkills([new SeismicSkill('titles', plugin), new SeismicSkill('missing', plugin)]);
    expect(list.map((s) => s.name)).toEqual(['seismic:titles']);
    expect(list[0]!.description).toBe('Names cards.');
    expect(list[0]!.getInstructions()).toBe('Body.');
  } finally {
    rmSync(plugin, { recursive: true, force: true });
  }
});
