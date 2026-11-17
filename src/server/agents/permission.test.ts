import { expect, test } from 'bun:test';
import { agyArgs, READ_ONLY_PERMISSIONS } from '../llms/harnesses/agy';
import { autoReviewRun, claudeMode, readOnlyRun } from './permission';

test('read-only comes from the permission', () => {
  expect(readOnlyRun({})).toBe(false);
  expect(readOnlyRun({ permission: 'readOnly' })).toBe(true);
  expect(readOnlyRun({ permission: 'auto' })).toBe(false);
});

test('Codex reviews automatically for auto', () => {
  expect(autoReviewRun({})).toBe(false);
  expect(autoReviewRun({ permission: 'auto' })).toBe(true);
  expect(autoReviewRun({ permission: 'ask' })).toBe(false);
});

test('Claude’s mode: an explicit permission wins, inherit takes the owner’s flag, auto is the default', () => {
  expect(claudeMode({})).toBe('auto');
  expect(claudeMode({ permissionMode: 'acceptEdits' })).toBe('acceptEdits');
  expect(claudeMode({ permission: 'inherit', permissionMode: 'acceptEdits' })).toBe('acceptEdits');
  expect(claudeMode({ permission: 'ask', permissionMode: 'acceptEdits' })).toBe('default');
  expect(claudeMode({ permission: 'auto', permissionMode: 'acceptEdits' })).toBe('auto');
});

test('agy: read-only by permission rules, every other permission skips them inside the sandbox', () => {
  expect(agyArgs({ permission: 'readOnly' })).toContain(JSON.stringify({ permissions: READ_ONLY_PERMISSIONS }));
  for (const permission of ['inherit', 'auto', 'ask'] as const) expect(agyArgs({ permission })).toContain('--dangerously-skip-permissions');
});
