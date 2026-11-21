/**
 * A job: a short, single-purpose agent session of Seismic's own (a draft, a proposal, notes on a
 * run). It is read-only, on the role `chores`, and answers through its tools: it ends with its turn,
 * or once a tool calls `finish`. A job is built for one run, so what its tools collect sits in the
 * subclass's fields, and `answer` turns that into the job's result (`R`). `run` settles with a
 * `JobResult`: the value where the job has its answer, whatever ended the session after it, and
 * otherwise the error that ended the session. What a failure means to the caller is the caller's to decide.
 */
import type { AgentRole } from '../../../core/types';
import type { AgentRuntime, AgentTool } from '../../runtime';
import type { AgentPermission, SessionOptions } from './types';
import { SeismicAgent } from './seismicAgent';

/** Where a job's session runs and shows, and how it takes the account's usage limit. */
export interface JobRun {
  cwd: string;
  /** Where it shows at work (`AgentSpec.at`). */
  at?: SessionOptions['at'];
  /** Files that go with the brief. */
  images?: string[];
  /** Waits for the account's usage limit instead of failing on it (`AgentSpec.onLimit`). */
  onLimit?: SessionOptions['onLimit'];
}

/** What a job gave: its value, or why it has none. */
export type JobResult<R> = { ok: true; value: R } | { ok: false; error: string };

export abstract class SeismicJob<R = void> extends SeismicAgent<void> {
  readonly role: AgentRole = 'chores';
  /** Set while the job runs: ends it, answering a tool call with `r`. */
  protected finish: (r: string) => string = (r) => r;

  getModel() {
    return undefined;
  }

  override getPermissionMode(): AgentPermission {
    return 'readOnly';
  }

  /**
   * What the tools collected, as the job's result: undefined while the job has no answer. A job
   * whose effect is what its tools do (they write to the board) answers `{ value: undefined }`.
   */
  protected abstract answer(): { value: R } | undefined;

  /** Why a session that ended without an answer has none. */
  protected missing(): string {
    return `${this.name} ended without an answer`;
  }

  /** The brief the session reads. */
  abstract getBrief(): string;
  /** The tools that answer; they end the job through `this.finish`. */
  abstract getJobTools(): AgentTool[];

  override getBriefing() {
    return this.getBrief();
  }

  override getTools() {
    return this.getJobTools();
  }

  /** Runs the session and settles with what it gave. */
  async run(runtime: AgentRuntime, o: JobRun): Promise<JobResult<R>> {
    const error = await this.session(runtime, o);
    const answer = this.answer();
    return answer ? { ok: true, value: answer.value } : { ok: false, error: error ?? this.missing() };
  }

  /** The session itself; settles with the error that ended it, none when a tool finished it or its turn ended. */
  private session(runtime: AgentRuntime, o: JobRun): Promise<string | undefined> {
    return new Promise((resolve) => {
      let done = false;
      const end = (error?: string) => {
        if (!done) {
          done = true;
          resolve(error);
        }
      };
      this.finish = (r) => {
        end();
        return r;
      };
      const session = runtime.start(
        {
          ...this.toSpec(undefined, {
            cwd: o.cwd,
            onEvent: (e) => {
              if (e.type === 'idle' || e.type === 'error') {
                session.close();
                end(e.type === 'error' ? e.message : undefined);
              }
            },
          }),
          ...(o.onLimit ? { onLimit: o.onLimit } : {}),
          ...(o.at ? { at: o.at } : {}),
        },
        this.getBrief(),
        o.images,
      );
    });
  }
}
