/**
 * The client of Seismic's RESTful API (`/api/v1/`, the server's `routes/v1/`). A write answers with
 * what it changed, which the page shows at once (`cardSaved`). New calls go here; `api.ts` holds
 * the old routes until they move.
 */
import type { CardPatch, Item } from '../../core/types';
import { call, cardBack, cardRemoved, cardSaved, projectOf, snapshotsOf } from '../api';

/** How long a request may take before the page gives it up. */
const TIMEOUT_MS = 60_000;

/** The URL of the card `id` in the API; the server finds the project it is on. */
export const getCardById = (id: string) => `/api/v1/cards/${encodeURIComponent(id)}`;

/**
 * A write to the card `id` (to `path` under its URL) that answers with the card: the project shows it
 * at once, in place of the card it was (`saved`), or put back on it (`back`).
 */
async function writeCard(id: string, method: string, path: string, body: unknown, shown: typeof cardSaved = cardSaved): Promise<Item> {
  const project = projectOf(id);
  const seen = snapshotsOf(project);
  const { card } = await call<{ card: Item }>(method, `${getCardById(id)}${path}`, body, false, TIMEOUT_MS);
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
export const restoreCard = (id: string) => writeCard(id, 'POST', '/restore', undefined, cardBack);
