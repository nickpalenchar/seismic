// Other cards named in a card's text: `/` in its task field opens a menu of the project's cards whose
// titles fit what follows, and the one picked stands in the text as a markdown link to its address
// (`[Title](/p/<project>/c/<code>)`); the field shows it as a pill (`cardMenu.tsx`), and so does
// every place that shows the text: a smart link, with the card's state, its current title and its
// priority (`SmartLink`). The agent reads the link as it stands: the card's title, and where it lives.

import type { Item } from '../core/types';
import { named } from './address';
import { know, known } from './known';

/** Set once the owner has picked a card from the menu: its hint under the field goes. */
export const CARD_REFS_KNOWN = 'obeya-card-refs-known';
export const usedCardRefs = () => know(CARD_REFS_KNOWN);
export const knowsCardRefs = () => known(CARD_REFS_KNOWN);

/** How many cards the menu lists at most. */
const SHOWN = 8;

/** A `/` search the cursor stands at the end of: where its slash is in the text, and what follows it. */
export interface CardSearch {
  start: number;
  query: string;
}

/**
 * The `/` search ending at `caret`: a slash at the start of the text or after a space, and the words
 * after it on the same line (a title has spaces), at most a few. A path (`/a/b`) is none.
 */
export function cardSearchAt(text: string, caret: number): CardSearch | null {
  const m = /(?:^|\s)\/([^\n/]{0,60})$/.exec(text.slice(0, caret));
  if (!m || /^\s/.test(m[1]!)) return null;
  return { start: caret - m[1]!.length - 1, query: m[1]! };
}

/**
 * The cards that fit `query`, case aside: each of its words is in the title or is the card's short
 * code; titles that start with the query first, then the rest, each group as listed. Not `self`,
 * nor what is archived.
 */
export function matchingCards(items: Item[], query: string, self?: string, limit = SHOWN): Item[] {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const fit = items.filter((i) => {
    if (i.id === self || i.archivedAt || !i.title.trim()) return false;
    const title = i.title.toLowerCase();
    return words.every((w) => title.includes(w) || i.short === w);
  });
  const first = fit.filter((i) => i.title.toLowerCase().startsWith(q));
  return [...first, ...fit.filter((i) => !first.includes(i))].slice(0, limit);
}

/** A card's title as the text of its link: brackets in it would end the link's text early. */
export const linkText = (title: string) => title.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();

const HREF = /^\/p\/([^/]+)\/c\/([^/?#]+)$/;
const LEGACY_HREF = /^\/c\/([^/]+)\/card\/([^/?#]+)$/;

/** The project and card code an address of a card names; null for any other address. */
export function cardHref(href: string): { project: string; code: string } | null {
  const m = HREF.exec(href) ?? LEGACY_HREF.exec(href);
  if (!m) return null;
  try {
    return { project: decodeURIComponent(m[1]!), code: decodeURIComponent(m[2]!) };
  } catch {
    return null;
  }
}

/** The card a link names among the project's `items`; undefined where it is not among them. */
export const referenced = (items: Item[], href: string): Item | undefined => {
  const at = cardHref(href);
  return at ? named(items, at.code) : undefined;
};

/** A piece of a line of the task text: words, or a link to a card. */
export type Piece = string | { href: string; text: string };

/** The task text as the field shows it: line by line, each line its words and its links to cards (other markdown stays as written). */
export function lines(md: string): Piece[][] {
  return md.split('\n').map((line) => {
    const out: Piece[] = [];
    let last = 0;
    for (const m of line.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
      if (!cardHref(m[2]!)) continue;
      if (m.index > last) out.push(line.slice(last, m.index));
      out.push({ href: m[2]!, text: m[1]! });
      last = m.index + m[0].length;
    }
    if (last < line.length) out.push(line.slice(last));
    return out;
  });
}

/** As much of a DOM node as the field's text is read from. */
export interface NodeLike {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<NodeLike>;
  getAttribute?: (name: string) => string | null;
}

const BLOCKS = new Set(['DIV', 'P', 'LI']);

/**
 * The task text a field's content stands for: its words, a card's pill as its markdown link, and a
 * line break where the browser put one: before each block (a line of its own) but the first, and
 * for a `<br>`, except one that ends its block or the field, which only holds an empty line open.
 */
export function textOf(root: NodeLike): string {
  let out = '';
  const walk = (node: NodeLike) => {
    const kids = Array.from(node.childNodes);
    kids.forEach((n, k) => {
      if (n.nodeType === 3) out += (n.nodeValue ?? '').replace(/\u00a0/g, ' ');
      else if (n.nodeType !== 1) return;
      else if (n.getAttribute?.('data-href')) out += `[${n.getAttribute('data-text') ?? ''}](${n.getAttribute('data-href')})`;
      else if (n.nodeName === 'BR') {
        if (k < kids.length - 1) out += '\n';
      } else {
        if (BLOCKS.has(n.nodeName) && k > 0) out += '\n';
        walk(n);
      }
    });
  };
  walk(root);
  return out;
}
