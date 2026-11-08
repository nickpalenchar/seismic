// Seismic's own settings, in `settings.json` under its home beside `projects.json` and `demo.json`:
// the language of Seismic's interface and the one its agents talk to the owner in, light or dark, the model and effort of each group of
// agents, how other devices reach Seismic (remote.ts), whether the bar shows the plan's usage limits (usage.ts), whether approving work asks for feedback on it, and the Project defaults a new project takes its own settings from. The owner chooses them in the settings sheet;
// until then the system's language and look apply, the agents run as `AGENT_DEFAULTS` says, and
// no other device reaches Seismic. Saving restarts nothing: the page loads again in the new
// language, takes the new look at once, and the server reads the file whenever it needs the
// language or starts an agent.

import { z } from 'zod';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chosenConversationLanguage, chosenLanguage, conversationLanguageIn, OWNER_SETTINGS_FILE as SETTINGS_FILE, ownerLanguageIn, ownerSettingsWritten, systemLanguage } from '../../plugin/skills/demo/lib/language.ts';
import { suggestToggles } from '../core/labels';
import { type Language, LANGUAGES } from '../core/locale';
import { AGENT_DEFAULTS, AGENT_EFFORTS, AGENT_MODELS, AGENT_ROLES, type AgentRole, type AgentSetting, type AgentsView, type LanguageView, type RemoteSetting, type Theme, THEMES, type ThemeView, type Motion, MOTIONS, type MotionView, type UsageMeterView, type FeedbackPromptView, type NotificationsView, type ProjectAgents, type ProjectDefaults, type ProjectDefaultsView, type ProjectSettings, type ProjectDemoSite, choosesHarness, HARNESSES, CODE_REVIEW_MODES, CARD_ARCHIVING, type CodeReviewSetting } from '../core/types';
import { BadRequest } from './board';

interface Settings {
  /** The interface's: Seismic's own words. */
  language?: Language;
  /** The agents' to the owner; absent, English. */
  conversationLanguage?: Language;
  /** Light or dark; absent follows the system. */
  theme?: Theme;
  /** Full or reduced motion; absent follows the system. */
  motion?: Motion;
  /** Only what differs from `AGENT_DEFAULTS`, so a changed default reaches what the owner left. */
  agents?: Partial<Record<AgentRole, Partial<AgentSetting>>>;
  /** `false`: Codex workers ask the owner what leaves their sandbox; absent, Codex's own automatic review decides. */
  codexAutoReview?: false;
  /** How other devices reach Seismic; absent, they do not. */
  remote?: RemoteSetting;
  /** `false`: the bar does not show the plan's usage limits; absent, it does. */
  usageMeter?: false;
  /** `false`: approving a card's work asks for no feedback on it; absent, it does. */
  feedbackPrompt?: false;
  /** Whether a page notifies the owner on the desktop when a card needs them; absent until the owner has been asked. */
  notifications?: boolean;
  /** Project defaults: what a new project's own settings start as; a setting left out has its built-in value. */
  projectDefaults?: ProjectSettings;
}

function read(home: string): Settings {
  try {
    const o = JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8')) as Record<string, unknown>;
    const language = LANGUAGES.find((l) => l === o.language);
    const conversationLanguage = LANGUAGES.find((l) => l === o.conversationLanguage);
    const theme = THEMES.find((x) => x === o.theme);
    const motion = MOTIONS.find((x) => x === o.motion);
    return { ...o, language, conversationLanguage, theme, motion, agents: agentsOf(o.agents), remote: remoteOf(o.remote) ?? undefined, usageMeter: o.usageMeter === false ? false : undefined, codexAutoReview: o.codexAutoReview === false ? false : undefined, feedbackPrompt: o.feedbackPrompt === false ? false : undefined, notifications: typeof o.notifications === 'boolean' ? o.notifications : undefined, projectDefaults: projectSettingsShape.safeParse(renamedBaselines(o.projectDefaults ?? o.canvasDefaults)).data };
  } catch {
    return {};
  }
}

export function languageView(home: string, system = systemLanguage()): LanguageView {
  const chosen = chosenLanguage(home) ?? null;
  const language = chosen ?? system;
  const conversationChosen = chosenConversationLanguage(home) ?? null;
  return { file: join(home, SETTINGS_FILE), chosen, system, language, conversationChosen, conversation: conversationChosen ?? 'en' };
}

/** The interface language that applies: the owner's choice, else the system's. */
export const ownerLanguage = ownerLanguageIn;

/** The conversation language that applies: the owner's choice, else English. */
export const conversationLanguage = conversationLanguageIn;

/**
 * Saves the owner's choice of the interface language (`language`) or the conversation language
 * (`conversation`), whichever the input names; `null` follows the system, or English, again.
 * Other settings in the file stay.
 */
export function saveLanguage(home: string, input: unknown): LanguageView {
  const given = (input && typeof input === 'object' ? input : {}) as { language?: unknown; conversation?: unknown };
  const valid = (v: unknown) => v === null || LANGUAGES.some((l) => l === v);
  if (!('language' in given) && !('conversation' in given)) throw new BadRequest('invalid', 'name language or conversation');
  for (const key of ['language', 'conversation'] as const)
    if (key in given && !valid(given[key])) throw new BadRequest('invalid', `${key} must be one of ${LANGUAGES.join(', ')} or null`);
  if ('language' in given) save(home, 'language', given.language as Language | null, `language ${given.language ?? 'of the system'}`);
  if ('conversation' in given) save(home, 'conversationLanguage', given.conversation as Language | null, `conversation language ${given.conversation ?? 'English'}`);
  return languageView(home);
}

export const themeView = (home: string): ThemeView => ({ file: join(home, SETTINGS_FILE), chosen: read(home).theme ?? null });

/** Saves light or dark; `null` follows the system again. Other settings in the file stay. */
export function saveTheme(home: string, input: unknown): ThemeView {
  const theme = (input as { theme?: unknown } | null)?.theme;
  if (theme !== null && !THEMES.some((x) => x === theme)) throw new BadRequest('invalid', `theme must be one of ${THEMES.join(', ')} or null`);
  save(home, 'theme', theme as Theme | null, `${theme ?? "the system's"} look`);
  return themeView(home);
}

export const motionView = (home: string): MotionView => ({ file: join(home, SETTINGS_FILE), chosen: read(home).motion ?? null });

/** Saves full or reduced motion; `null` follows the system again. */
export function saveMotion(home: string, input: unknown): MotionView {
  const motion = (input as { motion?: unknown } | null)?.motion;
  if (motion !== null && !MOTIONS.some((x) => x === motion)) throw new BadRequest('invalid', `motion must be one of ${MOTIONS.join(', ')} or null`);
  save(home, 'motion', motion as Motion | null, `${motion ?? "the system's"} motion`);
  return motionView(home);
}

export const usageMeterView = (home: string): UsageMeterView => ({ file: join(home, SETTINGS_FILE), on: read(home).usageMeter !== false });

/** Saves whether the bar shows the plan's usage limits (`{ on }`). Other settings in the file stay. */
export function saveUsageMeter(home: string, input: unknown): UsageMeterView {
  const on = (input as { on?: unknown } | null)?.on;
  if (typeof on !== 'boolean') throw new BadRequest('invalid', 'on must be true or false');
  save(home, 'usageMeter', on ? null : false, `usage limits ${on ? 'shown' : 'not shown'} in the bar,`);
  return usageMeterView(home);
}

export const feedbackPromptView = (home: string): FeedbackPromptView => ({ file: join(home, SETTINGS_FILE), on: read(home).feedbackPrompt !== false });

/** Saves whether approving work asks for feedback on it (`{ on }`); the responses given stay either way. Other settings in the file stay. */
export function saveFeedbackPrompt(home: string, input: unknown): FeedbackPromptView {
  const on = (input as { on?: unknown } | null)?.on;
  if (typeof on !== 'boolean') throw new BadRequest('invalid', 'on must be true or false');
  save(home, 'feedbackPrompt', on ? null : false, `feedback ${on ? 'asked for' : 'not asked for'} after approvals,`);
  return feedbackPromptView(home);
}

export const notificationsView = (home: string): NotificationsView => ({ file: join(home, SETTINGS_FILE), on: read(home).notifications ?? null });

/** Saves whether the desktop notifies the owner when a card needs them (`{ on }`). Other settings in the file stay. */
export function saveNotifications(home: string, input: unknown): NotificationsView {
  const on = (input as { on?: unknown } | null)?.on;
  if (typeof on !== 'boolean') throw new BadRequest('invalid', 'on must be true or false');
  save(home, 'notifications', on, `desktop notifications ${on ? 'on' : 'off'},`);
  return notificationsView(home);
}

const ownAgent = z.object({ model: z.enum(AGENT_MODELS).optional(), effort: z.enum(AGENT_EFFORTS).optional(), harness: z.enum(HARNESSES).optional(), codex: z.object({ model: z.string(), effort: z.enum(AGENT_EFFORTS) }).strict().optional(), agy: z.object({ model: z.string(), effort: z.enum(AGENT_EFFORTS) }).strict().optional() }).strict().optional();

/** A project's settings as saved before `projectBaselines` became `planBaselines`: the old key is still read. */
export function renamedBaselines(saved: unknown): unknown {
  if (!saved || typeof saved !== 'object' || !('projectBaselines' in saved)) return saved;
  const { projectBaselines, ...rest } = saved as Record<string, unknown>;
  return 'planBaselines' in rest ? rest : { ...rest, planBaselines: projectBaselines };
}

/** A project's own settings, as the configuration and Project defaults hold them. */
export const projectSettingsShape = z.object({
  planBaselines: z.boolean().optional(),
  archive: z.enum(CARD_ARCHIVING).optional(),
  suggest: z.object({ category: z.boolean().optional(), complexity: z.boolean().optional(), priority: z.boolean().optional() }).strict().optional(),
  agents: z.object({ koordinator: ownAgent, worker: ownAgent, explorer: ownAgent, chores: ownAgent, review: ownAgent }).strict().optional(),
  codeReviews: z.object({ on: z.boolean().optional(), mode: z.enum(CODE_REVIEW_MODES).optional() }).strict().optional(),
  demoSite: z
    .object({
      url: z.string().trim().regex(/^https?:\/\/\S+$/),
      // up to three lower-case parts with hyphens, `/` between them; the root where empty
      path: z
        .string()
        .transform((p) => p.trim().replace(/^\/+|\/+$/g, ''))
        .refine((p) => p === '' || /^[a-z0-9][a-z0-9-]{0,40}(\/[a-z0-9][a-z0-9-]{0,40}){0,2}$/.test(p), 'lower-case letters, digits and hyphens, with / between up to three parts')
        .optional(),
      publish: z.enum(['approved']).optional(),
      tags: z.record(z.string().trim().min(1), z.array(z.string().trim().min(1))).optional(),
    })
    .strict()
    .nullable()
    .optional(),
});

/** A project's demo site as it is saved: its address without a trailing slash, its path and tags without what is empty; none without an address. */
function demoSite(saved: ProjectDemoSite | null | undefined): ProjectDemoSite | null {
  const url = saved?.url?.trim().replace(/\/+$/, '');
  if (!saved || !url) return null;
  const path = saved.path?.trim().replace(/^\/+|\/+$/g, '');
  const tags = Object.entries(saved.tags ?? {}).filter(([d, v]) => d.trim() && v.length);
  return { url, ...(path ? { path } : {}), ...(saved.publish ? { publish: saved.publish } : {}), ...(tags.length ? { tags: Object.fromEntries(tags) } : {}) };
}

/** Whether and when a project reviews work that lands on main: off, and with the demo once turned on, where left out (reviews cost tokens). */
const codeReviews = (saved: Partial<CodeReviewSetting> | undefined): CodeReviewSetting => ({ on: saved?.on === true, mode: saved?.mode === 'manual' ? 'manual' : 'auto' });

/** The groups a project sets a model or effort of its own for, without those it leaves to Configuration. */
function projectAgents(saved: ProjectAgents | undefined): ProjectAgents {
  const out: ProjectAgents = {};
  for (const role of AGENT_ROLES) {
    const { harness, model, effort, codex, agy } = saved?.[role] ?? {};
    if (harness || model || effort || codex || agy) out[role] = { ...(harness ? { harness } : {}), ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(codex ? { codex } : {}), ...(agy ? { agy } : {}) };
  }
  return out;
}

/**
 * Each project setting as it applies, from its value as saved (none: its built-in default). A setting
 * added to `ProjectSettings` needs its entry here, and with it a value in Project defaults.
 */
export const PROJECT_SETTINGS: { [K in keyof ProjectSettings]-?: (saved: ProjectSettings[K]) => ProjectDefaults[K] } = {
  suggest: suggestToggles,
  planBaselines: (saved) => saved !== false,
  // the owner archives by hand where left out
  archive: (saved) => (saved === 'landed' ? 'landed' : 'manual'),
  // the default of every project's models is Configuration's "Agents and models": none of its own
  agents: projectAgents,
  codeReviews,
  // chosen per project, from this machine's sites: a new project has none until it chooses one
  demoSite,
};

/** A value that says nothing: an empty group of a project's own models is not saved. */
const empty = (v: unknown) => v === null || (!!v && typeof v === 'object' && !Object.keys(v).length);

const projectSetting = <K extends keyof ProjectSettings>(key: K, saved: ProjectSettings[K]): ProjectDefaults[K] => (PROJECT_SETTINGS[key] as (value: ProjectSettings[K]) => ProjectDefaults[K])(saved);

const projectSettingKeys = Object.keys(PROJECT_SETTINGS) as (keyof ProjectSettings)[];

/** `s` with each project setting it holds as it applies; those it leaves out stay out. */
export function tidyProjectSettings(s: ProjectSettings): ProjectSettings {
  return Object.fromEntries(projectSettingKeys.filter((k) => s[k] !== undefined).map((k) => [k, projectSetting(k, s[k])]).filter(([, v]) => !empty(v)));
}

/** A project's settings as they apply: what it holds, else each setting's built-in value. */
export const appliedProjectSettings = (s: ProjectSettings): ProjectDefaults => Object.fromEntries(projectSettingKeys.map((k) => [k, projectSetting(k, s[k])])) as ProjectDefaults;

export { projectAgentSetting } from '../core/types';

/** Project defaults as they apply: the owner's, else each setting's built-in value. */
export function projectDefaults(home: string): ProjectDefaults {
  const saved = read(home).projectDefaults ?? {};
  return Object.fromEntries(projectSettingKeys.map((k) => [k, projectSetting(k, saved[k])])) as ProjectDefaults;
}

export const projectDefaultsView = (home: string): ProjectDefaultsView => ({ file: join(home, SETTINGS_FILE), defaults: projectDefaults(home) });

/**
 * Saves the Project defaults given (`{ suggest: { … } }`); the projects there are keep their own. Other settings in the file stay.
 * A project's models have Configuration's "Agents and models" as their default, and its demo site is
 * chosen on each project, so neither is among them.
 */
export function saveProjectDefaults(home: string, input: unknown): ProjectDefaultsView {
  const parsed = projectSettingsShape.omit({ agents: true, demoSite: true }).strict().safeParse(input);
  if (!parsed.success) throw new BadRequest('invalid', `project defaults: ${z.prettifyError(parsed.error)}`);
  save(home, 'projectDefaults', { ...projectDefaults(home), ...tidyProjectSettings(parsed.data) }, 'project defaults');
  return projectDefaultsView(home);
}

/**
 * The configuration with Project defaults copied into each project `isNew` takes, for every setting
 * it does not set itself; the other projects stay as they are.
 */
export function withProjectDefaults<C extends ProjectSettings>(projects: C[], defaults: ProjectDefaults, isNew: (c: C, i: number) => boolean): C[] {
  return projects.map((c, i) => (isNew(c, i) ? { ...c, ...Object.fromEntries(projectSettingKeys.filter((k) => c[k] === undefined && !empty(defaults[k])).map((k) => [k, defaults[k]])) } : c));
}

/** Saves one of the owner's choices, or with `null` takes it out; the other settings in the file stay. */
function save<K extends 'language' | 'conversationLanguage' | 'theme' | 'motion' | 'remote' | 'usageMeter' | 'codexAutoReview' | 'feedbackPrompt' | 'notifications' | 'projectDefaults'>(home: string, key: K, value: Settings[K] | null, what: string) {
  // `canvasDefaults` is what `projectDefaults` was called while projects were canvases: read, and gone once saved
  write(home, { ...read(home), canvasDefaults: undefined, [key]: value ?? undefined } as Settings);
  console.log(`Seismic: ${what} saved to ${join(home, SETTINGS_FILE)}`);
}

function write(home: string, settings: Settings) {
  const { agents, ...rest } = settings;
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, SETTINGS_FILE), `${JSON.stringify(agents && Object.keys(agents).length ? { ...rest, agents } : rest, null, 2)}\n`);
  ownerSettingsWritten(home);
}

const codexChoice = z.object({ model: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_.:/-]+$/), effort: z.enum(AGENT_EFFORTS) }).strict();

/** Validate a one-start choice from an untrusted client without changing the defaults. */
export function startAgentSetting(input: unknown): AgentSetting {
  const parsed = z.object({ model: z.enum(AGENT_MODELS), effort: z.enum(AGENT_EFFORTS), harness: z.enum(HARNESSES).optional(), codex: codexChoice.optional(), agy: codexChoice.optional() }).strict().safeParse(input);
  if (!parsed.success || (parsed.data.harness === 'codex' && !parsed.data.codex) || (parsed.data.harness === 'agy' && !parsed.data.agy)) throw new BadRequest('invalid', 'invalid worker harness, model or effort');
  return parsed.data;
}

/** The known choices in a file's `agents` that differ from the defaults; anything else in it is left out. */
function agentsOf(input: unknown): Partial<Record<AgentRole, Partial<AgentSetting>>> {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, { model?: unknown; effort?: unknown; harness?: unknown; codex?: unknown; agy?: unknown } | undefined>;
  const agents: Partial<Record<AgentRole, Partial<AgentSetting>>> = {};
  for (const role of AGENT_ROLES) {
    const model = AGENT_MODELS.find((m) => m === o[role]?.model && m !== AGENT_DEFAULTS[role].model);
    const effort = AGENT_EFFORTS.find((e) => e === o[role]?.effort && e !== AGENT_DEFAULTS[role].effort);
    const harness = choosesHarness(role) && (o[role]?.harness === 'codex' || o[role]?.harness === 'agy') ? o[role]!.harness as 'codex' | 'agy' : undefined;
    const codex = choosesHarness(role) ? codexChoice.safeParse(o[role]?.codex) : undefined;
    const agy = choosesHarness(role) ? codexChoice.safeParse(o[role]?.agy) : undefined;
    if (model || effort || harness || codex?.success || agy?.success) agents[role] = { ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(harness ? { harness } : {}), ...(codex?.success ? { codex: codex.data } : {}), ...(agy?.success ? { agy: agy.data } : {}) };
  }
  return agents;
}

/** The model and effort a group of agents runs with: the owner's choice, else the default; read whenever one starts. */
export const agentSetting = (home: string, role: AgentRole): AgentSetting => ({ ...AGENT_DEFAULTS[role], ...read(home).agents?.[role] });

export function agentsView(home: string): AgentsView {
  return { file: join(home, SETTINGS_FILE), agents: Object.fromEntries(AGENT_ROLES.map((r) => [r, agentSetting(home, r)])) as Record<AgentRole, AgentSetting>, codexAutoReview: read(home).codexAutoReview !== false };
}

/** Saves whether Codex's own automatic review decides for Codex workers (`{ on }`) or the owner is asked; read whenever one starts. Other settings in the file stay. */
export function saveCodexAutoReview(home: string, input: unknown): AgentsView {
  const on = (input as { on?: unknown } | null)?.on;
  if (typeof on !== 'boolean') throw new BadRequest('invalid', 'on must be true or false');
  save(home, 'codexAutoReview', on ? null : false, `Codex workers' approvals ${on ? "by Codex's automatic review" : 'by the owner'},`);
  return agentsView(home);
}

/** Saves the choices for the groups given (`{ worker: { model: 'opus' } }`). Other groups and settings in the file stay. */
export function saveAgents(home: string, input: unknown): AgentsView {
  const given = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const settings = read(home);
  const agents: Record<string, unknown> = { ...settings.agents };
  for (const [role, choice] of Object.entries(given)) {
    if (!AGENT_ROLES.some((r) => r === role)) throw new BadRequest('invalid', `agents are one of ${AGENT_ROLES.join(', ')}`);
    const { model, effort, harness, codex, agy, ...other } = (choice && typeof choice === 'object' ? choice : {}) as Record<string, unknown>;
    if (Object.keys(other).length) throw new BadRequest('invalid', 'unknown agent setting');
    if (harness !== undefined && (!choosesHarness(role as AgentRole) || !(HARNESSES as readonly string[]).includes(String(harness)))) throw new BadRequest('invalid', 'only workers and code reviews can select claude, codex or agy');
    if (agy !== undefined && (!choosesHarness(role as AgentRole) || !codexChoice.safeParse(agy).success)) throw new BadRequest('invalid', 'agy needs a model id and a supported effort (low, medium, high, xhigh, max)');
    if (codex !== undefined && (!choosesHarness(role as AgentRole) || !codexChoice.safeParse(codex).success)) throw new BadRequest('invalid', 'codex needs a model id and a supported effort (low, medium, high, xhigh, max)');
    if (model !== undefined && !AGENT_MODELS.some((m) => m === model)) throw new BadRequest('invalid', `model must be one of ${AGENT_MODELS.join(', ')}`);
    if (effort !== undefined && !AGENT_EFFORTS.some((e) => e === effort)) throw new BadRequest('invalid', `effort must be one of ${AGENT_EFFORTS.join(', ')}`);
    agents[role] = { ...agents[role]!, ...(model !== undefined ? { model } : {}), ...(effort !== undefined ? { effort } : {}), ...(harness !== undefined ? { harness } : {}), ...(codex !== undefined ? { codex: codexChoice.parse(codex) } : {}), ...(agy !== undefined ? { agy: codexChoice.parse(agy) } : {}) };
  }
  write(home, { ...settings, agents: agentsOf(agents) });
  console.log(`Seismic: models and effort of the agents saved to ${join(home, SETTINGS_FILE)}`);
  return agentsView(home);
}

/** A setting for other devices as the file or the page gives it; `null` for none or one Seismic cannot use. */
export function remoteOf(input: unknown): RemoteSetting | null {
  const o = (input && typeof input === 'object' ? input : {}) as { via?: unknown; address?: unknown; awake?: unknown };
  const awake = o.awake === 'always' ? { awake: 'always' as const } : {};
  if (o.via === 'tailscale') return { via: 'tailscale', ...awake };
  if (o.via === 'address' && typeof o.address === 'string' && o.address.trim()) return { via: 'address', address: o.address.trim(), ...awake };
  return null;
}

/** How other devices reach Seismic, as the owner set it; `null`: they do not. */
export const remoteSetting = (home: string): RemoteSetting | null => read(home).remote ?? null;

/** Saves how other devices reach Seismic (`{ remote }`); `null` turns it off. Other settings in the file stay. */
export function saveRemote(home: string, input: unknown): RemoteSetting | null {
  const given = (input as { remote?: unknown } | null)?.remote;
  const remote = given === null ? null : remoteOf(given);
  if (given !== null && !remote) throw new BadRequest('invalid', 'remote must be null, { via: "tailscale" } or { via: "address", address }, each with an optional awake: "always"');
  save(home, 'remote', remote, `other devices ${remote ? `reach it ${remote.via === 'tailscale' ? 'through Tailscale' : `at ${remote.address}`}` : 'do not reach it'},`);
  return remote;
}
