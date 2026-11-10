// AI Elements' Message, ours from here on: one turn of a conversation as a bubble, on a card, in a chat
// and in the Koordinator's sheet alike. `from` places it (the owner's, `user`, on the right) and
// `MessageHead` heads it with who said it; `MessageActions` hold the buttons in its corner (reply,
// take back), which show while the pointer is on the message and always on a touch screen. What a kind
// of message adds (a question, the agent at work, an unread note) is the class `className` gives it,
// styled in `styles.css`.

import { cn } from 'cn';
import { Reply, Trash2 } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { t } from '../../strings';
import { IconButton } from '../button';

/** Who a message is from: `user` the owner, `assistant` anyone else (an agent, Seismic, the plan). */
export type MessageFrom = 'user' | 'assistant';

export function Message({ className, from, ...props }: ComponentProps<'div'> & { from: MessageFrom }) {
  return (
    <div
      data-slot="message"
      className={cn(
        'group relative flex-none max-w-[92%] rounded-xl border border-glass-edge bg-card px-3 py-2 shadow-[var(--shadow)]',
        from === 'user' ? 'is-user self-end bg-[color-mix(in_srgb,var(--working)_9%,var(--card))]' : 'is-assistant',
        className,
      )}
      {...props}
    />
  );
}

/** The colour of who said it, by the author's kind. */
const author: Record<string, string> = {
  owner: 'text-working',
  worker: 'text-ink',
  koordinator: 'text-muted-foreground',
  plan: 'text-muted-foreground',
  proposal: 'text-muted-foreground',
};

/**
 * A message's head: who said it, the agent's harness and model, and when; `children` (a button at the
 * right, "Make it a card") stays in view. `actions`: how many buttons `MessageActions` puts in the corner, whose room it leaves.
 */
export function MessageHead({ by, actions = 0, children }: { by: string; actions?: number; children?: ReactNode }) {
  return (
    <div className={cn('who text-[11px] font-semibold', author[by] ?? 'text-idea', actions === 1 && 'pr-6', actions > 1 && 'pr-[52px]')}>
      {children}
    </div>
  );
}

/** Who said it in `MessageHead`: the agent's model beside it, then the time. */
export const MessageMeta = ({ className, ...props }: ComponentProps<'span'>) => (
  <span className={cn('inline-block font-normal text-muted-foreground', className)} {...props} />
);

/** The buttons in a message's corner. */
export function MessageActions({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('msg-actions absolute top-1 right-1 flex items-center gap-1', className)} {...props} />;
}

/** One of them: it keeps the cursor where it was in the field (a mouse down does not take the focus). */
export function MessageAction({ className, ...props }: ComponentProps<typeof IconButton>) {
  return (
    <IconButton
      size="small"
      className={cn(
        'size-[26px] rounded-[3px] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-75',
        className,
      )}
      onMouseDown={(e) => e.preventDefault()}
      {...props}
    />
  );
}

export const ReplyAction = ({ onClick }: { onClick: () => void }) => (
  <MessageAction icon={<Reply size={15} strokeWidth={2} aria-hidden="true" />} label={t.talk.reply} className="bg-chip" onClick={onClick} />
);

export const DeleteAction = ({ onClick, label }: { onClick: () => void; label?: string }) => (
  <MessageAction icon={<Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />} label={label ?? t.delete} variant="danger" className="[@media(hover:hover)]:opacity-100" onClick={onClick} />
);
