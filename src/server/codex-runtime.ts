// Native installed Codex app-server adapter. Worker routing and portability live separately.
import { bothNames, seismicEnv } from '../core/env';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { GIT } from './workstations';
import type { CodexModel } from '../core/types';
import { z } from 'zod';
import { messageOf } from '../core/text';
import { sessionRegistry } from './session-registry';
import { codexConnection, CodexRpcError, type CodexConnection, type CodexHandlers } from './codex-rpc';
import { cleanEnv, type AgentEvent, type AgentRuntime, type AgentSpec } from './runtime';

// Codex reserves mcp__ names for actual MCP servers. Keep its wire name separate from the
// canonical identity consumed by Seismic's existing orchestration.
const wirePrefix = 'seismic_';
// A resumed thread keeps the tool definitions it was started with, so a session started before the
// rename still calls `obeya_report` and the like: those dispatch to today's tools. The execution
// tools carried a prefix of their own then, doubled on the wire.
const renamed: Record<string, string> = { obeya_obeya_run: 'seismic_run', obeya_obeya_git: 'seismic_git', obeya_to_obeya: 'seismic_to_seismic', seismic_to_obeya: 'seismic_to_seismic' };
const currentName = (name: string) => renamed[name] ?? name.replace(/^obeya_/, wirePrefix);
const threadResult = z.object({ thread: z.object({ id: z.string().min(1) }), model: z.string() });
const turnResult = z.object({ turn: z.object({ id: z.string().min(1) }) });
const modelPage = z.object({
  data: z.array(z.object({ model: z.string(), isDefault: z.boolean(), supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })), inputModalities: z.array(z.string()) })),
  nextCursor: z.string().nullable(),
});
const backgroundPage = z.object({ data: z.array(z.object({ itemId: z.string(), command: z.string(), osPid: z.number().int().positive().nullable().optional() })), nextCursor: z.string().nullable() });
const turnEvent = z.object({ turn: z.object({ id: z.string(), status: z.string(), error: z.object({ message: z.string(), codexErrorInfo: z.unknown() }).nullable().optional() }) });
const toolCall = z.object({ threadId: z.string(), turnId: z.string(), callId: z.string(), namespace: z.string().nullable(), tool: z.string(), arguments: z.unknown() });
const jsonObject = z.record(z.string(), z.unknown());
// Codex marks the review notifications unstable: only what Seismic shows of them is read
const autoReview = z.object({ review: z.object({ status: z.string(), rationale: z.string().nullish() }), action: jsonObject });

/** What Codex's automatic review judged, as the tool call the conversation names. */
function reviewedAction(action: Record<string, unknown>): { name: string; input: Record<string, unknown> } {
  if (action.type === 'command') return { name: 'Bash', input: { command: action.command } };
  if (action.type === 'execve') return { name: 'Bash', input: { command: [action.program, ...(Array.isArray(action.argv) ? action.argv.slice(1) : [])].join(' ') } };
  if (action.type === 'applyPatch') return { name: 'Edit', input: { file_path: Array.isArray(action.files) ? action.files.join(', ') : '' } };
  if (action.type === 'networkAccess') return { name: `Network: ${action.target}`, input: {} };
  const { type, ...input } = action;
  return { name: String(type), input };
}
const rateLimitWindow = z.object({ usedPercent: z.number(), resetsAt: z.number().nullable().optional() }).nullable().optional();
const rateLimitSnapshot = z.object({ limitId: z.string().nullable().optional(), primary: rateLimitWindow, secondary: rateLimitWindow, rateLimitReachedType: z.unknown().optional() });
const rateLimitsUpdate = z.object({ rateLimits: rateLimitSnapshot });

/**
 * When the usage limit that failed a Codex turn lifts (milliseconds), as far as Codex says: the last
 * reset of the windows its rate-limit updates report used up, else the time its message names
 * ("… or try again at 10:38 PM.", "… try again at Nov 5th, 2026 10:38 PM.", the machine's own
 * clock), else the last reset of a limit it reports reached (an update that lags the refusal says
 * 99 % used), else nothing, and the worker tries again later.
 */
export function codexLimit(message: string, snapshots: z.infer<typeof rateLimitSnapshot>[], now = Date.now()): { resetsAt?: number } {
  const resets = snapshots
    .flatMap((s) => [s.primary, s.secondary])
    .filter((w) => w && w.usedPercent >= 100 && w.resetsAt && w.resetsAt * 1000 > now)
    .map((w) => w!.resetsAt! * 1000);
  if (resets.length) return { resetsAt: Math.max(...resets) };
  const m = /\btry again at (?:([A-Z][a-z]{2}) (\d{1,2})(?:st|nd|rd|th)?, (\d{4}) )?(\d{1,2}):(\d{2}) ?([AP]M)\b/i.exec(message);
  if (!m) {
    const reached = snapshots
      .filter((s) => s.rateLimitReachedType != null)
      .flatMap((s) => [s.primary?.resetsAt, s.secondary?.resetsAt])
      .filter((r): r is number => !!r && r * 1000 > now)
      .map((r) => r * 1000);
    return reached.length ? { resetsAt: Math.max(...reached) } : {};
  }
  const hour = (Number(m[4]) % 12) + (m[6]!.toUpperCase() === 'PM' ? 12 : 0);
  if (m[1]) {
    const month = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(m[1].toLowerCase()) / 3;
    if (month < 0 || !Number.isInteger(month)) return {};
    return { resetsAt: new Date(Number(m[3]), month, Number(m[2]), hour, Number(m[5])).getTime() };
  }
  // today, or tomorrow for a time already past
  const at = new Date(now);
  at.setHours(hour, Number(m[5]), 0, 0);
  if (at.getTime() < now - 60_000) at.setDate(at.getDate() + 1);
  return { resetsAt: at.getTime() };
}
const configLayers = z.object({ layers: z.array(z.object({ name: z.object({ type: z.string(), dotCodexFolder: z.string().optional() }).passthrough(), disabledReason: z.string().nullable().optional() })).nullable().optional() });

/**
 * The paths Codex may key the trust of the project `cwd` lies in by (`[projects."<path>"]`): its
 * checkout's top level and, for a linked worktree, the main checkout's, as the file system has them.
 */
export function projectRoots(cwd: string): string[] {
  const r = spawnSync(GIT, ['-C', cwd, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'], { encoding: 'utf8', windowsHide: true });
  const [top, common] = r.status === 0 ? r.stdout.trim().split('\n') : [];
  const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
  const roots = [top ? real(top) : real(cwd), ...(common && basename(common) === '.git' ? [real(dirname(common))] : [])];
  return [...new Set(roots)];
}

/**
 * The `-c` override that makes Codex load the repository's own configuration (`.codex/`) in `cwd`
 * or none of it (`trusted`), over what the user's Codex configuration says of the project.
 */
export function projectTrust(cwd: string, trusted: boolean): string {
  const level = trusted ? 'trusted' : 'untrusted';
  return `projects={${projectRoots(cwd).map((p) => `${JSON.stringify(p)}={trust_level="${level}"}`).join(',')}}`;
}

/**
 * The installed Codex's native executable, or null. Resolved before applying session environment
 * additions. An npm .cmd shim is not a native executable on Windows; do not work around that by
 * introducing a shell into the transport.
 */
function installedCodex(): string | null {
  const executable = Bun.which(seismicEnv('CODEX') ?? 'codex', { PATH: process.env.PATH ?? '' });
  return executable && isAbsolute(executable) && !/\.(cmd|bat|ps1)$/i.test(executable) ? executable : null;
}

/** Whether a Codex worker could start on this machine: Codex is installed and signed in (`codex login status`). */
export function codexConnected(): boolean {
  const executable = installedCodex();
  if (!executable) return false;
  const r = spawnSync(executable, ['login', 'status'], { env: cleanEnv(), timeout: 5000, stdio: 'ignore' });
  return r.status === 0;
}

type Connect = (spec: AgentSpec, handlers: CodexHandlers) => CodexConnection;
const connectInstalled: Connect = (spec, handlers) => {
  const executable = installedCodex();
  if (!executable) throw new Error('Installed Codex executable unavailable; set SEISMIC_CODEX to its native executable path');
  // An earlier Seismic crashed and its sweep could not end this workstation's old session: a new one
  // could write beside it. The sweep tries again when Seismic next starts.
  const left = sessionRegistry()?.unaccounted(spec.cwd);
  if (left?.length) throw new Error(`An earlier session in this workstation left processes that are still running (${left.map((l) => l.label).join('; ')}); Seismic tries to end them when it starts`);
  return codexConnection({
    command: executable,
    args: ['app-server', '--listen', 'stdio://', '-c', projectTrust(spec.cwd, !!spec.codexConfig)],
    cwd: spec.cwd,
    env: { ...cleanEnv(), ...spec.env },
    label: `Codex in ${spec.cwd}`,
  }, handlers);
};

/**
 * The sandbox a Codex worker runs in: Codex's `workspace-write`, which keeps it in its workstation
 * and the temporary directories with no network. `SEISMIC_CODEX_SANDBOX=danger-full-access` in the
 * environment of Seismic lifts it, for a time when the sandbox stops work more than it protects
 * (loopback servers, browsers, the demos); Codex then asks only for what it holds dangerous. The
 * name from before the rename, `OBEYA_CODEX_SANDBOX`, counts where the new one is not set.
 */
export function codexSandbox(env: Record<string, string | undefined> = process.env): 'workspace-write' | 'danger-full-access' {
  const name = env.SEISMIC_CODEX_SANDBOX !== undefined ? 'SEISMIC_CODEX_SANDBOX' : 'OBEYA_CODEX_SANDBOX';
  const choice = env[name];
  if (choice === 'danger-full-access') {
    if (!warnedUnsandboxed) console.warn(`Seismic: Codex workers run without a sandbox (${name}=danger-full-access)`);
    warnedUnsandboxed = true;
    return choice;
  }
  if (choice && choice !== 'workspace-write') console.warn(`Seismic: ${name}=${choice} is neither workspace-write nor danger-full-access; Codex workers keep the workspace-write sandbox`);
  return 'workspace-write';
}
let warnedUnsandboxed = false;

/** Refuse gaps in the spike rather than quietly dropping a safety or orchestration contract. */
function supported(spec: AgentSpec) {
  const unsupported = [
    !isAbsolute(spec.cwd) || spec.cwd.startsWith('ssh://') ? 'non-local working directory' : '',
    spec.untrusted ? 'untrusted repository configuration' : '',
    spec.plugins?.length ? 'Claude plugins' : '',
    spec.dirs?.some((d) => !isAbsolute(d)) ? 'non-local additional workstation roots' : '',
    spec.watch ? 'before/after mutation hooks' : '',
    spec.permissionMode && spec.permissionMode !== 'default' ? `permission mode ${spec.permissionMode}` : '',
    // Also covers interpreters selected by a CLI shim's /usr/bin/env shebang.
    Object.keys(spec.env ?? {}).some((key) => key.toLowerCase() === 'path') ? 'per-session executable search path' : '',
  ].filter(Boolean);
  if (unsupported.length) throw new Error(`Codex does not support: ${unsupported.join(', ')}`);
  if (spec.resume && !/^codex:[A-Za-z0-9_-]+$/.test(spec.resume)) throw new Error('Codex can only resume a codex: session, not a Claude or Pi session');
}

/**
 * Native installed Codex, not a Codex model inside another harness. The injectable connection is
 * only the wire boundary for contract tests. Harness routing pins the setting to each card.
 */
export function createCodexRuntime(connect: Connect = connectInstalled): AgentRuntime {
  return {
    start(spec, firstMessage, images) {
      supported(spec);
      const tools = new Map(spec.tools.map((t) => [wirePrefix + t.name, { tool: t, schema: z.object(t.schema).strict() }]));
      if (tools.size !== spec.tools.length) throw new Error('Duplicate Seismic tool name');
      const dynamicTools = [...tools].map(([name, { tool, schema }]) => ({ type: 'function', name, description: tool.description, inputSchema: z.toJSONSchema(schema) }));
      const queue: { text: string; images: string[] }[] = [];
      const completed = new Set<string>();
      const toolResults = new Map<string, Promise<unknown>>();
      const permissions = new Map<string | number | symbol, AbortController>();
      // the account's limits as Codex last reported them, by limit
      const limits = new Map<string, z.infer<typeof rateLimitSnapshot>>();
      const cancelPermissions = (obsolete = false) => {
        for (const controller of permissions.values()) controller.abort(obsolete ? 'permission-obsolete' : undefined);
        permissions.clear();
      };
      let thread: string | undefined;
      let turn: string | undefined;
      let ready = false;
      let closing = false;
      let pumping = false;
      let settle = false;
      let idlePending = false;
      let imageSupport = false;
      let background: { id: string; description: string }[] = [];
      let poll: ReturnType<typeof setTimeout> | undefined;
      const emit = (event: AgentEvent) => { if (!closing) spec.onEvent(event); };
      const connection = connect(spec, { notification, request: serverRequest });
      const done = connection.done.catch((error: unknown) => {
        if (!closing) { emit({ type: 'error', message: messageOf(error), ended: true }); emit({ type: 'idle' }); }
      }).finally(() => {
        closing = true;
        cancelPermissions();
        clearTimeout(poll);
      });

      function fail(error: unknown) {
        if (closing) return;
        emit({ type: 'error', message: messageOf(error), ended: true });
        emit({ type: 'idle' });
        close();
      }
      function close() {
        if (closing) return;
        closing = true;
        cancelPermissions();
        clearTimeout(poll);
        // Try the semantic cleanup first, but do not wait a full RPC timeout to begin process
        // shutdown. EOF plus the transport's escalation bounds a stuck app-server as well.
        const deadline = setTimeout(() => connection.close(), 1000);
        void (async () => {
          try {
            try {
              if (thread && turn) await connection.request('turn/interrupt', { threadId: thread, turnId: turn });
            } catch { /* a turn can end between close() and interrupt */ }
            try {
              if (thread) await connection.request('thread/backgroundTerminals/clean', { threadId: thread });
            } catch { /* still close the transport if cleanup is unsupported or fails */ }
          } finally { clearTimeout(deadline); connection.close(); }
        })();
      }
      function send(text: string, files: string[] = []) {
        if (closing) return;
        if (files.some((f) => !isAbsolute(f))) throw new Error('Codex images must be absolute local file paths');
        queue.push({ text, images: [...files] });
        void pump();
      }
      async function backgrounds() {
        const tasks: typeof background = [];
        const pids: number[] = [];
        let cursor: string | null = null;
        do {
          const page = backgroundPage.parse(await connection.request('thread/backgroundTerminals/list', { threadId: thread, cursor, limit: 100 }));
          tasks.push(...page.data.map((t) => ({ id: t.itemId, description: t.command })));
          pids.push(...page.data.flatMap((t) => t.osPid ? [t.osPid] : []));
          cursor = page.nextCursor;
        } while (cursor && !closing);
        if (closing) return;
        await connection.trackProcesses?.(pids);
        const ended = background.filter((before) => !tasks.some((now) => now.id === before.id));
        const changed = JSON.stringify(tasks) !== JSON.stringify(background);
        if (changed) emit({ type: 'background', tasks });
        background = tasks;
        // Codex's shell terminal doesn't itself create a new turn when it exits, unlike Claude's
        // background task. Wake the coding loop to inspect its outcome rather than report success.
        if (ended.length) queue.push({ text: `Background commands have ended: ${ended.map((t) => t.description).join('; ')}. Inspect their results and continue your task.`, images: [] });
        clearTimeout(poll);
        if (tasks.length) poll = setTimeout(() => { settle = true; void pump(); }, 1000);
        return changed;
      }
      async function pump() {
        if (!ready || pumping || closing) return;
        pumping = true;
        try {
          while (!closing) {
            if (settle) {
              settle = false;
              const changed = await backgrounds();
              if (closing) break;
              // Unchanged polls must not reset the worker's background timeout.
              if (!turn && (changed || idlePending)) emit({ type: 'idle', background: background.length, more: queue.length > 0 });
              idlePending = false;
            }
            if (closing) break;
            const next = queue[0];
            if (!next) break;
            if (next.images.length && !imageSupport) throw new Error('Selected Codex model does not support images');
            const input = [{ type: 'text', text: next.text, text_elements: [] }, ...next.images.map((path) => ({ type: 'localImage', path }))];
            if (turn) {
              const expected = turn;
              try {
                const result = z.object({ turnId: z.string() }).parse(await connection.request('turn/steer', { threadId: thread, expectedTurnId: expected, input }));
                if (result.turnId !== expected) throw new Error('Codex accepted input for an unexpected turn');
              } catch (error) {
                // Only a definite server rejection is retryable. A timeout or transport failure
                // may have accepted input; replaying it can duplicate instructions or actions.
                if (error instanceof CodexRpcError && completed.has(expected)) continue;
                throw error;
              }
            } else {
              const result = turnResult.parse(await connection.request('turn/start', { threadId: thread, input, ...(spec.effort ? { effort: spec.effort } : {}) }));
              if (!completed.has(result.turn.id)) turn = result.turn.id;
            }
            queue.shift();
          }
        } catch (error) { fail(error); }
        finally { pumping = false; }
      }
      function notification(method: string, params: Record<string, unknown>) {
        // the account's limits are the app-server's, not the thread's
        if (method === 'account/rateLimits/updated') {
          const parsed = rateLimitsUpdate.safeParse(params);
          if (parsed.success) limits.set(parsed.data.rateLimits.limitId ?? 'codex', parsed.data.rateLimits);
          return;
        }
        if (closing || params.threadId !== thread || !thread) return;
        if (method === 'serverRequest/resolved') {
          const id = params.requestId;
          if (typeof id === 'string' || typeof id === 'number') {
            permissions.get(id)?.abort('permission-obsolete');
            permissions.delete(id);
          }
          return;
        }
        try {
          if (method === 'turn/started') {
            const result = turnEvent.parse(params);
            turn = result.turn.id;
          } else if (method === 'turn/completed') {
            const result = turnEvent.parse(params).turn;
            if ((turn && result.id !== turn) || completed.has(result.id)) return;
            completed.add(result.id);
            cancelPermissions(true);
            toolResults.clear();
            if (completed.size > 100) completed.delete(completed.values().next().value!);
            turn = undefined;
            if (result.status === 'failed') {
              const info = result.error?.codexErrorInfo;
              const message = result.error?.message ?? 'Codex turn failed';
              emit({ type: 'error', message, ...(['usageLimitExceeded', 'rateLimitExceeded'].includes(String(info)) ? { limit: codexLimit(message, [...limits.values()]) } : {}) });
            }
            settle = true;
            idlePending = true;
            void pump();
          } else if (method === 'item/autoApprovalReview/completed') {
            // Codex's own review refused what the worker wanted outside its sandbox: shown as auto mode's refusals are
            const review = autoReview.safeParse(params);
            if (review.success && params.turnId === turn && (review.data.review.status === 'denied' || review.data.review.status === 'timedOut')) emit({ type: 'denied', ...reviewedAction(review.data.action), by: 'classifier', ...(review.data.review.rationale ? { reason: review.data.review.rationale } : {}) });
          } else if (method === 'item/agentMessage/delta') {
            if (params.turnId === turn) emit({ type: 'text', text: z.string().parse(params.delta) });
          } else if (method === 'item/started') {
            if (params.turnId !== turn) return;
            const item = jsonObject.parse(params.item);
            if (item.type === 'commandExecution') emit({ type: 'tool', name: 'Bash', input: { command: item.command, cwd: item.cwd } });
            else if (item.type === 'fileChange') emit({ type: 'tool', name: 'Edit', input: { changes: item.changes } });
            // Seismic tools are emitted at dispatch, not twice (here and item/tool/call).
          }
          if (method === 'item/completed' && params.turnId === turn) {
            const item = jsonObject.parse(params.item);
            if (item.type === 'commandExecution' || item.type === 'fileChange') {
              emit({ type: 'toolDone', name: item.type === 'commandExecution' ? 'Bash' : 'Edit', ok: item.status !== 'failed' && (item.exitCode ?? 0) === 0 });
              const update = spec.contextUpdate?.();
              if (update) send(update);
            }
          }
          // Error notifications with willRetry belong to Codex's retry loop. Only turn/completed
          // establishes an idle/error boundary; individual items and transient errors never do.
        } catch (error) { fail(error); }
      }
      async function serverRequest(method: string, params: Record<string, unknown>, requestId?: string | number): Promise<unknown> {
        if (closing || !thread || params.threadId !== thread || !turn || params.turnId !== turn) throw new CodexRpcError(-32602, 'Request does not belong to the active Seismic thread and turn');
        if (method === 'item/tool/call') {
          const call = toolCall.parse(params);
          const key = `${call.turnId}:${call.callId}`;
          const existing = toolResults.get(key);
          if (existing) return existing;
          const result = (async () => {
            const entry = call.namespace === null ? tools.get(currentName(call.tool)) : undefined;
            if (!entry) return { contentItems: [{ type: 'inputText', text: 'Unknown Seismic tool' }], success: false };
            try {
              const args = entry.schema.parse(call.arguments);
              emit({ type: 'tool', name: `mcp__seismic__${entry.tool.name}`, input: args });
              const text = await entry.tool.run(args);
              const update = spec.contextUpdate?.();
              return { contentItems: [{ type: 'inputText', text: update ? `${text}\n\n${update}` : text }], success: true };
            } catch (error) { return { contentItems: [{ type: 'inputText', text: messageOf(error) }], success: false }; }
          })();
          toolResults.set(key, result);
          return result;
        }
        if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
          const name = method.includes('commandExecution') ? 'Bash' : 'Edit';
          const reason = typeof params.reason === 'string' ? params.reason : undefined;
          // Persist the action and its authority, not ephemeral RPC identities. A restarted
          // thread reissues the same approval with new turn/item ids; a one-use owner grant
          // must still match, but a changed command or permission scope must not.
          const { threadId: _, turnId: __, itemId: ___, reason: ____, availableDecisions: _____, startedAtMs: ______, approvalId: _______, ...input } = params;
          // Codex's availableDecisions may restrict a proposed amendment to a choice this spike
          // doesn't understand. Never approve amendments, broad grants, or session-wide authority.
          const decisions = params.availableDecisions;
          const canAccept = params.grantRoot == null && (!Array.isArray(decisions) || decisions.includes('accept'));
          const key = requestId ?? Symbol();
          const controller = new AbortController();
          permissions.set(key, controller);
          try {
            const answer = spec.askOwner && canAccept ? await spec.askOwner({ name, input, reason }, controller.signal) : { allow: false, message: 'No one-action owner approval available' };
            if (closing || controller.signal.aborted || params.turnId !== turn) return { decision: 'decline' };
            if (answer.allow) return { decision: 'accept' };
            emit({ type: 'denied', name, input, by: spec.askOwner && canAccept ? 'owner' : 'mode', reason: answer.message });
            // Codex's decline, unlike Claude's tool result, carries no explanation to the model.
            if (spec.askOwner && canAccept && answer.message) send(answer.message);
            return { decision: 'decline' };
          } finally { permissions.delete(key); }
        }
        if (method === 'item/permissions/requestApproval') {
          emit({ type: 'denied', name: 'permissions', input: params, by: 'mode', reason: 'Extended permission profiles are not supported by the Codex worker' });
          return { permissions: {}, scope: 'turn' };
        }
        // Native requestUserInput isn't Seismic's shared question workflow. Agents must use ask.
        throw new CodexRpcError(-32601, `Unsupported Codex request: ${method}; use the Seismic tools`);
      }
      void (async () => {
        try {
          const models = await discover(connection, () => closing);
          if (closing) return;
          await checkProjectConfig(connection, spec);
          if (closing) return;
          const model = spec.model ? models.find((m) => m.model === spec.model) : models.find((m) => m.isDefault);
          if (!model) throw new Error(`Codex model unavailable: ${spec.model ?? '(account default)'}`);
          if (spec.effort && !model.supportedReasoningEfforts.some((e) => e.reasoningEffort === spec.effort)) throw new Error(`Codex model ${model.model} does not support effort ${spec.effort}`);
          imageSupport = model.inputModalities.includes('image');
          const config = {
            ...(spec.dirs?.length ? { 'sandbox_workspace_write.writable_roots': spec.dirs } : {}),
            ...(connection.pid ? { 'shell_environment_policy.set': bothNames({ AGENT_PID: String(connection.pid) }) } : {}),
          };
          // a read-only agent (a code review) reads and runs what only reads, and asks nobody
          const params = { cwd: spec.cwd, model: model.model, developerInstructions: spec.system, approvalPolicy: spec.readOnly ? 'never' : 'on-request', approvalsReviewer: spec.autoReview && !spec.readOnly ? 'auto_review' : 'user', sandbox: spec.readOnly ? 'read-only' : codexSandbox(), config };
          const result = threadResult.parse(await connection.request(spec.resume ? 'thread/resume' : 'thread/start', spec.resume ? { ...params, threadId: spec.resume.slice('codex:'.length) } : { ...params, dynamicTools }));
          if (closing) return;
          if (result.model !== model.model) throw new Error(`Codex substituted model ${result.model} for ${model.model}`);
          thread = result.thread.id;
          if (spec.resume && `codex:${thread}` !== spec.resume) throw new Error('Codex resumed an unexpected thread');
          emit({ type: 'session', id: `codex:${thread}`, ...(spec.setting ? { setting: { ...spec.setting, codex: { model: model.model, effort: spec.effort ?? 'high' } } } : {}) });
          ready = true;
          void pump();
        } catch (error) { fail(error); }
      })();
      if (firstMessage !== undefined) send(firstMessage, images);
      return { send, close, done };
    },
  };
}

/**
 * Codex's own account of the configuration it reads in `spec.cwd` agrees with the trust it was
 * started with: no project layer when the repository's is not trusted (`codexConfig`), and none
 * but the workstation's own `.codex/` when it is. Anything else ends the start, before a thread runs.
 */
async function checkProjectConfig(connection: CodexConnection, spec: AgentSpec) {
  const { layers } = configLayers.parse(await connection.request('config/read', { cwd: spec.cwd, includeLayers: true }));
  const own = join(spec.cwd, '.codex');
  const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
  const loaded = (layers ?? []).filter((l) => l.name.type === 'project' && !l.disabledReason).map((l) => l.name.dotCodexFolder ?? '(unknown)');
  const stray = loaded.filter((folder) => !spec.codexConfig || real(folder) !== real(own));
  if (stray.length) throw new Error(`Codex would load repository configuration the owner has not trusted: ${stray.join(', ')}`);
}

async function discover(connection: CodexConnection, closing: () => boolean): Promise<CodexModel[]> {
  await connection.request('initialize', { clientInfo: { name: 'obeya', title: 'Seismic', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  if (closing()) return [];
  connection.notify('initialized', {});
  const models: CodexModel[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = modelPage.parse(await connection.request('model/list', { cursor, limit: 100 }));
    models.push(...page.data);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('Codex returned a repeated model-list cursor');
    if (cursor) seen.add(cursor);
  } while (cursor && !closing());
  return models;
}

/** Account catalog only: does not create a thread or spend a model turn. */
export async function codexModels(): Promise<CodexModel[]> {
  const connection = connectInstalled({ cwd: homedir(), system: '', tools: [], onEvent() {} }, {
    notification() {}, request: async () => { throw new CodexRpcError(-32601, 'No active worker'); },
  });
  try { return await discover(connection, () => false); }
  finally { connection.close(); await connection.done.catch(() => {}); }
}

export const codexRuntime = createCodexRuntime();
