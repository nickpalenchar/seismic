


import type { AgentAt, Item } from '../core/types';
import { oneAtATime } from '../core/one-at-a-time';
import { type Briefing, decisionLog, INFORM_RULES, inform, type OwnerAnswer } from './advisor';
import { type Board, pathOfRef } from './board';
import { outsidePlanDir } from './repo';
import type { AgentRuntime, AgentTool } from './runtime';
import { TO_SEISMIC } from './toSeismic';

export class PlanAgents {
  
  private queues = new Map<string, Promise<unknown>>();

  constructor(
    private board: Board,
    private runtime: AgentRuntime,
    
    private repoPath: () => string,
    private preferences: () => string = () => '',
    
  ) {}

  /**
   * Answers a question the owner asked about the plan or one of its workstreams, in the plan's
   * session. `dir`: the output directory of the looked-up thread, which the answer's files are in;
   * `signal` ends the turn at once; `onLimit` shows where it waits for the usage limit; `onWaiting`
   * passes the owner's words in while it waits for its background work (`Briefing.onWaiting`).
   * `asked`: written in the plan's sheet, straight to it: its screenshots, and `to_seismic` for what
   * the words ask of Seismic rather than of it. `at`: where it shows at work.
   */
  inform(
    plan: Item,
    message: string,
    onLimit: (until: number | null | undefined, retry?: () => void) => void,
    onTool?: (name: string, input: Record<string, unknown>) => void,
    dir?: string,
    signal?: AbortSignal,
    onWaiting?: Briefing['onWaiting'],
    asked?: { images: string[]; toSeismic?: AgentTool },
    at?: AgentAt,
  ): Promise<OwnerAnswer> {
    return this.queued(plan, () =>
      inform({
        onLimit,
        ...(at ? { at } : {}),
        runtime: this.runtime,
        cwd: this.repoPath(),
        resume: this.board.row(plan.id).session_id ?? undefined,
        setting: this.board.sessionSetting(plan.id),
        onSession: (id, setting) => this.board.work(plan.id, { session_id: id, ...(setting ? { agent_setting: JSON.stringify(setting) } : {}) }),
        ...(onTool ? { onTool } : {}),
        ...(dir ? { dir } : {}),
        ...(signal ? { signal } : {}),
        ...(onWaiting ? { onWaiting } : {}),
        ...(asked?.images.length ? { images: asked.images } : {}),
        ...(asked?.toSeismic ? { tools: [asked.toSeismic] } : {}),
        system: `You are the plan agent of the plan "${plan.title}", directed through Seismic. Its plan doc is ${plan.plan?.file ?? '(none)'}${plan.plan?.file && outsidePlanDir(pathOfRef(plan.plan.file)) ? '' : ' in this repository'}; you know it and the history of its workstreams.\n\n${INFORM_RULES}${asked?.toSeismic ? `\n\n${TO_SEISMIC}` : ''}`,
        message: [message, `Decisions taken in this plan so far:\n${decisionLog(this.board.decisions(plan.id))}`, this.preferences()].filter(Boolean).join('\n\n'),
        language: this.board.conversation(),
      }),
    );
  }

  /** One question at a time per plan, in one session. */
  private queued<T>(plan: Item, fn: () => Promise<T>): Promise<T> {
    return oneAtATime(this.queues, plan.id, fn);
  }
}
