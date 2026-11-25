



import type { AgentDoing } from '../core/types';


export const THINKING_AFTER = 20_000;


type DemoStage = 'preparingDemo' | 'recordingDemo' | 'finalizingDemo';

export interface Doing {
  demo?: DemoStage;
  
  failed?: string;
  thinking?: boolean;
  building?: number;
}

/** The label the card shows for the state: a failure the agent works on before the demo, the demo before thinking. */
export function shownDoing(d: Doing): AgentDoing {
  return d.failed ? 'debugging' : d.demo ?? (d.building ? 'building' : d.thinking ? 'thinking' : 'working');
}

/** A Bash command that renders a demo video (the demo skill's `node demo.ts`, a revoice), not a dry run or the narration alone. */
const renders = (command: string) =>
  (/\bdemo\.ts\b/.test(command) && !/--(dry|narration)\b/.test(command) && /\bnode\b/.test(command)) || /\brevoice(\.ts)?\b/.test(command);

/** A step that belongs to preparing a demo: the skill itself, its scripts and files, a dry run. */
function preparesDemo(name: string, input: Record<string, unknown>): boolean {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  if (name === 'Skill') return /(^|:)demo$/.test(s('skill'));
  if (name === 'Bash') return /\b(demo|explore)\.ts\b|\/skills\/demo\//.test(s('command'));
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit') return /(^|\/)(demo|explore)\.ts$|\/demos\/[^/]+\/stage\.json$/.test(s('file_path'));
  return false;
}

/** The state after the agent starts a tool call. Seismic's own tools change nothing but a handover, which ends the demo. */
export function onTool(d: Doing, name: string, input: Record<string, unknown>): Doing {
  const next: Doing = { ...d, thinking: false };
  if (name === 'mcp__seismic__ready_for_review' || name === 'mcp__seismic__ask') return { failed: d.failed };
  if (name.startsWith('mcp__')) return next;
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch'].includes(name)) next.building = (d.building ?? 0) + 1;
  const command = name === 'Bash' && typeof input.command === 'string' ? input.command : '';
  if (command && renders(command)) next.demo = 'recordingDemo';
  else if (preparesDemo(name, input)) next.demo = d.demo === 'recordingDemo' || d.demo === 'finalizingDemo' ? 'finalizingDemo' : 'preparingDemo';
  
  else if (d.demo === 'recordingDemo') next.demo = 'finalizingDemo';
  return next;
}

/** The state after a tool call ended: a failure marks the agent debugging until that tool succeeds again. */
export function onToolDone(d: Doing, name: string, ok: boolean): Doing {
  if (name.startsWith('mcp__')) return d;
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch'].includes(name)) d = { ...d, building: Math.max(0, (d.building ?? 0) - 1) };
  if (!ok) return { ...d, failed: name };
  return d.failed === name ? { ...d, failed: undefined } : d;
}
