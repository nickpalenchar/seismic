/**
 * The page's link to the server: the live project over its WebSocket (`useProject`), and the calls
 * to the old API (`api`).
 *
 * Deprecated for new calls: `api` is the old API (and marked `@deprecated`). Add new calls to the
 * RESTful client in `src/ui/clients/seismic.ts` instead, with their route under
 * `src/server/routes/v1/`. The WebSocket, `call` and the snapshot helpers here stay.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { afterAttachments } from './attachmentSwitch';
import { prepareSessionHandOver, sessionWithDrafts } from './draftSession';
import type { CardDiff } from '../core/diff';
import { type Place, placeParam } from '../core/layout';
import type { ProjectReposView, RepoConfig, AccessView, ActivityPage, Pairing, RemoteSetting, ModelInfo, Harness, HarnessAvailability, CloudPreset, ProjectConfig, ProjectInfo, ProjectSnapshot, ChatElsewhere, ClientMessage, ConfigSaved, CardAction, ConfigChecked, DemoSettings, Group, DemoSettingsView, DemoVoiceCheck, ProjectDemoSiteState, DemoSitesView, GithubRepoList, GithubRepoView, TagProposalJob, PageTags, NarrationLanguage, FirstProject, GitSetupPreview, MachineItem, MachineSectionId, MachineView, SetupCheck, SetupFolder, SetupRepoCheck, VoiceSetupView, CardEvent, Item, NewCard, Notice, OwnerHold, PendingRestart, PlanHistory, RepoTrust, ServerMessage, SettingsShared, Skill, SourceUpdate, SpotInput, TalkRef, AppUpdate, Usage, Waiting, Feedback, FeedbackAnswer, ProjectSettings, ProjectSettingsView, DeveloperView, Canvas } from '../core/types';
import type { Wish } from '../core/wish';
import { sameJson } from './sameJson';
import { noteMessage, watchPageStalls } from './stalls';

const agentSettingsEvents = new EventTarget();

export function onAgentSettingsChange(listener: () => void) {
  agentSettingsEvents.addEventListener('change', listener);
  return () => agentSettingsEvents.removeEventListener('change', listener);
}

/** The agents' settings were saved: what shows their models reads them again. */
export function agentSettingsSaved() {
  agentSettingsEvents.dispatchEvent(new Event('change'));
}

async function saveAgentSettings<T>(path: string, body: unknown): Promise<T> {
  const saved = await call<T>('PUT', path, body);
  agentSettingsSaved();
  return saved;
}

/** A request the server refused; `code` picks the owner's text, the message is the server's detail. */
export class ApiError extends Error {
  constructor(
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

export async function call<T>(method: string, path: string, body?: unknown, keepalive?: boolean, timeoutMs?: number): Promise<T> {
  const res = await send(method, path, body, keepalive, timeoutMs);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/**
 * The request, with `body` as JSON; throws the server's refusal. With `keepalive`, it outlasts the
 * page; with `timeoutMs`, it is given up after that long.
 */
async function send(method: string, path: string, body?: unknown, keepalive?: boolean, timeoutMs?: number) {
  const res = await fetch(path, {
    method,
    keepalive,
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await refused(res);
  return res;
}

/** Throws the server's refusal as an ApiError. */
async function refused(res: Response) {
  if (res.ok) return;
  const body = await res.text();
  let code: string | undefined;
  let detail = body;
  try {
    ({ code, error: detail = body } = JSON.parse(body));
  } catch {}
  throw new ApiError(code, detail || `HTTP ${res.status}`);
}

/** Saves a file the server makes, under the name it gives. */
async function download(path: string, fallback: string) {
  const res = await fetch(path);
  await refused(res);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallback;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const query = (where: Where) =>
  !where ? '' : 'card' in where ? `?card=${encodeURIComponent(where.card)}` : `?plan=${encodeURIComponent(where.plan)}`;

/** The project this page shows; every call goes to its API. */
let projectId = '';
export function setProject(id: string) {
  projectId = id;
}
/** A path in the shown project's API. */
export const at = (path: string, project = projectId) => `/api/c/${encodeURIComponent(project)}${path}`;
/** The project shown now, for work that ends after the owner may have switched to another. */
export const shownProject = () => projectId;
/**
 * The project each card is on, where the page shows the cards of several (the phone view). A call
 * about a card goes to its project even once another is in view: the card closing puts Seismic's in
 * view before the card's last calls (its held comments released, say) go out.
 */
const projectOfCard = new Map<string, string>();
export function cardsOn(project: string, cards: string[]) {
  for (const id of cards) projectOfCard.set(id, project);
}
/** The project of the card `id`: the one it is on where the page shows several, else the shown one. */
export const projectOf = (id: string) => projectOfCard.get(id) ?? projectId;
/** A path in the API of the card's project, about the card or plan `id`. */
export const cardAt = (id: string, path = '') => `/api/c/${encodeURIComponent(projectOf(id))}/cards/${id}${path}`;
/** A path in the API of the project of what the words are about, else of the shown one. */
const whereAt = (where: Where, path: string, project?: string) => {
  const id = where && ('card' in where ? where.card : where.plan);
  return id ? `/api/c/${encodeURIComponent(projectOf(id))}${path}` : at(path, project);
};
/** Where a looked-up answer's file is served; `download` to save it. */
export const answerFile = (thread: number, name: string, download = false) =>
  at(`/threads/${thread}/files/${name.split('/').map(encodeURIComponent).join('/')}${download ? '?download' : ''}`);

/** Where a file of a card's work is served (its left column's tabs); `download` to save it. */
export const cardFile = (id: string, path: string, download = false) =>
  cardAt(id, `/files/${path.split('/').map(encodeURIComponent).join('/')}${download ? '?download' : ''}`);

/** What a command is said about: the open card, the open plan, or neither. */
export type Where = { card: string } | { plan: string } | null;
/** The field on a card words were typed into, which tells the Koordinator what they were meant as. */
export type Field = 'note' | 'answer' | 'feedback' | 'demo' | 'discuss' | 'revise';

/** What Seismic made of a command. */
export interface Heard {
  confirm: string;
  token?: string;
  /** How long the command still waits for "Undo". */
  undoMs?: number;
  /** Said to the open card's agent: the card shows it, so there is nothing to confirm. */
  quiet?: boolean;
  /** Nothing was heard: the screenshots shown with it wait for the next recording. */
  unheard?: boolean;
  /** The words heard. */
  text?: string;
  /** The owner asked to tell Seismic's makers something: the draft for them opens with it. */
  wish?: Wish;
  /** The exchange the reply stands in, which the conversation in view may show already. */
  talk?: number;
  /** The plan whose sheet shows that exchange too. */
  plan?: string;
  /** The card whose conversation shows the reply in full. */
  inCard?: string;
}
/** How long "Undo" shows: until shortly before the command stops waiting. */
export const undoShownMs = (undoMs: number) => Math.max(0, undoMs - 400);
/** How long a confirmation stays above the microphone: 7 s, unless its undo window is longer. */
export const confirmShownMs = (undoMs = 0) => Math.max(7000, undoMs + 1500);

/**
 * How a new site is set up at its host: in the Cloudflare account of a site this machine deploys to
 * (`account`, by site), with another account's API token, or (neither) with the machine's own login;
 * at GitHub in a public repository (`public`) or a private one.
 */
export interface SiteHow {
  account?: string;
  token?: string;
  accountId?: string;
  public?: true;
}

/** "Add a demo site": at a host Seismic sets it up at (unlisted on Cloudflare unless `unlisted: false`), or entered by hand. */
export type AddSiteInput =
  | ({ host: 'cloudflare' | 'github'; unlisted?: false; name?: string } & SiteHow)
  | { host: 'github'; repo: string; folder: string; via: 'pr' | 'push' }
  | { manual: { url: string; deploy: string; env?: string; maxFile?: number } };

/**
 * The calls to the old API (`/api/…`, `/api/c/:project/…`), most of which answer with nothing and
 * leave the change to the next snapshot.
 *
 * @deprecated Add new calls to the RESTful client in `src/ui/clients/seismic.ts` instead, with their
 * route under `src/server/routes/v1/` (see the Router Layer in `docs/design/code-organization.md`).
 * A call moved there is taken out of here, and its callers switch to it.
 */
export const api = {
  exportProjects: (ids: string[], as: 'csv' | 'json') => download(`/api/projects/export?as=${as}${ids.map((id) => `&project=${encodeURIComponent(id)}`).join('')}`, `seismic-projects.${as}`),
  projects: () => call<ProjectInfo[]>('GET', '/api/projects'),
  /** What waits for the owner on each project, by project id, as the project's connection sends it. */
  waiting: () => call<Record<string, Waiting>>('GET', '/api/waiting'),
  activity: (project: string, all: boolean, before?: number) => call<ActivityPage>('GET', `/api/activity?project=${encodeURIComponent(project)}${all ? '&all=1' : ''}${before ? `&before=${before}` : ''}`),
  project: (id: string) => call<ProjectSnapshot>('GET', `/api/c/${encodeURIComponent(id)}/project`),
  /** Seismic's configuration, for all projects. */
  /** What the configuration as saved amounts to, and what is wrong with it: it reads every repository, so it comes after `config`. */
  configCheck: () => call<ConfigChecked>('GET', '/api/config/check'),
  checkConfig: (projects: ProjectConfig[]) => call<ConfigChecked>('POST', '/api/config/check', projects),
  retryStart: () => call<{}>('POST', '/api/config/retry'),
  /** Saves it; Seismic then starts again with it where something restarts it. */
  /** "Take over into the repository for everyone": the repository's settings for this machine into its settings file (`.seismic/settings.json`, else `.obeya/`). */
  shareSettings: (path: string, direct = false) => call<SettingsShared>('POST', '/api/config/share-settings', { path, direct }),
  /** The owner confirms the repository's commands the dialog showed them (the groups `held` of `now`): they count from now on. */
  trustCommands: (path: string, trust: RepoTrust) => call<object>('POST', '/api/config/trust', { path, seen: trust.now, held: trust.held }),
  // other devices reaching Seismic: the section "Other devices" and "Connect a phone"
  access: () => call<AccessView | { local: false }>('GET', '/api/access'),
  saveAccess: (remote: RemoteSetting | null) => call<AccessView>('PUT', '/api/access', { remote }),
  pair: () => call<Pairing>('POST', '/api/access/pair'),
  removeDevice: (id: string) => call<{ removed: boolean }>('DELETE', `/api/access/devices/${encodeURIComponent(id)}`),
  /** Seismic's key for pushes, and whether this device gets them. */
  push: () => call<{ key: string; on: boolean }>('GET', '/api/push'),
  subscribe: (subscription: PushSubscriptionJSON) => call<void>('PUT', '/api/push', subscription),
  /** Every response the owner gave on agents' work, on every project. */
  allFeedback: () => call<Feedback[]>('GET', '/api/feedback'),
  /** A project's own settings, and Configuration's models they fall back on. */
  projectSettings: (project: string) => call<ProjectSettingsView>('GET', `/api/c/${encodeURIComponent(project)}/settings`),
  /** Saves some of a project's own settings (`{ agents }`, `{ suggest }` …) into the configuration. */
  saveProjectSettings: (project: string, s: ProjectSettings) => saveAgentSettings<ProjectSettingsView>(`/api/c/${encodeURIComponent(project)}/settings`, s),
  /** A project's repositories as configured, with their check, for its settings sheet. */
  projectRepos: (project: string) => call<ProjectReposView>('GET', `/api/c/${encodeURIComponent(project)}/repos`),
  /** "Archive project": the project leaves the configuration and stops, its cards kept. */
  archiveProject: (project: string) => call<ConfigSaved>('POST', `/api/c/${encodeURIComponent(project)}/archive-project`),
  /** Saves one repository's entry (named by its path) from the settings sheet; it applies at once. */
  saveProjectRepo: (project: string, repo: RepoConfig) => call<ProjectReposView>('PUT', `/api/c/${encodeURIComponent(project)}/repos`, repo),
  /** The settings of the shown project, with Configuration's models as the base of its own. */
  shownProjectSettings: () => call<ProjectSettingsView>('GET', at('/settings')),
  harnessAvailability: () => call<HarnessAvailability>('GET', '/api/agents/harnesses'),
  harnesses: () => call<Harness[]>('GET', '/api/harnesses'),
  setHarness: (harness: Harness, connected: boolean) => saveAgentSettings<Harness[]>('/api/harnesses', { harness, connected }),
  codexModels: () => call<ModelInfo[]>('GET', '/api/agents/codex-models'),
  agyModels: () => call<ModelInfo[]>('GET', '/api/agents/agy-models'),
  /** The setup assistant's list: what Seismic needs on this machine; `sections`: only those, all where left out. */
  setup: (sections?: readonly MachineSectionId[]) => call<MachineView>('GET', `/api/setup${sections ? `?sections=${sections.join(',')}` : ''}`),
  setupInstall: (section: MachineSectionId, id: MachineItem['id']) => call<MachineView>('POST', '/api/setup/install', { section, id }),
  /** Opens a terminal that logs in (`token`: Claude's `claude setup-token`); `opened: false` where Seismic found none. */
  setupLogin: (section: MachineSectionId, id: MachineItem['id'], token?: boolean) => call<{ opened: boolean; command: string }>('POST', '/api/setup/login', { section, id, ...(token ? { token } : {}) }),
  /** The token from `claude setup-token`, for the sessions that run on a token. */
  setupToken: (token: string) => call<{ saved: true }>('POST', '/api/setup/token', { token }),
  setupIdentity: (name: string, email: string) => call<MachineView>('POST', '/api/setup/identity', { name, email }),
  /** A folder from the system's dialog; null when cancelled. */
  setupPick: (prompt: string) => call<{ path: string | null }>('POST', '/api/setup/pick', { prompt }),
  /** The first project from a folder (saved at once) or a clone (the view follows it). */
  setupFolder: (path: string) => call<SetupFolder>('POST', '/api/setup/folder', { path }),
  /** Whether the repository named for a clone can be read from here. */
  setupRepo: (clone: string) => call<SetupRepoCheck>('POST', '/api/setup/repo', { clone }),
  setupGitPreview: (path: string) => call<GitSetupPreview>('POST', '/api/setup/git-preview', { path }),
  setupGit: (path: string) => call<{ branch: string }>('POST', '/api/setup/git', { path }),
  setupProject: (input: ({ path: string; git?: false } | { clone: string; into: string }) & { agents?: string[] }) => call<FirstProject | MachineView>('POST', '/api/setup/project', input),
  voiceSetup: () => call<VoiceSetupView>('GET', '/api/voice-setup'),
  installVoice: () => call<VoiceSetupView>('POST', '/api/voice-setup/install'),
  measureVoice: () => call<VoiceSetupView>('POST', '/api/voice-setup/measure'),
  /** Tests a cloud service with the check's sentence and hears through it from then on; a key left out keeps the saved one. */
  useCloudVoice: (service: { preset: CloudPreset; baseUrl?: string; model?: string; key?: string }) => call<VoiceSetupView>('PUT', '/api/voice-setup/cloud', service),
  useLocalVoice: () => call<VoiceSetupView>('DELETE', '/api/voice-setup/cloud'),
  /** This machine's demo sites: listed, added (once a publish there went through), connected by code, removed. */
  demoSites: () => call<DemoSitesView>('GET', '/api/demo-sites'),
  addDemoSite: (input: AddSiteInput) => call<DemoSitesView>('POST', '/api/demo-sites', input),
  demoSitesSeen: () => call<DemoSitesView>('POST', '/api/demo-sites/seen'),
  connectDemoSite: (code: string) => call<DemoSitesView>('POST', '/api/demo-sites/connect', { code }),
  demoSiteCode: (url: string) => call<{ code: string }>('GET', `/api/demo-sites/code?url=${encodeURIComponent(url)}`),
  removeDemoSite: (url: string) => call<DemoSitesView>('DELETE', `/api/demo-sites?url=${encodeURIComponent(url)}`),
  githubRepos: () => call<GithubRepoList>('GET', '/api/demo-sites/github/repos'),
  githubRepo: (repo: string, folder: string) => call<GithubRepoView>('GET', `/api/demo-sites/github/repo?repo=${encodeURIComponent(repo)}&folder=${encodeURIComponent(folder)}`),
  demoSiteMode: (url: string, mode: 'direct' | 'pr') => call<DemoSitesView>('POST', '/api/demo-sites/mode', { url, mode }),
  /** A project's demo site as it stands, and "Initialize": its path on the site, with the empty overview, deployed. */
  projectSite: (project: string) => call<ProjectDemoSiteState | null>('GET', `/api/c/${encodeURIComponent(project)}/demo-site`),
  initProjectSite: (project: string, url: string, path: string) => call<ProjectDemoSiteState | null>('POST', `/api/c/${encodeURIComponent(project)}/demo-site/init`, { url, path }),
  proposeTags: (path: string, current: PageTags | undefined, language: NarrationLanguage | null) =>
    call<{ job: TagProposalJob }>('POST', '/api/tag-proposal', { path, ...(current ? { current } : {}), ...(language ? { language } : {}) }),
  tagProposal: (path: string) => call<{ job: TagProposalJob | null; available: boolean }>('GET', `/api/tag-proposal?path=${encodeURIComponent(path)}`),
  tagProposalTaken: (path: string) => call<object>('DELETE', `/api/tag-proposal?path=${encodeURIComponent(path)}`),
  checkDemoVoice: (settings: DemoSettings) => call<DemoVoiceCheck>('POST', '/api/demo-settings/check', settings),
  demoSetup: (settings: DemoSettings) => call<SetupCheck>('POST', '/api/demo-settings/setup', settings),
  installDemoVoice: (settings: DemoSettings) => call<DemoSettingsView>('POST', '/api/demo-settings/install', settings),
  /** One sentence in the voice, as a WAV to play. */
  demoVoiceSample: async (settings: DemoSettings, sampleText?: string) => (await send('POST', '/api/demo-settings/sample', { ...settings, ...(sampleText ? { sampleText } : {}) })).blob(),
  /** What the Developer section may do in this Seismic. */
  developer: () => call<DeveloperView>('GET', '/api/developer'),
  /** Restarts Seismic, or installs its dependencies again and restarts it, once no worker is in the middle of a turn. */
  developerRestart: (what: 'restart' | 'rebuild') => call<{ requested: string }>('POST', `/api/developer/${what}`),
  /** Has a restart that waits for workers go ahead now; false when none waits. */
  restartNow: () => call<{ restarting: boolean }>('POST', '/api/restart'),
  /** Has the restart of this project's repositories' agents that waits for them go ahead at once. */
  restartReposNow: () => call<{ restarting: boolean }>('POST', at('/restart')),
  /** Pauses the agents at work on a project; cards the Koordinator lets start there wait until they resume. */
  pauseAgents: (project: string) => call<void>('POST', `/api/c/${encodeURIComponent(project)}/pause`),
  /** Resumes a project's paused agents, and the cards waiting for that start. */
  resumeAgents: (project: string) => call<void>('POST', `/api/c/${encodeURIComponent(project)}/resume`),
  /** Installs the newer version of the app once the workers paused, as a restart waits for them. */
  installUpdate: () => call<{ updating: boolean }>('POST', '/api/app-update/install'),
  /** Fast-forwards the checkout Seismic runs from to its upstream; Seismic then restarts with the new code once the workers paused. */
  pullSource: () => call<{ source: SourceUpdate | null }>('POST', '/api/source-update/pull'),
  /** Draws or removes an owner-drawn arrow, `anchor` the edges and place it was drawn at; `keepalive` for one sent as the page goes. */
  dependency: (from: string, to: string, remove = false, keepalive = false, anchor?: import('../core/types').ManualAnchor) => call<void>(remove ? 'DELETE' : 'POST', at('/dependencies'), { from, to, ...(anchor ? { anchor } : {}) }, keepalive),
  create: (c: NewCard) => call<Item>('POST', at('/cards'), c),
  // the project's canvases: a new one, a new name, icon (`null`: none) or place (from 1), deleting an empty one, cards moved onto one
  createCanvas: (name: string, icon?: string) => call<Canvas>('POST', at('/canvases'), { name, ...(icon ? { icon } : {}) }),
  updateCanvas: (id: string, p: { name?: string; icon?: string | null; position?: number }) => call<Canvas>('PATCH', at(`/canvases/${encodeURIComponent(id)}`), p),
  deleteCanvas: (id: string, expected: { parked: number; snoozed: number }, moveTo?: string) =>
    call<void>('DELETE', at(`/canvases/${encodeURIComponent(id)}`), { expected, moveTo }),
  moveToCanvas: (cards: string[], canvas: string) => call<void>('POST', at(`/canvases/${encodeURIComponent(canvas)}/cards`), { cards }),
  /** The card that writes a repository's settings for everyone, on the project it belongs to (not necessarily the shown one). */
  adapterSetup: (project: string, repo: string) => call<Item>('POST', `/api/c/${encodeURIComponent(project)}/adapter-setup`, { repo }),
  /** The note on a repository's plan directory stays where the owner put it (its top left). */
  movePlanDirNote: (repo: string, to: { x: number; y: number }) => call<void>('PATCH', at(`/plan-dirs/${encodeURIComponent(repo)}`), to),
  preparePlanDoc: (project: string, repo: string, file: string) => call<Item>('POST', `/api/c/${encodeURIComponent(project)}/prepare-plan-doc`, { repo, file }),
  /** Downloads a card's demo as a ZIP of its page with the files, or as one HTML file. */
  exportDemo: (id: string, as: 'zip' | 'html', demo?: number) => download(cardAt(id, `/export?as=${as}${demo === undefined ? '' : `&demo=${demo}`}`), `demo.${as}`),
  /** The size of a card's demo video in bytes, the latest one or earlier one `n`; null when unknown. */
  demoSize: async (id: string, n?: number) => {
    const res = await fetch(cardAt(id, n === undefined ? '/demo/demo.mp4' : `/demos/${n}/demo.mp4`), { headers: { range: 'bytes=0-0' } });
    await res.body?.cancel();
    const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1]);
    return res.ok && total > 0 ? total : null;
  },
  /** Takes a finished card off the project into the archive. */
  /** The archive, the most recently archived first. */
  archived: () => call<Item[]>('GET', at('/archive')),
  /** Archives every finished card of the owner's on the project. */
  archiveDone: () => call<{ ids: string[] }>('POST', at('/archive')),
  /** An action on the card; `keepalive` for one sent as the page goes. */
  act: async (id: string, a: CardAction, keepalive = false) => {
    await call<void>('POST', cardAt(id, '/act'), a, keepalive);
    if (a.action === 'message' || a.action === 'answer' || (a.action === 'release' && a.now)) await refreshCard(id);
  },
  /** "Make it a card": a looked-up thread moves onto a Question card, which comes back. */
  threadCard: (thread: number) => call<Item>('POST', at(`/threads/${thread}/card`)),
  /** Opens an answer's file with the system's app, or without `file` the thread's directory. */
  openAnswer: (thread: number, file?: string) => call<void>('POST', at(`/threads/${thread}/open`), file === undefined ? {} : { file }),
  openCardFile: (id: string, file: string, show = false) => call<void>('POST', cardAt(id, '/open'), { file, ...(show ? { show } : {}) }),
  /** A new group with the cards in it; a name a group has already puts them into that one. */
  createGroup: (name: string, cards: string[], hue?: number) => call<Group>('POST', at('/groups'), { name, cards, hue }),
  /** Ends the group: its cards belong to none. Returns what brings it back. */
  deleteGroup: (id: string) => call<{ group: Group; cards: string[] }>('DELETE', at(`/groups/${id}`)),
  /** Puts the cards into the group, or with `null` into none. */
  assign: (cards: string[], group: string | null) => call<void>('POST', at('/assign'), { cards, group }),
  /** Stores a screenshot for a message; the message names it by the id. */
  uploadImage: async (image: Blob, project?: string, signal?: AbortSignal) => {
    const res = await fetch(at('/images', project), { method: 'POST', headers: { 'content-type': image.type }, body: image, signal });
    await refused(res);
    return ((await res.json()) as { id: string }).id;
  },
  /** Stores another kind of file for a message; returns the path the agent reads it at. */
  uploadFile: async (file: File, project?: string, signal?: AbortSignal) => {
    const res = await fetch(at(`/files?name=${encodeURIComponent(file.name)}`, project), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file, signal });
    await refused(res);
    return ((await res.json()) as { path: string }).path;
  },
  /** Where a file dropped in the browser lies on Seismic's machine, if Seismic finds exactly one that fits its name, size and time. */
  findFile: async (file: File, project?: string) => (await call<{ path: string | null }>('POST', at('/files/find', project), { name: file.name, size: file.size, modified: file.lastModified })).path,
  /** An image the app's drop names by its path on this machine, as a file the page attaches. */
  localImage: async (path: string) => {
    const res = await fetch(at(`/files/local?path=${encodeURIComponent(path)}`));
    await refused(res);
    const blob = await res.blob();
    return new File([blob], path.split(/[\\/]/).at(-1)!, { type: blob.type });
  },
  events: (id: string) => call<CardEvent[]>('GET', cardAt(id, '/events')),
  /** The owner's response on the card's approved work at `handover`; given again, it replaces the answer. */
  giveFeedback: (id: string, handover: number, answer: FeedbackAnswer) => call<Feedback>('POST', cardAt(id, '/feedback'), { handover, answer }),
  /** The skills the owner can ask the card's agent for by `/name`. */
  skills: (id: string) => call<Skill[]>('GET', cardAt(id, '/skills')),
  /** Whether the app in the card's workstation answers now. */
  appUp: async (id: string) => (await call<{ up: boolean }>('GET', cardAt(id, '/app'))).up,
  /** Where the owner's browser opens the card's app: through Seismic, which keeps it running a while after. */
  appOpen: (id: string) => cardAt(id, '/app/open'),
  /** What the card's work changes (null: nothing to read, no workstation and not landed); `full`: with the diff itself. */
  diff: async (id: string, full = false) => (await call<CardDiff | undefined>('GET', cardAt(id, `/diff${full ? '?full' : ''}`))) ?? null,
  /** One file of the card's change as it was and as it is (null where none is to show), for a diff to expand the lines around its hunks. */
  versions: async (id: string, path: string) => (await call<{ old: string | null; new: string | null } | undefined>('GET', cardAt(id, `/versions?path=${encodeURIComponent(path)}`))) ?? null,
  /** Whether both versions of a changed file are there to show, without carrying them. */
  hasVersions: async (id: string, path: string) => {
    const v = await call<{ old: boolean; new: boolean } | undefined>('GET', cardAt(id, `/versions?probe&path=${encodeURIComponent(path)}`));
    return !!v && v.old && v.new;
  },
  /** A plan's plan doc as written. */
  planDoc: (id: string) => call<{ file: string; markdown: string }>('GET', cardAt(id, '/plan')),
  /** A plan's decisions and the idea it came from. */
  history: (id: string) => call<PlanHistory>('GET', cardAt(id, '/history')),
  /**
   * What the owner said about the card or plan in view, with the screenshots shown with it;
   * `replyTo`: in reply to that message of the card's conversation, or of the sheet; `text`: typed in the field
   * before it, which goes first; `listen`: dictated into a field, the words only come back; `spot`:
   * about that place in the card's demo video; `place`: where on the project the owner was, for a card it makes;
   * `sent`: the page's name for the recording, to ask whether it arrived (`voiceArrived`). A refusal
   * throws an ApiError; a connection that broke, anything else.
   */
  voice: async (
    audio: Blob,
    where: Where,
    { images = [], replyTo, text, listen, spot, place, sent, project }: { images?: string[]; replyTo?: number | TalkRef; text?: string; listen?: boolean; spot?: SpotInput; place?: Place; sent?: string; project?: string } = {},
  ) => {
    const q = [
      ...(sent ? [`sent=${encodeURIComponent(sent)}`] : []),
      ...images.map((id) => `image=${encodeURIComponent(id)}`),
      ...(place ? [`place=${placeParam(place)}`] : []),
      ...(replyTo ? [`replyTo=${typeof replyTo === 'number' ? replyTo : `${replyTo.talk}.${replyTo.part}`}`] : []),
      ...(listen ? ['listen'] : []),
      ...(spot ? [`at=${spot.at}`, ...(spot.still ? [`still=${encodeURIComponent(spot.still)}`] : []), ...(spot.demo !== undefined ? [`demo=${spot.demo}`] : [])] : []),
    ].join('&');
    let body: Blob | FormData = audio;
    if (text?.trim()) {
      body = new FormData();
      body.set('audio', audio);
      body.set('text', text);
    }
    const res = await fetch(whereAt(where, `/voice${query(where)}${q && (where ? '&' : '?')}${q}`, project), { method: 'POST', body });
    await refused(res);
    return (await res.json()) as Heard;
  },
  /** Whether the recording `voice` sent as `sent` arrived whole. */
  voiceArrived: async (sent: string, project?: string) => (await call<{ arrived: boolean }>('GET', at(`/voice/arrived/${encodeURIComponent(sent)}`, project))).arrived,
  /** The owner started speaking (or typing a command): Seismic gets ready to read it. */
  warmVoice: () => fetch(at('/voice/warm'), { method: 'POST' }).catch(() => {}),
  /** The same, typed; `field`: the field of the open card it was typed into. */
  command: (text: string, where: Where, { images, field, replyTo, spot, place, destination }: { images?: string[]; field?: Field; replyTo?: number | TalkRef; spot?: SpotInput; place?: Place; destination?: { project: string; chat: number; requestId?: string } } = {}) =>
    call<Heard>('POST', whereAt(where, `/command${query(where)}${place ? `${where ? '&' : '?'}place=${placeParam(place)}` : ''}`, destination?.project), { text, ...(destination ? { chat: destination.chat, ...(destination.requestId ? { requestId: destination.requestId } : {}) } : {}), ...(images?.length ? { images } : {}), ...(field ? { field } : {}), ...(replyTo ? { replyTo } : {}), ...(spot ? { spot } : {}) }),
  /** A typed request to the Koordinator of another project, about nothing in view there. */
  commandOn: (project: string, text: string) => call<Heard>('POST', `/api/c/${encodeURIComponent(project)}/command`, { text }),
  undo: (token: string) => call<{ undone: boolean }>('POST', at('/command/undo'), { token }),
  /** The issue for Seismic's makers as a small job writes it from the owner's words, reworking the draft so far; `app`: Seismic runs in its app. */
  writeWish: (w: { said: string; answer?: string; title?: string; body?: string; images?: string[]; app: boolean }) =>
    call<{ title: string; body: string; raw?: true; limitedUntil?: string }>('POST', at('/wish'), w),
  /** A rule of the owner's, active at once, or with `target` one for that repository's CLAUDE.md. */
  addPreference: (text: string, target?: string) => call<void>('POST', at('/preferences'), { text, ...(target ? { target } : {}) }),
  /** Changes a preference, or deletes it with `null`. */
  setPreference: (id: number, text: string | null) =>
    text === null ? call<void>('DELETE', at(`/preferences/${id}`)) : call<void>('PATCH', at(`/preferences/${id}`), { text }),
  /** Accepts a proposed rule, in the owner's words and for the place they chose (a repository, `null` for the preferences) when they changed these. */
  acceptProposal: (id: number, text?: string, target?: string | null, project?: string) =>
    call<void>('POST', project ? `/api/c/${encodeURIComponent(project)}/preferences/${id}/accept` : at(`/preferences/${id}/accept`), { ...(text === undefined ? {} : { text }), ...(target === undefined ? {} : { target }) }),
  rejectProposal: (id: number, project?: string) => call<void>('POST', project ? `/api/c/${encodeURIComponent(project)}/preferences/${id}/reject` : at(`/preferences/${id}/reject`)),
  /** Takes a setting the work retrospective proposed, as it is or with the owner's `value`: on this machine, or into the repository for everyone. */
  takeSetting: (id: number, where: 'machine' | 'repository', value?: string | string[], project?: string) => call<unknown>('POST', project ? `/api/c/${encodeURIComponent(project)}/setting-proposals/${id}/take` : at(`/setting-proposals/${id}/take`), { where, ...(value === undefined ? {} : { value }) }),
  rejectSetting: (id: number, project?: string) => call<void>('POST', project ? `/api/c/${encodeURIComponent(project)}/setting-proposals/${id}/reject` : at(`/setting-proposals/${id}/reject`)),
  /** Shares outdated pages again, the newest demos first: `count` of them, or all with null. */
  reshare: (count: number | null, tags = false) => call<void>('POST', at('/reshare'), { count, ...(tags ? { tags } : {}) }),
  stopReshare: () => call<void>('POST', at('/reshare/stop')),
  /** "Ausblenden": puts away what the finished run says, and the notice of outdated pages until a newer change. */
  dismissReshare: () => call<void>('DELETE', at('/reshare')),
  /** The owner has the Koordinator's sheet in view: the answers waiting there are read. */
  /** Seismic's sheet is in view, or (`ids`) these exchanges in a plan's sheet. */
  readTalk: (ids?: number[]) => call<void>('POST', at('/talk/read'), ids ? { ids } : undefined),
  /** A new chat with Seismic on the shown project, or (`id`) an earlier one, of `project` where it is another. */
  newChat: () => call<{ chat: number }>('POST', at('/chat'), {}),
  enterChat: (project: string, forAnswer: boolean) => call<{ chat: number; timedOut: boolean }>('POST', at('/chat/enter', project), { forAnswer }),
  openChat: (id: number, project?: string) => call<{ chat: number }>('POST', project ? `/api/c/${encodeURIComponent(project)}/chat` : at('/chat'), { id }),
  setChatModel: (project: string, chat: number, model?: string) => call<void>('POST', `/api/c/${encodeURIComponent(project)}/chat/model`, { chat, model: model ?? null }),
  /** The chats with Seismic on every project that runs, the latest first. */
  everyChat: () => call<ChatElsewhere[]>('GET', '/api/chats'),
  /** Seismic no longer waits on the card after that exchange, to take the step it said it would. */
  unwait: (talk: number, card: string) => call<{ stopped: boolean }>('POST', at(`/talk/${talk}/unwait`), { card }),
};

// Log lines arrive over the project's WebSocket; whoever shows a card's log listens here.
const eventListeners = new Set<(e: CardEvent) => void>();
export function onCardEvent(fn: (e: CardEvent) => void): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

// A successful feedback request can outlive a gap in the project's WebSocket. Read the saved
// conversation and card state before clearing the composer, even if the server's push was missed.
const cardRefreshListeners = new Set<(id: string) => Promise<void> | void>();
const cardRefreshes = new Map<string, object>();
const failedCardRefreshes = new Set<string>();
const cardRefreshChanges = new Set<() => void>();

function onCardRefreshChange(fn: () => void) {
  cardRefreshChanges.add(fn);
  return () => cardRefreshChanges.delete(fn);
}

export function useCardRefreshFailed(id: string): boolean {
  return useSyncExternalStore(onCardRefreshChange, () => failedCardRefreshes.has(id), () => false);
}

export function onCardRefresh(fn: (id: string) => Promise<void> | void): () => void {
  cardRefreshListeners.add(fn);
  return () => cardRefreshListeners.delete(fn);
}

export async function refreshCard(id: string): Promise<void> {
  const attempt = {};
  cardRefreshes.set(id, attempt);
  // Retry the read alone. The mutation has already succeeded and must never be sent twice.
  const results = await Promise.allSettled([...cardRefreshListeners].map(async (read) => {
    try {
      await read(id);
    } catch {
      if (cardRefreshes.get(id) === attempt) await read(id);
    }
  }));
  if (cardRefreshes.get(id) !== attempt) return;
  cardRefreshes.delete(id);
  if (results.some((r) => r.status === 'rejected')) failedCardRefreshes.add(id);
  else failedCardRefreshes.delete(id);
  for (const fn of cardRefreshChanges) fn();
}

// A project's WebSocket is open again after it was lost: what was pushed meanwhile never arrived, so
// whoever shows a card's log loads it anew (the agent may have read the owner's words meanwhile).
const reconnectListeners = new Set<() => void>();
export function onReconnect(fn: () => void): () => void {
  reconnectListeners.add(fn);
  return () => reconnectListeners.delete(fn);
}

// A line taken out of a card's log (a comment deleted before it went to the worker).
const goneListeners = new Set<(cardId: string, id: number) => void>();
export function onCardEventGone(fn: (cardId: string, id: number) => void): () => void {
  goneListeners.add(fn);
  return () => goneListeners.delete(fn);
}

// What Seismic tells the owner without a command of theirs to answer (an answer looked up, what a
// request an agent passed on came to): it shows above the microphone, with "Undo" while actions wait.
const noticeListeners = new Set<(n: Notice) => void>();
/** Notices that came before anything showed them: those a page gets as it opens, before the project is drawn. */
let heldNotices: { n: Notice; at: number }[] = [];
export function onNotice(fn: (n: Notice) => void): () => void {
  noticeListeners.add(fn);
  const held = heldNotices;
  heldNotices = [];
  // the undo window went on meanwhile
  for (const { n, at } of held) fn(n.undoMs ? { ...n, undoMs: Math.max(0, n.undoMs - (Date.now() - at)) } : n);
  return () => noticeListeners.delete(fn);
}
function notice(n: Notice) {
  if (!noticeListeners.size) heldNotices.push({ n, at: Date.now() });
  for (const fn of noticeListeners) fn(n);
}

// What the owner does in this page that a restart would cut off, by who holds it (the demo video,
// push-to-talk); the server hears every change, and again after a reconnect.
const holds = new Map<string, OwnerHold>();
export const restartHeld = () => holds.size > 0;
/** The page's open WebSockets: one for the project it shows, one per project in the phone view. */
const sockets = new Map<string, WebSocket>();
const sendHolds = () => {
  for (const ws of sockets.values()) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'hold', hold: [...new Set(holds.values())] } satisfies ClientMessage));
};
/** Holds a due restart off while the owner watches (`video`) or dictates (`voice`); `null` lets go. */
export function holdRestart(by: string, what: OwnerHold | null) {
  if ((holds.get(by) ?? null) === what) return;
  if (what) holds.set(by, what);
  else holds.delete(by);
  sendHolds();
}

// Where the owner looks on the project, for a card a command makes without a place of its own: the
// server hears every change, again after a reconnect, and when the page gets the focus back, so
// the page the owner looked at last wins.
let focusMessage: Extract<ClientMessage, { type: 'focus' }> | null = null;
const sendFocus = () => {
  const ws = sockets.get(projectId);
  if (focusMessage && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(focusMessage));
};
export function reportFocus(place: Place) {
  focusMessage = { type: 'focus', place: placeParam(place) };
  sendFocus();
}

// A paired device reports when its page is in view, so it holds off its own pushes. A phone
// counts as in use while visible; other pages report recent interaction or video playback.
const HERE_MS = 30_000;
let used = true;
let inViewIsUse = false;
/** The phone view: being in view is using it. */
export const phoneInUse = () => void (inViewIsUse = true);
const sendHere = () => {
  const ws = sockets.get(projectId);
  if (document.visibilityState === 'visible' && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'here' } satisfies ClientMessage));
};
if (typeof document !== 'undefined') {
  // a stall of this page goes into the server's log
  watchPageStalls((stall) => {
    const ws = sockets.get(projectId) ?? [...sockets.values()][0];
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: 'stall', ...stall } satisfies ClientMessage));
    return true;
  });
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) addEventListener(type, () => void (used = true), { capture: true, passive: true });
  setInterval(() => {
    const playing = [...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended);
    if (!used && !playing && !inViewIsUse) return;
    used = false;
    sendHere();
  }, HERE_MS);
  // the phone locked or another app in front: what starts waiting from now on is pushed again
  const away = () => {
    if (document.visibilityState !== 'hidden') return;
    for (const ws of sockets.values()) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'away' } satisfies ClientMessage));
  };
  document.addEventListener('visibilitychange', away);
  addEventListener('pagehide', away);
}

// Whoever has something to keep across the reload a restart brings writes it down here first.
const reloadListeners = new Set<() => void>();
export function beforeReload(fn: () => void): () => void {
  reloadListeners.add(fn);
  return () => reloadListeners.delete(fn);
}

/** Loads the page again, keeping what is open, as after a restart. */
export function reload() {
  for (const fn of reloadListeners) fn();
  // A native route sent during the reload belongs to the document that starts next.
  delete window.seismicDeskPage;
  location.reload();
}

/**
 * In the app's window, whose shell is about to start again while the server runs on (a new build of
 * it, app/src/update.rs): what a reload keeps goes to the server rather than this tab's session
 * storage, which the new shell's webview starts without. `token` tells the shell it is there.
 */
export async function handOver(token: string, signal?: AbortSignal) {
  const response = await fetch('/api/app-rebuilt/handover', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, entries: snapshotSession() }),
    signal,
  });
  await refused(response);
}

/** Flushes pending drafts and view state before the shell snapshots a disconnected window. */
export function snapshotSession() {
  for (const fn of reloadListeners) fn();
  return sessionWithDrafts();
}

/**
 * In the window of a shell that started again: what the page before it handed over, back into
 * session storage. Startup waits for it a short while only; an answer that comes later still fills
 * in, and the server keeps its copy until this page has taken it.
 */
export async function takeHandOver(restoredDrafts?: ReadonlySet<string>, wait = 1_500) {
  const session = prepareSessionHandOver(restoredDrafts);
  const taking = (async () => {
    const response = await fetch('/api/app-rebuilt/handover');
    await refused(response);
    if (response.status === 204) return;
    const handed = await response.json() as { token: string; entries: [string, string][] } | null;
    if (!handed) return;
    await session.apply(handed.entries);
    await fetch(`/api/app-rebuilt/handover?token=${encodeURIComponent(handed.token)}`, { method: 'DELETE' });
  })().catch(() => {}).finally(session.close);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([taking, new Promise<void>((resolve) => { deadline = setTimeout(resolve, wait); })]);
  clearTimeout(deadline);
}

/** How many snapshots the page took in, by project: a write's answer is older than one that came after the write went out. */
const snapshotsIn = new Map<string, number>();
const tookSnapshot = (project: string) => snapshotsIn.set(project, (snapshotsIn.get(project) ?? 0) + 1);
export const snapshotsOf = (project: string) => snapshotsIn.get(project) ?? 0;

/** A write's answer, applied to the snapshot of the project it was on. */
type SnapshotChange = (snapshot: ProjectSnapshot) => ProjectSnapshot;
const savedListeners = new Set<(project: string, change: SnapshotChange, seen: number) => void>();
function onCardSaved(fn: (project: string, change: SnapshotChange, seen: number) => void): () => void {
  savedListeners.add(fn);
  return () => savedListeners.delete(fn);
}

/**
 * A write to a card answered with the card as it now stands: the project shows it without waiting
 * for the next snapshot. `seen`: `snapshotsOf(project)` when the write went out.
 */
export function cardSaved(project: string, card: Item, seen: number) {
  for (const fn of savedListeners) fn(project, (snapshot) => withCard(snapshot, card), seen);
}

/** A card back on the project (a deletion undone): it shows again without waiting for the next snapshot. `seen` as for `cardSaved`. */
export function cardBack(project: string, card: Item, seen: number) {
  for (const fn of savedListeners) fn(project, (snapshot) => withCardBack(snapshot, card), seen);
}

/** A card deleted: the project stops showing it without waiting for the next snapshot. `seen` as for `cardSaved`. */
export function cardRemoved(project: string, id: string, seen: number) {
  for (const fn of savedListeners) fn(project, (snapshot) => withoutCard(snapshot, id), seen);
}

/** For a state setter: `next`, unless it has the same content as what the state holds, which then stays the object it was. */
const unlessSame = <T,>(next: T) => (previous: T) => (sameJson(previous, next) ? previous : next);

/**
 * The snapshot with `card` in place of the card it was; one it does not show, or shows as it is,
 * leaves it as it is. A card the answer shows archived (a prototype approved) leaves the project.
 */
export function withCard(snapshot: ProjectSnapshot, card: Item): ProjectSnapshot {
  if (card.archivedAt) return withoutCard(snapshot, card.id);
  const before = snapshot.items.find((i) => i.id === card.id);
  if (!before || sameJson(before, card)) return snapshot;
  return { ...snapshot, items: snapshot.items.map((i) => (i.id === card.id ? card : i)) };
}

/** The snapshot with `card` on it: in place of the card it was, else added. */
export function withCardBack(snapshot: ProjectSnapshot, card: Item): ProjectSnapshot {
  return snapshot.items.some((i) => i.id === card.id) ? withCard(snapshot, card) : { ...snapshot, items: [...snapshot.items, card] };
}

/** The snapshot without the card `id`; one it does not show leaves it as it is. */
export function withoutCard(snapshot: ProjectSnapshot, id: string): ProjectSnapshot {
  if (!snapshot.items.some((i) => i.id === id)) return snapshot;
  return { ...snapshot, items: snapshot.items.filter((i) => i.id !== id) };
}

/**
 * `next`, keeping what it has the same as `previous` as `previous`'s own objects: each card, and
 * each other part of the snapshot. A card that did not change stays the object it was, so the
 * canvas does not draw it again; a snapshot that changed nothing is `previous` itself, which
 * React does not render again at all.
 */
export function withUnchanged(previous: ProjectSnapshot | null, next: ProjectSnapshot): ProjectSnapshot {
  if (!previous) return next;
  const before = new Map(previous.items.map((i) => [i.id, i]));
  const items = next.items.map((item) => {
    const old = before.get(item.id);
    return old && sameJson(old, item) ? old : item;
  });
  const sameItems = items.length === previous.items.length && items.every((item, index) => item === previous.items[index]);
  const merged = { ...next, items: sameItems ? previous.items : items } as Record<string, unknown>;
  const old = previous as unknown as Record<string, unknown>;
  for (const key of Object.keys(merged)) if (key !== 'items' && key in old && sameJson(old[key], merged[key])) merged[key] = old[key];
  const keys = Object.keys(merged);
  const unchanged = keys.length === Object.keys(old).length && keys.every((key) => merged[key] === old[key]);
  return unchanged ? previous : (merged as unknown as ProjectSnapshot);
}

/**
 * The live project `id` (the shown one by default): the server pushes a snapshot on connect and after
 * every change, the restart that waits, the newer version of the app there is, how many cards on
 * each project need the owner, and the Bun it runs on when that is too old. A lost connection is
 * tried again with a growing pause, and at once when the page comes back into view (a phone that
 * was locked).
 */
/** The server answered nothing while the page loaded (the app from the home screen, the machine asleep). */
export let quietAtStart = false;
export const markQuiet = () => void (quietAtStart = true);

/** How long a connection may take to open before the page counts the server as not answering. */
const QUIET_MS = 3000;
/** How long before it is given up and tried anew. */
const GIVE_UP_MS = 10_000;
/** How often the page asks an open connection whether the server is there. */
const PING_MS = 5000;
/** How long a ping may stay unanswered before the page counts the server as frozen. */
const FROZEN_MS = 10_000;

export function useProject(id = projectId): {
  snapshot: ProjectSnapshot | null;
  online: boolean;
  /** Since when the server does not answer; null while it does. */
  offlineSince: number | null;
  /** Since when the server, though connected, answers nothing (frozen); null while it does. */
  frozenSince: number | null;
  restart: PendingRestart | null;
  update: AppUpdate | null;
  /** New commits on the upstream of the checkout Seismic runs from. */
  source: SourceUpdate | null;
  /** The plans' usage limits, a harness's each (Claude Code's first), while the bar shows them. */
  usage: Usage[];
  /** What waits for the owner on each project, by project id. */
  waiting: Record<string, Waiting>;
  oldBun: string | null;
  /** The projects from the connection, initially and as they change. */
  projects: ProjectInfo[] | null;
} {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  // a page that loaded while the server answered nothing says so at once
  const [online, setOnline] = useState(!quietAtStart);
  const [offlineSince, setOfflineSince] = useState<number | null>(() => (quietAtStart ? Date.now() - QUIET_MS : null));
  const [frozenSince, setFrozenSince] = useState<number | null>(null);
  const [restart, setRestart] = useState<PendingRestart | null>(null);
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [source, setSource] = useState<SourceUpdate | null>(null);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [waiting, setWaiting] = useState<Record<string, Waiting>>({});
  const [oldBun, setOldBun] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  useEffect(() => {
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let delay = 500;
    let closed = false;
    let server: string | undefined;
    let hidden = document.visibilityState !== 'visible';
    /** The socket was open before: one that opens now opens again. */
    let opened = false;
    let snapshotVersion = 0;
    const offRefresh = onCardRefresh(async (cardId) => {
      if (projectOf(cardId) !== id) return;
      const version = ++snapshotVersion;
      const fresh = await api.project(id);
      // A newer read or push takes precedence over a response that was still in flight.
      if (!closed && version === snapshotVersion) {
        tookSnapshot(id);
        setSnapshot((previous) => withUnchanged(previous, fresh));
      }
    });
    // a card a write answered with shows at once, unless a snapshot came in after the write went out
    const offSaved = onCardSaved((project, change, seen) => {
      if (project !== id || closed || snapshotsOf(id) !== seen) return;
      setSnapshot((s) => s && change(s));
    });
    /** When the oldest ping the server has not answered was sent. */
    let unanswered: number | null = null;
    /** Since when the server counts as frozen; a connection lost meanwhile keeps counting from there. */
    let frozenAt: number | null = null;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/c/${encodeURIComponent(id)}/ws`);
      sockets.set(id, ws);
      // a sleeping machine answers nothing, not even a refusal: the page says so meanwhile, and tries anew
      const since = Date.now();
      const opening = ws;
      setTimeout(() => {
        if (opening.readyState !== WebSocket.CONNECTING || closed) return;
        setOnline(false);
        setOfflineSince((t) => t ?? since);
      }, QUIET_MS);
      setTimeout(() => opening.readyState === WebSocket.CONNECTING && opening.close(), GIVE_UP_MS);
      ws.onopen = () => {
        if (document.visibilityState === 'visible') sendHere();
        if (opened) {
          for (const fn of reconnectListeners) fn();
          for (const cardId of failedCardRefreshes) if (projectOf(cardId) === id) void refreshCard(cardId);
        }
        opened = true;
        setOnline(true);
        setOfflineSince(null);
        delay = 500;
        sendHolds();
        sendFocus();
      };
      ws.onmessage = (e) => {
        unanswered = frozenAt = null;
        setFrozenSince(null);
        const start = performance.now();
        const msg = JSON.parse(e.data) as ServerMessage;
        // what the page took in, for a stall right after it
        queueMicrotask(() => noteMessage(msg.type, e.data.length, start, performance.now() - start));
        // a new server process may run new code: the page loads it, and keeps what was open
        if (msg.type === 'pong') return;
        if (msg.type === 'hello') {
          if (server && server !== msg.server) afterAttachments(reload);
          server = msg.server;
          setOldBun(msg.oldBun ?? null);
        } else if (msg.type === 'snapshot') {
          snapshotVersion++;
          tookSnapshot(id);
          setSnapshot((previous) => withUnchanged(previous, msg.snapshot));
        } else if (msg.type === 'restart') setRestart(msg.restart);
        else if (msg.type === 'update') setUpdate(msg.update);
        else if (msg.type === 'source') setSource(msg.source);
        // these come with every change on any project: one that brings nothing new leaves the page as it is
        else if (msg.type === 'usage') setUsage(unlessSame(msg.usage));
        else if (msg.type === 'waiting') setWaiting(unlessSame(msg.waiting));
        else if (msg.type === 'projects') setProjects(unlessSame<ProjectInfo[] | null>(msg.projects));
        else if (msg.type === 'event') for (const fn of eventListeners) fn(msg.event);
        else if (msg.type === 'eventGone') for (const fn of goneListeners) fn(msg.cardId, msg.id);
        else if (msg.type === 'notice') notice(msg);
      };
      ws.onclose = () => {
        if (closed) return;
        const outageStart = frozenAt ?? Date.now();
        unanswered = frozenAt = null;
        setFrozenSince(null);
        setOnline(false);
        setOfflineSince((t) => t ?? outageStart);
        // a project the configuration no longer has: the page goes to the first one there is; a
        // device removed from Seismic's devices, or a browser whose cookie no longer names the
        // owner's key, gets the page that says how to connect or sign in again
        api.projects().then(
          (list) => {
            if (!closed && !list.some((c) => c.id === id)) afterAttachments(() => {
              if (!closed) location.replace('/');
            });
          },
          (e) => {
            if (!closed && e instanceof ApiError && (e.code === 'notPaired' || e.code === 'notOwner')) afterAttachments(reload);
          },
        );
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 8000);
      };
    };
    connect();
    // an open connection does not mean the server answers: a frozen one keeps it open and says nothing
    const beat = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN || document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (unanswered !== null && now - unanswered >= FROZEN_MS) setFrozenSince((frozenAt ??= unanswered));
      if (unanswered === null) unanswered = now;
      ws.send(JSON.stringify({ type: 'ping' } satisfies ClientMessage));
    }, PING_MS);
    // back from GitHub, say: the server looks at the pull requests now instead of at its next round
    const back = () => {
      const visible = document.visibilityState === 'visible';
      const cameBack = hidden && visible;
      hidden = !visible;
      // pings a locked phone or suspended tab left unanswered say nothing of the server: it gets to answer anew
      if (cameBack) {
        unanswered = frozenAt = null;
        setFrozenSince(null);
      }
      if (visible && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'back' } satisfies ClientMessage));
      if (!visible || closed || ws.readyState === WebSocket.OPEN) return sendFocus();
      // a phone that was locked had no connection meanwhile, which says nothing of the server: not
      // answering counts from now, and a connection still opening from back then is tried anew
      if (cameBack) setOfflineSince((t) => (t === null ? null : Date.now()));
      // a connection lost meanwhile is tried again now, not after the pause it waits
      if (ws.readyState === WebSocket.CLOSED || (cameBack && ws.readyState === WebSocket.CONNECTING)) {
        clearTimeout(retry);
        ws.onclose = null;
        ws.close();
        delay = 500;
        connect();
      }
      sendFocus();
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => {
      closed = true;
      offRefresh();
      offSaved();
      clearTimeout(retry);
      clearInterval(beat);
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
      if (sockets.get(id) === ws) sockets.delete(id);
      ws.close();
    };
  }, [id]);
  return { snapshot, online, offlineSince, frozenSince, restart, update, source, usage, waiting, oldBun, projects };
}
