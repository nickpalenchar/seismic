/**
 * Permissions: what the owner's `--permission-mode` says (every agent follows it unless it says
 * otherwise, `SeismicAgent.getPermissionMode()`), and how a harness reads an agent's
 * `AgentPermission`.
 */
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { AgentSpec } from '../../runtime';
import type { AgentPermission } from './types';

let owner: AgentPermission = 'auto';

/** The owner's permission mode, set once at start. */
export const ownerPermission = (): AgentPermission => owner;
export const setOwnerPermission = (permission: AgentPermission) => {
  owner = permission;
};

/** The values the flag takes, and the Claude Code names it took before. */
const FLAG: Record<string, AgentPermission> = {
  ask: 'ask',
  default: 'ask',
  acceptEdits: 'acceptEdits',
  auto: 'auto',
  dangerouslyBypassPermissions: 'dangerouslyBypassPermissions',
  bypassPermissions: 'dangerouslyBypassPermissions',
};
export const PERMISSION_FLAG_VALUES = ['ask', 'acceptEdits', 'auto', 'dangerouslyBypassPermissions'] as const;

/** The flag's value as a permission; an error naming the values it takes for any other. */
export function parsePermissionFlag(value: string): AgentPermission {
  const permission = Object.hasOwn(FLAG, value) ? FLAG[value] : undefined;
  if (!permission) throw new Error(`--permission-mode ${value}: use one of ${PERMISSION_FLAG_VALUES.join(', ')}`);
  return permission;
}

type Perm = Pick<AgentSpec, 'permission'>;

/** The agent reads and writes nothing, and asks nobody. */
export const readOnlyRun = (spec: Perm): boolean => spec.permission === 'readOnly';

/** Codex: its own automatic review stands in for the owner. */
export const autoReviewRun = (spec: Perm): boolean => spec.permission === 'auto';

/**
 * Codex: no sandbox and no approvals. Codex's own automatic review is the owner's setting
 * (`codexAutoReview`), not the flag, so a spec without a permission is bypassed only where the owner
 * bypasses everything, and otherwise asks as before.
 */
export const bypassRun = (spec: Perm): boolean => (spec.permission ?? owner) === 'dangerouslyBypassPermissions';

/** Claude Code's mode for an agent that is not read-only. */
export function claudeMode(spec: Perm): PermissionMode {
  switch (spec.permission ?? owner) {
    case 'ask': return 'default';
    case 'acceptEdits': return 'acceptEdits';
    case 'dangerouslyBypassPermissions': return 'bypassPermissions';
    case 'readOnly': return 'dontAsk';
    default: return 'auto';
  }
}
