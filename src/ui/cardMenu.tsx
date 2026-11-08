// A card's task field, where other cards are linked (`cardRefs.ts`): an editable text in which each
// linked card stands as its smart link, a pill that the cursor steps over and that Backspace or
// Delete takes out whole. The text is kept as markdown, a pill as the link to its card's address.
// `/` and words of a title open a menu of the project's cards that fit, just under the line being
// typed, each as the smart link it will become. The arrow keys mark, Enter, Tab or a click picks,
// Escape closes it and leaves the card open. Picking puts the pill and a space in place of the search.

import { type ClipboardEvent, forwardRef, useContext, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { Item } from '../core/types';
import { cardPath } from './address';
import { projectOf } from './api';
import { SmartLink } from './cardLink';
import { type CardSearch, cardSearchAt, knowsCardRefs, lines, linkText, matchingCards, referenced, textOf, usedCardRefs } from './cardRefs';
import { Cards } from './message';
import { t } from './strings';

/** What the task field offers the card around it. */
export interface LinkFieldHandle {
  el: HTMLDivElement | null;
  /** Types `s` where the cursor is, as a keystroke would. */
  type: (s: string) => void;
  /** Puts the cursor at the end of the text. */
  focusEnd: () => void;
}

/** The flag of a priority, as `PriorityMark` draws it (Lucide's Flag, as markup since the pill is built outside React). */
const FLAG = '<svg class="lucide lucide-flag" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg>';

/** A pill as the field holds it: its card's state, title and priority, the link it stands for in its data. */
function pill(href: string, text: string, card: Item | undefined): HTMLSpanElement {
  const el = document.createElement('span');
  el.contentEditable = 'false';
  el.dataset.href = href;
  el.dataset.text = text;
  dress(el, card);
  return el;
}

/** Brings a pill up to date with its card: state, current title, priority; muted once the card is gone. */
function dress(el: HTMLElement, card: Item | undefined) {
  const on = card && !card.archivedAt;
  el.className = on ? `smart-link s-${card.state}` : 'smart-link gone';
  el.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'sl-dot';
  const title = document.createElement('span');
  title.className = 'sl-title';
  title.textContent = on ? card.title || el.dataset.text! : el.dataset.text!;
  el.append(dot, title);
  const priority = card?.labels?.priority;
  if (on && priority) {
    const prio = document.createElement('span');
    prio.className = `prio prio-${priority}`;
    prio.innerHTML = FLAG;
    prio.append(t.priority.names[priority]);
    el.append(prio);
  }
}

/** The field's content for `md`: a block per line, its words and its pills. */
function fill(root: HTMLElement, md: string, items: Item[]) {
  root.replaceChildren(
    ...lines(md).map((pieces) => {
      const line = document.createElement('div');
      if (!pieces.length) line.append(document.createElement('br'));
      for (const p of pieces) line.append(typeof p === 'string' ? document.createTextNode(p) : pill(p.href, p.text, referenced(items, p.href)));
      return line;
    }),
  );
}

/** The search at the cursor, read from the text up to it, and the text node it stands in with its place there. */
function searchAt(root: HTMLElement): { search: CardSearch; node: Text; offset: number } | null {
  const sel = getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return null;
  const at = sel.getRangeAt(0);
  if (!root.contains(at.startContainer) || at.startContainer.nodeType !== 3) return null;
  const before = document.createRange();
  before.setStart(root, 0);
  before.setEnd(at.startContainer, at.startOffset);
  const holder = document.createElement('div');
  holder.append(before.cloneContents());
  const text = textOf(holder);
  const search = cardSearchAt(text, text.length);
  // the search lies within the text node the cursor is in (a pill or a line break ends it)
  if (!search || search.query.length + 1 > at.startOffset) return null;
  return { search, node: at.startContainer as Text, offset: at.startOffset };
}

/** Where the menu stands in the field's frame, and how wide it is. */
type Place = { left: number; top: number; width: number };

/** How wide the menu is at most. */
const MENU_WIDTH = 460;

/** Just under the line of the search's slash, from the slash on, but not out past the field's right edge. */
function menuPlace(root: HTMLElement, node: Text, slash: number): Place | undefined {
  const frame = root.offsetParent?.getBoundingClientRect();
  const r = document.createRange();
  r.setStart(node, slash);
  r.setEnd(node, slash + 1);
  const at = r.getBoundingClientRect();
  if (!frame || !at.height) return undefined;
  const box = root.getBoundingClientRect();
  const width = Math.min(MENU_WIDTH, box.width);
  return {
    width,
    left: box.left - frame.left + Math.max(0, Math.min(at.left - box.left - 8, box.width - width)),
    // never below the field's bottom edge, where its text scrolls on
    top: Math.min(at.bottom, box.bottom) - frame.top + 4,
  };
}

/**
 * The task text of card `self` (`value`, markdown), edited in place; `onChange` hears each change.
 * The menu stands in the positioned frame around the field, the hint under it.
 */
export const LinkField = forwardRef<
  LinkFieldHandle,
  { self: Item; value: string; placeholder: string; className?: string; onChange: (md: string) => void; onPaste?: (e: ClipboardEvent) => void }
>(function LinkField({ self, value, placeholder, className, onChange, onPaste }, handle) {
  const { items } = useContext(Cards);
  const root = useRef<HTMLDivElement>(null);
  // the text the field holds, as last read or written: a value that differs came from outside
  const held = useRef<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [found, setFound] = useState<{ search: CardSearch; place?: Place } | null>(null);
  const [marked, setMarked] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!root.current || value === held.current) return;
    held.current = value;
    fill(root.current, value, items);
  }, [value]);
  // the pills follow their cards: a new title, another state or priority
  useEffect(() => {
    for (const el of root.current?.querySelectorAll<HTMLElement>('[data-href]') ?? []) dress(el, referenced(items, el.dataset.href!));
  }, [items]);
  const lookAtCursor = () => {
    const el = root.current;
    const at = el && searchAt(el);
    if (!el || !at) {
      setFound(null);
      return setDismissed(null);
    }
    setFound((f) => (f?.search.start === at.search.start && f.search.query === at.search.query ? f : { search: at.search, place: menuPlace(el, at.node, at.offset - at.search.query.length - 1) }));
  };
  const read = () => {
    const el = root.current;
    if (!el) return;
    const md = textOf(el).slice(0, 20000);
    if (md !== held.current) {
      held.current = md;
      onChange(md);
    }
    lookAtCursor();
  };
  useEffect(() => setMarked(0), [found?.search.query]);
  useImperativeHandle(handle, () => ({
    el: root.current,
    type: (s) => void document.execCommand('insertText', false, s),
    focusEnd: () => {
      const el = root.current;
      if (!el) return;
      el.focus();
      getSelection()?.selectAllChildren(el);
      getSelection()?.collapseToEnd();
    },
  }));
  const menu = focused && found && dismissed !== found.search.start ? matchingCards(items, found.search.query, self.id) : [];
  const pick = (card: Item) => {
    const el = root.current;
    const at = el && searchAt(el);
    if (!el || !at) return;
    // put in by hand: the browser's insertHTML lifts a pill out of its line
    const r = document.createRange();
    r.setStart(at.node, at.offset - at.search.query.length - 1);
    r.setEnd(at.node, at.offset);
    r.deleteContents();
    const space = document.createTextNode('\u00a0');
    r.insertNode(space);
    r.insertNode(pill(cardPath(projectOf(card.id), card), linkText(card.title), card));
    // the cursor after the space after it
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.collapse(space, 1);
    usedCardRefs();
    read();
  };
  return (
    <>
      <div
        ref={root}
        className={[className, !value && 'blank'].filter(Boolean).join(' ')}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-placeholder={placeholder}
        data-placeholder={placeholder}
        // while the menu is open, Escape closes it, not the card
        data-esc={menu.length > 0 || undefined}
        onInput={read}
        onKeyUp={(e) => {
          if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') lookAtCursor();
        }}
        onMouseUp={lookAtCursor}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPaste={(e) => {
          onPaste?.(e);
          if (e.defaultPrevented) return;
          // only the words: a page's formatting has no place in the task
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
        onKeyDown={(e) => {
          const n = menu.length;
          if (!n || !found || e.nativeEvent.isComposing) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            setDismissed(found.search.start);
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setMarked((m) => (m + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
          } else if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
            e.preventDefault();
            pick(menu[Math.min(marked, n - 1)]!);
          }
        }}
      />
      {menu.length > 0 && <CardMenu cards={menu} marked={marked} onPick={pick} at={found?.place} />}
      {focused && !menu.length && !knowsCardRefs() && <p className="c-listener card-refs-hint">{t.cardRefs.hint}</p>}
    </>
  );
});

/** The cards that fit the search, the marked one picked with Enter or Tab, another with the arrow keys or a click; `at`: where it stands in the field's frame. */
function CardMenu({ cards, marked, onPick, at }: { cards: Item[]; marked: number; onPick: (card: Item) => void; at?: Place }) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.children[marked]?.scrollIntoView({ block: 'nearest' });
  }, [marked, cards]);
  return (
    <div className="skill-menu card-menu" role="listbox" aria-label={t.cardRefs.menu} style={at}>
      <ul ref={list}>
        {cards.map((c, i) => (
          <li key={c.id} role="option" aria-selected={i === marked} className={i === marked ? 'on' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c)}>
            {/* a click on it picks the card rather than opening it */}
            <span className="cm-pill">
              <SmartLink href={cardPath(projectOf(c.id), c)} text={c.title} />
            </span>
            {c.short && <span className="cm-code">{c.short}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
