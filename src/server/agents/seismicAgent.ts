/**
 * The base class of Seismic's agents. An agent is a role, a model (chosen per run, since many agents
 * have no fixed one), skills, MCPs, in-process tools and prompts. A subclass supplies the pieces; the
 * base class assembles an `AgentSpec` and starts it on a runtime (`src/server/llms/harnesses/`).
 *
 * ```ts
 * class SeismicWorker extends SeismicAgent<WorkerContext> {
 *   readonly role = 'worker';
 *   readonly name = 'worker';
 *   readonly description = 'Works one card: implementation, checks, demo.';
 *   getModel(ctx) { return ctx.setting; }
 *   getPrompt(ctx) { return workerSystem(ctx); }
 *   getBriefing(ctx) { return briefing(ctx.card); }
 *   getTools(ctx) { return workerTools(ctx); }
 * }
 * ```
 *
 * Not covered yet: trust flags (`untrusted`, `claudeHeld`, `codexConfig`), limit handling, hooks,
 * images, plugin directories. Callers set those on the spec `toSpec` returns.
 */
import type { AgentRole, AgentSetting } from '../../core/types';
import type { AgentEvent, AgentRuntime, AgentSession, AgentSpec, AgentTool } from '../runtime';
import type { AgentMcp, AgentSkill } from './types';

/** What a run needs from its caller. */
export interface AgentRun {
  cwd: string;
  onEvent: (e: AgentEvent) => void;
  /** Resume this session instead of starting one. */
  resume?: string;
}

export abstract class SeismicAgent<Ctx = void> {
  /** Ties the agent to its settings entry (`AGENT_DEFAULTS`, a project's overrides). */
  abstract readonly role: AgentRole;
  abstract readonly name: string;
  abstract readonly description: string;
  /** Read-only agents get no tools that change files or run commands. */
  readOnly = false;

  /** The model, effort and harness for this run: by the role's setting and whatever else the context says. */
  abstract getModel(ctx: Ctx): AgentSetting;
  /** Appended to the harness's default system prompt. */
  abstract getPrompt(ctx: Ctx): string;
  /** The first message of a run; none lets the session start up and wait. */
  getBriefing(_ctx: Ctx): string | undefined { return undefined; }
  /** The skills the agent uses; each harness attaches them its own way (`skills/attachedSkills.ts`). */
  getSkills(_ctx: Ctx): AgentSkill[] { return []; }
  getMCPs(_ctx: Ctx): AgentMcp[] { return []; }
  /** In-process tools, reached by the agent as `mcp__seismic__<name>`. */
  getTools(_ctx: Ctx): AgentTool[] { return []; }

  toSpec(ctx: Ctx, run: AgentRun): AgentSpec {
    const skills = this.getSkills(ctx);
    return {
      cwd: run.cwd,
      system: this.getPrompt(ctx),
      tools: this.getTools(ctx),
      ...(skills.length ? { skills } : {}),
      role: this.role,
      setting: this.getModel(ctx),
      ...(this.readOnly ? { readOnly: true } : {}),
      ...(run.resume ? { resume: run.resume } : {}),
      onEvent: run.onEvent,
    };
  }

  start(runtime: AgentRuntime, ctx: Ctx, run: AgentRun): AgentSession {
    return runtime.start(this.toSpec(ctx, run), this.getBriefing(ctx));
  }
}
