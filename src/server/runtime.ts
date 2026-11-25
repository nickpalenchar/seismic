

import { LimitAttempts, limitWatch } from './limit-watch';
import { type PermissionUpdate, type SpawnedProcess, type SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { endSessionsHere } from './llms/harnesses/codexRpc';
import { agentIdentity } from './llms/harnesses/identity';
import { allowed } from './allow-rules';
import type { SeismicSkill } from './llms/skills/seismicSkill';
import type { CapabilityCheck } from './llms/models/capabilityCheck';
import type { SeismicModel } from './llms/models/seismicModel';
import type { AgentPermission } from './llms/agents/types';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { remote } from './hosts';
import type { z } from 'zod';
import { OWN_GROUP } from './spawn';
import type { ToolWatch } from './folder';
import { harnessChoice, type AgentAt, type AgentEffort, type AgentIdentity, type AgentRole, type AgentSetting, type ClaudeFile, type Harness } from '../core/types';
import { codexAsTrusted } from './trust';
import { messageOf } from '../core/text';

export interface AgentTool {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  
  run: (args: Record<string, unknown>) => Promise<string> | string;
}

export type AgentEvent =
  | { type: 'session'; id: string; setting?: AgentSetting; model?: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input: Record<string, unknown> }
  
  | { type: 'toolDone'; name: string; ok: boolean }
  




  | { type: 'denied'; name: string; input: Record<string, unknown>; by: DeniedBy; reason?: string }
  





  | { type: 'idle'; background?: number; more?: boolean }
  



  | { type: 'background'; tasks: { id: string; description: string }[] }
  



  | { type: 'lost'; message: string }
  






  | { type: 'error'; message: string; limit?: { resetsAt?: number }; ended?: true; token?: true };


export type DeniedBy = 'rule' | 'classifier' | 'mode' | 'hook' | 'seismic' | 'owner' | 'other';


export interface PermissionRequest {
  name: string;
  input: Record<string, unknown>;
  
  reason?: string;
  
  suggestions?: unknown;
}


export type PermissionAnswer = { allow: true; permissions?: PermissionUpdate[] } | { allow: false; message: string };

export interface AgentSpec {
  
  cwd: string;
  
  system: string;
  
  tools: AgentTool[];
  
  resume?: string;
  
  dirs?: string[];
  



  untrusted?: boolean;
  




  claudeHeld?: boolean;
  



  codexConfig?: boolean;
  
  plugins?: string[];
  
  skills?: SeismicSkill[];
  




  permission?: AgentPermission;
  




  checkModel?: (model: SeismicModel) => CapabilityCheck;
  
  env?: Record<string, string>;
  
  effort?: AgentEffort;
  
  model?: string;
  
  resolvedModel?: string;
  
  role?: AgentRole;
  
  at?: AgentAt;
  
  setting?: AgentSetting;
  




  contextUpdate?: () => string | undefined;
  



  watch?: ToolWatch;
  



  askOwner?: (request: PermissionRequest, signal: AbortSignal) => Promise<PermissionAnswer>;
  




  onLimit?: (until: number | null | undefined, retry?: () => void) => void;
  onEvent: (e: AgentEvent) => void;
}

export interface AgentSession {
  
  send(text: string, images?: string[]): void;
  
  close(): void;
  
  done: Promise<void>;
}

export interface AgentRuntime {
  
  start(spec: AgentSpec, firstMessage?: string, images?: string[]): AgentSession;
}

/** Earlier Claude sessions have no prefix. */
export function sessionHarness(id: string): Harness {
  return id.startsWith('codex:') ? 'codex' : id.startsWith('agy:') ? 'agy' : 'claude';
}

/**
 * A runtime that starts each agent of a group with its group's model and effort (`agentSetting`),
 * asked at every start; Claude Code's default model is no model given. `shown` hears the identity
 * of each session with `at` where it shows: at its start, again once the session names the model
 * it resolved, and with none once it ended; `session` tells one session from the next at the same place.
 */
export function withAgentSetting(
  runtime: AgentRuntime,
  setting: (role: AgentRole) => AgentSetting,
  shown?: (at: AgentAt, agent: AgentIdentity | undefined, session: object) => void,
): AgentRuntime {
  return {
    start(spec, firstMessage, images) {
      if (!spec.role) return runtime.start(spec, firstMessage, images);
      const chosen = spec.setting ?? { ...setting(spec.role), ...(spec.resume ? { harness: sessionHarness(spec.resume) } : {}) };
      const choice = harnessChoice(chosen);
      const { model: _, resolvedModel, ...rest } = spec;
      const model = resolvedModel ?? choice.model;
      const identity: AgentIdentity = { harness: chosen.harness ?? 'claude', ...(model === 'default' ? {} : { model }) };
      const run = <T>(fn: () => T): T => agentIdentity.run(identity, fn);
      const at = shown && spec.at;
      const token = {};
      if (at) shown(at, { ...identity }, token);
      const session = run(() => runtime.start({
        ...rest, setting: chosen, effort: chosen.harness === 'agy' ? chosen.agy?.effort : choice.effort, ...(model === 'default' ? {} : { model }),
        tools: spec.tools.map((tool) => ({ ...tool, run: (args) => run(() => tool.run(args)) })),
        ...(spec.askOwner ? { askOwner: (request, signal) => run(() => spec.askOwner!(request, signal)) } : {}),
        onEvent: (event) => {
          if (event.type === 'session') {
            const resolved = event.model ?? (event.setting ? harnessChoice(event.setting).model : undefined);
            if (resolved && resolved !== 'default' && resolved !== identity.model) {
              identity.model = resolved;
              if (at) shown(at, { ...identity }, token);
            }
          }
          run(() => spec.onEvent(event.type === 'session' && !event.setting ? { ...event, setting: chosen } : event));
        },
      }, firstMessage, images));
      if (at) {
        const over = () => shown(at, undefined, token);
        session.done.then(over, over);
      }
      return session;
    },
  };
}

/**
 * A runtime whose Codex agents do not ask the owner for a command that a rule of the repository's
 * allow list covers (`allow-rules.ts`): Claude Code applies that list itself, Codex has none of
 * its own that Seismic sets. `rules` are those the owner confirmed for the agent's `cwd`; none while
 * the repository's configuration is held (`claudeHeld`) or not read at all (`untrusted`). Such a
 * command may also have network (`networkOnly`), as `seismic_run` gives it; a request for anything
 * beyond that (a path grant, other permissions) is always asked.
 */
export function withTrustedAllow(runtime: AgentRuntime, rules: (cwd: string) => string[]): AgentRuntime {
  return {
    start(spec, firstMessage, images) {
      const ask = spec.askOwner;
      if (!ask || spec.untrusted || spec.claudeHeld || spec.setting?.harness !== 'codex') return runtime.start(spec, firstMessage, images);
      return runtime.start({
        ...spec,
        askOwner: (request, signal) => {
          const { command, kind, grantRoot } = request.input;
          if (request.name === 'Bash' && (kind == null || kind === 'command') && grantRoot == null && networkOnly(request.input) && allowed(rules(spec.cwd), command, undefined, [spec.cwd, ...(spec.dirs ?? [])])) return Promise.resolve({ allow: true });
          return ask(request, signal);
        },
      }, firstMessage, images);
    },
  };
}

/**
 * Whether a Codex approval asks for no more than its command and, at most, network for it: no
 * additional permissions but network (`{ network: { enabled: true } }`), or a host of Codex's
 * managed network (`networkApprovalContext`). A path grant or anything else rides on no rule.
 */
export function networkOnly(input: Record<string, unknown>): boolean {
  const extra = input.additionalPermissions;
  if (extra != null) {
    if (typeof extra !== 'object' || Array.isArray(extra)) return false;
    const { network, ...rest } = extra as Record<string, unknown>;
    if (Object.values(rest).some((v) => v != null)) return false;
    if (network != null && network !== true && !(typeof network === 'object' && Object.keys(network).length === 1 && (network as Record<string, unknown>).enabled === true)) return false;
  }
  const context = input.networkApprovalContext;
  return context == null || (typeof context === 'object' && typeof (context as Record<string, unknown>).host === 'string');
}

/**
 * A runtime whose Codex agents load the repository's own Codex configuration (`codexConfig`) only
 * where the workstation's `.codex/` is exactly what the owner trusted for the repository `cwd` lies
 * in (`trusted`, `codexAsTrusted`), checked at every start and resume: one new on the default branch,
 * or changed in the workstation since (by the card, or a rebase onto a change not trusted yet), is not
 * loaded until the owner trusts it.
 */
export function withCodexTrust(runtime: AgentRuntime, trusted: (cwd: string) => Record<string, ClaudeFile> | undefined): AgentRuntime {
  return {
    start(spec, firstMessage, images) {
      if (spec.setting?.harness !== 'codex' || remote(spec.cwd)) return runtime.start(spec, firstMessage, images);
      const { codexConfig: _, ...rest } = spec;
      return runtime.start({ ...rest, ...(codexAsTrusted(spec.cwd, trusted(spec.cwd)) ? { codexConfig: true } : {}) }, firstMessage, images);
    },
  };
}

/**
 * A runtime that starts each agent working in a repository whose own Claude Code settings wait for
 * the owner's confirmation (`untrusted`, by the agent's `cwd`) without them: their hooks, MCP
 * servers and helpers would run outside the permission checks. Claude Code then reads none of the
 * repository's files, its CLAUDE.md neither, so the agent gets that in its instructions instead.
 * A Codex agent reads none of them anyway (nor CLAUDE.md), so it starts as it would, only marked
 * (`claudeHeld`): `untrusted` stays for the sessions that must not run on Codex (a review card's).
 * Where finding that out takes git, the agent starts once git has answered (`startingLater`): the
 * server does not wait for it.
 */
export function withRepoTrust(runtime: AgentRuntime, untrusted: (cwd: string) => boolean | Promise<boolean>): AgentRuntime {
  return {
    start(spec, firstMessage, images) {
      
      if (spec.untrusted) return runtime.start(spec, firstMessage, images);
      const start = (held: boolean) => {
        if (!held) return runtime.start(spec, firstMessage, images);
        if (spec.setting?.harness === 'codex' || spec.setting?.harness === 'agy') return runtime.start({ ...spec, claudeHeld: true }, firstMessage, images);
        const file = join(spec.cwd, 'CLAUDE.md');
        const notes = !remote(spec.cwd) && existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
        const system = notes ? `${spec.system}\n\nThe repository's CLAUDE.md:\n\n${notes}` : spec.system;
        return runtime.start({ ...spec, untrusted: true, system }, firstMessage, images);
      };
      const held = untrusted(spec.cwd);
      if (typeof held === 'boolean') return start(held);
      
      return startingLater(
        held.catch(() => true).then((h) => () => start(h)),
        spec,
      );
    },
  };
}

/**
 * A session that starts once `starting` settles with how to start it: what it is sent meanwhile
 * reaches it then. Closed before, it never starts. One that fails to start ends with the error.
 */
export function startingLater(starting: Promise<() => AgentSession>, spec: AgentSpec): AgentSession {
  let session: AgentSession | undefined;
  let closed = false;
  const waiting: { text: string; images?: string[] }[] = [];
  const done = starting.then(async (start) => {
    if (closed) return;
    try {
      session = start();
    } catch (e) {
      spec.onEvent({ type: 'error', message: messageOf(e) });
      return;
    }
    for (const m of waiting.splice(0)) session.send(m.text, m.images);
    await session.done;
  });
  return {
    send: (text, images) => (session ? session.send(text, images) : void waiting.push({ text, images })),
    close: () => {
      closed = true;
      session?.close();
    },
    done,
  };
}


export const LIMIT_LIFTED = 'The usage limit that stopped your last turn has reset. Go on where you stopped.';

/** For an agent that waits for the usage limit with nowhere to show it (`AgentSpec.onLimit`): nobody waits for its result. */
export const waitQuietly = () => {};

/**
 * A runtime whose agents with `onLimit` wait for the account's usage limit: the turn it stopped
 * waits, without its error and its end, and `margin` after the limit lifts (`limitLifts`) the
 * session is told to go on where it stopped; one that runs into the limit again waits anew.
 */
export function withLimitWait(runtime: AgentRuntime, margin = 10_000): AgentRuntime {
  return {
    start(spec, firstMessage, images) {
      const onLimit = spec.onLimit;
      if (!onLimit) return runtime.start(spec, firstMessage, images);
      const key = {};
      const attempts = new LimitAttempts();
      let waiting = false;
      
      let stopped = false;
      let closed = false;
      const session: AgentSession = runtime.start(
        {
          ...spec,
          onEvent: (e) => {
            if (closed) return;
            if (e.type === 'error' && e.limit) {
              if (stopped) return;
              stopped = true;
              const until = attempts.hit(e.limit, margin);
              limitWatch.cancel(key);
              waiting = true;
              if (until !== null) limitWatch.wait(key, until, () => {
                waiting = false;
                onLimit(undefined);
                session.send(LIMIT_LIFTED);
              });
              onLimit(until, () => {
                limitWatch.cancel(key);
                waiting = false;
                onLimit(undefined);
                session.send(LIMIT_LIFTED);
              });
            } else if (e.type === 'idle' && stopped) stopped = false;
            else {
              if (e.type === 'text' || e.type === 'tool') {
                attempts.count = 0;
                limitWatch.cancel(key);
                if (waiting) onLimit(undefined);
                waiting = false;
              }
              spec.onEvent(e);
            }
          },
        },
        firstMessage,
        images,
      );
      return {
        send: (text, images) => {
          limitWatch.cancel(key);
          if (waiting) onLimit(undefined);
          waiting = false;
          session.send(text, images);
        },
        close: () => {
          closed = true;
          if (waiting) onLimit(undefined);
          limitWatch.cancel(key);
          waiting = false;
          session.close();
        },
        done: session.done,
      };
    },
  };
}


const here = new Set<ChildProcess>();

/**
 * Starts Claude Code on this machine as the SDK would, but out of the terminal's process group
 * (`OWN_GROUP`), so that Ctrl-C reaches Seismic alone, which waits for the agent to pause. Its stderr
 * goes to `stderr`, which the SDK reads only from a process it started itself.
 */
export function spawnHere(stderr: (text: string) => void): (o: SpawnOptions) => SpawnedProcess {
  return (o) => {
    const p = spawn(o.command, o.args, { cwd: o.cwd, env: o.env, signal: o.signal, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: OWN_GROUP });
    here.add(p);
    p.once('exit', () => here.delete(p));
    p.stderr!.setEncoding('utf8').on('data', stderr);
    return p as SpawnedProcess;
  };
}

/** Has `endAgentsHere` end `p` too, with what it runs, as Seismic stops: a command Seismic runs for a Codex agent (`codexExecTools.ts`). */
export function endWithAgents(p: ChildProcess) {
  here.add(p);
  p.once('exit', () => here.delete(p));
}

/** A session's error with what Claude Code said last on stderr, unless the error names it already. */
export function withStderr(message: string, stderr: string): string {
  const tail = stderr.trim();
  return tail && !message.includes(tail) ? `${message}. stderr: ${tail}` : message;
}

/**
 * Ends the Claude Code processes started on this machine, and what each runs, as Seismic stops: once
 * they paused for it, or at once when the owner would not wait. Without a terminal's Ctrl-C reaching
 * them, they would otherwise go on with a turn that nobody hears any more. Not on Windows, where they
 * stay in the console (`OWN_GROUP`) and a kill would end them at once, before they end what they run:
 * there they end as before, with their stdin.
 */
export function endAgentsHere(force = false) {
  const sessionsDone = endSessionsHere(force);
  if (!OWN_GROUP && !force) return sessionsDone;
  for (const p of here) {
    try {
      if (OWN_GROUP && p.pid) process.kill(-p.pid, force ? 'SIGKILL' : 'SIGTERM');
      else if (force && p.pid) {
        
        const killer = spawn('taskkill.exe', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', detached: true });
        killer.on('error', () => { try { p.kill('SIGKILL'); } catch {  } });
        killer.unref();
      }
    } catch {
      
    }
  }
  return sessionsDone;
}






export const idleRuntime: AgentRuntime = {
  start(spec, firstMessage, images) {
    let end!: () => void;
    const done = new Promise<void>((r) => (end = r));
    const heard = (text: string, images: string[] = []) =>
      console.log(`idle worker in ${spec.cwd} is told${images.length ? ` (with ${images.length} image${images.length === 1 ? '' : 's'})` : ''}:\n${text}\n---`);
    if (firstMessage) heard(firstMessage, images);
    return { send: heard, close: () => end(), done };
  },
};

/**
 * Seismic's own environment minus what belongs to a Claude Code session that may have started it (but
 * the login of a machine without a keychain, `CLAUDE_CODE_OAUTH_TOKEN`), minus the supervisor's
 * mark (an Seismic an agent starts, a scratch one for a demo, supervises itself), and minus what has
 * the compiled binary run scripts as Bun.
 */
export function cleanEnv(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([k]) => k === 'CLAUDE_CODE_OAUTH_TOKEN' || !/^(CLAUDE_CODE_|CLAUDECODE$|CLAUDE_PID$|SEISMIC_SUPERVISED$|SEISMIC_FROM_APP$|OBEYA_SUPERVISED$|OBEYA_FROM_APP$|BUN_BE_BUN$)/.test(k)));
}

/**
 * What an agent's command line printed once it exited within `timeout` ms, in the agents' environment; null otherwise.
 * Never holds up the server. The limit is the one `agy models` has: a login check that answers a cold start or a
 * slow network in 5 s or more is still signed in, and no page waits on it (`HarnessCheck.known`).
 */
export function answered(command: string, args: string[], timeout = 15_000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { env: cleanEnv(), timeout, maxBuffer: 1 << 20, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout)));
  });
}
