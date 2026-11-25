
import type { ZodType } from 'zod';
import type { Language } from '../core/locale';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionRequest } from '../server/runtime';
import { enabled } from './index';
import { alwaysAllow } from './always-allow/server';

export type Settings = Record<string, unknown>;


export interface PermissionContext {
  
  harness: 'claude' | 'codex';
  
  cwd: string;
  
  landsOnMain: boolean;
  
  language: Language;
  settings: Settings;
}


export interface PermissionOption {
  
  label: Record<Language, string>;
  
  note?: Record<Language, string>;
  
  data?: unknown;
}

export interface PermissionPicked extends PermissionContext {
  
  log: (text: string) => void;
  




  asOwner: <T>(change: (repo: { path: string; folder: boolean }) => Promise<T>) => Promise<T>;
}
export interface ServerExtension {
  
  routes?: Record<string, Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', (request: Request, context: { settings: (project: string, repo: string) => Settings | undefined }) => Response | Promise<Response>>>>;
  event?: (event: { type: 'landed' | 'workerStarted'; project: string; card: string; settings: Settings }) => void | Promise<void>;
  settings?: Record<string, ZodType>;
  permission?: {
    options: (request: PermissionRequest, context: PermissionContext) => PermissionOption[];
    
    picked: (data: unknown, context: PermissionPicked) => { permissions?: PermissionUpdate[] } | void;
  };
}


const implementations: Record<string, ServerExtension> = { 'always-allow': alwaysAllow };
export const serverExtensions: readonly ServerExtension[] = enabled.flatMap((name) => implementations[name] ? [implementations[name]!] : []);

/** Only registered extension fields, never the repository's core configuration. */
export function extensionSettings(settings: object): Settings {
  return Object.fromEntries(serverExtensions.flatMap((e) => Object.keys(e.settings ?? {})).map((key) => [key, (settings as Settings)[key]]).filter(([, value]) => value !== undefined));
}
