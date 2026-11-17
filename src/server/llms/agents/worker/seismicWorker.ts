/**
 * The worker: one agent per card while it is worked on, doing the implementation, the checks and the
 * demo. What it is (its role, model, skills, permission) is defined here, with its system prompt
 * (`system.ts`) and its tools (`tools.ts`); the `Workers` that runs the card hands in the card's state
 * as the context.
 */
import type { AgentSetting, Item } from '../../../../core/types';
import { EXEC_LANE_AUTO_NOTE, EXEC_LANE_NOTE } from '../../harnesses/codexExecTools';
import type { Live } from '../../../workers';
import { ownerPermission } from '../permission';
import { SeismicAgent } from '../seismicAgent';
import { SEISMIC_SKILLS } from '../../skills/registry';
import type { AgentPermission, SessionOptions } from '../types';
import { workerSystemPrompt } from './systemPrompt';
import { workerTools, type WorkerHost } from './tools';

export interface WorkerContext {
  /** The `Workers` that runs the card. */
  host: WorkerHost;
  cardId: string;
  card?: Item;
  /** The card's running state. */
  live: Live;
  /** The card's pinned harness, model and effort. */
  setting: AgentSetting;
  /** The owner's standing preferences, added to the instructions. */
  preferences: string;
  /** The card works an idea's prototype. */
  prototype: boolean;
  /** A review card: its workstation holds a stranger's code. */
  review: boolean;
  /** The repository's CLAUDE.md as its default branch has it, for a review card whose own is the contributor's. */
  notes: string;
  options: SessionOptions;
  /** The first message: the briefing and what the owner has said since. */
  message: string;
}

export class SeismicWorker extends SeismicAgent<WorkerContext> {
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
  override getPermissionMode(ctx: WorkerContext): AgentPermission {
    if (ctx.setting.harness !== 'codex') return super.getPermissionMode(ctx);
    if (ctx.live.autoReview) return 'auto';
    return ownerPermission() === 'dangerouslyBypassPermissions' ? 'dangerouslyBypassPermissions' : 'ask';
  }
}

export const seismicWorker = new SeismicWorker();
