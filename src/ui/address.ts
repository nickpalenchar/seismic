// The page's address: `/p/<project>` shows a project, `/p/<project>/c/<code>` a card open on it,
// the code being the card's short code or its whole id, `/p/<project>/feedback` the Agent Feedback
// Log, a page of its own opened from that project. What else the page shows (the phone view,
// the conversation open on the phone, the view over the canvas as `?view=table`) stays in the query.
import { projectAt, projectSegment } from '../core/project-slug';
import type { Item } from '../core/types';
import { leave, leavesPage } from './leaving';

export interface Address {
  project?: string;
  /** A card's code or id, as the address has it. */
  card?: string;
  /** A page in place of the project. */
  page?: 'feedback';
}

const PATH = /^\/p\/([^/]+)(?:\/c\/([^/]+)|\/(feedback))?\/?$/;
const LEGACY_PATH = /^\/c\/([^/]+)(?:\/card\/([^/]+)|\/(feedback))?\/?$/;

/** What an address names; the query of addresses before paths (`?c=<project>&card=<id>`) too. */
export function readAddress(at: { pathname: string; search: string } = location): Address {
  const m = PATH.exec(at.pathname) ?? LEGACY_PATH.exec(at.pathname);
  if (m) return { project: decodeURIComponent(m[1]!), ...(m[2] ? { card: decodeURIComponent(m[2]) } : {}), ...(m[3] ? { page: 'feedback' as const } : {}) };
  const q = new URLSearchParams(at.search);
  const project = q.get('c');
  const card = q.get('card');
  return { ...(project ? { project } : {}), ...(card ? { card } : {}) };
}

let known: { id: string; name: string }[] = [];

/** The projects the page knows, so that addresses are made with their names. */
export const knowProjects = (projects: { id: string; name: string }[]) => {
  known = projects;
};

/** The project an address part (`Address.project`) names among `projects`: by its name, else by its id. */
export const projectNamed = <T extends { id: string; name: string }>(projects: T[], segment: string | undefined) => projectAt(projects, segment);

/** The address of a project by its id: its name as the owner sees it, its id while the page does not know it. */
export const projectPath = (project: string) => {
  const p = known.find((c) => c.id === project);
  return `/p/${encodeURIComponent(p ? projectSegment(p, known) : project)}`;
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

let wentTo = false;
/** Whether the page shown came from `goTo` (a link, the inbox), not a reload or Back; asked once, as the page opens. */
export function cameByGoTo(): boolean {
  const was = wentTo;
  wentTo = false;
  return was;
}

/**
 * Goes to `path` (another project, a card on it) within the page, as a link would but without
 * loading it again: a step in the history, Back returns.
 */
export function goTo(path: string) {
  const go = () => {
    if (leavesPage(location.href, path)) wentTo = true;
    history.pushState(null, '', path);
    dispatchEvent(new PopStateEvent('popstate', { state: null }));
  };
  // another project's page (or another page of the app) replaces this one: an unsaved draft on it asks first (`leaving`)
  if (leavesPage(location.href, path)) leave(go);
  else go();
}

/** A plain click on a link switches within the page, without loading it again; one for a new tab or window stays the link's. */
export function switchTo(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault(): void }, path: string) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  goTo(path);
}

/** The Agent Feedback Log, opened from a project: its link back to the dashboard leads there. */
export const feedbackLogPath = (project: string) => `${projectPath(project)}/feedback`;

/** The address of a card on its project: by its short code where it has one. */
export const cardPath = (project: string, card: Pick<Item, 'id' | 'short'> | string) =>
  `${projectPath(project)}/c/${encodeURIComponent(typeof card === 'string' ? card : (card.short ?? card.id))}`;

/** The card an address names among `items`, by its code or its id. */
export const named = <T extends Pick<Item, 'id' | 'short'>>(items: T[], code: string): T | undefined =>
  items.find((i) => i.id === code) ?? items.find((i) => i.short === code.toLowerCase());

/** The views over the canvas the address names (`?view=`); the canvas itself is the address without one. */
export const VIEWS = ['table'] as const;
export type AddressView = (typeof VIEWS)[number];

/** The view the query names; `unknown` where it names one that does not exist, which the page drops from the address. */
export function readView(search: string): { view?: AddressView; unknown?: true } {
  const v = new URLSearchParams(search).get('view');
  if (v === null) return {};
  return (VIEWS as readonly string[]).includes(v) ? { view: v as AddressView } : { unknown: true };
}

/**
 * The view a followed address (Back, Forward, a link within the page) asks for, given the one `shown`
 * now: the one it names, null (the canvas) where it names none or an unknown one while the table shows,
 * undefined where the shown view stays (Inbox, Queue and the like are not in the address).
 */
export function followedView(search: string, shown: string | null): AddressView | null | undefined {
  const { view } = readView(search);
  if (view) return view;
  return shown && (VIEWS as readonly string[]).includes(shown) ? null : undefined;
}

/** The query with `view` naming the view shown, or without it for the canvas; the rest stays as it was. */
export function withView(search: string, view: AddressView | undefined): string {
  if (!view) return new URLSearchParams(search).has('view') ? queryWithout(search, 'view') : search;
  if (new URLSearchParams(search).get('view') === view) return search;
  const rest = queryWithout(search, 'view');
  return `${rest || '?'}${rest ? '&' : ''}view=${view}`;
}

/** The query without what the path says now, with flags (`?talk`) kept as bare names. */
export function queryWithout(search: string, ...names: string[]): string {
  const q = new URLSearchParams(search);
  for (const n of names) q.delete(n);
  const s = q.toString().replace(/=(&|$)/g, '$1');
  return s ? `?${s}` : '';
}

/** An address from before paths (`/?c=<project>&card=<id>`) in today's form, in place; a link or bookmark of then still opens what it named. */
export function upgradeAddress() {
  if (location.pathname !== '/' && !LEGACY_PATH.test(location.pathname)) return;
  const { project, card, page } = readAddress();
  if (!project) return;
  history.replaceState(history.state, '', `${card ? cardPath(project, card) : page === 'feedback' ? feedbackLogPath(project) : projectPath(project)}${queryWithout(location.search, 'c', 'card')}${location.hash}`);
}
