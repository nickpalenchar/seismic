// Seismic's chats, in the head of its conversation (the sheet, the phone's panel): the button at the
// left slides out the earlier chats, this project's or every project's, the one at the right starts
// a new chat. What the owner says goes into the chat open now; the Koordinator remembers that one.

import { Menu, SquarePen, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from 'cn';
import type { Chat, ChatElsewhere, Talk } from '../core/types';
import { api } from './api';
import { plain } from './markdown';
import { useStoredState } from './stored';
import { clock, failText, shortDay, t } from './strings';
import { SegmentedControl } from './components/segmented';
import { Tooltip } from './components/tooltip';

interface Props {
  /** The heading between the two buttons. */
  title: ReactNode;
  project: string;
  /** The project's name, on the switch to its own chats. */
  projectName: string;
  /** The chat open now, the project's chats with something said in them, and what the sheet holds (answers unread in other chats among it). */
  chat: number;
  chats: Chat[];
  talk: Talk[];
  /** A chat of another project was opened there: show that project's conversation. */
  onProject: (project: string) => void;
  /** The sheet's close button, at the head's right end. */
  onClose?: () => void;
}

export function ChatsHead({ title, project, projectName, chat, chats, talk, onProject, onClose }: Props) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useStoredState('obeya-chats-all', false);
  const [every, setEvery] = useState<ChatElsewhere[] | null>(null);
  const [error, setError] = useState('');
  const drawer = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  // nothing said in the chat open now: a new one would be the same
  const fresh = !talk.some((x) => x.chat === chat) && !chats.some((c) => c.id === chat);
  const waiting = talk.filter((x) => x.unread && x.chat !== chat).length;

  useEffect(() => {
    if (!open || !all) return;
    let gone = false;
    api.everyChat().then(
      (x) => !gone && setEvery(x),
      (e) => !gone && setError(failText(e)),
    );
    return () => void (gone = true);
  }, [open, all, chats]);
  useEffect(() => {
    if (!open) return;
    setError('');
    // the sheet may have scrolled down to its sections: the list stands over all of it from its top
    drawer.current?.closest('.sheet')?.scrollTo({ top: 0 });
    drawer.current?.querySelector<HTMLElement>('.chat-row.on, .chat-row')?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open]);

  const go = (c: Chat) => {
    if (c.id === chat && c.project === project) return setOpen(false);
    api.openChat(c.id, c.project === project ? undefined : c.project).then(
      () => {
        setOpen(false);
        if (c.project !== project) onProject(c.project);
      },
      (e) => setError(failText(e)),
    );
  };
  const start = () => {
    setOpen(false);
    api.newChat().catch(console.error);
  };
  const shown: (Chat & { projectName?: string })[] = all ? (every ?? []) : chats;

  return (
    // on the phone the head is the panel's grip: a press on it drags the panel, one on its buttons does not
    <div className={headClass} ref={head}>
      <Tooltip content={waiting ? `${t.koordinator.chatsOpen} · ${t.koordinator.unreadCount(waiting)}` : t.koordinator.chatsOpen}>
        <button
            className={cn(btnClass, waiting > 0 && "waits after:content-[''] after:absolute after:top-[5px] after:right-[5px] after:size-2 after:rounded-[50%] after:bg-waiting")} aria-label={t.koordinator.chatsOpen}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
        >
          <Menu size={18} />
        </button>
      </Tooltip>
      {title}
      <Tooltip content={t.koordinator.newChatHint}>
        <button className={cn(btnClass, 'chats-new')} aria-label={t.koordinator.newChat} disabled={fresh} onClick={start}>
          <SquarePen size={17} />
        </button>
      </Tooltip>
      {onClose && (
        <Tooltip content={t.koordinator.chatsClose}>
          <button className={btnClass} aria-label={t.koordinator.chatsClose} onClick={onClose}>
            <X size={17} />
          </button>
        </Tooltip>
      )}
      {open &&
        head.current?.closest('.sheet, .ph-panel') &&
        createPortal(
          // a portal's events bubble through the head to the panel's grip: a press in the list is no drag
          <div className="chats-layer contents" onPointerDown={(e) => e.stopPropagation()}>
            <div className="chats-scrim absolute inset-0 z-30 bg-dim animate-[fade_.2s_ease-out]" onClick={() => setOpen(false)} />
            <div className={drawerClass} ref={drawer} role="dialog" aria-label={t.koordinator.chats}>
              <div className="chats-top flex items-center justify-between pl-1.5 text-[16px]">
                <b>{t.koordinator.chats}</b>
                <Tooltip content={t.koordinator.chatsClose}>
                  <button className={btnClass} aria-label={t.koordinator.chatsClose} onClick={() => setOpen(false)}>
                    <X size={17} />
                  </button>
                </Tooltip>
              </div>
              <SegmentedControl
                className="chats-scope flex p-0.5 rounded-[4px] [&_small]:text-[10px] [&_small]:font-normal [&_small]:text-muted-foreground"
                itemClassName="chats-scope-item flex-1 py-1.5 px-2 rounded-[3px] flex flex-col items-center justify-center min-w-0 data-[state=on]:font-semibold"
                label={t.koordinator.chats}
                value={all ? 'all' : 'here'}
                onValueChange={(x) => setAll(x === 'all')}
                options={[
                  {
                    value: 'here',
                    label: (
                      <>
                        <span className="chats-scope-name max-w-full overflow-hidden text-ellipsis whitespace-nowrap">{projectName}</span>
                        <small>{t.koordinator.chatsHere}</small>
                      </>
                    ),
                  },
                  { value: 'all', label: t.koordinator.chatsAll },
                ]}
              />
              <ul className="chats-list list-none m-0 p-0 flex flex-col gap-0.5">
                {fresh && !all && (
                  <li>
                    <button className={cn(rowClass, onClass)} onClick={() => setOpen(false)}>
                      <span className={titleClass}>{t.koordinator.newChat}</span>
                      <span className={metaClass}>{t.koordinator.chatNow}</span>
                    </button>
                  </li>
                )}
                {shown.map((c) => (
                  <li key={c.id}>
                    <button className={cn(rowClass, c.id === chat && c.project === project && onClass)} onClick={() => go(c)}>
                      <span className={cn(titleClass, !c.title && 'by-obeya text-muted-foreground italic')}>{c.title ? plain(c.title) : t.koordinator.chatByObeya}</span>
                      <span className={metaClass}>
                        {when(c.at)}
                        {c.projectName && ` · ${c.projectName}`}
                        {c.unread ? (
                          <span className="chat-unread ml-auto min-w-[18px] py-px px-1.5 rounded-[9px] bg-waiting text-on-ink text-[11px] font-semibold text-center" title={t.koordinator.unreadCount(c.unread)}>
                            {c.unread}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {!shown.length && !(fresh && !all) && (all ? every !== null : true) && <p className="hint">{t.koordinator.chatsEmpty}</p>}
              {error && <p className="p-error">{error}</p>}
            </div>
          </div>,
          head.current.closest('.sheet, .ph-panel')!,
        )}
    </div>
  );
}

/**
 * The head: in the sheet over the conversation, with the sheet's title between the buttons; on the phone the
 * panel's bar, with the word between them and larger buttons for a finger.
 */
const headClass =
  'chats-head flex items-center gap-1.5 [.sheet>&]:mt-0 [.sheet>&]:mx-0 [.sheet>&]:mb-2 [.sheet>&_h2]:m-0 [.sheet>&_h2]:flex-1 [.sheet>&_h2]:min-w-0 [.ph-bar_&]:flex-1 [.ph-bar_&]:min-w-0 [.ph-bar_&]:gap-2 [.ph-bar_&_.ph-word]:flex-1 [.ph-bar_&_.ph-word]:min-w-0';
/** Its buttons, the icon alone; with a dot while an answer waits in another chat. */
const btnClass =
  'chats-btn inline-flex items-center justify-center relative size-8 flex-none p-0 [border:0] rounded-[3px] bg-transparent text-muted-foreground cursor-pointer hover:not-disabled:bg-chip hover:not-disabled:text-ink disabled:opacity-40 disabled:cursor-default [.ph-bar_&]:size-10';
/** The earlier chats, slid out from the left over the sheet or the panel. */
const drawerClass =
  'chats-drawer absolute top-0 bottom-0 left-0 z-31 w-[min(320px,86%)] flex flex-col gap-2.5 pt-4 px-3 pb-[calc(16px+env(safe-area-inset-bottom))] bg-panel border-r border-r-line [box-shadow:var(--lift)] overflow-y-auto overscroll-contain animate-[chats-in_.25s_cubic-bezier(.3,.9,.3,1)] text-[14px] [&_.hint]:[margin:4px_6px]';
/** A chat in the list; the one open now tinted. */
const rowClass = 'chat-row flex flex-col items-stretch gap-[3px] w-full py-2 px-2.5 [border:0] rounded-[4px] bg-transparent text-ink text-left cursor-pointer hover:bg-chip';
const onClass = 'on bg-[color-mix(in_srgb,var(--working)_14%,transparent)]!';
const titleClass = 'chat-title overflow-hidden text-ellipsis whitespace-nowrap';
const metaClass = 'chat-meta flex items-center gap-1.5 text-[12px] text-muted-foreground';

/** When a chat was last talked in: the time today, else the day. */
const when = (at: string) => (new Date(at).toDateString() === new Date().toDateString() ? clock(at) : shortDay(at));
