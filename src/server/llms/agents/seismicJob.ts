







import type { AgentRole } from '../../../core/types';
import { messageOf } from '../../../core/text';
import type { AgentRuntime, AgentSession, AgentTool } from '../../runtime';
import type { AgentPermission, SessionOptions } from './types';
import { SeismicAgent } from './seismicAgent';


export interface JobRun {
  cwd: string;
  
  at?: SessionOptions['at'];
  
  images?: string[];
  
  onLimit?: SessionOptions['onLimit'];
}


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

  



  protected abstract answer(): { value: R } | undefined;

  /** Why a session that ended without an answer has none. */
  protected missing(): string {
    return `${this.name} ended without an answer`;
  }

  
  abstract getBrief(): Promise<string>;
  
  abstract getJobTools(): AgentTool[];

  override getTools() {
    return this.getJobTools();
  }

  /** Ends the run now and closes its session (the owner stopped waiting, a time limit ran out); the run settles with what the job has by then. */
  cancel(): void {
    this.stopRun();
  }

  private stopRun: () => void = () => {};

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
      this.stopRun = () => {
        end();
        session?.close();
      };
      let session: AgentSession | undefined;
      const start = (brief: string) => {
        
        if (done) return;
        session = runtime.start(
          {
            ...this.toSpec(undefined, {
              cwd: o.cwd,
              onEvent: (e) => {
                if (e.type === 'idle' || e.type === 'error') {
                  session?.close();
                  end(e.type === 'error' ? e.message : undefined);
                }
              },
            }),
            ...(o.onLimit ? { onLimit: o.onLimit } : {}),
            ...(o.at ? { at: o.at } : {}),
          },
          brief,
          o.images,
        );
      };
      this.getBrief().then(start, (e: unknown) => end(messageOf(e)));
    });
  }
}
