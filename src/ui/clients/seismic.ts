/**
 * The client of Seismic's RESTful API (`/api/v1/`, the server's `routes/v1/`). A write answers with
 * what it changed, which the page shows at once (`cardSaved`). New calls go here; `api.ts` holds
 * the old routes until they move.
 */
import type { AgentSetting, CardPatch, Item, OwnerSetting, OwnerSettingChanges, OwnerSettingViews } from '../../core/types';
import { agentSettingsSaved, call, cardBack, cardRemoved, cardSaved, projectOf, snapshotsOf } from '../api';

/** How long a request may take before the page gives it up. */
const TIMEOUT_MS = 60_000;

/** The URL of the card `id` in the API; the server finds the project it is on. */
export const getCardById = (id: string) => `/api/v1/cards/${encodeURIComponent(id)}`;

type WriteOptions = {
  /** How the project shows the card: in place of the card it was (`cardSaved`, the default), put back on it (`cardBack`), or taken off it. */
  shown?: (project: string, card: Item, seen: number) => void;
  /** How long the page waits; `null` waits as long as the server works on it. */
  timeoutMs?: number | null;
};

/** A write to the card `id` (to `path` under its URL) that answers with the card, which the project shows at once. */
async function writeCard(id: string, method: string, path: string, body: unknown, { shown = cardSaved, timeoutMs = TIMEOUT_MS }: WriteOptions = {}): Promise<Item> {
  const project = projectOf(id);
  const seen = snapshotsOf(project);
  const { card } = await call<{ card: Item }>(method, `${getCardById(id)}${path}`, body, false, timeoutMs ?? undefined);
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
