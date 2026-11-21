/**
 * A job: a short, single-purpose agent session of Seismic's own (a draft, a proposal, notes on a
 * run). It is read-only, on the role `chores`, and answers through its tools: it ends with its turn,
 * or once a tool calls `finish`. A job is built for one run, so what its tools collect sits in the
 * subclass's fields. `run` settles with the error that ended the session before a tool called
 * `finish`, if one did.
 */
import type { AgentRole } from '../../../core/types';
import type { AgentRuntime, AgentTool } from '../../runtime';
import type { AgentNeeds, AgentPermission, SessionOptions } from './types';
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

export abstract class SeismicJob extends SeismicAgent<void> {
  readonly role: AgentRole = 'chores';
  /** What the job needs of its model, which the harness checks; a job that reads screenshots only as a help says `{ images: 'optional' }`. */
  readonly needs: AgentNeeds = {};
  /** Set while the job runs: ends it, answering a tool call with `r`. */
  protected finish: (r: string) => string = (r) => r;

  getModel() {
    return undefined;
  }

  override getPermissionMode(): AgentPermission {
    return 'readOnly';
  }

  override getNeeds() {
    return Object.keys(this.needs).length ? this.needs : undefined;
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

  /** Runs the session; settles with the error that ended it, none when a tool finished it or its turn ended. */
  run(runtime: AgentRuntime, o: JobRun): Promise<string | undefined> {
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
