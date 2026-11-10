// AI Elements' Conversation (use-stick-to-bottom underneath), ours from here on: the scrolling box of a
// conversation, on a card, in a chat and in the Koordinator's sheet alike. At its end it stays there as
// the conversation grows (a new message, an agent's next step, a comment's video frame loading, text
// wrapping anew once the font is in); scrolled up to read further back, the owner stays where they are
// and a button takes them to the latest message. What the owner says (`said` changing) takes the box to
// its end; `start` names the message the box opens at instead, once its content is in, and it stays
// there until the owner scrolls or says something.

import { ArrowDown } from 'lucide-react';
import { cn } from 'cn';
import type { ComponentProps, Ref } from 'react';
import { useEffect, useRef } from 'react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import { t } from '../../strings';
import { IconButton } from '../button';

export type ConversationProps = Omit<ComponentProps<typeof StickToBottom>, 'children' | 'ref'> & {
  /** The box's own element, which marked text is measured against (`CiteButton`). */
  boxRef?: Ref<HTMLDivElement>;
  /** Changes when the owner says something: the box goes to its end. */
  said?: unknown;
  /** What the box shows (messages, steps), which is in once it is not empty. */
  entries?: unknown;
  /** The message the box opens at instead of its end, once its content is in. */
  start?: (box: HTMLElement) => HTMLElement | null;
  /** Classes of the content, the column the messages stand in. */
  contentClassName?: string;
  children?: React.ReactNode;
};

export function Conversation({ className, boxRef, said, entries, start, contentClassName, children, ...props }: ConversationProps) {
  return (
    <StickToBottom
      // the library spreads its props onto the box's div, `ref` included (its types leave it out)
      {...({ ref: boxRef } as object)}
      className={cn('relative min-h-0 overflow-hidden', className)}
      initial="instant"
      resize="smooth"
      role="log"
      {...props}
    >
      <StickToBottom.Content className={contentClassName} scrollClassName="min-h-0 flex-1 [scrollbar-gutter:stable]">{children}</StickToBottom.Content>
      <Follow said={said} entries={entries} start={start} />
      <ConversationScrollButton />
    </StickToBottom>
  );
}

/** What the owner's words and the opening message ask of the box that stick-to-bottom does not do by itself. */
function Follow({ said, entries, start }: Pick<ConversationProps, 'said' | 'entries' | 'start'>) {
  const { scrollRef, scrollToBottom, stopScroll } = useStickToBottomContext();
  const seen = useRef(said);
  useEffect(() => {
    if (said === seen.current) return;
    seen.current = said;
    void scrollToBottom('instant');
  }, [said]);
  const started = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!entries || started.current || !el) return;
    started.current = true;
    const anchor = start?.(el);
    if (!anchor) return;
    // at its top as far as the box scrolls; the initial move to the end comes first, so this goes after it
    stopScroll();
    const place = () => {
      if (anchor.isConnected) el.scrollTop += anchor.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
    };
    place();
    requestAnimationFrame(place);
  }, [entries]);
  return null;
}

/** Shows while the conversation is scrolled up from its end: one click to the latest message. */
export function ConversationScrollButton({ className, ...props }: Partial<ComponentProps<typeof IconButton>>) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <IconButton
      icon={<ArrowDown size={16} strokeWidth={2} aria-hidden="true" />}
      label={t.talk.toLatest}
      className={cn('absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-background shadow-[var(--shadow)]', className)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => void scrollToBottom()}
      {...props}
    />
  );
}
