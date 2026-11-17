import { afterEach, expect, test } from 'bun:test';
import { agyArgs, READ_ONLY_PERMISSIONS } from '../harnesses/agy';
import { autoReviewRun, bypassRun, claudeMode, ownerPermission, parsePermissionFlag, readOnlyRun, setOwnerPermission } from './permission';

afterEach(() => setOwnerPermission('auto'));

test('the flag takes the neutral names and Claude Code’s old ones, and nothing else', () => {
  expect(parsePermissionFlag('auto')).toBe('auto');
  expect(parsePermissionFlag('ask')).toBe('ask');
  expect(parsePermissionFlag('default')).toBe('ask');
  expect(parsePermissionFlag('acceptEdits')).toBe('acceptEdits');
  expect(parsePermissionFlag('bypassPermissions')).toBe('dangerouslyBypassPermissions');
  expect(parsePermissionFlag('dangerouslyBypassPermissions')).toBe('dangerouslyBypassPermissions');
  for (const bad of ['plan', 'dontAsk', 'readOnly', '', 'toString']) expect(() => parsePermissionFlag(bad)).toThrow('use one of ask, acceptEdits, auto, dangerouslyBypassPermissions');
});

test('the owner’s mode is auto until set', () => {
  expect(ownerPermission()).toBe('auto');
  setOwnerPermission('acceptEdits');
  expect(ownerPermission()).toBe('acceptEdits');
});

test('read-only and Codex’s automatic review come from the permission alone', () => {
  expect(readOnlyRun({})).toBe(false);
  expect(readOnlyRun({ permission: 'readOnly' })).toBe(true);
  expect(autoReviewRun({})).toBe(false);
  expect(autoReviewRun({ permission: 'auto' })).toBe(true);
  expect(autoReviewRun({ permission: 'ask' })).toBe(false);
});

test('Claude’s mode: an explicit permission wins, none follows the owner', () => {
  expect(claudeMode({})).toBe('auto');
  setOwnerPermission('acceptEdits');
  expect(claudeMode({})).toBe('acceptEdits');
  expect(claudeMode({ permission: 'ask' })).toBe('default');
  expect(claudeMode({ permission: 'auto' })).toBe('auto');
  expect(claudeMode({ permission: 'dangerouslyBypassPermissions' })).toBe('bypassPermissions');
});

test('Codex runs without a sandbox only where bypass is asked for, by the agent or by the owner for all', () => {
  expect(bypassRun({})).toBe(false);
  expect(bypassRun({ permission: 'dangerouslyBypassPermissions' })).toBe(true);
  setOwnerPermission('dangerouslyBypassPermissions');
  expect(bypassRun({})).toBe(true);
  expect(bypassRun({ permission: 'ask' })).toBe(false);
});

test('agy: read-only by permission rules, every other permission skips them inside the sandbox', () => {
  expect(agyArgs({ permission: 'readOnly' })).toContain(JSON.stringify({ permissions: READ_ONLY_PERMISSIONS }));
  for (const permission of ['ask', 'acceptEdits', 'auto', 'dangerouslyBypassPermissions'] as const) expect(agyArgs({ permission })).toContain('--dangerously-skip-permissions');
});
