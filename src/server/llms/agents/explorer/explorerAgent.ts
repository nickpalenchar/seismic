





import type { AgentSetting, Item } from '../../../../core/types';
import type { Language } from '../../../../core/locale';
import { SeismicAgent } from '../seismicAgent';
import type { AgentPermission, SessionOptions } from '../types';
import type { Live } from '../../../explorers';
import { explorerBriefing } from './briefing';
import { explorerContextUpdate } from './contextUpdate';
import { explorerSystemPrompt } from './systemPrompt';
import { type ExplorerHost, explorerTools } from './tools';

export interface ExplorerContext {
  
  host: ExplorerHost;
  cardId: string;
  live: Live;
  
  conversation: Language;
  ui: Language;
  repository: Language;
  
  toSeismic: boolean;
  
  preferences: string;
  
  message: string;
  
  start?: { card: Item; shots: string[]; said: number[] };
  
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
    return ctx.start ? `${explorerBriefing(ctx.host, ctx.start.card, ctx.start.shots, ctx.start.said)}\n\n${ctx.message}` : ctx.message;
  }

  override getTools(ctx: ExplorerContext) {
    return explorerTools(ctx.host, ctx.cardId, ctx.live);
  }

  override getSessionOptions(ctx: ExplorerContext) {
    return { ...ctx.options, contextUpdate: () => explorerContextUpdate(ctx.host, ctx.cardId, ctx.live) };
  }
}

export const explorerAgent = new ExplorerAgent();
