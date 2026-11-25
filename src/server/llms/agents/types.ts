



import type { AgentSpec } from '../../runtime';
import type { SeismicSkill } from '../skills/seismicSkill';


export type AgentSkill = SeismicSkill;


export interface AgentMcp {
  name: string;
  
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}












export type AgentPermission = 'ask' | 'acceptEdits' | 'auto' | 'dangerouslyBypassPermissions' | 'readOnly';






export type SessionOptions = Pick<AgentSpec, 'at' | 'dirs' | 'untrusted' | 'claudeHeld' | 'codexConfig' | 'env' | 'contextUpdate' | 'askOwner' | 'watch' | 'onLimit' | 'resolvedModel'>;
