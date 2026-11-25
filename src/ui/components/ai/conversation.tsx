







import { ArrowDown } from 'lucide-react';
import { cn } from 'cn';
import type { ComponentProps, Ref } from 'react';
import { useEffect, useRef } from 'react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import { t } from '../../strings';
import { IconButton } from '../button';

export type ConversationProps = Omit<ComponentProps<typeof StickToBottom>, 'children' | 'ref'> & {
  
  boxRef?: Ref<HTMLDivElement>;
  
  said?: unknown;
  
  entries?: unknown;
  
  start?: (box: HTMLElement) => HTMLElement | null;
  
  contentClassName?: string;
  
  scrolling?: boolean;
  children?: React.ReactNode;
};

export function Conversation({ className, boxRef, said, entries, start, contentClassName, scrolling = true, children, ...props }: ConversationProps) {
  if (!scrolling) {
    return (
      <div ref={boxRef} className={cn('relative', className)} role="log">
        <div className={contentClassName}>{children}</div>
      </div>
    );
  }
  return (
    <StickToBottom
      
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
