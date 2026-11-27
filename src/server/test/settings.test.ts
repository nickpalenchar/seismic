import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { languageOf } from '../../core/locale';
import { AGENT_DEFAULTS, type AgentSetting } from '../../core/types';
import { withAgentSetting } from '../runtime';
import { OWNER_SETTINGS_FILE as SETTINGS_FILE, systemLanguage } from '../../../plugin/skills/demo/lib/language.ts';
import { agentSetting, agentsView, appliedProjectSettings, conversationLanguage, languageView, ownerLanguage, saveAgents, saveCodexAutoReview, saveLanguage, saveTheme, saveMotion, motionView, saveUsageMeter, themeView, usageMeterView, moveFeedbackPrompt, projectDefaults, saveProjectDefaults, notificationsView, saveNotifications, startAgentSetting } from '../settings';
import { FakeRuntime } from './helpers/testing';

const homes: string[] = [];
const scratchHome = () => homes[homes.push(mkdtempSync(join(tmpdir(), 'seismic-settings-'))) - 1]!;
afterEach(() => homes.splice(0).forEach((h) => rmSync(h, { recursive: true, force: true })));

test('a locale names a language Seismic speaks, or none', () => {
  expect(languageOf('en-GB')).toBe('en');
  expect(languageOf('EN')).toBe('en');
  expect(languageOf('de_DE.UTF-8')).toBeUndefined();
  expect(languageOf('fr_FR')).toBeUndefined();
  expect(languageOf('')).toBeUndefined();
});

test('the system language: English, whatever the Mac interface or the locale variables say', () => {
  const none = () => undefined;
  expect(systemLanguage({ LANG: 'en_US.UTF-8' }, 'linux', none)).toBe('en');
  expect(systemLanguage({ LC_ALL: 'C', LANG: 'en_GB' }, 'linux', none)).toBe('en');
  expect(systemLanguage({ LANG: 'fr_FR.UTF-8' }, 'linux', none)).toBe('en');
  expect(systemLanguage({ LANG: 'de_DE.UTF-8' }, 'darwin', none)).toBe('en');
  expect(systemLanguage({ LANG: 'en_US.UTF-8' }, 'darwin', () => 'de-DE')).toBe('en');
});

test('the languages default to English until chosen, each saved on its own beside the other settings', () => {
  const home = scratchHome();
  expect(languageView(home, 'en')).toMatchObject({ chosen: null, language: 'en', conversationChosen: null, conversation: 'en' });
  saveLanguage(home, { language: 'en' });
  expect(languageView(home, 'en')).toMatchObject({ chosen: 'en', language: 'en', conversationChosen: null, conversation: 'en' });
  expect(conversationLanguage(home)).toBe('en');
  saveLanguage(home, { conversation: 'en' });
  expect(languageView(home, 'en')).toMatchObject({ chosen: 'en', language: 'en', conversationChosen: 'en', conversation: 'en' });
  expect([ownerLanguage(home), conversationLanguage(home)]).toEqual(['en', 'en']);
  expect(JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'))).toEqual({ language: 'en', conversationLanguage: 'en' });
  saveLanguage(home, { conversation: null });
  expect(conversationLanguage(home)).toBe('en');
  expect(JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'))).toEqual({ language: 'en' });
  for (const bad of [{}, { conversation: 'fr' }, { language: 'de' }, { language: 'en', conversation: 'de' }, null]) expect(() => saveLanguage(home, bad)).toThrow();
});

test("the model and effort per group of agents: preset, chosen one group at a time beside the language, the file keeping only what differs", () => {
  const home = scratchHome();
  expect(agentsView(home).agents).toEqual({
    koordinator: { model: 'opus', effort: 'medium' },
    worker: { model: 'opus', effort: 'high' },
    explorer: { model: 'opus', effort: 'high' },
    chores: { model: 'opus', effort: 'medium' },
    review: { model: 'opus', effort: 'high' },
  });
  saveLanguage(home, { language: 'en' });
  saveAgents(home, { worker: { model: 'fable', effort: 'xhigh' }, chores: { model: 'sonnet' } });
  saveAgents(home, { koordinator: { model: 'haiku' }, chores: { model: 'default' } });
  expect(agentSetting(home, 'worker')).toEqual({ model: 'fable', effort: 'xhigh' });
  expect(agentSetting(home, 'koordinator')).toEqual({ model: 'haiku', effort: 'medium' });
  expect(agentSetting(home, 'chores')).toEqual({ model: 'opus', effort: 'medium' });
  saveAgents(home, { worker: { model: 'opus' } });
  expect(JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'))).toEqual({ language: 'en', agents: { koordinator: { model: 'haiku' }, worker: { effort: 'xhigh' } } });
  
  saveAgents(home, { koordinator: { model: 'opus' }, worker: { effort: 'high' }, chores: { model: 'opus' } });
  expect(JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'))).toEqual({ language: 'en' });
  for (const bad of [{ boss: {} }, { worker: { model: 'gpt' } }, { worker: { effort: null } }, { worker: { effort: 'huge' } }, { worker: { model: 'opus', fast: true } }]) expect(() => saveAgents(home, bad)).toThrow();
  
  writeFileSync(join(home, SETTINGS_FILE), JSON.stringify({ agents: { worker: { model: 'gpt', effort: 'low' }, boss: { model: 'opus' } } }));
  expect(agentSetting(home, 'worker')).toEqual({ model: 'opus', effort: 'low' });
});

test("an agent of a group starts with the group's model and effort, asked at every start; Claude Code's default model is none given", () => {
  const fake = new FakeRuntime();
  let worker: AgentSetting = { model: 'opus', effort: 'high' };
  const runtime = withAgentSetting(fake, (role) => (role === 'worker' ? worker : AGENT_DEFAULTS[role]));
  const spec = { cwd: '/r', system: '', tools: [], onEvent: () => {} };
  runtime.start({ ...spec, role: 'worker' });
  expect(fake.last.spec).toMatchObject({ model: 'opus', effort: 'high' });
  worker = { model: 'default', effort: 'max' };
  runtime.start({ ...spec, role: 'worker', model: 'sonnet', effort: 'low' });
  expect(fake.last.spec.effort).toBe('max');
  expect('model' in fake.last.spec).toBe(false);
  runtime.start({ ...spec, role: 'chores' });
  expect(fake.last.spec).toMatchObject({ model: 'opus', effort: 'medium' });
  
  runtime.start({ ...spec, effort: 'low' });
  expect(fake.last.spec.effort).toBe('low');
  expect(fake.last.spec.model).toBeUndefined();
});

test("a setting a start carries wins over its group's, and its model and effort reach the runtime", () => {
  const fake = new FakeRuntime();
  const runtime = withAgentSetting(fake, () => ({ model: 'opus', effort: 'high' }));
  const spec = { cwd: '/r', system: '', tools: [], onEvent: () => {}, role: 'worker' as const };
  runtime.start({ ...spec, setting: { model: 'haiku', effort: 'low' } });
  expect(fake.last.spec).toMatchObject({ model: 'haiku', effort: 'low', setting: { model: 'haiku', effort: 'low' } });
  const codex = { model: 'opus' as const, effort: 'high' as const, harness: 'codex' as const, codex: { model: 'gpt-test', effort: 'medium' as const } };
  runtime.start({ ...spec, setting: codex });
  expect(fake.last.spec).toMatchObject({ model: 'gpt-test', effort: 'medium', setting: codex });
});

test('harness choices retain separate Claude and Codex options and reject invalid choices', () => {
  const home = scratchHome();
  const codex = { model: 'codex-test', effort: 'low' as const };
  saveAgents(home, { worker: { harness: 'codex', codex } });
  expect(agentSetting(home, 'worker')).toEqual({ model: 'opus', effort: 'high', harness: 'codex', codex });
  saveAgents(home, { worker: { harness: 'claude', model: 'sonnet' } });
  expect(agentSetting(home, 'worker')).toEqual({ model: 'sonnet', effort: 'high', codex });
  saveAgents(home, { worker: { harness: 'codex' } });
  const fake = new FakeRuntime();
  const runtime = withAgentSetting(fake, (r) => agentSetting(home, r));
  const spec = { cwd: '/r', system: '', tools: [], onEvent() {}, role: 'worker' as const };
  runtime.start(spec);
  expect(fake.last.spec).toMatchObject({ model: 'codex-test', effort: 'low' });
  runtime.start({ ...spec, setting: AGENT_DEFAULTS.worker });
  expect(fake.last.spec).toMatchObject({ model: 'opus', effort: 'high' });
  saveAgents(home, { koordinator: { harness: 'codex', codex }, explorer: { codex } });
  expect(agentSetting(home, 'koordinator')).toMatchObject({ harness: 'codex', codex });
  expect(agentSetting(home, 'explorer')).toMatchObject({ codex });
  for (const bad of [{ worker: { harness: 'pi' } }, { worker: { codex: { ...codex, effort: 'ultra' } } }, { worker: { codex: { ...codex, model: '' } } }]) expect(() => saveAgents(home, bad)).toThrow();
});

test('Antigravity settings preserve original IDs until a catalog can identify legacy variants', () => {
  const home = scratchHome();
  const legacy = { model: 'gemini-4-argon-medium', effort: 'high' } as const;
  const whole = { model: 'gemini-ultra-high', effort: 'high' } as const;
  writeFileSync(join(home, SETTINGS_FILE), JSON.stringify({ agents: { worker: { harness: 'agy', agy: legacy } } }));
  expect(agentSetting(home, 'worker').agy).toEqual(legacy);
  expect(saveAgents(home, { worker: { agy: whole } }).agents.worker.agy).toEqual(whole);
  expect(appliedProjectSettings({ agents: { worker: { agy: legacy }, review: { agy: whole } } }).agents).toEqual({ worker: { agy: legacy }, review: { agy: whole } });
  expect(startAgentSetting({ model: 'opus', effort: 'high', harness: 'agy', agy: whole }).agy).toEqual(whole);
  const accountDefault = startAgentSetting({ model: 'opus', effort: 'high', harness: 'agy', agy: { model: 'default' } });
  expect(accountDefault.agy).toEqual({ model: 'default' });
  const fake = new FakeRuntime();
  withAgentSetting(fake, () => accountDefault).start({ cwd: '/r', system: '', tools: [], onEvent() {}, role: 'worker' });
  expect(fake.last.spec.model).toBeUndefined();
  expect(fake.last.spec.effort).toBeUndefined();
});

test('agy is a third harness with its own model and effort, kept apart from the others', () => {
  const home = scratchHome();
  const agy = { model: 'agy-test', effort: 'medium' as const };
  saveAgents(home, { review: { harness: 'agy', agy } });
  expect(agentSetting(home, 'review')).toEqual({ model: 'opus', effort: 'high', harness: 'agy', agy });
  saveAgents(home, { review: { harness: 'codex', codex: { model: 'c', effort: 'low' } } });
  expect(agentSetting(home, 'review')).toMatchObject({ harness: 'codex', agy, codex: { model: 'c' } });
  expect(startAgentSetting({ model: 'opus', effort: 'high', harness: 'agy', agy })).toEqual({ model: 'opus', effort: 'high', harness: 'agy', agy });
  expect(() => startAgentSetting({ model: 'opus', effort: 'high', harness: 'agy' })).toThrow();
  saveAgents(home, { chores: { harness: 'agy', agy }, explorer: { agy } });
  expect(agentSetting(home, 'chores')).toMatchObject({ harness: 'agy', agy });
  expect(agentSetting(home, 'explorer')).toMatchObject({ agy });
  expect(() => saveAgents(home, { chores: { agy: { ...agy, effort: 'ultra' } } })).toThrow();
});

test('light or dark: as the system until chosen, beside the other settings, and back to the system with null', () => {
  const home = scratchHome();
  expect(themeView(home).chosen).toBeNull();
  saveLanguage(home, { language: 'en' });
  expect(saveTheme(home, { theme: 'dark' }).chosen).toBe('dark');
  expect(JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'))).toEqual({ language: 'en', theme: 'dark' });
  expect(themeView(home).chosen).toBe('dark');
  expect(saveTheme(home, { theme: null }).chosen).toBeNull();
  expect(JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'))).toEqual({ language: 'en' });
  for (const bad of [{ theme: 'sepia' }, {}, null]) expect(() => saveTheme(home, bad)).toThrow();
  
  writeFileSync(join(home, SETTINGS_FILE), JSON.stringify({ theme: 'sepia' }));
  expect(themeView(home).chosen).toBeNull();
});

test('motion: as the system until chosen, reduced beside the look, and back to the system with null', () => {
  const home = scratchHome();
  expect(motionView(home).chosen).toBeNull();
  saveTheme(home, { theme: 'dark' });
  expect(saveMotion(home, { motion: 'reduced' }).chosen).toBe('reduced');
  expect(JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'))).toEqual({ theme: 'dark', motion: 'reduced' });
  expect(saveMotion(home, { motion: 'full' }).chosen).toBe('full');
  expect(saveMotion(home, { motion: null }).chosen).toBeNull();
  expect(JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'))).toEqual({ theme: 'dark' });
  for (const bad of [{ motion: 'none' }, {}, null]) expect(() => saveMotion(home, bad)).toThrow();
  writeFileSync(join(home, SETTINGS_FILE), JSON.stringify({ motion: 'slow' }));
  expect(motionView(home).chosen).toBeNull();
});

test('the usage limits in the bar: shown until turned off, which alone stands in the file', () => {
  const home = scratchHome();
  expect(usageMeterView(home).on).toBe(true);
  saveLanguage(home, { language: 'en' });
  expect(saveUsageMeter(home, { on: false }).on).toBe(false);
  expect(JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'))).toEqual({ language: 'en', usageMeter: false });
  expect(saveUsageMeter(home, { on: true }).on).toBe(true);
  expect(JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'))).toEqual({ language: 'en' });
  for (const bad of [{ on: 'no' }, {}, null]) expect(() => saveUsageMeter(home, bad)).toThrow();
  
  writeFileSync(join(home, SETTINGS_FILE), JSON.stringify({ usageMeter: 'off' }));
  expect(usageMeterView(home).on).toBe(true);
});

test('model feedback: off for a project that says nothing of it, on where it says so', () => {
  expect(appliedProjectSettings({}).modelFeedback).toBe(false);
  expect(appliedProjectSettings({ modelFeedback: true }).modelFeedback).toBe(true);
  const home = scratchHome();
  expect(projectDefaults(home).modelFeedback).toBe(false);
  expect(saveProjectDefaults(home, { modelFeedback: true }).defaults.modelFeedback).toBe(true);
  expect(() => saveProjectDefaults(home, { modelFeedback: 'yes' })).toThrow();
});

test('the old Seismic-wide feedback setting, once on, moves into every project that says nothing of it and into Project defaults', () => {
  const home = scratchHome();
  const projects = join(home, 'projects.json');
  writeFileSync(join(home, SETTINGS_FILE), JSON.stringify({ usageMeter: false, feedbackPrompt: true }));
  writeFileSync(projects, JSON.stringify([{ repos: [{ path: '/a' }] }, { modelFeedback: false, repos: [{ path: '/b' }] }]));
  moveFeedbackPrompt(home, projects);
  expect(JSON.parse(readFileSync(projects, 'utf8'))).toEqual([{ repos: [{ path: '/a' }], modelFeedback: true }, { modelFeedback: false, repos: [{ path: '/b' }] }]);
  expect(JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'))).toEqual({ usageMeter: false, projectDefaults: { modelFeedback: true } });
  
  writeFileSync(projects, '[]');
  moveFeedbackPrompt(home, projects);
  expect(readFileSync(projects, 'utf8')).toBe('[]');
});

test('the old feedback setting, never turned on, goes without touching the projects; a file without projects is fine', () => {
  const home = scratchHome();
  writeFileSync(join(home, SETTINGS_FILE), JSON.stringify({ feedbackPrompt: false, theme: 'dark' }));
  moveFeedbackPrompt(home, join(home, 'projects.json'));
  expect(JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'))).toEqual({ theme: 'dark' });
  writeFileSync(join(home, SETTINGS_FILE), JSON.stringify({ feedbackPrompt: true }));
  moveFeedbackPrompt(home, join(home, 'projects.json'));
  expect(projectDefaults(home).modelFeedback).toBe(true);
});

test('desktop notifications: not decided until the owner chose, then on or off as saved', () => {
  const home = scratchHome();
  expect(notificationsView(home).on).toBeNull();
  expect(saveNotifications(home, { on: false }).on).toBe(false);
  expect(notificationsView(home).on).toBe(false);
  expect(saveNotifications(home, { on: true }).on).toBe(true);
  for (const bad of [{ on: 'yes' }, {}, null]) expect(() => saveNotifications(home, bad)).toThrow();
  writeFileSync(join(home, SETTINGS_FILE), JSON.stringify({ notifications: 'yes' }));
  expect(notificationsView(home).on).toBeNull();
});

test("Codex's automatic review decides for Codex workers until the owner turns it off, which the file keeps", () => {
  const home = scratchHome();
  expect(agentsView(home).codexAutoReview).toBe(true);
  expect(saveCodexAutoReview(home, { on: false }).codexAutoReview).toBe(false);
  expect(JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'))).toEqual({ codexAutoReview: false });
  expect(saveCodexAutoReview(home, { on: true }).codexAutoReview).toBe(true);
  expect(JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'))).toEqual({});
  for (const bad of [{}, { on: 'yes' }, null]) expect(() => saveCodexAutoReview(home, bad)).toThrow();
});

test('the defaults saved while projects were canvases (`canvasDefaults`) still apply and move to `projectDefaults` once saved', () => {
  const home = mkdtempSync(join(tmpdir(), 'seismic-settings-'));
  try {
    writeFileSync(join(home, SETTINGS_FILE), JSON.stringify({ theme: 'dark', canvasDefaults: { archive: 'manual' } }));
    expect(projectDefaults(home).archive).toBe('manual');
    saveProjectDefaults(home, { archive: 'landed' });
    const file = JSON.parse(readFileSync(join(home, SETTINGS_FILE), 'utf8'));
    expect(file).toMatchObject({ theme: 'dark', projectDefaults: { archive: 'landed' } });
    expect(file).not.toHaveProperty('canvasDefaults');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
