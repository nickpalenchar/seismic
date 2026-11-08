/** Server implementations of the extensions enabled in the registry. */
import type { ZodType } from 'zod';
import type { Language } from '../core/locale';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionRequest } from '../server/runtime';
import { enabled } from './index';
import { alwaysAllow } from './always-allow/server';

export type Settings = Record<string, unknown>;

/** Where a tool call the owner is asked to permit comes from. */
export interface PermissionContext {
  /** The asking agent's harness. */
  harness: 'claude' | 'codex';
  /** The card's workstation, where the agent works. */
  cwd: string;
  /** Whether the card's work goes onto the main branch by itself (a folder without git counts so), not through pull requests. */
  landsOnMain: boolean;
  /** The language of the card's conversation. */
  language: Language;
  settings: Settings;
}

/** An option of a permission question besides "Allow" and "Deny"; picked, the call runs. */
export interface PermissionOption {
  /** Its words in every language: the owner's answer is matched against all of them. */
  label: Record<Language, string>;
  /** A paragraph the question adds about it, in every language. */
  note?: Record<Language, string>;
  /** Kept with the question (as JSON) and handed back when the owner picks the option. */
  data?: unknown;
}

export interface PermissionPicked extends PermissionContext {
  /** A line from Seismic in the card's conversation. */
  log: (text: string) => void;
  /**
   * Changes the card's repository as its owner: `change` writes onto its main branch (or, in a
   * folder without git, its files), and the agents' configuration trusted before stays trusted with
   * what it wrote.
   */
  asOwner: <T>(change: (repo: { path: string; folder: boolean }) => Promise<T>) => Promise<T>;
}
export interface ServerExtension {
  /** Routes use the core's access checks; lookup returns the active repository's extension settings. */
  routes?: Record<string, Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', (request: Request, context: { settings: (canvas: string, repo: string) => Settings | undefined }) => Response | Promise<Response>>>>;
  event?: (event: { type: 'landed' | 'workerStarted'; canvas: string; card: string; settings: Settings }) => void | Promise<void>;
  settings?: Record<string, ZodType>;
  permission?: {
    options: (request: PermissionRequest, context: PermissionContext) => PermissionOption[];
    /** The owner picked one of `options`' (its `data`); what it returns goes to the asking Claude Code session with the allowed call. */
    picked: (data: unknown, context: PermissionPicked) => { permissions?: PermissionUpdate[] } | void;
  };
}

// Add an enabled extension's server implementation here, without importing its browser module.
const implementations: Record<string, ServerExtension> = { 'always-allow': alwaysAllow };
export const serverExtensions: readonly ServerExtension[] = enabled.flatMap((name) => implementations[name] ? [implementations[name]!] : []);

/** Only registered extension fields, never the repository's core configuration. */
export function extensionSettings(settings: object): Settings {
  return Object.fromEntries(serverExtensions.flatMap((e) => Object.keys(e.settings ?? {})).map((key) => [key, (settings as Settings)[key]]).filter(([, value]) => value !== undefined));
}
