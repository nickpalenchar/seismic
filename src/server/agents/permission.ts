/**
 * How a harness reads an agent's permission (`AgentPermission`). The older spec fields it stands
 * beside (`readOnly`, `autoReview`, `permissionMode`) still count, for callers that have not moved
 * to `SeismicAgent.getPermissionMode()`; an explicit `permission` wins over `permissionMode`.
 */
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { AgentSpec } from '../runtime';

type Perm = Pick<AgentSpec, 'readOnly' | 'permission' | 'autoReview' | 'permissionMode'>;

/** The agent reads and writes nothing, and asks nobody. */
export const readOnlyRun = (spec: Pick<Perm, 'readOnly' | 'permission'>): boolean => !!spec.readOnly || spec.permission === 'readOnly';

/** Codex's own automatic review stands in for the owner. */
export const autoReviewRun = (spec: Pick<Perm, 'autoReview' | 'permission'>): boolean => !!spec.autoReview || spec.permission === 'auto';

/** Claude Code's mode for an agent that is not read-only. */
export function claudeMode(spec: Pick<Perm, 'permission' | 'permissionMode'>): PermissionMode {
  if (spec.permission === 'auto') return 'auto';
  if (spec.permission === 'ask') return 'default';
  return spec.permissionMode ?? 'auto';
}
