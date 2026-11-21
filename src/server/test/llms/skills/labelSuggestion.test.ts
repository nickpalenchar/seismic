import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CATEGORIES, COMPLEXITIES, LABEL_NAMES, PRIORITIES, PRIORITY_NAMES, SUBCATEGORIES } from '../../../../core/labels';
import { labelsSkill } from '../../../llms/skills/labels';
import { labelsFrom, labelWords } from '../../../llms/skills/labelSuggestion';

describe('the labels skill', () => {
  test('names every value of the lists and the complexity scale as src/core/labels.ts has them', () => {
    const skill = readFileSync(labelsSkill.file, 'utf8');
    expect(skill).toMatch(/^---\nname: labels\ndescription: .+\n---\n/);
    for (const k of [...CATEGORIES, ...SUBCATEGORIES]) expect(skill).toContain(`- ${LABEL_NAMES[k]}: `);
    for (const p of PRIORITIES) expect(skill).toContain(`- ${PRIORITY_NAMES[p]}: `);
    const complexity = skill.split('## Complexity\n')[1]!.split('## Priority')[0]!;
    expect([...complexity.matchAll(/^- (\d+)$/gm)].map((m) => Number(m[1]))).toEqual([...COMPLEXITIES]);
    expect(labelsSkill.getInstructions()).toStartWith('# Judging a card');
  });

  test('a tool call’s names map to the lists; what was not asked or is off the lists is left out', () => {
    expect(labelsFrom({ category: 'data migration', subcategory: 'Refactor', complexity: 4, priority: 'Critical' }, ['category', 'complexity', 'priority'])).toEqual({
      category: 'dataMigration',
      priority: 'critical',
    });
    expect(labelWords(['category', 'subcategory', 'complexity'])).toBe('category, sub-category and complexity');
  });
});
