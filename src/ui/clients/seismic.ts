/**
 * The client of Seismic's RESTful API (`/api/v1/`, the server's `routes/v1/`). A write answers with
 * what it changed, which the page shows at once (`cardSaved`). New calls go here; `api.ts` holds
 * the old routes until they move.
 */
import type { Item } from '../../core/types';
import { call, cardSaved, projectOf, snapshotsOf } from '../api';

/** How long a request may take before the page gives it up. */
const TIMEOUT_MS = 60_000;

/** The URL of the card `id` in the API; the server finds the project it is on. */
export const getCardById = (id: string) => `/api/v1/cards/${encodeURIComponent(id)}`;

/** A write to the card `id` (to `path` under its URL) that answers with the card: the project shows it at once. */
async function writeCard(id: string, method: string, path: string, body: unknown): Promise<Item> {
  const project = projectOf(id);
  const seen = snapshotsOf(project);
  const { card } = await call<{ card: Item }>(method, `${getCardById(id)}${path}`, body, false, TIMEOUT_MS);
  cardSaved(project, card, seen);
  return card;
}

/** "Share on approval" on the card's demo: whether approving puts its latest demo on the page. */
export const setShareOnApproval = (id: string, onApproval: boolean) => writeCard(id, 'PATCH', '/share', { onApproval });
