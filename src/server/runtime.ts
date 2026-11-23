// Agent sessions behind a small interface, so the orchestration can be tested without a model.

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
  /** Returns the text the agent sees as the tool result. */
  run: (args: Record<string, unknown>) => Promise<string> | string;
}

export type AgentEvent =
  | { type: 'session'; id: string; setting?: AgentSetting; model?: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input: Record<string, unknown> }
  /** A tool call of the agent's own (not a subagent's) ended; `ok` false when it failed (a command's non-zero exit, say). */
  | { type: 'toolDone'; name: string; ok: boolean }
  /**
   * A tool call was refused without anyone being asked: by a rule of the settings, auto mode's
   * classifier, the permission mode, a hook (`seismic`: Seismic's own, `refuseForegroundWait`).
   * `reason`: the deciding component's own words, when it gave any.
   */
  | { type: 'denied'; name: string; input: Record<string, unknown>; by: DeniedBy; reason?: string }
  /**
   * The turn ended; the session waits for the next message. `background` counts the agent's
   * background tasks still running: when one ends, the session wakes itself for a new turn.
   * `more`: a message sent during the turn came too late for it and starts a turn of its own,
   * which follows without another message.
   */
  | { type: 'idle'; background?: number; more?: boolean }
  /**
   * The agent's background tasks still running changed, in a turn or between turns: a deploy
   * watcher that ends, say, which then wakes the session. `tasks`: all that run now, by the SDK's id.
   */
  | { type: 'background'; tasks: { id: string; description: string }[] }
  /**
   * The session's machine is out of reach (a worker on an SSH host whose connection failed or
   * dropped): the session has ended, and resumes by its id once the host answers again.
   */
  | { type: 'lost'; message: string }
  /**
   * The turn failed. `limit` when the account's usage limit stopped it (the five-hour session
   * limit, say): it lifts again at `resetsAt` (milliseconds) when the API said when. `ended` when
   * the session died with it and took the work it had started along (a Codex app-server's
   * descendants), the app in the workstation included. `token` when the session signed in with a token
   * rather than this machine's account (`CardEvent.token`).
   */
  | { type: 'error'; message: string; limit?: { resetsAt?: number }; ended?: true; token?: true };

/** Who refused a tool call (`SDKPermissionDeniedMessage.decision_reason_type`, sorted). */
export type DeniedBy = 'rule' | 'classifier' | 'mode' | 'hook' | 'seismic' | 'owner' | 'other';

/** A tool call the settings want a person to confirm (an `ask` rule, a safety check). */
export interface PermissionRequest {
  name: string;
  input: Record<string, unknown>;
  /** Why it is asked, when Claude Code says. */
  reason?: string;
  /** Claude Code's suggestions of permission updates for the call (`canUseTool`'s `suggestions`), as it gives them. */
  suggestions?: unknown;
}

/** The owner's answer; `permissions`: updates the asking Claude Code session takes with the allowed call (`updatedPermissions`). */
export type PermissionAnswer = { allow: true; permissions?: PermissionUpdate[] } | { allow: false; message: string };

export interface AgentSpec {
  /** Where the agent works; a workstation on another machine (`ssh://<host>/…`) runs it there (`hosts.ts`). */
  cwd: string;
  /** Appended to the default system prompt. */
  system: string;
  /** Tools the agent reaches as `mcp__seismic__<name>`. */
  tools: AgentTool[];
  /** Resume this session instead of starting one. */
  resume?: string;
  /** Directories outside `cwd` the agent works in as in its own (a looked-up thread's output directory). */
  dirs?: string[];
  /**
   * The repository's own Claude Code settings in `cwd` wait for the owner to confirm them
   * (`withRepoTrust`): the session reads the user's settings alone, none of the repository's.
   */
  untrusted?: boolean;
  /**
   * The repository's own Claude Code settings in `cwd` wait for the owner to confirm them, for a
   * Codex session (`withRepoTrust`), which reads none of them anyway: it just takes no command from
   * their allow list without asking (`withTrustedAllow`).
   */
  claudeHeld?: boolean;
  /**
   * The repository's own Codex configuration in `cwd` (its `.codex/`) is to the byte what the owner
   * trusted (`withCodexTrust`): a Codex session loads it. Without, it loads none of the repository's.
   */
  codexConfig?: boolean;
  /** Directories of local Claude Code plugins loaded into the session (skills, mainly). */
  plugins?: string[];
  /** Seismic's skills for the session; each harness attaches them its own way (`skills/attachedSkills.ts`). */
  skills?: SeismicSkill[];
  /**
   * What the agent may do without asking, as no harness names it (`agents/permission.ts`); without
   * one it follows the owner's `--permission-mode`. Read-only agents get no tools that change files
   * or run commands.
   */
  permission?: AgentPermission;
  /**
   * Asked by the harness once it has resolved the model the session runs on, before its first turn:
   * what the agent that runs it asks of that model (`SeismicAgent.checkCapabilities`). A check that is
   * not `ok` ends the session with its `problem`; the harness takes its messages through `apply`.
   */
  checkModel?: (model: SeismicModel) => CapabilityCheck;
  /** Added to the agent's environment (Seismic's own, cleaned). */
  env?: Record<string, string>;
  /** How much the model thinks; low for quick, small jobs. */
  effort?: AgentEffort;
  /** The model, when not the default: a smaller one for small, frequent jobs. */
  model?: string;
  /** A model named by an earlier session, pinned when that run resumes or is retried. */
  resolvedModel?: string;
  /** The group the agent belongs to, whose model and effort the owner chooses (`withAgentSetting`). */
  role?: AgentRole;
  /** Where the agent shows at work: its harness and model show there while its session lives (`withAgentSetting`). */
  at?: AgentAt;
  /** Pinned to a card's run; changing defaults must not switch its harness or model on resume. */
  setting?: AgentSetting;
  /**
   * Asked after every tool step of the agent's own (not a subagent's): what changed since the
   * session's instructions were built, or what waited for its next step, for the agent to read with
   * that step's result without being stopped; nothing when nothing did. Asking takes it: it is read.
   */
  contextUpdate?: () => string | undefined;
  /**
   * Told before and after each tool call of the agent and its subagents, and waited for: what a
   * call changes in a folder without git becomes the card's (`FolderWorkstations.watch`).
   */
  watch?: ToolWatch;
  /**
   * Asked when a tool call needs a person's permission; settles with their answer. Without it such a
   * call is refused, as in any session without someone to ask.
   */
  askOwner?: (request: PermissionRequest, signal: AbortSignal) => Promise<PermissionAnswer>;
  /**
   * The agent waits for the account's usage limit instead of failing on it (`withLimitWait`): a turn
   * the limit stops is neither an error nor over, and this hears when the agent goes on by itself,
   * and nothing once it does or its session ends. Without it, the turn fails with the error's `limit`.
   */
  onLimit?: (until: number | null | undefined, retry?: () => void) => void;
  onEvent: (e: AgentEvent) => void;
}

export interface AgentSession {
  /** Sends a user message, with images (files) after the text; the session takes it at the next opportunity. */
  send(text: string, images?: string[]): void;
  /** Ends the session after the current step. */
  close(): void;
  /** Settles when the session has ended. */
  done: Promise<void>;
}

export interface AgentRuntime {
  /** Without a first message the agent starts up and waits, so a later `send` skips the start-up. */
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
      // one already started without them (a review card's) brings its notes from elsewhere
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
      // where it cannot be told, the repository's settings are not read
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

/** What an agent the usage limit stopped is told once it lifts. */
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
      // the end of the turn the limit stopped is not the end of its work
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

/** Claude Code processes started on this machine that still run. */
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
        // taskkill handles the process tree; do not wait for the helper on an explicit force.
        const killer = spawn('taskkill.exe', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', detached: true });
        killer.on('error', () => { try { p.kill('SIGKILL'); } catch { /* already gone */ } });
        killer.unref();
      }
    } catch {
      // gone already
    }
  }
  return sessionsDone;
}

/**
 * Workers of a scratch Seismic for a demo (`--idle-workers`): a started card is in progress, but no
 * agent works on it, so it stays as staged and costs nothing. What a worker is told goes into the
 * server's log, for a demo to show what reaches the agent.
 */
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
