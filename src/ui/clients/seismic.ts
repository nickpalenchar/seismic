




import type { AgentSetting, CardAction, CardPatch, ChatElsewhere, ModelInfo, ConfigSaved, ConfigView, Item, OwnerSetting, OwnerSettingChanges, OwnerSettingViews, ProjectConfig } from '../../core/types';
import { agentSettingsSaved, call, cardBack, cardRemoved, cardSaved, projectOf, snapshotsOf } from '../api';


const TIMEOUT_MS = 60_000;

/** The URL of the card `id` in the API; the server finds the project it is on. */
export const getCardById = (id: string) => `/api/v1/cards/${encodeURIComponent(id)}`;

type WriteOptions = {
  
  shown?: (project: string, card: Item, seen: number) => void;
  
  timeoutMs?: number | null;
  keepalive?: boolean;
};

/** A write to the card `id` (to `path` under its URL) that answers with the card, which the project shows at once. */
async function writeCard(id: string, method: string, path: string, body: unknown, { shown = cardSaved, timeoutMs = TIMEOUT_MS, keepalive = false }: WriteOptions = {}): Promise<Item> {
  const project = projectOf(id);
  const seen = snapshotsOf(project);
  const { card } = await call<{ card: Item }>(method, `${getCardById(id)}${path}`, body, keepalive, timeoutMs ?? undefined);
  shown(project, card, seen);
  return card;
}

/** "Share on approval" on the card's demo: whether approving puts its latest demo on the page. */
export const setShareOnApproval = (id: string, onApproval: boolean) => writeCard(id, 'PATCH', '/share', { onApproval });

/** Changes to the card `id` (its title, text, place, labels; a plan's fold), answered with the card. */
export const patchCard = (id: string, patch: CardPatch) => writeCard(id, 'PATCH', '', patch);

/** The card `id` deleted (its undo is `restoreCard`): the project stops showing it at once. */
export async function removeCard(id: string): Promise<void> {
  const project = projectOf(id);
  const seen = snapshotsOf(project);
  await call<void>('DELETE', getCardById(id), undefined, false, TIMEOUT_MS);
  cardRemoved(project, id, seen);
}

/** A deleted card brought back (the undo of `removeCard`): the project shows it again at once. */
export const restoreCard = (id: string) => writeCard(id, 'POST', '/restore', undefined, { shown: cardBack });

/** The card `id` archived: it leaves the shown project at once; the answer is the card as the archive shows it. */
export const archiveCard = (id: string) => writeCard(id, 'POST', '/archive', undefined, { shown: (project, card, seen) => cardRemoved(project, card.id, seen) });

/** The archived card `id` back on the project (also the undo of `archiveCard`): it shows again at once. */
export const unarchiveCard = (id: string) => writeCard(id, 'POST', '/unarchive', undefined, { shown: cardBack });

/**
 * The card started: Seismic judges when its agent begins (`agent`: the one picked in the Start menu);
 * a plan, all its planned workstreams. `skipWaitForCards`: "Start anyway" on a card waiting behind others.
 */
export const startCardAgent = (id: string, { agent, skipWaitForCards = false }: { agent?: AgentSetting; skipWaitForCards?: boolean } = {}) =>
  writeCard(id, 'POST', '/start', { ...(agent ? { agent } : {}), ...(skipWaitForCards ? { skipWaitForCards } : {}) });

/** "Take out of the queue": the card's start taken back before its agent begins; on a plan, its workstreams' not yet planned. */
export const dequeueCard = (id: string) => writeCard(id, 'POST', '/dequeue', {});

/** The owner writes to the card (its agent, a Question card's thread, a review card's decisions on its findings); `keepalive` for one sent as the page goes. */
export const sendCardMessage = (id: string, message: Extract<CardAction, { action: 'message' }>, keepalive = false) =>
  writeCard(id, 'POST', '/message', message, { keepalive });

/** The owner answers the question the card waits on; `keepalive` for one sent as the page goes. */
export const answerCard = (id: string, answer: Extract<CardAction, { action: 'answer' }>, keepalive = false) =>
  writeCard(id, 'POST', '/answer', answer, { keepalive });

/** The card's agent paused (`safePoint`: when its turn ends). */
export const pauseCard = (id: string, { safePoint = false }: { safePoint?: boolean } = {}) => writeCard(id, 'POST', '/pause', safePoint ? { safePoint } : {});

/** The paused card's agent goes on (a card at its retry limit tries again). */
export const resumeCard = (id: string) => writeCard(id, 'POST', '/resume', {});

/** The card snoozed until `until`. */
export const snoozeCard = (id: string, until: string) => writeCard(id, 'POST', '/snooze', { until });

/** The snoozed card woken before its time. */
export const wakeCard = (id: string) => writeCard(id, 'POST', '/wake', {});

/** When the accepted proposal starts (`at`), or with `null` no longer at a time. */
export const setCardStartAt = (id: string, at: string | null) => writeCard(id, 'POST', '/start-at', { at });

/** The card's agent stopped: the card is planned again. */
export const stopCardAgent = (id: string) => writeCard(id, 'POST', '/stop', {});

/**
 * The card's work approved (`direct`: onto main where it would go out as a pull request). The answer
 * waits for what the approval does, a landing onto main included, so the page waits as long.
 */
export const approveCard = (id: string, { direct = false }: { direct?: boolean } = {}) => writeCard(id, 'POST', '/approve', direct ? { direct } : {}, { timeoutMs: null });

/** One of the owner's system-level settings, as it reads. */
export const getSetting = async <N extends OwnerSetting>(name: N): Promise<OwnerSettingViews[N]> =>
  (await call<{ setting: OwnerSettingViews[N] }>('GET', `/api/v1/settings/${name}`, undefined, false, TIMEOUT_MS)).setting;

/** One of the owner's settings saved on its own (the fields it changes), answered with it as it then reads. */
export async function saveSetting<N extends OwnerSetting>(name: N, change: OwnerSettingChanges[N]): Promise<OwnerSettingViews[N]> {
  const { setting } = await call<{ setting: OwnerSettingViews[N] }>('PUT', `/api/v1/settings/${name}`, change, false, TIMEOUT_MS);
  if (name === 'agents' || name === 'codexAutoReview') agentSettingsSaved();
  return setting;
}

/** Several of the owner's settings saved at once, answered with all of them. */
export async function saveSettings(changes: Partial<OwnerSettingChanges>): Promise<OwnerSettingViews> {
  const { settings } = await call<{ settings: OwnerSettingViews }>('PATCH', '/api/v1/settings', changes, false, TIMEOUT_MS);
  if ('agents' in changes || 'codexAutoReview' in changes) agentSettingsSaved();
  return settings;
}

/** Seismic's configuration: its projects and their repositories, as the Configuration sheet shows them. */
export const getConfiguration = async (): Promise<ConfigView> => (await call<{ configuration: ConfigView }>('GET', '/api/v1/configuration', undefined, false, TIMEOUT_MS)).configuration;

/**
 * The configuration saved with the sheet's Save: what came of it (applied at once, or a restart to
 * come) and the configuration as it then reads. Applying waits for git to read the projects it changed.
 */
export const saveConfiguration = (projects: ProjectConfig[]) => call<{ saved: ConfigSaved; configuration: ConfigView }>('PUT', '/api/v1/configuration', projects, false, TIMEOUT_MS);

/** The chats with Seismic on every project that runs, the latest first. */
export const getEveryChat = async (): Promise<ChatElsewhere[]> => (await call<{ chats: ChatElsewhere[] }>('GET', '/api/v1/chats', undefined, false, TIMEOUT_MS)).chats;

/** A new chat with Seismic on the project (the one with nothing said in it yet, where there is one): its id. */
export const createChat = async (project: string): Promise<number> => (await call<{ chat: number }>('POST', '/api/v1/chats', { project }, false, TIMEOUT_MS)).chat;

/** The owner goes back to the earlier chat `chat` (of any project): new words go into it from now on. */
export const openChat = async (chat: number): Promise<void> => void (await call<{ chat: number }>('POST', `/api/v1/chats/${chat}/open`, undefined, false, TIMEOUT_MS));

/** The model the chat's words are read with (`undefined`: the project's default). */
export const setChatModel = async (chat: number, model?: string): Promise<void> => void (await call<unknown>('PATCH', `/api/v1/chats/${chat}`, { model: model ?? null }, false, TIMEOUT_MS));

/** The owner saw these exchanges of the chat. */
export const readChat = async (chat: number, ids: number[]): Promise<void> => void (await call<unknown>('POST', `/api/v1/chats/${chat}/read`, { ids }, false, TIMEOUT_MS));

/** The owner stops Seismic's wait on `card` after the exchange of the chat ("Stop waiting"); false when it no longer waits. */
export const stopWaiting = async (chat: number, exchange: number, card: string): Promise<boolean> =>
  (await call<{ stopped: boolean }>('POST', `/api/v1/chats/${chat}/exchanges/${exchange}/unwait`, { card }, false, TIMEOUT_MS)).stopped;

/** The chat the owner talked in last on the project, and when; `null` while nothing was said in any. */
export const getRecentChat = async (project: string): Promise<{ id: number; at: string } | null> =>
  (await call<{ chat: { id: number; at: string } | null }>('GET', `/api/v1/chats/recent?project=${encodeURIComponent(project)}`, undefined, false, TIMEOUT_MS)).chat;

type ModelHarness = 'codex' | 'agy';

const MODELS_KEPT_MS = 60_000;

let modelsKept: { at: number; read: Promise<Record<ModelHarness, ModelInfo[]>> } | null = null;

/**
 * The models of the harness. Every harness is read in one call and kept for a minute, so the chat
 * panel and the start menu find them there; `fresh` reads again (the settings, after a change).
 */
export function getAgentModels(harness: ModelHarness, { fresh = false }: { fresh?: boolean } = {}): Promise<ModelInfo[]> {
  if (fresh || !modelsKept || Date.now() - modelsKept.at > MODELS_KEPT_MS) {
    const read = call<{ models: Record<ModelHarness, ModelInfo[]> }>('GET', '/api/v1/agents?models=codex,agy', undefined, false, TIMEOUT_MS).then((answer) => answer.models);
    const kept = { at: Date.now(), read };
    modelsKept = kept;
    read.catch(() => void (modelsKept === kept && (modelsKept = null)));
  }
  return modelsKept!.read.then((models) => models[harness]);
}
