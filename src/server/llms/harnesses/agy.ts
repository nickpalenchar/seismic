/**
 * Antigravity (`agy`) as a harness for Seismic agents, in preview. One headless
 * `agy` process per session, speaking stream-json both ways: a `user` frame in per turn, `step_update`
 * frames out while it works, one `result` frame when the turn ends. It runs fully automatic
 * (`--dangerously-skip-permissions`) inside agy's own OS sandbox (`--sandbox`), so the card never asks a
 * permission question; what the sandbox keeps from it goes through `seismic_run` and `seismic_git`
 * (`codexExecTools.ts`). Seismic's tools reach it over a localhost MCP endpoint (`agyMcp.ts`) that a
 * per-session stdio bridge forwards to. Routing and portability checks: `index.ts`.
 */
import { readOnlyRun } from '../agents/permission';
import { seismicEnv } from '../../../core/env';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { homedir } from 'node:os';
import { AGENT_EFFORTS, agyBaseChoice, catalogModel, modelEffort, type AgentEffort, type CodexModel, type Usage, type UsageLimit } from '../../../core/types';
import type { UsageSource } from '../../usage';
import { messageOf } from '../../../core/text';
import { which } from '../../path';
import { OWN_GROUP } from '../../spawn';
import { cleanEnv, type AgentEvent, type AgentRuntime, type AgentSpec } from '../../runtime';
import { AGY_CONVERSATION_ID } from '../../transcript';
import { agyBrainDir, agyTranscriptLog, TranscriptTail, type AgyTask } from './agyTasks';
import { AgentProcesses, onceClosed, tolerateTimeouts, untilIdentified } from './processes';
import { windowsJob, type ProcessJob } from './windowsJob';
import { endAtShutdown, observeEveryTick } from './codexRpc';
import { sessionRegistry } from './sessionRegistry';
import { installMcpConfig } from './agyMcpConfig';
import { AGY_SERVER, agyBridgeEnv, registerAgyTools, wireTools, type AgyRegistration } from './agyMcp';

/** The installed `agy`, or null: `SEISMIC_AGY` first, else on the search path (which has its installer's directory). */
export function installedAgy(env: Record<string, string | undefined> = process.env): string | null {
  const found = seismicEnv('AGY', env) ?? which('agy', env);
  return found && isAbsolute(found) && !/\.(cmd|bat|ps1)$/i.test(found) ? found : null;
}

/** Whether an Antigravity worker could start on this machine: `agy` is installed and signed in (`agy models` answers), as the setup assistant checks it. */
export async function agyConnected(): Promise<boolean> {
  try { await agyModels(); return true; } catch { return false; }
}

/**
 * The models `agy models` lists, as the picker has them. `agy` lists an id per model and effort
 * (`gemini-4-argon-medium  Gemini 4 Argon (Medium)`); those become one model with the efforts it
 * has, which `--model` and `--effort` take apart. A suffix counts only where the display name
 * confirms it with the matching tag, so an id that merely ends in `-high` stays whole, as a model
 * without efforts. The first listed, or the one marked as the default, is the account default,
 * with its effort as the default effort.
 */
export function parseAgyModels(output: string): CodexModel[] {
  const entries = output.split('\n').flatMap((line) => {
    const m = /^\s*(?:[-*•>]\s*)?`?([A-Za-z][A-Za-z0-9_.:/-]*)`?(.*)$/.exec(line);
    if (!m || /^(fetching|available|models?|error|usage|name|id)\b/i.test(m[1]!)) return [];
    const suffix = /^(.+)-(low|medium|high|xhigh|max)$/.exec(m[1]!);
    const tag = /\((low|medium|high|xhigh|max)\)/i.exec(m[2]!)?.[1]?.toLowerCase();
    const split: { model: string; effort?: AgentEffort } = suffix && tag === suffix[2] ? { model: suffix[1]!, effort: suffix[2] as AgentEffort } : { model: m[1]! };
    return [{ ...split, isDefault: /\bdefault\b|\bcurrent\b|\(\*\)|\*$/i.test(m[2]!) }];
  });
  const chosen = entries.find((e) => e.isDefault) ?? entries[0];
  const models = new Map<string, CodexModel>();
  for (const e of entries) {
    const model = models.get(e.model) ?? { model: e.model, isDefault: e.model === chosen?.model, supportedReasoningEfforts: [], inputModalities: ['text'] };
    if (e.effort && !model.supportedReasoningEfforts.some((x) => x.reasoningEffort === e.effort)) model.supportedReasoningEfforts.push({ reasoningEffort: e.effort });
    models.set(e.model, model);
  }
  return [...models.values()].map((m) => ({
    ...m,
    supportedReasoningEfforts: AGENT_EFFORTS.filter((e) => m.supportedReasoningEfforts.some((x) => x.reasoningEffort === e)).map((reasoningEffort) => ({ reasoningEffort })),
    ...(m.isDefault && chosen?.effort ? { defaultReasoningEffort: chosen.effort } : {}),
  }));
}

const catalogs = new Map<string, CodexModel[]>();
const listings = new Map<string, Promise<CodexModel[]>>();

type RunChoice = { model?: string; effort?: AgentEffort };

/** Resolve saved variants, unsupported inherited efforts and the account default before building flags. */
export function agyRun(choice: RunChoice, models: CodexModel[]): RunChoice {
  const base = agyBaseChoice({ model: choice.model ?? 'default', effort: choice.effort }, models);
  const model = catalogModel(models, base.model);
  const effort = model ? modelEffort(model, base.effort) : base.effort;
  return { ...(base.model === 'default' ? {} : { model: base.model }), ...(effort ? { effort } : {}) };
}

/** The account's model catalog, from the CLI; fails visibly where `agy` is missing or not signed in. */
export async function agyModels(executable = installedAgy()): Promise<CodexModel[]> {
  if (!executable) throw new Error('Antigravity (agy) is not installed; set SEISMIC_AGY to its path');
  const pending = listings.get(executable);
  if (pending) return pending;
  const listing = (async () => {
    const r = Bun.spawn([executable, 'models'], { env: cleanEnv() as Record<string, string>, stdout: 'pipe', stderr: 'pipe', timeout: 15000 });
    const [out, err, status] = await Promise.all([new Response(r.stdout).text(), new Response(r.stderr).text(), r.exited]);
    if (status !== 0) throw new Error(`Antigravity could not list its models: ${(err || out || 'not signed in?').trim().split('\n').pop()}`);
    const models = parseAgyModels(out);
    if (!models.length) throw new Error('Antigravity listed no models');
    catalogs.set(executable, models);
    return models;
  })();
  listings.set(executable, listing);
  try { return await listing; } finally { listings.delete(executable); }
}

const usageRead = z.object({
  status: z.string().optional(),
  command: z.object({
    data: z.object({
      groups: z.array(z.object({
        name: z.string(),
        buckets: z.array(z.object({ window: z.string().optional(), remaining_fraction: z.number(), reset_time: z.string().nullish() })),
      })),
    }),
  }),
});

/**
 * The limits of an `agy -p /usage --output-format json` answer (captured in fixtures/agy-usage.json):
 * a five-hour and a weekly bucket per group of models sharing them, each with the share remaining.
 * Every limit is scoped to its group; agy grades none, so Seismic does from the percentage, as for Codex.
 */
export function agyUsageOf(answer: unknown, now = new Date()): Usage {
  const r = usageRead.parse(answer);
  // within a group, the five-hour bucket ahead of the week's, as Claude and Codex list them
  const limits = r.command.data.groups.flatMap((g) =>
    g.buckets.map((b): UsageLimit => {
      const group = /^\d+h$/i.test(b.window ?? '') ? 'session' : 'weekly';
      const percent = Math.max(0, Math.min(100, (1 - b.remaining_fraction) * 100));
      return {
        kind: `${group}_scoped`,
        group,
        scope: g.name,
        percent,
        ...(b.reset_time ? { resetsAt: new Date(b.reset_time).toISOString() } : {}),
        severity: percent >= 95 ? 'critical' : percent >= 80 ? 'warning' : 'normal',
      };
    }).sort((a, b) => Number(b.group === 'session') - Number(a.group === 'session')),
  );
  return { harness: 'agy', limits, at: now.toISOString() };
}

/** Runs `agy` with `args`; its exit status and output. Aborting `signal` ends it, with whatever it started. */
export type AgyRun = (executable: string, args: string[], signal: AbortSignal) => Promise<{ status: number; out: string; err: string }>;

/** How long a `/usage` answer may take before everything it runs is ended. */
const USAGE_RUN_MS = 25_000;

/**
 * Ends `child` with everything it started. Where it has a group of its own (`OWN_GROUP`) the group is
 * killed. On Windows, which has none, the job holding the run ends the whole tree at once, whatever
 * has exited since and whoever the parents in between were. If terminating the job fails, its handle
 * is closed at once, which ends its members all the same (kill on close, which `windowsJob` makes
 * sure of), rather than waiting for the run's output to close, which a helper holding it would keep
 * from happening. Nothing here waits on the process table or holds the event loop.
 */
export function endProcessTree(child: { pid?: number; kill: (signal: NodeJS.Signals) => unknown }, job?: ProcessJob, ownGroup = OWN_GROUP) {
  if (job?.terminate()) return;
  job?.close();
  try {
    if (ownGroup && child.pid) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch {
    // already gone
  }
}

/** The environment variable through which the Windows launcher is told where `agy` is, so that no path goes through cmd's parser. */
export const USAGE_LAUNCH_AGY = 'SEISMIC_USAGE_AGY';

/**
 * How `agy` is started on Windows so that every process of the run is in its job (`windowsJob`): a
 * `cmd` that waits for a line on stdin before it starts `agy`, which inherits its output. The job
 * takes `cmd` while it waits, and whatever `cmd` starts afterwards is born into the job, so there is
 * no moment in which agy, or a helper of agy's, runs outside it. `agy`'s path reaches `cmd` in an
 * environment variable, quoted: cmd expands it once and parses nothing of it. The arguments are
 * `agy`'s own (no spaces); `cmd /c` exits with the last command's status, agy's.
 */
export function usageLaunch(executable: string, args: string[], env: Record<string, string | undefined>, comSpec = process.env.ComSpec || 'cmd.exe') {
  if (args.some((a) => /[\s"%&|<>^]/.test(a))) throw new Error(`agy /usage arguments cannot go through cmd: ${args.join(' ')}`);
  return {
    command: comSpec,
    args: ['/d', '/s', '/c', `"set /p _= & "%${USAGE_LAUNCH_AGY}%" ${args.join(' ')}"`],
    env: { ...env, [USAGE_LAUNCH_AGY]: executable } as Record<string, string | undefined>,
  };
}

const runAgy: AgyRun = (executable, args, signal) =>
  new Promise((resolve, reject) => {
    // a group of its own on POSIX, a job on Windows: ending it ends whatever agy started for the answer too
    const job = OWN_GROUP ? undefined : windowsJob();
    if (!OWN_GROUP && !job) return reject(new Error('agy /usage cannot be held in a job object'));
    const launch = job ? usageLaunch(executable, args, cleanEnv()) : { command: executable, args, env: cleanEnv() };
    const child = spawn(launch.command, launch.args, { cwd: homedir(), env: launch.env, stdio: [job ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true, detached: OWN_GROUP, windowsVerbatimArguments: !!job });
    const end = () => endProcessTree(child, job);
    const timer = setTimeout(end, USAGE_RUN_MS);
    signal.addEventListener('abort', end, { once: true });
    const settle = () => {
      job?.close();
      clearTimeout(timer);
      signal.removeEventListener('abort', end);
    };
    let out = '';
    let err = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
    child.once('error', (e) => {
      settle();
      reject(e);
    });
    child.once('close', (status) => {
      settle();
      if (signal.aborted) reject(new Error('agy /usage was stopped'));
      else resolve({ status: status ?? 1, out, err });
    });
    if (job) {
      // the launcher waits; agy starts only once the job holds it
      if (child.pid && job.assign(child.pid)) {
        child.stdin!.on('error', () => { /* the launcher is gone; its exit says so */ });
        child.stdin!.end('\r\n');
      } else {
        // the launcher has started nothing yet, and the empty job would end nothing: it alone is killed
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
        reject(new Error('agy /usage could not be put into its job object'));
      }
    }
  });

/**
 * Antigravity's usage limits, from `agy -p /usage` in print mode, which answers without starting an
 * agent turn, spending quota or leaving a conversation behind: a process per round, nothing kept
 * between them, and closing the source ends the one under way. Nothing to show (`null`) while agy
 * is not installed, without starting anything, or not signed in.
 */
export function agyUsage(run: AgyRun = runAgy, executable: () => string | null = installedAgy): UsageSource {
  // closing ends a `/usage` run under way, rather than letting it finish for nobody
  const closing = new AbortController();
  return {
    fetch: async () => {
      const agy = executable();
      if (closing.signal.aborted || !agy) return null;
      const { status, out, err } = await run(agy, ['-p', '/usage', '--output-format', 'json'], closing.signal);
      const answer = (() => {
        try {
          return JSON.parse(out) as unknown;
        } catch {
          return undefined;
        }
      })();
      if (status === 0 && answer && usageRead.safeParse(answer).success) return agyUsageOf(answer);
      const said = `${err}\n${out}`.trim();
      if (/sign.?in|log.?in|not authenticated|unauthenticated|credentials/i.test(said)) return null;
      throw new Error(`agy /usage failed: ${said.split('\n').pop() || `exit ${status}`}`);
    },
    close: () => closing.abort(),
  };
}

/** Refuse what agy workers do not do yet, rather than quietly doing it differently. */
function supported(spec: AgentSpec) {
  const unsupported = [
    !isAbsolute(spec.cwd) || spec.cwd.startsWith('ssh://') ? 'non-local working directory' : '',
    spec.dirs?.some((d) => !isAbsolute(d)) ? 'non-local additional workstation roots' : '',
    spec.watch ? 'before/after mutation hooks' : '',
    spec.plugins?.length ? 'Claude plugins' : '',
  ].filter(Boolean);
  if (unsupported.length) throw new Error(`Antigravity does not support: ${unsupported.join(', ')}`);
  if (spec.resume && !(spec.resume.startsWith('agy:') && AGY_CONVERSATION_ID.test(spec.resume.slice('agy:'.length)))) throw new Error('Antigravity can only resume an agy: session, not a Claude or Codex one');
}

/**
 * What a read-only agent (a code review) may do without being asked, as `agy`'s permission rules have
 * it: Seismic's tools, reads, and commands that only look. Everything else, writing above all, is
 * denied, since nobody answers in a headless session.
 */
export const READ_ONLY_PERMISSIONS = {
  allow: [`mcp(${AGY_SERVER})`, `mcp(${AGY_SERVER}/*)`, `mcp(${AGY_SERVER}:*)`, `mcp(${AGY_SERVER}_*)`, `mcp(${AGY_SERVER}/seismic_ask)`, 'read_file', ...['git', 'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc', 'pwd', 'diff', 'stat'].map((c) => `command(${c})`)],
  deny: ['write_file'],
};

/**
 * The flags of a session. Fully automatic inside the sandbox; a read-only agent (a code review) does
 * not skip permissions, so only `READ_ONLY_PERMISSIONS` apply (skipping them would also skip deny rules).
 */
export function agyArgs(spec: Pick<AgentSpec, 'resume' | 'model' | 'effort' | 'permission' | 'dirs'>): string[] {
  return [
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--sandbox',
    ...(readOnlyRun(spec) ? ['--settings', JSON.stringify({ permissions: READ_ONLY_PERMISSIONS })] : ['--dangerously-skip-permissions']),
    ...(spec.dirs ?? []).flatMap((d) => ['--add-dir', d]),
    ...(spec.resume ? ['--conversation', spec.resume.slice('agy:'.length)] : []),
    ...(spec.model ? ['--model', spec.model] : []),
    ...(spec.effort ? ['--effort', spec.effort] : []),
  ];
}

const frame = z.object({
  event: z.string(),
  conversation_id: z.string().optional(),
  step_update: z.object({
    step_type: z.string().optional(),
    step_index: z.number().optional(),
    state: z.string().optional(),
    text_delta: z.string().optional(),
    tool_name: z.string().optional(),
    tool_info: z.object({ parameters: z.record(z.string(), z.unknown()).nullish(), error: z.object({ message: z.string().optional() }).nullish() }).passthrough().nullish(),
  }).passthrough().optional(),
  result: z.object({ status: z.string().optional(), error: z.string().nullish() }).passthrough().optional(),
});

/** What `agy` calls a tool of its own, as the Claude tool the orchestration knows it by. */
export function nativeTool(name: string, parameters: Record<string, unknown> = {}): { name: string; input: Record<string, unknown> } {
  if (/command|shell|terminal|exec|bash/i.test(name)) return { name: 'Bash', input: { command: parameters.command ?? parameters.CommandLine ?? parameters.cmd ?? name } };
  if (/edit|write|replace|patch|create_file|delete/i.test(name)) return { name: 'Edit', input: parameters };
  if (/view|read|list|grep|find|search|open/i.test(name)) return { name: 'Read', input: parameters };
  return { name, input: parameters };
}

/**
 * When the usage limit lifts (milliseconds). agy's account-quota error uses a Go-style duration:
 * "Resets in 152h12m37s." (captured in fixtures/agy-quota.txt). Keep the preview's retry wording
 * too; an unrecognised time stays unknown rather than scheduling an early retry.
 */
export function agyLimit(message: string, now = Date.now()): { resetsAt?: number } | undefined {
  if (!/quota|rate.?limit|resource.?exhausted|usage limit|too many requests|\b429\b/i.test(message)) return undefined;
  const marker = /(?:resets?\s+in|retry\s+(?:in|after)|try again\s+(?:in|after))\s+/i.exec(message);
  if (!marker) return {};
  // Capture the whole phrase before validating it. Whitespace (including newlines) is not a
  // terminator: "2h 3days" must stay unknown, rather than scheduling a retry after only 2h.
  // A decimal point belongs to a number; other periods end the sentence.
  const phrase = message.slice(marker.index + marker[0].length).split(/\.(?!\d)|[;)]/, 1)[0]!.trim();
  if (!/^(?:\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s*)+$/i.test(phrase)) return {};
  let duration = 0;
  for (const part of phrase.matchAll(/(\d+(?:\.\d+)?)\s*([hms])/gi)) {
    const unit = part[2]!.toLowerCase();
    duration += Number(part[1]) * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1000);
  }
  const resetsAt = now + duration;
  return Number.isFinite(resetsAt) ? { resetsAt } : {};
}

/** An `agy` the argument list and environment are given to; injectable for tests. */
type Launch = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => ReturnType<typeof spawn>;
const launchInstalled: Launch = (command, args, options) => spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: OWN_GROUP });

export function createAgyRuntime(launch: Launch = launchInstalled, executable: () => string | null = installedAgy, brain: () => string = agyBrainDir, loadModels = agyModels): AgentRuntime {
  const sessions = {
    start(command: string, spec: AgentSpec, run: RunChoice, firstMessage?: string, images?: string[]) {
      // An earlier Seismic crashed and its sweep could not end this workstation's old session.
      const left = sessionRegistry()?.unaccounted(spec.cwd);
      if (left?.length) throw new Error(`An earlier session in this workstation left processes that are still running (${left.map((l) => l.label).join('; ')}); Seismic tries to end them when it starts`);
      // Capture resumed history before launching agy, which can write before its init frame arrives.
      let tail = spec.resume ? new TranscriptTail(agyTranscriptLog(brain(), spec.resume.slice('agy:'.length)), true) : undefined;
      const closeConfig = { current: () => {} };
      const emit = (event: AgentEvent) => { if (!closing) spec.onEvent(event); };
      const registration: AgyRegistration = {
        tools: wireTools(spec.tools),
        called: (tool, input) => emit({ type: 'tool', name: `mcp__seismic__${tool.name}`, input }),
        ...(spec.contextUpdate ? { update: spec.contextUpdate } : {}),
      };
      const endpoint = registerAgyTools(registration);
      try { closeConfig.current = installMcpConfig(spec.cwd); } catch (error) { endpoint.dispose(); throw error; }

      const queue: string[] = [];
      const seen = new Set<number>();
      // agy calls an MCP tool through its own `call_mcp_tool`; Seismic's are shown at dispatch (`called`)
      const own = (name: string, parameters?: Record<string, unknown> | null) => name === 'call_mcp_tool' ? parameters?.ServerName === AGY_SERVER : [...registration.tools.keys()].some((w) => name === w || name.endsWith(w));
      let closing = false;
      // Turns wait for agy's identity to be on record, so a crash during the first one leaves nothing unrecorded.
      let ready = false;
      let turn = false;
      let introduced = false;
      let stderr = '';
      let exited = false;
      let background: AgyTask[] = [];
      let terminate: ReturnType<typeof setTimeout> | undefined;
      let kill: ReturnType<typeof setTimeout> | undefined;
      let child: ReturnType<Launch>;
      try {
        child = launch(command, agyArgs({ ...spec, model: run.model, effort: run.effort }), { cwd: spec.cwd, env: { ...cleanEnv(), ...spec.env, ...agyBridgeEnv(endpoint) } });
      } catch (error) {
        closeConfig.current();
        endpoint.dispose();
        throw error;
      }
      let finish!: () => void;
      const done = new Promise<void>((resolve) => { finish = resolve; });

      // What a crash of Seismic would leave behind (agy's own commands, which may detach from its
      // group) is recorded as it is observed, as for Codex (sessionRegistry.ts).
      const terminals = child.pid ? new AgentProcesses(child.pid) : undefined;
      const record = terminals ? sessionRegistry()?.begin(`Antigravity in ${spec.cwd}`, spec.cwd) : undefined;
      // A command the record does not name would outlive a crash: agy does not go on without it.
      const publish = () => {
        void record?.then((generation) => generation?.publish(terminals!.observed())).catch((error: unknown) => {
          failEnded(`Antigravity's processes could not be put on record: ${messageOf(error)}`);
        });
      };
      if (terminals && record) { terminals.onChange = publish; publish(); }
      // A busy machine's snapshot can time out: that observation is skipped. One that failed for good
      // once agy is identified (and may run turns) may have missed a process, so ending what was seen
      // does not account for it: the record stays. Before that no turn went out, so nothing is owed.
      const observed = tolerateTimeouts();
      let unobserved = false;
      const watch = (operation: Promise<void>) => observed(operation).catch((error: unknown) => { if (terminals?.observed().length) unobserved = true; throw error; });
      let observing = false;
      const stopObserving = observeEveryTick(() => {
        if (observing || !terminals) return;
        observing = true;
        watch(terminals.track()).catch((error: unknown) => failEnded(`Antigravity's processes cannot be watched: ${messageOf(error)}`)).finally(() => { observing = false; });
      });

      // agy wakes itself for a task that ends during a turn; between turns nothing does, so the session does.
      const watchTasks = (turnEnded = false) => {
        if (!tail || closing) return;
        let tasks: AgyTask[];
        try { tasks = tail.tasks(); } catch { return; }
        if (JSON.stringify(tasks) === JSON.stringify(background)) return;
        const ended = background.filter((before) => !tasks.some((now) => now.id === before.id));
        background = tasks;
        emit({ type: 'background', tasks });
        // a turn that just ended reports its own idle
        if (turn || turnEnded) return;
        if (ended.length) queue.push(`Background commands have ended: ${ended.map((t) => t.description).join('; ')}. Inspect their results and continue your task.`);
        emit({ type: 'idle', background: tasks.length, more: queue.length > 0 });
        pump();
      };
      const stopTasks = observeEveryTick(() => watchTasks());

      const signal = (which: NodeJS.Signals) => {
        if (exited) return;
        try { if (OWN_GROUP && child.pid) process.kill(-child.pid, which); else child.kill(which); } catch { /* already gone */ }
      };
      const stop = () => {
        if (closing) return;
        closing = true;
        endpoint.dispose();
        // Queued before any kill, so the commands seen now are ended with the rest.
        if (terminals) void watch(terminals.track()).catch(() => { /* the record stays for a sweep */ });
        child.stdin?.end();
        terminate = setTimeout(() => signal('SIGTERM'), 1000);
        kill = setTimeout(() => signal('SIGKILL'), 3000);
      };
      const failEnded = (message: string) => {
        if (closing) return;
        spec.onEvent({ type: 'error', message, ended: true });
        spec.onEvent({ type: 'idle' });
        stop();
      };
      const pump = () => {
        if (closing || !ready || turn || !queue.length) return;
        const text = queue.shift()!;
        const content = introduced ? text : `${spec.system}\n\n---\n\n${text}`;
        introduced = true;
        turn = true;
        child.stdin?.write(`${JSON.stringify({ event: 'user', message: { content } })}\n`, (error) => { if (error) failEnded(`Antigravity could not be written to: ${error.message}`); });
      };
      const send = (text: string, files: string[] = []) => {
        if (closing) return;
        if (files.some((f) => !isAbsolute(f))) throw new Error('Antigravity images must be absolute local file paths');
        queue.push(files.length ? `${text}\n\nImages attached; view these files:\n${files.map((f) => `- ${resolve(f)}`).join('\n')}` : text);
        pump();
      };

      function onFrame(line: string) {
        let parsed: z.infer<typeof frame>;
        try {
          const r = frame.safeParse(JSON.parse(line));
          if (!r.success) return;
          parsed = r.data;
        } catch { stderr = (stderr + line + '\n').slice(-4000); return; }
        if (parsed.event === 'init' && parsed.conversation_id) {
          const id = `agy:${parsed.conversation_id}`;
          if (!tail) tail = new TranscriptTail(agyTranscriptLog(brain(), parsed.conversation_id));
          emit({ type: 'session', id, ...(spec.setting ? { setting: { ...spec.setting, agy: { model: run.model ?? 'default', effort: run.effort } } } : {}), ...(run.model ? { model: run.model } : {}) });
        } else if (parsed.event === 'step_update' && parsed.step_update) {
          const s = parsed.step_update;
          if (s.step_type === 'agent_response' && s.text_delta) emit({ type: 'text', text: s.text_delta });
          else if (s.step_type === 'tool' && s.tool_name && !own(s.tool_name, s.tool_info?.parameters)) {
            const index = s.step_index ?? -1;
            if (!seen.has(index) && s.state === 'ACTIVE') {
              seen.add(index);
              const t = nativeTool(s.tool_name, s.tool_info?.parameters ?? {});
              emit({ type: 'tool', name: t.name, input: t.input });
            } else if (s.state === 'DONE' || s.state === 'ERROR') {
              seen.delete(index);
              emit({ type: 'toolDone', name: nativeTool(s.tool_name).name, ok: s.state === 'DONE' });
            }
          }
        } else if (parsed.event === 'result') {
          turn = false;
          seen.clear();
          if (parsed.result?.status && parsed.result.status !== 'SUCCESS') {
            const message = parsed.result.error || 'Antigravity turn failed';
            const limit = agyLimit(message);
            emit({ type: 'error', message, ...(limit ? { limit } : {}) });
          }
          watchTasks(true);
          emit({ type: 'idle', ...(background.length ? { background: background.length } : {}), more: queue.length > 0 });
          pump();
        }
      }

      const out = new StringDecoder('utf8');
      let buffer = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += out.write(chunk);
        let i: number;
        while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1); if (line) onFrame(line); }
      });
      child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
      child.stdin?.on('error', () => { /* the process is gone; its exit says why */ });
      child.on('error', (error) => failEnded(`Antigravity could not start: ${messageOf(error)}`));
      child.on('exit', () => {
        stopObserving();
        stopTasks();
        // Do not wait for `close`: a command agy started may still hold its pipes open.
        void terminals?.kill().catch(() => { /* retried at close */ });
        // The leader is gone, so any member still in its group keeps the number reserved: this is the
        // last point where signalling the group cannot reach a reused one.
        if (OWN_GROUP && child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch { /* none left */ }
        exited = true;
        clearTimeout(terminate);
        clearTimeout(kill);
      });
      const unregister = endAtShutdown(stop, { done, force: async () => {
        stop();
        await terminals?.kill().catch(() => { /* the record stays for a sweep */ });
        signal('SIGKILL');
      } });
      onceClosed(child, (code) => {
        exited = true;
        stopObserving();
        stopTasks();
        clearTimeout(terminate);
        clearTimeout(kill);
        endpoint.dispose();
        closeConfig.current();
        // The record goes only once every process is ended; a refused signal leaves it for the sweep.
        void (async () => {
          let ended = true;
          try { await terminals?.kill(); } catch { ended = false; }
          try { const generation = await record; if (ended && !unobserved) await generation?.finish(); else await generation?.abandon(); } catch (error) { console.warn(`Session record not settled: ${messageOf(error)}`); }
          unregister();
          finish();
        })();
        if (!closing) {
          const signedOut = /authentication|sign in|log ?in/i.test(stderr);
          failEnded(signedOut ? 'Antigravity is not signed in; the owner signs in with their Google account by running `agy` once' : `Antigravity exited${code === null ? '' : ` with code ${code}`}${stderr.trim() ? `: ${stderr.trim().split('\n').slice(-3).join(' ')}` : ''}`);
        }
        closing = true;
      });

      const recorded = terminals ? untilIdentified(terminals, watch).then(async () => { await (await record)?.publish(terminals.observed()); }) : Promise.resolve();
      recorded.then(() => { ready = true; pump(); }, (error: unknown) => failEnded(`Antigravity could not be put on record: ${messageOf(error)}`));
      if (firstMessage !== undefined) send(firstMessage, images);
      return { send, close: stop, done };
    },
  };
  return {
    start(spec, firstMessage, images) {
      supported(spec);
      const command = executable();
      if (!command) throw new Error('Antigravity (agy) is not installed; set SEISMIC_AGY to its path');
      const start = (models: CodexModel[]) => sessions.start(command, spec, agyRun(spec, models), firstMessage, images);
      const cached = catalogs.get(command);
      if (cached) return start(cached);
      if (!spec.setting && !spec.model && !spec.effort) return start([]);

      // A queue or resume can reach this before any picker or connection check. Keep its turns
      // until the flags are known, and let a close during discovery prevent the launch.
      let session: ReturnType<AgentRuntime['start']> | undefined;
      let closed = false;
      const queued: [string, string[]?][] = [];
      const cancelled = Promise.withResolvers<void>();
      const close = () => {
        closed = true;
        queued.length = 0;
        if (session) session.close();
        else cancelled.resolve();
      };
      const preparing = Promise.resolve().then(() => loadModels(command)).then((models) => {
        if (closed) return;
        unregister();
        session = start(models);
        for (const args of queued.splice(0)) session.send(...args);
        return session.done;
      }).catch((error: unknown) => {
        if (closed) return;
        spec.onEvent({ type: 'error', message: messageOf(error), ended: true });
        spec.onEvent({ type: 'idle' });
      });
      const done = Promise.race([preparing, cancelled.promise]).finally(() => unregister());
      const unregister = endAtShutdown(close, { done, force: async () => close() });
      return {
        done, close,
        send(text, images) {
          if (closed) return;
          if (session) session.send(text, images);
          else queued.push([text, images]);
        },
      };
    },
  };
}

export const agyRuntime = createAgyRuntime();
