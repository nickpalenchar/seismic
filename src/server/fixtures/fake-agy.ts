// A stand-in for Antigravity (`agy`) in stream-json mode, for tests and scratch runs of Seismic
// (SEISMIC_AGY pointing at a wrapper that runs it). Each user frame is a script, one directive per line:
//   CALL <tool> <json>  calls a Seismic tool over the MCP endpoint named in .agents/mcp_config.json
//   RUN <command>       shows a native shell step
//   FAIL                ends the turn with a usage-limit error
// Anything else is answered with a line of text. Its argv is echoed on the first text, as `ARGV <json>`.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const at = args.indexOf('--conversation');
const conversation = at >= 0 ? args[at + 1] : 'conv-1';
const out = (frame: unknown) => process.stdout.write(`${JSON.stringify(frame)}\n`);
const config = JSON.parse(readFileSync('.agents/mcp_config.json', 'utf8')).mcpServers.seismic as { serverUrl: string; headers: Record<string, string> };
let rpcId = 0;
const rpc = async (method: string, params: unknown) => {
  const res = await fetch(config.serverUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...config.headers }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  return res.json() as Promise<{ result?: { content?: { text: string }[] }; error?: { message: string } }>;
};
let step = 0;

out({ event: 'init', conversation_id: conversation });
await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fake-agy', version: '0' } });
let first = true;
let buffer = '';
for await (const chunk of process.stdin) {
  buffer += chunk;
  let i: number;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
    const frame = JSON.parse(line) as { event: string; message: { content: string } };
    if (frame.event !== 'user') continue;
    if (first) { out({ event: 'step_update', step_update: { step_type: 'agent_response', step_index: step++, state: 'ACTIVE', text_delta: `ARGV ${JSON.stringify(args)} ` } }); first = false; }
    let failed = false;
    for (const directive of frame.message.content.split('\n')) {
      const m = /^(CALL|RUN|FAIL)\b\s*(\S*)\s*(.*)$/.exec(directive.trim());
      if (!m) continue;
      if (m[1] === 'FAIL') failed = true;
      else if (m[1] === 'RUN') {
        const index = step++;
        const command = [m[2], m[3]].filter(Boolean).join(' ');
        out({ event: 'step_update', step_update: { step_type: 'tool', step_index: index, state: 'ACTIVE', tool_name: 'run_command', tool_info: { parameters: { command } } } });
        out({ event: 'step_update', step_update: { step_type: 'tool', step_index: index, state: 'DONE', tool_name: 'run_command', tool_info: { parameters: { command } } } });
      } else {
        const index = step++;
        const name = `seismic_${m[2]}`;
        out({ event: 'step_update', step_update: { step_type: 'tool', step_index: index, state: 'ACTIVE', tool_name: 'call_mcp_tool', tool_info: { parameters: { ServerName: 'seismic', ToolName: name } } } });
        const reply = await rpc('tools/call', { name, arguments: m[3] ? JSON.parse(m[3]) : {} });
        const text = reply.result?.content?.map((c) => c.text).join('') ?? reply.error?.message ?? '';
        out({ event: 'step_update', step_update: { step_type: 'tool', step_index: index, state: 'DONE', tool_name: 'call_mcp_tool', tool_info: { parameters: { ServerName: 'seismic', ToolName: name } } } });
        out({ event: 'step_update', step_update: { step_type: 'agent_response', step_index: step++, state: 'ACTIVE', text_delta: `${m[2]} -> ${text} ` } });
      }
    }
    out(failed ? { event: 'result', result: { status: 'ERROR', error: 'Quota exceeded. Retry in 30s.' } } : { event: 'result', result: { status: 'SUCCESS' } });
  }
}
