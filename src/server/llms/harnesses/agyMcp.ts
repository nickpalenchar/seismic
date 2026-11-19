/**
 * The MCP endpoint through which Antigravity (`agy`) reaches Seismic's tools. Claude gets its tools
 * from an in-process MCP server and Codex over its app-server protocol; `agy` can only connect to an
 * MCP server of its own: here a localhost HTTP endpoint (Streamable HTTP, JSON replies), one for the
 * whole server, on a port of its own. Each session registers its tools under a token of its own that
 * its stdio bridge forwards as a bearer header. The workspace configuration has no credentials.
 */
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { messageOf } from '../../../core/text';
import type { AgentTool } from '../../runtime';
import { COMPILED } from '../../resources';

/** The name `agy` knows the server by, and the prefix of every tool, so none clashes with one of its own. */
export const AGY_SERVER = 'seismic';
export const AGY_TOOL_PREFIX = 'seismic_';
export const AGY_BRIDGE_FLAG = '--agy-mcp-bridge';

// The shared config starts the same dispatcher regardless of where Seismic is installed.
export const AGY_BRIDGE_COMMAND = process.platform === 'win32'
  ? { command: 'cmd.exe', args: ['/d', '/v:off', '/c', '%SEISMIC_AGY_MCP_LAUNCH%'] }
  : { command: '/bin/sh', args: [
      '-c',
      'if [ -n "$SEISMIC_AGY_MCP_ENTRY" ]; then set -- "$SEISMIC_AGY_MCP_ENTRY" "$@"; fi; exec "$SEISMIC_AGY_MCP_EXECUTABLE" "$@"',
      'seismic-agy-mcp',
      AGY_BRIDGE_FLAG,
    ] };

const bridgeEntry = COMPILED ? undefined : resolve(import.meta.dir, '../../main.ts');

export function agyBridgeEnv(
  { url, token }: AgyEndpoint,
  executable = process.execPath,
  entry = bridgeEntry,
) {
  return {
    SEISMIC_AGY_MCP_URL: url,
    SEISMIC_AGY_MCP_TOKEN: token,
    ...(process.platform === 'win32'
      // Disable delayed expansion in cmd so exclamation marks in paths survive as well as spaces.
      ? { SEISMIC_AGY_MCP_LAUNCH: `"${executable}"${entry ? ` "${entry}"` : ''} ${AGY_BRIDGE_FLAG}` }
      : { SEISMIC_AGY_MCP_EXECUTABLE: executable, SEISMIC_AGY_MCP_ENTRY: entry ?? '' }),
  };
}

/** agy starts this stdio MCP subprocess with the credentials inherited from its own session. */
export async function runAgyMcpBridge() {
  const { SEISMIC_AGY_MCP_URL: url, SEISMIC_AGY_MCP_TOKEN: token } = process.env;
  if (!url || !/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(url) || !token) throw new Error('Missing Antigravity session endpoint');
  const forward = async (line: string) => {
    let message: { id?: unknown };
    try { message = JSON.parse(line); } catch { return; }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: line,
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Endpoint unavailable');
      if (response.status !== 202) console.log(JSON.stringify(await response.json()));
    } catch {
      if (message?.id !== undefined) console.log(JSON.stringify(rpcError(message.id, -32603, 'Antigravity session endpoint unavailable')));
    }
  };
  const pending = new Set<Promise<void>>();
  for await (const line of createInterface({ input: process.stdin })) {
    const reply = forward(line);
    pending.add(reply);
    void reply.finally(() => pending.delete(reply));
  }
  await Promise.all(pending);
}

export interface AgyRegistration {
  /** The tools of the session, by the name they have on the wire. */
  tools: Map<string, { tool: AgentTool; schema: z.ZodObject }>;
  /** Told of each call as it starts; what the call returns is the tool's text. */
  called?: (tool: AgentTool, args: Record<string, unknown>) => void;
  /** Appended to the text of every result: what changed since the session's instructions were built. */
  update?: () => string | undefined;
}

export interface AgyEndpoint {
  url: string;
  token: string;
  /** Takes the session's tools off the endpoint: its token opens nothing any more. */
  dispose(): void;
}

const registrations = new Map<string, AgyRegistration>();
let server: ReturnType<typeof Bun.serve> | undefined;

const rpc = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** The tools as the wire has them: their names prefixed, their arguments checked as the schema says. */
export function wireTools(tools: AgentTool[]): AgyRegistration['tools'] {
  const wire: AgyRegistration['tools'] = new Map(tools.map((t) => [AGY_TOOL_PREFIX + t.name, { tool: t, schema: z.object(t.schema).strict() }]));
  if (wire.size !== tools.length) throw new Error('Duplicate Seismic tool name');
  return wire;
}

/** The reply to one JSON-RPC message of a session, or null for a notification. */
export async function handleMcp(reg: AgyRegistration, message: unknown): Promise<unknown | null> {
  const m = (message && typeof message === 'object' ? message : {}) as { id?: unknown; method?: unknown; params?: Record<string, unknown> };
  if (typeof m.method !== 'string') return rpcError(m.id ?? null, -32600, 'Invalid request');
  if (m.id === undefined) return null;
  if (m.method === 'initialize') {
    const asked = typeof m.params?.protocolVersion === 'string' ? m.params.protocolVersion : '2025-03-26';
    return rpc(m.id, { protocolVersion: asked, capabilities: { tools: {} }, serverInfo: { name: AGY_SERVER, version: '1.0.0' } });
  }
  if (m.method === 'ping') return rpc(m.id, {});
  if (m.method === 'tools/list') {
    return rpc(m.id, { tools: [...reg.tools].map(([name, { tool, schema }]) => ({ name, description: tool.description, inputSchema: z.toJSONSchema(schema, { io: 'input' }) })) });
  }
  if (m.method === 'tools/call') {
    const entry = typeof m.params?.name === 'string' ? reg.tools.get(m.params.name) : undefined;
    if (!entry) return rpcError(m.id, -32602, 'Unknown Seismic tool');
    try {
      const args = entry.schema.parse(m.params?.arguments ?? {}) as Record<string, unknown>;
      reg.called?.(entry.tool, args);
      const text = await entry.tool.run(args);
      const update = reg.update?.();
      return rpc(m.id, { content: [{ type: 'text', text: update ? `${text}\n\n${update}` : text }] });
    } catch (error) {
      return rpc(m.id, { content: [{ type: 'text', text: messageOf(error) }], isError: true });
    }
  }
  return rpcError(m.id, -32601, `Method not found: ${m.method}`);
}

function listen(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== '/mcp') return new Response('Not found', { status: 404 });
      const bearer = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
      const reg = registrations.get(bearer);
      if (!reg) return new Response('Unauthorized', { status: 401 });
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
      let body: unknown;
      try { body = await request.json(); } catch { return Response.json(rpcError(null, -32700, 'Parse error'), { status: 400 }); }
      if (Array.isArray(body)) {
        const replies = (await Promise.all(body.map((b) => handleMcp(reg, b)))).filter((r) => r !== null);
        return replies.length ? Response.json(replies) : new Response(null, { status: 202 });
      }
      const reply = await handleMcp(reg, body);
      return reply === null ? new Response(null, { status: 202 }) : Response.json(reply);
    },
  });
}

/** Registers a session's tools on the endpoint (started with the first), under a token of the session's own. */
export function registerAgyTools(reg: AgyRegistration): AgyEndpoint {
  server ??= listen();
  const token = randomBytes(32).toString('base64url');
  registrations.set(token, reg);
  return { url: `http://127.0.0.1:${server.port}/mcp`, token, dispose: () => { registrations.delete(token); } };
}
