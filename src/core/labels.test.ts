import { expect, test } from 'bun:test';
import { suggestable, suggestToggles } from './labels';

test('a canvas toggle lets Seismic suggest its labels; category goes with its sub-category, and a toggle left out is on', () => {
  expect(suggestable(undefined)).toEqual(['category', 'subcategory', 'complexity', 'priority']);
  expect(suggestable({ category: false })).toEqual(['complexity', 'priority']);
  expect(suggestable({ category: true, complexity: false, priority: false })).toEqual(['category', 'subcategory']);
  expect(suggestToggles({ priority: false })).toEqual({ category: true, complexity: true, priority: false });
});
