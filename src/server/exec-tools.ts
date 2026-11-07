// The tools a Codex worker reaches what its sandbox keeps from it through (docs/design/agents-and-workspaces.md):
// network, a browser, a local server, a git write in a worktree (its `.git` lies in the main
// repository, outside the workspace), a place outside the workspace. Seismic runs the call itself,
// on the owner's machine and with the owner's rights; what makes that safe is the gate (the
// repository's confirmed allow list, else the owner is asked) and the places a command may run in,
// not a sandbox. Claude workers have no use for them: their own tools and the same allow list cover this.

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { z } from 'zod';
import { allowed } from './allow-rules';
import { cleanEnv, endWithAgents, type AgentTool, type PermissionAnswer, type PermissionRequest } from './runtime';
import { OWN_GROUP } from './spawn';

export interface ExecLane {
  /** The card's workspace on this machine: where commands run by default, and where git works. */
  workspace: string;
  /** Other places a command may run in (the temporary directories, the demos directory). */
  places: () => string[];
  /** The `Bash` rules of the allow list the owner confirmed; a command all of whose parts they cover runs without a question. */
  rules: () => string[];
  /** Asks the owner (the card's question); only an answer that allows lets the command run. */
  ask: (request: PermissionRequest) => Promise<PermissionAnswer>;
  /** Added to the command's environment. */
  env?: Record<string, string>;
  /**
   * Codex's own automatic review decides for the worker (`AgentSpec.autoReview`): a command the
   * allow list does not cover is not asked, the worker runs it in its own shell with escalated
   * permissions, where that review judges it.
   */
  auto?: boolean;
}

export const DEFAULT_TIMEOUT = 300;
export const MAX_TIMEOUT = 1800;
/** How much of a command's output the agent gets: this many characters from its start and from its end. */
const OUTPUT_HEAD = 12_000;
const OUTPUT_TAIL = 12_000;

/** `dir` resolved against `base`, as the directory it really is (no symlink out, no `..` out); null where it is none. */
function realDirectory(dir: string, base: string): string | null {
  try {
    return realpathSync(isAbsolute(dir) ? dir : resolve(base, dir));
  } catch {
    return null;
  }
}

/** Whether `dir` is `root` or lies in it. */
const within = (dir: string, root: string) => dir === root || dir.startsWith(root.endsWith(sep) ? root : root + sep);

/** The directory a command runs in: `cwd` where it is one of the places allowed, else null. */
export function placeFor(lane: Pick<ExecLane, 'workspace' | 'places'>, cwd: string | undefined): string | null {
  const dir = realDirectory(cwd?.trim() || '.', lane.workspace);
  if (!dir) return null;
  const roots = [lane.workspace, ...lane.places()].map((r) => realDirectory(r, lane.workspace)).filter((r): r is string => !!r);
  return roots.some((r) => within(dir, r)) ? dir : null;
}

/** Output of a command as the agent reads it: all of it, or its start and end around a note of what was left out. */
export function clipped(text: string): string {
  if (text.length <= OUTPUT_HEAD + OUTPUT_TAIL) return text;
  const left = text.length - OUTPUT_HEAD - OUTPUT_TAIL;
  return `${text.slice(0, OUTPUT_HEAD)}\n… ${left} characters left out …\n${text.slice(-OUTPUT_TAIL)}`;
}

/** Runs `command` (a shell line when `shell`, else a program with `args`) in `cwd`; the result text has the exit code and the output. */
function execute(command: string, args: string[], o: { cwd: string; env: Record<string, string>; shell: boolean; seconds: number }): Promise<string> {
  return new Promise((done) => {
    const p = spawn(command, args, { cwd: o.cwd, env: { ...cleanEnv(), ...o.env } as NodeJS.ProcessEnv, shell: o.shell, stdio: ['ignore', 'pipe', 'pipe'], detached: OWN_GROUP, windowsHide: true });
    endWithAgents(p);
    let out = '';
    p.stdout!.setEncoding('utf8').on('data', (d: string) => (out += d));
    p.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
    let timedOut = false;
    const stop = (signal: NodeJS.Signals) => {
      try {
        if (OWN_GROUP && p.pid) process.kill(-p.pid, signal);
        else p.kill(signal);
      } catch {
        // gone already
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop('SIGTERM');
      setTimeout(() => stop('SIGKILL'), 3000).unref();
    }, o.seconds * 1000);
    p.once('error', (e) => {
      clearTimeout(timer);
      done(`Not run: ${e.message}`);
    });
    p.once('close', (code, signal) => {
      clearTimeout(timer);
      const how = timedOut ? `stopped after ${o.seconds} seconds` : signal ? `ended by ${signal}` : `exit code ${code}`;
      done(`${how}\n${clipped(out)}`.trimEnd());
    });
  });
}

/** The git subcommands the agent may run: the work in its worktree, nothing that reaches a remote or changes git's own settings. */
export const GIT_ALLOWED = new Set(['status', 'diff', 'log', 'show', 'add', 'rm', 'mv', 'restore', 'commit', 'rebase', 'merge', 'cherry-pick', 'stash', 'switch', 'checkout', 'branch', 'reset', 'revert']);
/** Flags that make git run a program of the caller's choosing, or work somewhere else than in the worktree. */
const GIT_REFUSED_FLAGS = /^(?:--git-dir|--work-tree|--exec|--upload-pack|--receive-pack|--output|--exec-path|--namespace|--super-prefix)(?:=|$)/;

/** Why git with these arguments is not run; null where it is. */
export function gitRefusal(args: string[]): string | null {
  const sub = args[0];
  if (!sub || sub.startsWith('-')) return 'The first argument is the git subcommand (git options before it are not accepted).';
  if (!GIT_ALLOWED.has(sub)) return `git ${sub} is not available here (${[...GIT_ALLOWED].join(', ')} are). Pushing and settings are not yours to change; Seismic lands the work.`;
  const flag = args.slice(1).find((a) => GIT_REFUSED_FLAGS.test(a) || (sub === 'rebase' && /^-[a-wyzA-Z]*x/.test(a)));
  return flag ? `${flag} is not accepted.` : null;
}

/** What a Codex worker's system prompt says of its two tools: what they are for, in terms of what its own shell cannot do. */
export const EXEC_LANE_NOTE =
  'Your own shell is sandboxed: it writes only in your workspace and the temporary directories, has no network and cannot reach a local server, and cannot write your worktree’s .git. ' +
  'The tools seismic_run (a shell command outside the sandbox) and seismic_git (git in your workspace) do what it cannot: git writes such as add, commit and rebase, installing packages, running a browser or a local app, recording a demo, writing into the demos directory.';

/** The same for a worker whose approvals Codex's automatic review decides. */
export const EXEC_LANE_AUTO_NOTE =
  'Your own shell is sandboxed: it writes only in your workspace and the temporary directories, has no network and cannot reach a local server, and cannot write your worktree’s .git. ' +
  'For a command the sandbox stops, request escalated permissions: Codex’s automatic review decides, nobody is asked. ' +
  'seismic_git (git in your workspace) does git writes such as add, commit and rebase without one, seismic_run the commands the repository’s allow list covers.';

/** Execution tools for a Codex worker whose workspace lies on this machine. */
export function execTools(lane: ExecLane): AgentTool[] {
  const env = { ...lane.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', CI: '1' };
  return [
    {
      name: 'run',
      description:
        'Runs a shell command outside your sandbox, on the owner’s machine: for what the sandbox keeps from your own shell (network, a browser, a local server, files outside the workspace). Runs in the workspace, a temporary directory or the demos directory (`cwd`). ' +
        (lane.auto
          ? 'Only commands the repository’s allow list covers run; run any other in your own shell with escalated permissions. '
          : 'Commands the repository’s allow list covers run at once; any other waits for the owner’s answer. ') +
        'No stdin; a command that outlives `timeout_seconds` is ended with everything it started. ' +
        'Output longer than a few thousand lines comes back as its start and end.',
      schema: {
        command: z.string().describe('The shell line to run'),
        cwd: z.string().optional().describe('Directory to run in: relative to the workspace, or absolute in a temporary or the demos directory (default: the workspace)'),
        timeout_seconds: z.number().int().positive().optional().describe(`Default ${DEFAULT_TIMEOUT}, at most ${MAX_TIMEOUT}`),
        reason: z.string().optional().describe('Why, in a few words: shown to the owner where they are asked'),
      },
      run: async (args) => {
        const command = typeof args.command === 'string' ? args.command.trim() : '';
        if (!command) return 'Not run: no command.';
        const cwd = placeFor(lane, typeof args.cwd === 'string' ? args.cwd : undefined);
        if (!cwd) return 'Not run: cwd is not a directory in the workspace, a temporary directory or the demos directory.';
        if (!allowed(lane.rules(), command, undefined, [lane.workspace, ...lane.places()])) {
          if (lane.auto) return 'Not run: the repository’s allow list does not cover it. Run it in your own shell and request escalated permissions there; Codex’s automatic review decides.';
          const answer = await lane.ask({ name: 'Bash', input: { command }, ...(typeof args.reason === 'string' && args.reason ? { reason: args.reason } : {}) });
          if (!answer.allow) return `Not run: ${answer.message}`;
        }
        const seconds = Math.min(typeof args.timeout_seconds === 'number' ? args.timeout_seconds : DEFAULT_TIMEOUT, MAX_TIMEOUT);
        return execute(command, [], { cwd, env, shell: true, seconds });
      },
    },
    {
      name: 'git',
      description:
        'Runs git in your workspace, outside your sandbox (a worktree’s .git lies in the main repository, which your own shell cannot write): ' +
        `${[...GIT_ALLOWED].join(', ')}. No push and no settings; Seismic lands your branch. Pass the arguments after "git" as a list.`,
      schema: { args: z.array(z.string()).min(1).describe('The arguments after "git", e.g. ["commit", "-m", "Fix the export"]') },
      run: async (args) => {
        const list = Array.isArray(args.args) ? args.args.map(String) : [];
        const refusal = gitRefusal(list);
        if (refusal) return `Not run: ${refusal}`;
        return execute('git', list, { cwd: lane.workspace, env, shell: false, seconds: DEFAULT_TIMEOUT });
      },
    },
  ];
}
