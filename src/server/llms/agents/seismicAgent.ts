/**
 * The base class of Seismic's agents. An agent is a role, a model (chosen per run, since many agents
 * have no fixed one), skills, MCPs, in-process tools and prompts. A subclass supplies the pieces; the
 * base class assembles an `AgentSpec` and starts it on a runtime (`src/server/llms/harnesses/`).
 *
 * ```ts
 * class WorkerAgent extends SeismicAgent<WorkerContext> {
 *   readonly role = 'worker';
 *   readonly name = 'worker';
 *   readonly description = 'Works one card: implementation, checks, demo.';
 *   getModel(ctx) { return ctx.setting; }
 *   getPrompt(ctx) { return workerSystemPrompt(ctx); }
 *   getBriefing(ctx) { return briefing(ctx.card); }
 *   getTools(ctx) { return workerTools(ctx); }
 * }
 * ```
 *
 * Session options (where it shows, trust flags, hooks that carry news and ask the owner) come from
 * `getSessionOptions`.
 */
import type { AgentRole, AgentSetting } from '../../../core/types';
import type { AgentEvent, AgentRuntime, AgentSession, AgentSpec, AgentTool } from '../../runtime';
import { ownerPermission } from './permission';
import { CapabilityCheck, mergeCapabilities } from '../models/capabilityCheck';
import type { Capabilities, SeismicModel } from '../models/seismicModel';
import type { AgentMcp, AgentPermission, AgentSkill, SessionOptions } from './types';

/** What a run needs from its caller. */
export interface AgentRun {
  cwd: string;
  onEvent: (e: AgentEvent) => void;
  /** Resume this session instead of starting one. */
  resume?: string;
  /** Files that go with the first message. */
  images?: string[];
}

export abstract class SeismicAgent<Ctx = void> {
  /** Ties the agent to its settings entry (`AGENT_DEFAULTS`, a project's overrides). */
  abstract readonly role: AgentRole;
  abstract readonly name: string;
  abstract readonly description: string;

  /** The model, effort and harness for this run: by the role's setting and whatever else the context says; none leaves it to the role's setting. */
  abstract getModel(ctx: Ctx): AgentSetting | undefined;
  /**
   * What the agent may do without asking the owner: what the owner's `--permission-mode` says, unless
   * the agent overrides it. Read-only agents get no tools that change files or run commands. Each
   * harness maps it its own way (`permission.ts`). None leaves it to the harness, which follows the
   * owner's mode as it did before agents declared one (Codex asks, its automatic review being the
   * owner's own setting).
   */
  getPermissionMode(_ctx: Ctx): AgentPermission | undefined { return ownerPermission(); }

  /**
   * What this agent asks of any model it runs on (a vision agent declares `{ images: 'required' }`),
   * checked once the harness has resolved the model, before the first turn.
   */
  readonly capabilities: Capabilities = {};

  /** What this run asks of its model: the agent's own capabilities, and a subclass may add the run's. */
  getCapabilities(_ctx: Ctx): Capabilities { return this.capabilities; }

  /** What `needed`, with this agent's own capabilities, asks of `model`: whether the session may run on it. */
  checkCapabilities(model: SeismicModel, needed: Capabilities = {}): CapabilityCheck {
    return new CapabilityCheck(model, mergeCapabilities(this.capabilities, needed));
  }
  /** Appended to the harness's default system prompt. */
  abstract getPrompt(ctx: Ctx): string;
  /** The first message of a run; none lets the session start up and wait. */
  getBriefing(_ctx: Ctx): string | undefined { return undefined; }
  /** The skills the agent uses; each harness attaches them its own way (`skills/attachedSkills.ts`). */
  getSkills(_ctx: Ctx): AgentSkill[] { return []; }
  getMCPs(_ctx: Ctx): AgentMcp[] { return []; }
  /** Where the session shows and what it hears of (`SessionOptions`); nothing by default. */
  getSessionOptions(_ctx: Ctx): SessionOptions { return {}; }
  /** In-process tools, reached by the agent as `mcp__seismic__<name>`. */
  getTools(_ctx: Ctx): AgentTool[] { return []; }

  toSpec(ctx: Ctx, run: AgentRun): AgentSpec {
    const skills = this.getSkills(ctx);
    const permission = this.getPermissionMode(ctx);
    const needed = this.getCapabilities(ctx);
    const setting = this.getModel(ctx);
    return {
      ...this.getSessionOptions(ctx),
      cwd: run.cwd,
      system: this.getPrompt(ctx),
      tools: this.getTools(ctx),
      ...(skills.length ? { skills } : {}),
      role: this.role,
      ...(setting ? { setting } : {}),
      ...(permission ? { permission } : {}),
      ...(Object.keys(needed).length ? { checkModel: (model: SeismicModel) => this.checkCapabilities(model, needed) } : {}),
      ...(run.resume ? { resume: run.resume } : {}),
      onEvent: run.onEvent,
    };
  }

  start(runtime: AgentRuntime, ctx: Ctx, run: AgentRun): AgentSession {
    return runtime.start(this.toSpec(ctx, run), this.getBriefing(ctx), run.images);
  }
}
