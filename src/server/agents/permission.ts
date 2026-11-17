/**
 * How a harness reads an agent's permission (`AgentPermission`). Without one, the agent follows the
 * owner's `--permission-mode` where the harness has such a mode (`AgentSpec.permissionMode`).
 */
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { AgentSpec } from '../runtime';

type Perm = Pick<AgentSpec, 'permission' | 'permissionMode'>;

/** The agent reads and writes nothing, and asks nobody. */
export const readOnlyRun = (spec: Pick<Perm, 'permission'>): boolean => spec.permission === 'readOnly';

/** Codex's own automatic review stands in for the owner. */
export const autoReviewRun = (spec: Pick<Perm, 'permission'>): boolean => spec.permission === 'auto';

/** Claude Code's mode for an agent that is not read-only. */
export function claudeMode(spec: Perm): PermissionMode {
  if (spec.permission === 'auto') return 'auto';
  if (spec.permission === 'ask') return 'default';
  return spec.permissionMode ?? 'auto';
}
