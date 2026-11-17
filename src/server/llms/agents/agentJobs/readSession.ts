/**
 * The one-shot read-only session the agent jobs and the Koordinator's turns share.
 */
import type { AgentAt, AgentRole } from '../../../../core/types';
import type { AgentRuntime, AgentTool } from '../../../runtime';

/**
 * A read-only session that reads `brief` (and `images`) and answers through its tools: it ends with
 * its turn, or once a tool calls `finish`. It settles with the error that ended it before a tool
 * called `finish`, if one did. With `onLimit` it waits for the account's usage limit instead of
 * failing on it (`AgentSpec.onLimit`).
 */
export function readSession(
  runtime: AgentRuntime,
  o: {
    cwd: string;
    system: string;
    tools: (finish: (r: string) => string) => AgentTool[];
    brief: string;
    role: AgentRole;
    /** Where it shows at work (`AgentSpec.at`). */
    at?: AgentAt;
    images?: string[];
    onLimit?: (until: number | null | undefined, retry?: () => void) => void;
  },
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let done = false;
    const end = (error?: string) => {
      if (!done) {
        done = true;
        resolve(error);
      }
    };
    const finish = (r: string) => {
      end();
      return r;
    };
    const session = runtime.start(
      {
        cwd: o.cwd,
        permission: 'readOnly',
        role: o.role,
        system: o.system,
        tools: o.tools(finish),
        ...(o.onLimit ? { onLimit: o.onLimit } : {}),
        ...(o.at ? { at: o.at } : {}),
        onEvent: (e) => {
          if (e.type === 'idle' || e.type === 'error') {
            session.close();
            end(e.type === 'error' ? e.message : undefined);
          }
        },
      },
      o.brief,
      o.images,
    );
  });
}
