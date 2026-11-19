/**
 * The exploration agent: one session per idea, with a worker's tools, resumed for every message.
 * What it is (its role, model, prompt, tools) is defined here; the `Explorers` that runs the idea
 * hands in the idea's state as the context. It has no permission of its own: the harness follows the
 * owner's mode, as for the workers.
 */
import type { AgentSetting } from '../../../../core/types';
import type { Language } from '../../../../core/locale';
import { SeismicAgent } from '../seismicAgent';
import type { AgentPermission, SessionOptions } from '../types';
import type { Live } from '../../../explorers';
import { explorerSystemPrompt } from './systemPrompt';
import { type ExplorerHost, explorerTools } from './tools';

export interface ExplorerContext {
  /** The `Explorers` that runs the idea. */
  host: ExplorerHost;
  cardId: string;
  live: Live;
  /** The language the owner talks in by default, the interface's, and the repository's. */
  conversation: Language;
  ui: Language;
  repository: Language;
  /** The agent has the tool that passes the owner's words on to the Koordinator. */
  toSeismic: boolean;
  /** The owner's standing preferences, added to the instructions. */
  preferences: string;
  /** The first message: the briefing and what the owner has said. */
  message: string;
  /** Where it shows, what it hears with its tool steps, how it waits for a usage limit. */
  options: SessionOptions;
  setting?: AgentSetting;
}

export class ExplorerAgent extends SeismicAgent<ExplorerContext> {
  readonly role = 'explorer' as const;
  readonly name = 'explorer';
  readonly description = "Talks an idea through with the owner and keeps the idea's brief.";

  getModel(ctx: ExplorerContext) {
    return ctx.setting;
  }

  override getPermissionMode(): AgentPermission | undefined {
    return undefined;
  }

  getPrompt(ctx: ExplorerContext) {
    return explorerSystemPrompt(ctx.conversation, ctx.ui, ctx.repository, ctx.toSeismic) + (ctx.preferences ? `\n\n${ctx.preferences}` : '');
  }

  override getBriefing(ctx: ExplorerContext) {
    return ctx.message;
  }

  override getTools(ctx: ExplorerContext) {
    return explorerTools(ctx.host, ctx.cardId, ctx.live);
  }

  override getSessionOptions(ctx: ExplorerContext) {
    return ctx.options;
  }
}

export const explorerAgent = new ExplorerAgent();
