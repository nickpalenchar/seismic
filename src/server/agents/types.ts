/**
 * Placeholder types for what a `SeismicAgent` returns besides its model. Skills and MCPs get
 * classes of their own later; these only name the slots.
 */
import type { SeismicSkill } from './skills/seismicSkill';

/** A skill the agent uses. */
export type AgentSkill = SeismicSkill;

/** An MCP server the agent's session connects to. */
export interface AgentMcp {
  name: string;
  /** The command that starts a stdio server, or the url of a remote one. */
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

/**
 * What an agent may do without asking the owner, in terms no harness owns. Each harness maps it
 * (`permission.ts`); one with no equivalent drops it.
 * - `inherit`: what the owner's `--permission-mode` says (`auto` where nothing is set).
 * - `auto`: runs without asking; whatever judges its actions is the harness's own (Claude's classifier,
 *   Codex's automatic review) or only its sandbox (agy).
 * - `ask`: asks the owner for what needs a permission.
 * - `readOnly`: reads and runs what only reads, writes nothing, asks nobody.
 */
export type AgentPermission = 'inherit' | 'auto' | 'ask' | 'readOnly';
