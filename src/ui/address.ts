// The page's address: `/p/<project>` shows a canvas, `/p/<project>/c/<code>` a card open on it,
// the code being the card's short code or its whole id, `/p/<project>/feedback` the Agent Feedback
// Log, a page of its own opened from that canvas. What else the page shows (the phone view,
// the conversation open on the phone) stays in the query.
import { projectAt, projectSegment } from '../core/project-slug';
import type { Item } from '../core/types';

export interface Address {
  canvas?: string;
  /** A card's code or id, as the address has it. */
  card?: string;
  /** A page in place of the canvas. */
  page?: 'feedback';
}

const PATH = /^\/p\/([^/]+)(?:\/c\/([^/]+)|\/(feedback))?\/?$/;
const LEGACY_PATH = /^\/c\/([^/]+)(?:\/card\/([^/]+)|\/(feedback))?\/?$/;

/** What an address names; the query of addresses before paths (`?c=<canvas>&card=<id>`) too. */
export function readAddress(at: { pathname: string; search: string } = location): Address {
  const m = PATH.exec(at.pathname) ?? LEGACY_PATH.exec(at.pathname);
  if (m) return { canvas: decodeURIComponent(m[1]!), ...(m[2] ? { card: decodeURIComponent(m[2]) } : {}), ...(m[3] ? { page: 'feedback' as const } : {}) };
  const q = new URLSearchParams(at.search);
  const canvas = q.get('c');
  const card = q.get('card');
  return { ...(canvas ? { canvas } : {}), ...(card ? { card } : {}) };
}

let known: { id: string; name: string }[] = [];

/** The projects the page knows, so that addresses are made with their names. */
export const knowProjects = (projects: { id: string; name: string }[]) => {
  known = projects;
};

/** The project an address part (`Address.canvas`) names among `projects`: by its name, else by its id. */
export const projectNamed = <T extends { id: string; name: string }>(projects: T[], segment: string | undefined) => projectAt(projects, segment);

/** The address of a project by its id: its name as the owner sees it, its id while the page does not know it. */
export const projectPath = (canvas: string) => {
  const p = known.find((c) => c.id === canvas);
  return `/p/${encodeURIComponent(p ? projectSegment(p, known) : canvas)}`;
};

/**
 * The path that takes the place of `pathname` while the project `open` is shown, or null where it
 * stays: an address of that project by another name than its own now (an old one, or its id)
 * moves to its name, as does `was`, the address it had until a rename while it was open (also where no project keeps
 * that name). What follows the project in the path stays.
 */
export function followedPath(pathname: string, projects: { id: string; name: string; oldNames?: string[] }[], open: string, was: { id: string; path: string } | null): string | null {
  knowProjects(projects);
  const seg = /^\/p\/([^/]+)/.exec(pathname);
  const now = projectPath(open);
  if (!seg || seg[0] === now) return null;
  const ours = projectNamed(projects, decodeURIComponent(seg[1]!))?.id === open || (was?.id === open && was.path === seg[0]);
  return ours ? `${now}${pathname.slice(seg[0].length)}` : null;
}

/** The Agent Feedback Log, opened from a canvas: its link back to the dashboard leads there. */
export const feedbackLogPath = (canvas: string) => `${projectPath(canvas)}/feedback`;

/** The address of a card on its canvas: by its short code where it has one. */
export const cardPath = (canvas: string, card: Pick<Item, 'id' | 'short'> | string) =>
  `${projectPath(canvas)}/c/${encodeURIComponent(typeof card === 'string' ? card : (card.short ?? card.id))}`;

/** The card an address names among `items`, by its code or its id. */
export const named = <T extends Pick<Item, 'id' | 'short'>>(items: T[], code: string): T | undefined =>
  items.find((i) => i.id === code) ?? items.find((i) => i.short === code.toLowerCase());

/** The query without what the path says now, with flags (`?talk`) kept as bare names. */
export function queryWithout(search: string, ...names: string[]): string {
  const q = new URLSearchParams(search);
  for (const n of names) q.delete(n);
  const s = q.toString().replace(/=(&|$)/g, '$1');
  return s ? `?${s}` : '';
}

/** An address from before paths (`/?c=<canvas>&card=<id>`) in today's form, in place; a link or bookmark of then still opens what it named. */
export function upgradeAddress() {
  if (location.pathname !== '/' && !LEGACY_PATH.test(location.pathname)) return;
  const { canvas, card, page } = readAddress();
  if (!canvas) return;
  history.replaceState(history.state, '', `${card ? cardPath(canvas, card) : page === 'feedback' ? feedbackLogPath(canvas) : projectPath(canvas)}${queryWithout(location.search, 'c', 'card')}${location.hash}`);
}
