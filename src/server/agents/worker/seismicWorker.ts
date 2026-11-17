/**
 * The worker: one agent per card while it is worked on, doing the implementation, the checks and the
 * demo. What it is (its role, model, skills, permission) is defined here; what a run of it says and
 * does (the system prompt, the tools, the hooks) is still made by `Workers` (`workers.ts`) and handed
 * in as the context, until that code moves here.
 */
import type { AgentSetting } from '../../../core/types';
import type { AgentTool } from '../../runtime';
import { ownerPermission } from '../permission';
import { SeismicAgent } from '../seismicAgent';
import { SEISMIC_SKILLS } from '../skills/registry';
import type { AgentPermission, SessionOptions } from '../types';

export interface WorkerContext {
  /** The card's pinned harness, model and effort. */
  setting: AgentSetting;
  /** The system prompt for the card: the worker's rules, plus the notes of its harness and repository. */
  system: string;
  tools: AgentTool[];
  options: SessionOptions;
  /** The owner's setting lets Codex's own automatic review stand in for them. */
  autoReview: boolean;
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
    return ctx.system;
  }
  override getBriefing(ctx: WorkerContext) {
    return ctx.message;
  }
  override getTools(ctx: WorkerContext) {
    return ctx.tools;
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
    if (ctx.autoReview) return 'auto';
    return ownerPermission() === 'dangerouslyBypassPermissions' ? 'dangerouslyBypassPermissions' : 'ask';
  }
}

export const seismicWorker = new SeismicWorker();
