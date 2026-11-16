import { expect, test } from 'bun:test';
import { skillListing, skillPlugins } from './attachedSkills';
import { labelsSkill } from './labels';
import { titlesSkill } from './titles';
import { SEISMIC_PLUGIN } from '../../demo';

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
