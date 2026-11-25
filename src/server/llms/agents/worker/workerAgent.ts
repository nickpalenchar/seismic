





import type { AgentSetting, Item } from '../../../../core/types';
import { EXEC_LANE_AUTO_NOTE, EXEC_LANE_NOTE } from '../../harnesses/codexExecTools';
import type { Live } from '../../../workerSupervisor/workerSupervisor';
import { ownerPermission } from '../permission';
import { SeismicAgent } from '../seismicAgent';
import { SEISMIC_SKILLS } from '../../skills/registry';
import type { AgentPermission, SessionOptions } from '../types';
import { workerSystemPrompt } from './systemPrompt';
import { workerTools, type WorkerHost } from './tools';

export interface WorkerContext {
  
  host: WorkerHost;
  cardId: string;
  card?: Item;
  
  live: Live;
  
  setting: AgentSetting;
  
  preferences: string;
  
  prototype: boolean;
  
  review: boolean;
  
  notes: string;
  options: SessionOptions;
  
  message: string;
}

export class WorkerAgent extends SeismicAgent<WorkerContext> {
  readonly role = 'worker' as const;
  readonly name = 'worker';
  readonly description = 'Works one card: implementation, checks, demo.';

  getModel(ctx: WorkerContext) {
    return ctx.setting;
  }

  getPrompt(ctx: WorkerContext) {
    const { setting, live, review, notes } = ctx;
    const lane = setting.harness && setting.harness !== 'claude' && !live.host && !review ? `\n\n${live.autoReview ? EXEC_LANE_AUTO_NOTE : EXEC_LANE_NOTE}` : '';
    const claudeMd = notes ? `\n\nThe repository's CLAUDE.md, as its default branch has it:\n\n${notes}` : '';
    return `${workerSystemPrompt(ctx.host, ctx.preferences, ctx.prototype, ctx.card)}${lane}${claudeMd}`;
  }

  override getBriefing(ctx: WorkerContext) {
    return ctx.message;
  }

  override getTools(ctx: WorkerContext) {
    return workerTools(ctx.host, ctx.cardId, ctx.live, ctx.prototype);
  }

  override getSkills() {
    return [...SEISMIC_SKILLS];
  }

  override getSessionOptions(ctx: WorkerContext) {
    return ctx.options;
  }

  /**
   * Codex's automatic review is the owner's setting, not their `--permission-mode`: without it a Codex
   * worker asks, unless the owner bypasses permissions for all.
   */
  override getPermissionMode(ctx: WorkerContext): AgentPermission | undefined {
    if (ctx.setting.harness !== 'codex') return super.getPermissionMode(ctx);
    if (ctx.live.autoReview) return 'auto';
    return ownerPermission() === 'dangerouslyBypassPermissions' ? 'dangerouslyBypassPermissions' : 'ask';
  }
}

export const workerAgent = new WorkerAgent();
