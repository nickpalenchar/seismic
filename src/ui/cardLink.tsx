// A card named in a text (what a queued card waits for, the card a follow-up comes from): a link
// that opens it in place of what is open, as long as it is on the project. Its address is the card's,
// so a click with a modifier opens it in a tab of its own.
import { useContext } from 'react';
import type { Item } from '../core/types';
import { cardPath } from './address';
import { projectOf } from './api';
import { cardHref, referenced } from './cardRefs';
import { plain } from './markdown';
import { Cards } from './message';
import { PriorityMark } from './labels';
import { stateLabel } from './strings';

/** The card by `title` (its own by default); plain text where it is not on the project. `onOpen` in place of the `Cards` around it. */
export function CardLink({ card, title, onOpen, className = 'link card-link' }: { card: Item | undefined; title?: string; onOpen?: (i: Item) => void; className?: string }) {
  const cards = useContext(Cards);
  const text = plain(title ?? card?.title ?? '');
  // an archived card is not on the project to unfold from
  if (!card || card.archivedAt) return <>{text}</>;
  return (
    <a
      className={className}
      href={cardPath(projectOf(card.id), card)}
      onClick={(e) => {
        if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        (onOpen ?? cards.open)(card);
      }}
    >
      {text}
    </a>
  );
}

const MARK = '\u0000';

/** A sentence of the strings that names cards: `text` gets a mark for each name, which becomes the card's link. */
export function Naming({ text, cards, onOpen }: { text: (...names: string[]) => string; cards: { card: Item | undefined; title?: string }[]; onOpen?: (i: Item) => void }) {
  const parts = text(...cards.map((_, k) => `${MARK}${k}${MARK}`)).split(MARK);
  // the parts alternate: text, the number of a name, text, …
  return (
    <>
      {parts.map((x, k) => {
        if (k % 2 === 0) return x;
        const c = cards[Number(x)]!;
        return <CardLink key={k} card={c.card} title={c.title} onOpen={onOpen} />;
      })}
    </>
  );
}

/**
 * A card a text links to, as a smart link: a pill with a dot in the colour of its state, its title
 * as it is now and its priority where it has one, its state line as tooltip. A click opens the card
 * as `CardLink` does. A card not on the project (archived, deleted, on another project) keeps the
 * link's text, muted. Further facts a card comes to have may join the pill.
 */
export function SmartLink({ href, text }: { href: string; text: string }) {
  const cards = useContext(Cards);
  const card = referenced(cards.items, href);
  if (!card || card.archivedAt || projectOf(card.id) !== cardHref(href)?.project) {
    return (
      <span className="smart-link gone">
        <span className="sl-dot" />
        <span className="sl-title">{plain(text)}</span>
      </span>
    );
  }
  return (
    <a
      className={`smart-link s-${card.state}`}
      href={cardPath(projectOf(card.id), card)}
      title={stateLabel(card)}
      onClick={(e) => {
        if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        cards.open(card);
      }}
    >
      <span className="sl-dot" />
      <span className="sl-title">{plain(card.title || text)}</span>
      {card.priority && <PriorityMark priority={card.priority} />}
    </a>
  );
}

/** For `CardRefs`: a link to a card's address as a smart link, null for any other. */
export const smartLink = (href: string, text: string) => (cardHref(href) ? <SmartLink href={href} text={text} /> : null);
