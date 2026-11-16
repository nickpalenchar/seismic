/**
 * The Claude harness: agents run through the Claude Agent SDK, on the Claude Code login of the
 * machine. The contract it fulfils and the wrappers around it are in `src/server/runtime.ts`.
 */

import { seismicEnv } from '../../../core/env';
import { createSdkMcpServer, type HookInput, type HookJSONOutput, type PermissionUpdate, query, type SDKRateLimitInfo, type SDKResultMessage, type SDKUserMessage, tool } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { LOST, remote, sessionFiles, type SshHost } from '../../hosts';
import { localBin, which } from '../../path';
import { filesIn } from '../../files';
import { mediaType } from '../../images';
import { COMPILED } from '../../resources';
import type { Messages } from '../../../core/messages';
import type { ToolCall } from '../../folder';
import { messageOf } from '../../../core/text';
import { claudeLoginFailed } from '../../../core/login';
import { type AgentRuntime, type AgentSpec, type AgentTool, cleanEnv, type DeniedBy, spawnHere, withStderr } from '../../runtime';

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];

/**
 * The Claude Code the agents run on: the one `SEISMIC_CLAUDE` names; from the checkout, the binary
 * the Agent SDK brings for this platform (undefined: the SDK finds it itself); in the compiled
 * binary, which carries none, the machine's own installation, on the PATH or where the official
 * installer puts it (a path that does not exist when there is none, for the SDK to say so).
 */
export function claudeExecutable(env: Record<string, string | undefined> = process.env, compiled = COMPILED, platform: string = process.platform): string | undefined {
  const named = seismicEnv('CLAUDE', env);
  if (named) return named;
  if (!compiled) return undefined;
  const installed = join(localBin(), platform === 'win32' ? 'claude.exe' : 'claude');
  const onPath = which('claude', env);
  // npm's `claude.cmd` on Windows is no program to start; the installer's binary is
  return onPath && !/\.(cmd|bat|ps1)$/i.test(onPath) ? onPath : installed;
}

/** Runs agents through the Claude Agent SDK, on the Claude Code login of the machine. */
export const sdkRuntime: AgentRuntime = {
  start(spec, firstMessage, images) {
    const inbox = new Inbox();
    const there = remote(spec.cwd);
    // a session on another machine: whether its connection was lost, rather than the session failing
    let lost = false;
    // not on this machine's account: on another machine, or here on CLAUDE_CODE_OAUTH_TOKEN
    const token = there || ({ ...cleanEnv(), ...spec.env }).CLAUDE_CODE_OAUTH_TOKEN ? { token: true as const } : {};
    const files = there ? sessionFiles(there.host.o.home, spec.plugins ?? []) : undefined;
    if (there && files) {
      const dir = there.host.prepare(files);
      inbox.carry = (text, images) => carryImages(there.host, dir, text, images, join(there.host.o.home, 'files'));
    }
    if (firstMessage !== undefined) inbox.push(firstMessage, images);
    const abort = new AbortController();
    const server = (name: string, tools: AgentTool[]) =>
      createSdkMcpServer({
        name,
        version: '1.0.0',
        // the agent needs these from the first step, not behind a tool search
        alwaysLoad: true,
        tools: tools.map((t) =>
          tool(t.name, t.description, t.schema, async (args) => ({ content: [{ type: 'text' as const, text: await t.run(args as Record<string, unknown>) }] })),
        ),
      });
    const legacy = spec.resume ? legacyTools(spec.tools) : [];
    const ownTools = [...spec.tools.map((t) => `mcp__seismic__${t.name}`), ...legacy.map((t) => `mcp__${LEGACY_SERVER}__${t.name}`)];
    const claude = there ? 'claude' : claudeExecutable();
    // a watched call's end is waited for before the agent goes on
    const watched = spec.watch ? [{ hooks: [async (input: HookInput) => (await spec.watch!.after(toolCall(input)), {})] }] : [];
    // what Claude Code here last said on stderr, for a session that ends with an error
    let stderr = '';
    const q = query({
      prompt: inbox,
      options: {
        cwd: there ? there.path : spec.cwd,
        abortController: abort,
        ...(claude ? { pathToClaudeCodeExecutable: claude } : {}),
        spawnClaudeCodeProcess:
          there && files
            ? there.host.session({
                cwd: there.path,
                files,
                onExit: (code) => (lost = code === LOST && !abort.signal.aborted),
              })
            : spawnHere((text) => (stderr = (stderr + text).slice(-STDERR_TAIL))),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: spec.system },
        mcpServers: { seismic: server('seismic', spec.tools), ...(legacy.length ? { [LEGACY_SERVER]: server(LEGACY_SERVER, legacy) } : {}) },
        ...(spec.plugins?.length ? { plugins: spec.plugins.map((path) => ({ type: 'local' as const, path })) } : {}),
        ...(spec.readOnly
          ? { tools: READ_ONLY_TOOLS, allowedTools: [...READ_ONLY_TOOLS, ...ownTools], permissionMode: 'dontAsk' as const }
          : // a worker's own tools are allowed by the hook below: as allowedTools they would have the SDK warn that they pass by canUseTool
            { ...(spec.askOwner ? {} : { allowedTools: ownTools }), permissionMode: spec.permissionMode ?? 'auto' }),
        // without the repository's settings, which Claude Code reads with its CLAUDE.md
        ...(spec.untrusted ? { settingSources: ['user' as const] } : {}),
        ...(spec.resume ? { resume: spec.resume } : {}),
        ...(spec.dirs?.length ? { additionalDirectories: spec.dirs } : {}),
        ...(spec.effort ? { effort: spec.effort } : {}),
        ...(spec.model ? { model: spec.model } : {}),
        // on another machine only what the session itself needs: that machine has its own PATH and home
        env: there ? { ...spec.env } : { ...cleanEnv(), ...spec.env },
        ...(spec.askOwner ? { canUseTool: (name: string, input: Record<string, unknown>, o: { signal: AbortSignal; decisionReason?: string; suggestions?: unknown }) => askOwner(spec.askOwner!, name, input, o) } : {}),
        hooks: {
          PreToolUse: [
            { matcher: `mcp__(seismic|${LEGACY_SERVER})__.*`, hooks: [async () => ownToolAllowed] },
            ...(spec.watch ? [{ hooks: [async (input: HookInput) => (await spec.watch!.before(toolCall(input)), {})] }] : []),
            {
              matcher: 'Bash',
              hooks: [
                async (input) => {
                  const out = refuseForegroundWait(input);
                  if (input.hook_event_name === 'PreToolUse' && 'hookSpecificOutput' in out)
                    spec.onEvent({ type: 'denied', name: input.tool_name, input: (input.tool_input ?? {}) as Record<string, unknown>, by: 'obeya' });
                  return out;
                },
              ],
            },
          ],
          // a subagent's step would pass it to the subagent, which the agent may never hear of
          PostToolUse: [
            ...watched,
            { hooks: [async (input) => withContext('PostToolUse', input.agent_id ? undefined : spec.contextUpdate?.())] },
          ],
          PostToolUseFailure: [
            ...watched,
            { hooks: [async (input) => withContext('PostToolUseFailure', input.agent_id ? undefined : spec.contextUpdate?.())] },
          ],
        },
      },
    });
    let background: { id: string; description: string }[] = [];
    // what the agent's tool calls were called with, by id: a denial names only the call
    const inputs = new Map<string, Record<string, unknown>>();
    // and which tool each was, for when it ends
    const names = new Map<string, string>();
    // the account's usage limits as last reported, and whether the turn's request was refused for one
    let limits: SDKRateLimitInfo | undefined;
    let limited = false;
    const done = (async () => {
      try {
        for await (const m of q) {
          if (m.type === 'system' && m.subtype === 'init') spec.onEvent({ type: 'session', id: m.session_id, model: m.model });
          else if (m.type === 'system' && m.subtype === 'background_tasks_changed') {
            const running = backgroundWork(m.tasks);
            if (JSON.stringify(running) !== JSON.stringify(background)) spec.onEvent({ type: 'background', tasks: running });
            background = running;
          }
          else if (m.type === 'rate_limit_event') limits = m.rate_limit_info;
          else if (m.type === 'system' && m.subtype === 'permission_denied') {
            if (!m.agent_id) spec.onEvent({ type: 'denied', name: m.tool_name, input: inputs.get(m.tool_use_id) ?? {}, by: deniedBy(m.decision_reason_type), ...(m.decision_reason?.trim() ? { reason: m.decision_reason.trim() } : {}) });
          }
          // an API error the CLI words as the agent's reply; the turn's result reports it
          else if (m.type === 'assistant' && m.error) limited ||= m.error === 'rate_limit';
          else if (m.type === 'assistant' && !m.parent_tool_use_id) {
            for (const block of m.message.content) {
              if (block.type === 'text' && block.text.trim()) spec.onEvent({ type: 'text', text: block.text });
              else if (block.type === 'tool_use') inputs.set(block.id, (block.input ?? {}) as Record<string, unknown>), names.set(block.id, currentToolName(block.name)), spec.onEvent({ type: 'tool', name: currentToolName(block.name), input: (block.input ?? {}) as Record<string, unknown> });
            }
          } else if (m.type === 'user' && !m.parent_tool_use_id && Array.isArray(m.message.content)) {
            for (const block of m.message.content) {
              if (block.type === 'tool_result') spec.onEvent({ type: 'toolDone', name: names.get(block.tool_use_id) ?? '', ok: !block.is_error });
            }
          } else if (m.type === 'result') {
            const failed = resultFailure(m);
            const limit = failed ? usageLimit(failed, limited, limits) : undefined;
            limited = false;
            if (failed) spec.onEvent({ type: 'error', message: failed, ...(limit ? { limit } : {}), ...token });
            spec.onEvent({ type: 'idle', background: background.length, ...(inbox.taken(m) ? {} : { more: true }) });
          }
        }
      } catch (e) {
        if (!abort.signal.aborted && !lost) spec.onEvent({ type: 'error', message: withStderr(messageOf(e), stderr), ...token });
      }
      if (lost && !abort.signal.aborted) spec.onEvent({ type: 'lost', message: `the connection to ${there!.host.name} was lost` });
    })();
    return {
      send: (text, images) => inbox.push(text, images),
      close: () => {
        inbox.end();
        abort.abort();
      },
      done,
    };
  },
};

/** How much of what Claude Code said last on stderr a session that ended with an error reports. */
const STDERR_TAIL = 2000;

/**
 * What made a turn fail, or nothing when it did not. A turn that failed on the API (not logged in,
 * say) ends as a `success` with `is_error` and the error in `result`.
 */
export function resultFailure(m: SDKResultMessage): string | undefined {
  if (m.subtype === 'success') return m.is_error ? m.result.trim() || 'error' : undefined;
  return m.errors?.filter((e) => e.trim()).join('; ') || m.subtype;
}

/**
 * Whether a failed turn hit the account's usage limit, and when that lifts: the request was refused
 * for it, the limits last reported say so, or (from a CLI that reports neither) the message does
 * ("You've hit your session limit · resets 2:40pm").
 */
export function usageLimit(failure: string, refused: boolean, limits: SDKRateLimitInfo | undefined, now = Date.now()): { resetsAt?: number } | undefined {
  const rejected = limits?.status === 'rejected';
  if (!refused && !rejected && !/\bhit your .*limit\b/i.test(failure)) return undefined;
  // the API gives seconds
  if (rejected && limits.resetsAt) return { resetsAt: limits.resetsAt * 1000 };
  const said = resetIn(failure, now);
  return said ? { resetsAt: said } : {};
}

/**
 * When the message says the limit resets, as the CLI words it ("resets 7:20pm (Europe/Berlin)"):
 * the next such time in that zone, or one that passed within the hour. Nothing for a message that
 * names no time, or a day as well (a weekly limit).
 */
export function resetIn(message: string, now = Date.now()): number | undefined {
  const m = /\bresets (\d{1,2})(?::(\d{2}))?\s*([ap]m)\b(?:\s*\(([^)]+)\))?/i.exec(message);
  if (!m) return undefined;
  const hour = (Number(m[1]) % 12) + (m[3]!.toLowerCase() === 'pm' ? 12 : 0);
  const minute = Number(m[2] ?? 0);
  let zone = m[4]?.trim();
  try {
    if (zone) new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zone = undefined;
  }
  // the date there now, and that time on it or the next day
  const day = wallClock(now, zone);
  for (const add of [0, 1]) {
    const at = fromWallClock(day.year, day.month, day.day + add, hour, minute, zone);
    if (at > now - 3_600_000) return at;
  }
  return undefined;
}

/** The date and time a clock in `zone` (the machine's own without one) shows at `at`, as UTC fields. */
function wallClock(at: number, zone: string | undefined) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(at)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  return parts;
}

/** The moment a clock in `zone` shows that date and time. */
function fromWallClock(year: number, month: number, day: number, hour: number, minute: number, zone: string | undefined): number {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  const offset = (at: number) => {
    const w = wallClock(at, zone);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(at / 1000) * 1000;
  };
  // once more with the offset at the result, across a change of summer time
  const guess = wanted - offset(wanted);
  return wanted - offset(guess);
}

/** A usage limit that does not say when it lifts is tried again after this. */
const LIMIT_RETRY = 15 * 60_000;

/** A usage limit that should have lifted already is tried again after this. */
const LIMIT_AGAIN = 60_000;

/** When to go on after the usage limit stopped a turn: `margin` after it lifts, so that clocks a little apart do not matter. */
export function limitLifts(limit: { resetsAt?: number }, margin: number, now = Date.now()): number {
  const reset = limit.resetsAt;
  return !reset ? now + LIMIT_RETRY : reset > now ? reset + margin : now + LIMIT_AGAIN;
}

/** Sorts the SDK's `decision_reason_type` of a denial. */
export function deniedBy(type: string | undefined): DeniedBy {
  switch (type) {
    case 'rule':
    // a Bash command whose parts the rules decided one by one
    case 'subcommandResults':
      return 'rule';
    case 'classifier':
      return 'classifier';
    case 'mode':
    // a session with nobody to ask
    case 'asyncAgent':
      return 'mode';
    case 'hook':
      return 'hook';
    default:
      return 'other';
  }
}

/**
 * Passes a tool call that needs a person's permission to the owner, with Claude Code's suggestions
 * for it; the session takes the permission updates an answer brings. Claude Code's own question
 * tool has nobody to answer it in Seismic; the agent's tools of Seismic do.
 */
export async function askOwner(
  ask: NonNullable<AgentSpec['askOwner']>,
  name: string,
  input: Record<string, unknown>,
  o: { signal: AbortSignal; decisionReason?: string; suggestions?: unknown },
): Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] } | { behavior: 'deny'; message: string }> {
  if (name === 'AskUserQuestion') return { behavior: 'deny', message: 'Nobody answers this tool here. Ask the owner with the ask tool of Seismic (mcp__seismic__ask) instead.' };
  const answer = await ask({ name, input, ...(o.decisionReason?.trim() ? { reason: o.decisionReason.trim() } : {}), ...(o.suggestions != null ? { suggestions: o.suggestions } : {}) }, o.signal);
  if (!answer.allow) return { behavior: 'deny', message: answer.message };
  return answer.permissions?.length ? { behavior: 'allow', updatedInput: input, updatedPermissions: answer.permissions } : { behavior: 'allow', updatedInput: input };
}

/** A session's failure in the owner's words. */
export function failureReason(message: string, t: Messages): string {
  if (claudeLoginFailed(message)) return t.failure.notLoggedIn;
  return t.failure.session(message);
}

/** Background work that ended wakes the agent within this; a turn that waits longer without a sign counts as ended. */
export const BACKGROUND_GRACE = 10 * 60_000;

/**
 * Background work ends by its own limit well within this (a command run in the background after two
 * hours at most, a watcher after half an hour): it is only for a session that never says the work ended.
 */
export const BACKGROUND_LIMIT = 3 * 60 * 60_000;

/**
 * A turn of an agent that answers the owner (an idea's, a look-up's) that ended while its background
 * work runs: that work wakes the agent when it ends, so the turn waits for it, and the owner's words
 * meanwhile go into the session at once. Without a sign of the agent for a long while
 * (BACKGROUND_LIMIT while the work runs, BACKGROUND_GRACE after it ended), `over` ends the turn.
 */
export class BackgroundWait {
  /** How many of the agent's background tasks run, as the session last said. */
  running = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private over: () => void,
    private limits: { grace?: number; limit?: number } = {},
    /** The turn starts or stops waiting. */
    private onChange?: (waiting: boolean) => void,
  ) {}

  get waiting(): boolean {
    return this.timer !== undefined;
  }

  /** The turn ended: it waits for the agent's background work to wake it. */
  start() {
    const was = this.waiting;
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.onChange?.(false);
        this.over();
      },
      this.running > 0 ? (this.limits.limit ?? BACKGROUND_LIMIT) : (this.limits.grace ?? BACKGROUND_GRACE),
    );
    if (!was) this.onChange?.(true);
  }

  /** The agent's background work started or ended: a turn waiting for it waits as long as it runs. */
  changed(running: number) {
    this.running = running;
    if (this.waiting) this.start();
  }

  /** The agent goes on (a message, its work woke it), or its session ends: the turn waits no more. */
  stop() {
    if (!this.waiting) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.onChange?.(false);
  }
}

/** A foreground command may sleep this long; anything longer keeps the owner's notes from the agent. */
export const FOREGROUND_SLEEP_LIMIT = 30;

/** Short waits the refusal suggests; both pass it (tested), the first also where `timeout` is missing (macOS). */
export const BOUNDED_WAITS = [
  'for i in $(seq 1 15); do curl -sf localhost:3000 && break; sleep 2; done',
  "timeout 30 bash -c 'until curl -sf localhost:3000; do sleep 2; done'",
];

/**
 * Refuses a foreground Bash command that sleeps longer than the limit: a message sent meanwhile
 * reaches the agent only once the command is done.
 */
export function refuseForegroundWait(input: HookInput): HookJSONOutput {
  if (input.hook_event_name !== 'PreToolUse') return {};
  const { command, run_in_background } = (input.tool_input ?? {}) as { command?: unknown; run_in_background?: unknown };
  if (run_in_background || typeof command !== 'string' || foregroundSleep(command) <= FOREGROUND_SLEEP_LIMIT) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Not run: this command sleeps in the foreground for more than ${FOREGROUND_SLEEP_LIMIT} seconds (or in a loop with no bound), and a note from the owner reaches you only once a command is done. Wait in the background instead: run it with run_in_background, or watch for the condition with Monitor, and end your turn; you are woken when it finishes or fires. A short wait may stay in the foreground if bounded to ${FOREGROUND_SLEEP_LIMIT} seconds, e.g. \`${BOUNDED_WAITS[0]}\` or, where \`timeout\` is installed, \`${BOUNDED_WAITS[1]}\`.`,
    },
  };
}

/** Seismic's own tools run without asking anyone. */
/** A tool call as the hooks of `AgentSpec.watch` hear of it. */
/**
 * A resumed Claude session's history calls Seismic's tools by their names from before the rename to
 * Seismic (`mcp__obeya__report`, `mcp__obeya__to_obeya`): it gets them under those names as well,
 * and a call by an old name counts as a call of today's tool.
 */
const LEGACY_SERVER = 'obeya';

/** Today's tools under their old names, for a resumed session. */
export function legacyTools(tools: AgentTool[]): AgentTool[] {
  return tools.map((t) => ({ ...t, name: t.name === 'to_seismic' ? 'to_obeya' : t.name, description: `The former name of mcp__seismic__${t.name}, the same tool.` }));
}

/** A tool's name as Seismic knows it today, for a call by its old name. */
export function currentToolName(name: string): string {
  const old = `mcp__${LEGACY_SERVER}__`;
  if (!name.startsWith(old)) return name;
  const rest = name.slice(old.length);
  return `mcp__seismic__${rest === 'to_obeya' ? 'to_seismic' : rest}`;
}

function toolCall(input: HookInput): ToolCall {
  const i = input as { tool_use_id?: string; tool_name?: string; tool_input?: unknown };
  return { id: i.tool_use_id ?? '', name: currentToolName(i.tool_name ?? ''), input: (i.tool_input ?? {}) as Record<string, unknown> };
}

const ownToolAllowed: HookJSONOutput = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };

function withContext(event: 'PostToolUse' | 'PostToolUseFailure', text: string | undefined): HookJSONOutput {
  return text ? { hookSpecificOutput: { hookEventName: event, additionalContext: text } } : {};
}

/**
 * How many seconds a shell command sleeps in the foreground, read from the command line alone:
 * `sleep` with its durations (`sleep 90`, `sleep 5m`, `sleep 1m 30s`), times the iterations of the
 * loop it is in (a `for` over a word list, `seq` or `{a..b}`; `while` and `until` have no bound).
 * A command that `timeout N` starts counts at most N, wherever it stands (`cd app && timeout 30 bash
 * -c 'until …; do sleep 2; done'`). What runs behind `&` does not count, nor does the text of a
 * heredoc unless a shell runs it (`bash <<EOF`, `cat <<EOF | sh`). Commands that only sleep inside
 * scripts or programs they call are not seen.
 */
export function foregroundSleep(command: string): number {
  // redirections such as 2>&1 are words, not `&`
  const tokens = boundTimeouts(withoutHeredocs(command)).replace(/['"`]/g, ' ').match(/\d*[<>]&\d*-?|&>>?|&&|\|\||[;&|(){}\n]|[^\s;&|(){}<>]+|[<>]+/g) ?? [];
  // per open loop or group (and the command line itself): seconds of finished commands, and of the one in progress
  type Frame = { done: number; current: number; iterations: number; closer: string };
  const stack: Frame[] = [{ done: 0, current: 0, iterations: 1, closer: '' }];
  const top = () => stack.at(-1)!;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === 'sleep') {
      let s = 0;
      while (i + 1 < tokens.length && /^(\d+(\.\d+)?[smhd]?|inf(inity)?)$/.test(tokens[i + 1]!)) s += seconds(tokens[++i]!);
      top().current += s;
    } else if (t === 'while' || t === 'until') stack.push({ done: 0, current: 0, iterations: Infinity, closer: 'done' });
    else if (t === '(' || t === '{') stack.push({ done: 0, current: 0, iterations: 1, closer: t === '(' ? ')' : '}' });
    else if (t === 'for') {
      // the words up to `do` say how often the body runs
      const header: string[] = [];
      while (i + 1 < tokens.length && tokens[i + 1] !== 'do') header.push(tokens[++i]!);
      stack.push({ done: 0, current: 0, iterations: iterations(header), closer: 'done' });
    } else if (t === top().closer) {
      const loop = stack.pop()!;
      const body = loop.done + loop.current;
      top().current += body > 0 ? body * loop.iterations : 0;
    } else if (t === '&') top().current = 0;
    else if (t === ';' || t === '&&' || t === '||' || t === '\n') {
      top().done += top().current;
      top().current = 0;
    }
  }
  // loops left open (a command line cut off) count as they stand
  let total = 0;
  for (let k = stack.length - 1; k >= 0; k--) {
    const f = stack[k]!;
    const body = f.done + f.current + total;
    total = body > 0 ? body * f.iterations : 0;
  }
  return total;
}

/** A command word that runs what it reads as shell code: a shell, or `ssh` running it elsewhere. */
const SHELL = /^(?:\S*\/)?(?:(?:ba|z|da|k|mk)?sh|ssh)$/;

/**
 * The command line without the text of its heredocs (`cat > f <<'EOF' … EOF`, a commit message in
 * `"$(cat <<'EOF' … EOF)"`): only data, unless the command it is fed to, or one the heredoc's
 * command pipes into, is a shell. Single quotes hide `<<`, double quotes too, except within `$(…)`.
 */
function withoutHeredocs(command: string): string {
  // what the scanner is in: code (the line itself or a `$(…)`/`(…)`, closed by `)`) or a double-quoted string
  const modes: ('line' | 'paren' | 'dq')[] = ['line'];
  const pending: { delimiter: string; tabs: boolean; keep: boolean }[] = [];
  let out = '';
  for (let i = 0; i < command.length; ) {
    const mode = modes.at(-1)!;
    const c = command[i]!;
    let unit = c;
    if (c === '\\') unit = command.slice(i, i + 2);
    else if (mode === 'dq') {
      if (c === '"') modes.pop();
      else if (command.startsWith('$(', i)) (unit = '$('), modes.push('paren');
    } else if (c === "'") {
      const end = command.indexOf("'", i + 1);
      unit = command.slice(i, end < 0 ? command.length : end + 1);
    } else if (c === '"') modes.push('dq');
    else if (c === '(') modes.push('paren');
    else if (c === ')' && mode === 'paren') modes.pop();
    else if (c === '#' && /^$|[\s;&|()]$/.test(out.slice(-1))) unit = command.slice(i).match(/^[^\n]*/)![0];
    else if (command.startsWith('<<<', i)) unit = '<<<';
    else if (command.startsWith('<<', i)) {
      const op = command.slice(i).match(/^<<(-?)[ \t]*((?:'[^'\n]*'|"[^"\n]*"|\\.|[^\s;&|()<>'"\\])+)/);
      const delimiter = op?.[2]!.replace(/['"\\]/g, '');
      if (op && delimiter && /[A-Za-z_]/.test(delimiter)) {
        unit = op[0];
        // the pipeline the heredoc belongs to: back to the last command separator, on to the next one in its line
        const before = out.split(/[;&\n(]|\|\|/).at(-1)!;
        const after = command.slice(i + unit.length).split(/[;&\n)]|\|\|/)[0]!;
        const words = `${before} ${after}`.replace(/['"]/g, ' ').split(/[\s|]+/);
        pending.push({ delimiter, tabs: op[1] === '-', keep: words.some((w) => SHELL.test(w)) });
      }
    } else if (c === '\n' && pending.length > 0) {
      // the bodies follow this line, one after another, each up to the line that is its delimiter
      out += '\n';
      i++;
      for (const h of pending.splice(0)) {
        let end = i;
        for (;;) {
          const next = command.indexOf('\n', end);
          const line = command.slice(end, next < 0 ? command.length : next);
          if (next < 0 || (h.tabs ? line.replace(/^\t+/, '') : line) === h.delimiter) {
            end = next < 0 ? command.length : next + 1;
            break;
          }
          end = next + 1;
        }
        if (h.keep) out += command.slice(i, end);
        i = end;
      }
      continue;
    }
    out += unit;
    i += unit.length;
  }
  return out;
}

/** `timeout` (or coreutils' `gtimeout` on macOS) where a command begins: variables set for it, options, then the duration. */
const TIMEOUT = /^(?:\w+=\S*\s+)*g?timeout(?:\s+(?:-[ks]\s*\S+|--?[a-zA-Z][\w-]*(?:=\S+)?))*\s+(\d+(?:\.\d+)?[smhd]?)(?=\s)/;

/** Words after which a command begins, as after `;`. */
const COMMAND_BEFORE = new Set(['do', 'then', 'else', 'elif', '!', 'time']);

/**
 * The command line with each command that `timeout N` starts replaced by a `sleep` as long as it
 * can wait: N, or less if what it runs sleeps less (`timeout 0` sets no bound). Quotes count here,
 * so a loop handed to `bash -c '…'` stays in the command it belongs to.
 */
function boundTimeouts(command: string): string {
  let out = '';
  let start = true;
  for (let i = 0; i < command.length; ) {
    const rest = command.slice(i);
    const t = start ? TIMEOUT.exec(rest) : null;
    if (t) {
      const end = i + commandEnd(rest);
      const bound = seconds(t[1]!) || Infinity;
      out += `sleep ${Math.min(bound, foregroundSleep(command.slice(i + t[0].length, end)))} `;
      i = end;
      start = false;
      continue;
    }
    const unit = rest.match(/^(?:[ \t]+|\d*[<>]&\d*-?|&>>?|[<>]+|[;&|(){}\n]|'[^']*'?|"(?:\\.|[^"\\])*"?|\\.|[^\s;&|(){}<>'"\\]+)/)?.[0] ?? rest[0]!;
    out += unit;
    i += unit.length;
    if (/^[;&|({\n]$/.test(unit)) start = true;
    else if (!/^[ \t]+$/.test(unit) && !/^\d*[<>]/.test(unit)) start = COMMAND_BEFORE.has(unit);
  }
  return out;
}

/** Where the command at the start of `text` ends: at `;`, `&`, `|`, a line break or a `)` it did not open, outside quotes. */
function commandEnd(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\') i++;
    else if (c === "'") i = text.indexOf("'", i + 1) < 0 ? text.length : text.indexOf("'", i + 1);
    else if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
    } else if (c === '(') depth++;
    else if (c === ')' && depth-- === 0) return i;
    else if (c === '&' && (/[<>]/.test(text[i - 1] ?? '') || text[i + 1] === '>')) continue;
    else if (/[;&|\n]/.test(c) && depth === 0) return i;
  }
  return text.length;
}

function seconds(d: string): number {
  if (d.startsWith('inf')) return Infinity;
  const n = Number.parseFloat(d);
  return n * ({ m: 60, h: 3600, d: 86400 }[d.at(-1)!] ?? 1);
}

/** How often a `for` runs from its header (`i in a b c`, `i in $(seq 1 60)`, `i in {1..60}`); unknown counts as unbounded. */
function iterations(header: string[]): number {
  const at = header.indexOf('in');
  if (at < 0) return Infinity;
  const words = header.slice(at + 1).filter((w) => !/^(&&|\|\||[;&|(){}\n])$/.test(w));
  const list = words.join(' ');
  const range = list.match(/^(-?\d+)\.\.(-?\d+)$/);
  if (range) return Math.abs(Number(range[2]) - Number(range[1])) + 1;
  const seq = list.match(/^\$? ?seq (-?\d+)(?: (-?\d+))?(?: (-?\d+))?$/);
  if (seq) {
    const [first, step, last] =
      seq[3] !== undefined ? [Number(seq[1]), Number(seq[2]), Number(seq[3])] : seq[2] !== undefined ? [Number(seq[1]), 1, Number(seq[2])] : [1, 1, Number(seq[1])];
    return step === 0 ? Infinity : Math.max(0, Math.floor((last - first) / step) + 1);
  }
  return words.some((w) => w.startsWith('$')) ? Infinity : words.length;
}

/**
 * The agent's background tasks that wake it when they finish or fire: a render, a test run, a
 * watcher. The SDK marks watchers `ambient` (no activity to show), like its own housekeeping,
 * which wakes no one and does not count.
 */
export function backgroundWork(tasks: { task_id: string; task_type: string; description: string; ambient?: boolean }[]): { id: string; description: string }[] {
  return tasks.filter((t) => !t.ambient || t.task_type.startsWith('monitor')).map((t) => ({ id: t.task_id, description: t.description }));
}

/**
 * Copies the owner's screenshots to the session's machine, into `images` in Seismic's directory
 * there, and the files the message names by path under `files` (Seismic's, here) into `files` there,
 * and names them by their paths there in the message; the message goes as it was if that fails
 * (the session sees the images in it all the same).
 */
async function carryImages(host: SshHost, dir: Promise<string>, text: string, images: string[], files: string): Promise<string> {
  const dropped = filesIn(text, files);
  if (!images.length && !dropped.length) return text;
  try {
    const to = `${await dir}/images`;
    if (images.length) await host.copyFiles(images, to);
    const there = `${await dir}/files`;
    if (dropped.length) await host.copyFiles(dropped, there);
    const carried = images.reduce((t, f) => t.split(f).join(`${to}/${basename(f)}`), text);
    return dropped.reduce((t, d) => t.split(d).join(`${there}/${basename(d)}`), carried);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return text;
  }
}

/** The session's input: an async stream of user messages that stays open until ended. */
export class Inbox implements AsyncIterable<SDKUserMessage> {
  private queue: { uuid: string; content: Promise<SDKUserMessage['message']['content']> }[] = [];
  /** The messages sent that no turn has taken yet, by their uuid. */
  private untaken = new Set<string>();
  private wake: (() => void) | null = null;
  private ended = false;
  /** For a session on another machine: copies the images and the files the text names there and returns the text with their paths there. */
  carry?: (text: string, images: string[]) => Promise<string>;

  push(text: string, images: string[] = []) {
    // read now: the files may be gone by the time the session takes the message
    const blocks = images.map((f) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType(f), data: readFileSync(f).toString('base64') } }));
    const carried = this.carry ? this.carry(text, images) : Promise.resolve(text);
    const uuid = randomUUID();
    this.untaken.add(uuid);
    this.queue.push({ uuid, content: carried.then((t) => (blocks.length ? [{ type: 'text' as const, text: t }, ...blocks] : t)) });
    this.wake?.();
  }

  /**
   * Whether every message sent has been taken by the turn that `result` ends or one before it. A
   * message sent while the turn ends comes too late for it and starts a turn of its own; one taken
   * in the middle of a turn is listed with the turn's result. A CLI that lists none is taken at its word.
   */
  taken(result: { user_message_uuid?: string; user_message_uuids?: string[] }): boolean {
    const took = result.user_message_uuids ?? (result.user_message_uuid ? [result.user_message_uuid] : undefined);
    if (!took) this.untaken.clear();
    for (const uuid of took ?? []) this.untaken.delete(uuid);
    return this.untaken.size === 0;
  }

  end() {
    this.ended = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      while (this.queue.length) {
        const { uuid, content } = this.queue.shift()!;
        // the CLI names the messages a turn took by their uuid (`taken`); the SDK's type leaves the field out
        yield { type: 'user', message: { role: 'user', content: await content }, parent_tool_use_id: null, uuid } as SDKUserMessage;
      }
      if (this.ended) return;
      await new Promise<void>((r) => (this.wake = r));
      this.wake = null;
    }
  }
}
