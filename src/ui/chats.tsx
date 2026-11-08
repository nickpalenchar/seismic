// Seismic's chats, in the head of its conversation (the sheet, the phone's panel): the button at the
// left slides out the earlier chats, this project's or every project's, the one at the right starts
// a new chat. What the owner says goes into the chat open now; the Koordinator remembers that one.

import { Menu, SquarePen, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Chat, ChatElsewhere, Talk } from '../core/types';
import { api } from './api';
import { plain } from './markdown';
import { useStoredState } from './stored';
import { clock, failText, shortDay, t } from './strings';

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
    <div className="chats-head" ref={head}>
      <button
        className={['chats-btn', waiting > 0 && 'waits'].filter(Boolean).join(' ')}
        title={waiting ? `${t.koordinator.chatsOpen} · ${t.koordinator.unreadCount(waiting)}` : t.koordinator.chatsOpen}
        aria-label={t.koordinator.chatsOpen}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Menu size={18} />
      </button>
      {title}
      <button className="chats-btn chats-new" title={t.koordinator.newChatHint} aria-label={t.koordinator.newChat} disabled={fresh} onClick={start}>
        <SquarePen size={17} />
      </button>
      {onClose && (
        <button className="chats-btn" title={t.koordinator.chatsClose} aria-label={t.koordinator.chatsClose} onClick={onClose}>
          <X size={17} />
        </button>
      )}
      {open &&
        head.current?.closest('.sheet, .ph-panel') &&
        createPortal(
          // a portal's events bubble through the head to the panel's grip: a press in the list is no drag
          <div className="chats-layer" onPointerDown={(e) => e.stopPropagation()}>
            <div className="chats-scrim" onClick={() => setOpen(false)} />
            <div className="chats-drawer" ref={drawer} role="dialog" aria-label={t.koordinator.chats}>
              <div className="chats-top">
                <b>{t.koordinator.chats}</b>
                <button className="chats-btn" title={t.koordinator.chatsClose} aria-label={t.koordinator.chatsClose} onClick={() => setOpen(false)}>
                  <X size={17} />
                </button>
              </div>
              <div className="chats-scope" role="radiogroup">
                <button role="radio" aria-checked={!all} className={!all ? 'on' : undefined} onClick={() => setAll(false)}>
                  <span className="chats-scope-name">{projectName}</span>
                  <small>{t.koordinator.chatsHere}</small>
                </button>
                <button role="radio" aria-checked={all} className={all ? 'on' : undefined} onClick={() => setAll(true)}>
                  {t.koordinator.chatsAll}
                </button>
              </div>
              <ul className="chats-list">
                {fresh && !all && (
                  <li>
                    <button className="chat-row on" onClick={() => setOpen(false)}>
                      <span className="chat-title">{t.koordinator.newChat}</span>
                      <span className="chat-meta">{t.koordinator.chatNow}</span>
                    </button>
                  </li>
                )}
                {shown.map((c) => (
                  <li key={c.id}>
                    <button className={['chat-row', c.id === chat && c.project === project && 'on'].filter(Boolean).join(' ')} onClick={() => go(c)}>
                      <span className={c.title ? 'chat-title' : 'chat-title by-obeya'}>{c.title ? plain(c.title) : t.koordinator.chatByObeya}</span>
                      <span className="chat-meta">
                        {when(c.at)}
                        {c.projectName && ` · ${c.projectName}`}
                        {c.unread ? (
                          <span className="chat-unread" title={t.koordinator.unreadCount(c.unread)}>
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

/** When a chat was last talked in: the time today, else the day. */
const when = (at: string) => (new Date(at).toDateString() === new Date().toDateString() ? clock(at) : shortDay(at));
