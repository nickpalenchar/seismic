// Antigravity (`agy`) as a harness for task workers and code reviews, in preview. One headless
// `agy` process per session, speaking stream-json both ways: a `user` frame in per turn, `step_update`
// frames out while it works, one `result` frame when the turn ends. It runs fully automatic
// (`--dangerously-skip-permissions`) inside agy's own OS sandbox (`--sandbox`), so the card never asks a
// permission question; what the sandbox keeps from it goes through `seismic_run` and `seismic_git`
// (`exec-tools.ts`). Seismic's tools reach it over a localhost MCP endpoint (`agy-mcp.ts`) that the
// session's `.agents/mcp_config.json` names. Routing and portability checks: `worker-runtime.ts`.
import { seismicEnv } from '../core/env';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { GIT } from './workstations';
import { AGENT_EFFORTS, type CodexModel } from '../core/types';
import { messageOf } from '../core/text';
import { which } from './path';
import { OWN_GROUP } from './spawn';
import { cleanEnv, type AgentEvent, type AgentRuntime, type AgentSpec } from './runtime';
import { AGY_SERVER, registerAgyTools, wireTools, type AgyRegistration } from './agy-mcp';

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
  if (spec.resume && !/^agy:[A-Za-z0-9_.-]+$/.test(spec.resume)) throw new Error('Antigravity can only resume an agy: session, not a Claude or Codex one');
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
 * When the usage limit that failed a turn lifts (milliseconds), as far as the error says ("retry in
 * 34s", "try again in 2 hours"); `{}` when it names no time. Undefined when it is no usage limit.
 */
export function agyLimit(message: string, now = Date.now()): { resetsAt?: number } | undefined {
  if (!/quota|rate.?limit|resource.?exhausted|usage limit|too many requests|\b429\b/i.test(message)) return undefined;
  const m = /(?:in|after)\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/i.exec(message);
  if (!m) return {};
  const unit = m[2]![0]!.toLowerCase();
  return { resetsAt: now + Number(m[1]) * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1000) };
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
      let turn = false;
      let introduced = false;
      let stderr = '';
      let exited = false;
      let terminate: ReturnType<typeof setTimeout> | undefined;
      let kill: ReturnType<typeof setTimeout> | undefined;
      const child = launch(command, agyArgs(spec), { cwd: spec.cwd, env: { ...cleanEnv(), ...spec.env } });
      let finish!: () => void;
      const done = new Promise<void>((resolve) => { finish = resolve; });

      const signal = (which: NodeJS.Signals) => {
        if (exited) return;
        try { if (OWN_GROUP && child.pid) process.kill(-child.pid, which); else child.kill(which); } catch { /* already gone */ }
      };
      const stop = () => {
        if (closing) return;
        closing = true;
        endpoint.dispose();
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
        if (closing || turn || !queue.length) return;
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
      child.on('close', (code) => {
        exited = true;
        clearTimeout(terminate);
        clearTimeout(kill);
        if (OWN_GROUP && child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch { /* none left */ }
        endpoint.dispose();
        closeConfig.current();
        if (!closing) {
          const signedOut = /authentication|sign in|log ?in/i.test(stderr);
          failEnded(signedOut ? 'Antigravity is not signed in; the owner signs in with their Google account by running `agy` once' : `Antigravity exited${code === null ? '' : ` with code ${code}`}${stderr.trim() ? `: ${stderr.trim().split('\n').slice(-3).join(' ')}` : ''}`);
        }
        closing = true;
        finish();
      });

      if (firstMessage !== undefined) send(firstMessage, images);
      return { send, close: stop, done };
    },
  };
}

export const agyRuntime = createAgyRuntime();
