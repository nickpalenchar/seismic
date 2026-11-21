/**
 * Placeholder types for what a `SeismicAgent` returns besides its model. Skills and MCPs get
 * classes of their own later; these only name the slots.
 */
import type { AgentSpec } from '../../runtime';
import type { SeismicSkill } from '../skills/seismicSkill';

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
 * (`permission.ts`); one with no equivalent runs it as the nearest it has.
 * - `ask`: asks the owner for what needs a permission.
 * - `acceptEdits`: file edits go through; commands and the rest still ask.
 * - `auto`: runs without asking; whatever judges its actions is the harness's own (Claude's
 *   classifier, Codex's automatic review) or only its sandbox (agy).
 * - `dangerouslyBypassPermissions`: no permission check at all.
 * - `readOnly`: reads and runs what only reads, writes nothing, asks nobody. An agent's choice: the
 *   owner's `--permission-mode` never names it.
 */
export type AgentPermission = 'ask' | 'acceptEdits' | 'auto' | 'dangerouslyBypassPermissions' | 'readOnly';

/**
 * What an agent's session needs from where and how it runs, beyond what the agent is: where it shows,
 * what it may touch, the hooks that let it hear of news and ask the owner. Supplied by the caller
 * (`SeismicAgent.getSessionOptions`). The trust flags and the limit handling go here as agents need them.
 */
export type SessionOptions = Pick<AgentSpec, 'at' | 'dirs' | 'untrusted' | 'claudeHeld' | 'codexConfig' | 'env' | 'contextUpdate' | 'askOwner' | 'watch' | 'onLimit' | 'resolvedModel'>;
