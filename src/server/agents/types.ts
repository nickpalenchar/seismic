/**
 * Placeholder types for what a `SeismicAgent` returns besides its model. Skills and MCPs get
 * classes of their own later; these only name the slots.
 */
import type { Skill } from '../../core/types';

/** A skill the agent can be asked for by `/name`. */
export type AgentSkill = Skill;

/** An MCP server the agent's session connects to. */
export interface AgentMcp {
  name: string;
  /** The command that starts a stdio server, or the url of a remote one. */
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}
