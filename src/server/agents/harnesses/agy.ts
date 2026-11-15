/**
 * Antigravity (`agy`) as a harness for task workers and code reviews, in preview. One headless
 * `agy` process per session, speaking stream-json both ways: a `user` frame in per turn, `step_update`
 * frames out while it works, one `result` frame when the turn ends. It runs fully automatic
 * (`--dangerously-skip-permissions`) inside agy's own OS sandbox (`--sandbox`), so the card never asks a
 * permission question; what the sandbox keeps from it goes through `seismic_run` and `seismic_git`
 * (`codexExecTools.ts`). Seismic's tools reach it over a localhost MCP endpoint (`agyMcp.ts`) that the
 * session's `.agents/mcp_config.json` names. Routing and portability checks: `index.ts`.
 */
import { seismicEnv } from '../../../core/env';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { GIT } from '../../workstations';
import { AGENT_EFFORTS, type CodexModel } from '../../../core/types';
import { messageOf } from '../../../core/text';
import { which } from '../../path';
import { OWN_GROUP } from '../../spawn';
import { cleanEnv, type AgentEvent, type AgentRuntime, type AgentSpec } from '../../runtime';
import { AGY_CONVERSATION_ID } from '../../transcript';
import { AgentProcesses, tolerateTimeouts, untilIdentified } from './processes';
import { endAtShutdown, observeEveryTick } from './codexRpc';
import { sessionRegistry } from './sessionRegistry';
import { AGY_SERVER, registerAgyTools, wireTools, type AgyRegistration } from './agyMcp';

/** The installed `agy`, or null: `SEISMIC_AGY` first, else on the search path (which has its installer's directory). */
export function installedAgy(env: Record<string, string | undefined> = process.env): string | null {
  const found = seismicEnv('AGY', env) ?? which('agy', env);
  return found && isAbsolute(found) && !/\.(cmd|bat|ps1)$/i.test(found) ? found : null;
}

/**
 * The models `agy models` lists, as the picker has them. Every model offers all efforts `agy` knows;
 * the first listed, or the one marked as the default, is the account default.
 */
export function parseAgyModels(output: string): CodexModel[] {
  const entries = output.split('\n').flatMap((line) => {
    const m = /^\s*(?:[-*•>]\s*)?`?([A-Za-z][A-Za-z0-9_.:/-]*)`?(.*)$/.exec(line);
    if (!m || /^(fetching|available|models?|error|usage|name|id)\b/i.test(m[1]!)) return [];
    return [{ model: m[1]!, isDefault: /\bdefault\b|\bcurrent\b|\(\*\)|\*$/i.test(m[2]!) }];
  });
  const marked = entries.findIndex((e) => e.isDefault);
  return entries.map((e, i) => ({ ...e, isDefault: i === (marked < 0 ? 0 : marked), supportedReasoningEfforts: AGENT_EFFORTS.map((reasoningEffort) => ({ reasoningEffort })), inputModalities: ['text'] }));
}

/** The account's model catalog, from the CLI; fails visibly where `agy` is missing or not signed in. */
export async function agyModels(): Promise<CodexModel[]> {
  const executable = installedAgy();
  if (!executable) throw new Error('Antigravity (agy) is not installed; set SEISMIC_AGY to its path');
  const r = Bun.spawn([executable, 'models'], { env: cleanEnv() as Record<string, string>, stdout: 'pipe', stderr: 'pipe', timeout: 30000 });
  const [out, err, status] = await Promise.all([new Response(r.stdout).text(), new Response(r.stderr).text(), r.exited]);
  if (status !== 0) throw new Error(`Antigravity could not list its models: ${(err || out || 'not signed in?').trim().split('\n').pop()}`);
  const models = parseAgyModels(out);
  if (!models.length) throw new Error('Antigravity listed no models');
  return models;
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
export function agyArgs(spec: Pick<AgentSpec, 'resume' | 'model' | 'effort' | 'readOnly' | 'dirs'>): string[] {
  return [
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--sandbox',
    ...(spec.readOnly ? ['--settings', JSON.stringify({ permissions: READ_ONLY_PERMISSIONS })] : ['--dangerously-skip-permissions']),
    ...(spec.dirs ?? []).flatMap((d) => ['--add-dir', d]),
    ...(spec.resume ? ['--conversation', spec.resume.slice('agy:'.length)] : []),
    ...(spec.model ? ['--model', spec.model] : []),
    ...(spec.effort ? ['--effort', spec.effort] : []),
  ];
}

/** The workstation file `agy` reads MCP servers from; the session writes it and takes it away again. */
const MCP_CONFIG = join('.agents', 'mcp_config.json');
const OURS = /"serverUrl":\s*"http:\/\/127\.0\.0\.1:\d+\/mcp"/;

/**
 * Registers the endpoint with `agy` for this workstation only (never the owner's own configuration),
 * out of reach of `git add -A` (the repository's `info/exclude`). A file of the repository's own is
 * not overwritten.
 */
function installMcpConfig(cwd: string, endpoint: { url: string; token: string }): () => void {
  const file = join(cwd, MCP_CONFIG);
  if (existsSync(file) && !OURS.test(readFileSync(file, 'utf8'))) throw new Error(`Antigravity cannot start here: the workstation has its own ${MCP_CONFIG}`);
  const exclude = spawnSync(GIT, ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'], { encoding: 'utf8', windowsHide: true });
  if (exclude.status === 0) {
    const path = exclude.stdout.trim();
    const line = `/${MCP_CONFIG.replaceAll('\\', '/')}`;
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path) || !readFileSync(path, 'utf8').split('\n').includes(line)) appendFileSync(path, `${existsSync(path) && !readFileSync(path, 'utf8').endsWith('\n') ? '\n' : ''}${line}\n`);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ mcpServers: { [AGY_SERVER]: { disabled: false, serverUrl: endpoint.url, headers: { Authorization: `Bearer ${endpoint.token}` } } } }, null, 2)}\n`, { mode: 0o600 });
  return () => { try { rmSync(file, { force: true }); } catch { /* the workstation is gone */ } };
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

export function createAgyRuntime(launch: Launch = launchInstalled, executable: () => string | null = installedAgy): AgentRuntime {
  return {
    start(spec, firstMessage, images) {
      supported(spec);
      const command = executable();
      if (!command) throw new Error('Antigravity (agy) is not installed; set SEISMIC_AGY to its path');
      // An earlier Seismic crashed and its sweep could not end this workstation's old session.
      const left = sessionRegistry()?.unaccounted(spec.cwd);
      if (left?.length) throw new Error(`An earlier session in this workstation left processes that are still running (${left.map((l) => l.label).join('; ')}); Seismic tries to end them when it starts`);
      const closeConfig = { current: () => {} };
      const emit = (event: AgentEvent) => { if (!closing) spec.onEvent(event); };
      const registration: AgyRegistration = {
        tools: wireTools(spec.tools),
        called: (tool, input) => emit({ type: 'tool', name: `mcp__seismic__${tool.name}`, input }),
        ...(spec.contextUpdate ? { update: spec.contextUpdate } : {}),
      };
      const endpoint = registerAgyTools(registration);
      try { closeConfig.current = installMcpConfig(spec.cwd, endpoint); } catch (error) { endpoint.dispose(); throw error; }

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
      let terminate: ReturnType<typeof setTimeout> | undefined;
      let kill: ReturnType<typeof setTimeout> | undefined;
      const child = launch(command, agyArgs(spec), { cwd: spec.cwd, env: { ...cleanEnv(), ...spec.env } });
      let finish!: () => void;
      const done = new Promise<void>((resolve) => { finish = resolve; });

      // What a crash of Seismic would leave behind (agy's own commands, which may detach from its
      // group) is recorded as it is observed, as for Codex (sessionRegistry.ts).
      const terminals = child.pid ? new AgentProcesses(child.pid) : undefined;
      const record = terminals ? sessionRegistry()?.begin(`Antigravity in ${spec.cwd}`, spec.cwd) : undefined;
      const publish = () => {
        void record?.then((generation) => generation?.publish(terminals!.observed())).catch((error) => {
          console.warn(`Session record not updated: ${messageOf(error)}`);
        });
      };
      if (terminals && record) { terminals.onChange = publish; publish(); }
      // A busy machine's snapshot can time out: that observation is skipped. One that failed for good
      // may have missed a process, so ending what was seen does not account for it: the record stays.
      const observed = tolerateTimeouts();
      let unobserved = false;
      const watch = (operation: Promise<void>) => observed(operation).catch((error: unknown) => { unobserved = true; throw error; });
      let observing = false;
      const stopObserving = observeEveryTick(() => {
        if (observing || !terminals) return;
        observing = true;
        watch(terminals.track()).catch((error: unknown) => failEnded(`Antigravity's processes cannot be watched: ${messageOf(error)}`)).finally(() => { observing = false; });
      });

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
          emit({ type: 'session', id, ...(spec.setting ? { setting: { ...spec.setting, agy: { model: spec.model ?? 'default', effort: spec.effort ?? 'high' } } } : {}), ...(spec.model ? { model: spec.model } : {}) });
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
          emit({ type: 'idle', more: queue.length > 0 });
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
      child.on('close', (code) => {
        exited = true;
        stopObserving();
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
}

export const agyRuntime = createAgyRuntime();
