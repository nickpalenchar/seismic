// The phone view: on a phone the page shows, instead of the project, the Agents view across every
// project, with the desktop sheet's tabs: "All" (the cards by stage, what needs the owner first as the
// inbox lists it, and "Done" for what is finished but not archived, hidden until its chip is tapped),
// "Queue", "Parked" and "Activity"; Seismic's conversation is a panel of its own that
// comes up from below. A card opens full screen with the project's own detail view (answer options,
// demo, approve buttons), its conversation in the same panel, and Back returns to the list. The microphone is held by touch; Enter breaks the line, only Send sends;
// the list itself has a plus button in the microphone's place, which makes a card and opens it (the microphone is back with a panel open);
// what was typed but not sent survives a reload. It holds one WebSocket per project.

import { ChevronLeft, Plus } from 'lucide-react';
import { useRatePrompt } from './feedback';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type ProjectInfo, type ProjectSnapshot, type CardPatch, finishedArchivable, inParkingLot, type Item, nameless, needsYou, openQuestions, unreadAnswers, type Usage, snoozeOf } from '../core/types';
import { AGENT_STAGES, agentStage } from '../core/agents';
import { AgentsTabs, StageChips, useAgentsTab } from './agents';
import { ActivityTab } from './activity';
import { QueueList, useQueueSort } from './queue';
import { useStoredState } from './stored';
import { ChatsHead } from './chats';
import { api, beforeReload, cardsOn, onNotice, phoneInUse, setProject, useProject, type Where } from './api';
import { enterBreaksLines } from './composer';
import { InboxList, when } from './inbox';
import { inboxEntries, readMark } from '../core/inbox';
import { useInboxRead } from './inboxRead';
import { sendReply } from './quickReply';
import { type ActDone, Detail, type Pending, TalkElsewhere, useEvents } from './detail';
import { cardDraft, fieldOn, focusedDraft, keepDrafts, MIC_DRAFT, obeyaDraft } from './draft';
import { KoordinatorTalk } from './koordinator';
import { Sign } from './logo';
import { Notify, registerWorker } from './notify';
import { plain } from './markdown';
import { Cards, KoordinatorAgent } from './message';
import { glide, type Mark, settle, speed, THROWN, thrown } from './panelHeight';
import { CardFace, cardClass, shownState } from './card';
import { TalkIcon } from './parts';
import { videoOf } from './spot';
import { failText, forTouch, t } from './strings';
import { UsagePill } from './usage';
import { agentWorks, beingWritten, cardTalk, koordinatorReads, obeyaWorks, opensWithTalk, runs, unseen } from './talk';
import { seenOf } from './seen';
import { noticeLine, tellers, useAck, useWarnings } from './tell';
import { Toasts, useToasts } from './components/toast';
import { HoldToTalk, PushToTalk, usePushToTalk, useTold } from './voice';
import { projectPath, cardPath, named, knowProjects, projectNamed, queryWithout, readAddress } from './address';
import { scrollBehavior } from './motion';

/**
 * Whether the page shows the phone view: on a phone, which has a coarse pointer and a short side
 * under 600 px whichever way it is held (a tablet and a narrow window at the desk keep the project).
 * `?view=phone` or `?view=project` in the address decides instead.
 */
export function phoneView(): boolean {
  const asked = new URLSearchParams(location.search).get('view');
  if (asked === 'phone' || asked === 'project') return asked === 'phone';
  return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
}

/** The phone view keeps its drafts apart from any project's: it shows every project. */
const DRAFTS = '@phone';
/** The project whose Seismic the conversation at the bottom is with, as the owner last picked it. */
const OBEYA_PROJECT = 'obeya-phone-project';
/** The stages "All" groups the cards by on the phone: the desktop's, then the finished cards not archived yet. */
const PHONE_STAGES = [...AGENT_STAGES, 'done'] as const;
type PhoneStage = (typeof PHONE_STAGES)[number];
/** How long the server may not answer before the view says so: a phone back from its lock screen reconnects within this. */
const QUIET_MS = 3000;
/** How long a frozen server may stay silent before the banner names the time it went quiet. */
const UNRESPONSIVE_MS = 150_000;

/** The card the address names, by its code or its id. */
const cardInAddress = () => readAddress().card ?? null;
const talkInAddress = () => new URLSearchParams(location.search).has('talk');
/** What a step in the browser's history opened: a card, or the conversation of what is in view. */
type Step = 'card' | 'talk';
/** The open card's demo video, on its page. */
const pageVideo = () => document.querySelector<HTMLVideoElement>('#ph-card .demo-view video');

/** The kinds of input the keyboard comes up for; a date or a time opens the phone's own picker instead. */
const TYPED = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** Whether the element is a text field: one the keyboard comes up for. */
const typesText = (el: unknown): el is HTMLTextAreaElement | HTMLInputElement =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TYPED.has(el.type));

/** How much shorter than the tallest seen the screen gets while the keyboard is up; a browser's bars sliding in and out take less. */
const KEYBOARD_PX = 150;

/**
 * Marks the page while the keyboard is up (`ph-kb` on the root): a text field has the focus and the
 * height the page has is well below the tallest it had at this width. The keyboard closed with the
 * phone's own button leaves the focus in the field, so the focus alone does not tell (until
 * 2026-10-17 it did, and the microphone stayed hidden after that).
 */
function watchKeyboard() {
  const vv = window.visualViewport;
  const tallest = new Map<number, number>();
  const check = () => {
    const h = vv?.height ?? innerHeight;
    const w = Math.round(innerWidth);
    const top = Math.max(tallest.get(w) ?? 0, h);
    tallest.set(w, top);
    document.documentElement.classList.toggle('ph-kb', typesText(document.activeElement) && h < top - KEYBOARD_PX);
  };
  check();
  vv?.addEventListener('resize', check);
  addEventListener('resize', check);
  addEventListener('focusin', check);
  addEventListener('focusout', check);
  return () => {
    vv?.removeEventListener('resize', check);
    removeEventListener('resize', check);
    removeEventListener('focusin', check);
    removeEventListener('focusout', check);
    document.documentElement.classList.remove('ph-kb');
  };
}

/** Longer than this, or moved further, a touch is no tap: a long press selects, a swipe scrolls. */
const TAP_MS = 400;
const TAP_PX = 10;

/**
 * A tap into a text field while the keyboard is down only puts the cursor where the finger was and
 * brings the keyboard up. Left to Chrome, a tap on a word marked misspelled also opened its menu of
 * suggestions, and on the phone that closed the keyboard it had just begun to open. With the
 * keyboard up the tap is Chrome's again, and the suggestions open above it.
 */
function tapOpensKeyboard() {
  let down: { x: number; y: number; at: number; field: HTMLTextAreaElement | HTMLInputElement } | null = null;
  const start = (e: TouchEvent) => {
    const field = e.target instanceof Element ? e.target.closest('textarea, input') : null;
    const finger = e.touches[0];
    down =
      finger && e.touches.length === 1 && typesText(field) && !field.readOnly && !field.disabled && !document.documentElement.classList.contains('ph-kb')
        ? { x: finger.clientX, y: finger.clientY, at: e.timeStamp, field }
        : null;
  };
  const end = (e: TouchEvent) => {
    const tap = down;
    down = null;
    const finger = e.changedTouches[0];
    if (!tap || !finger || e.touches.length || e.timeStamp - tap.at > TAP_MS) return;
    if (Math.hypot(finger.clientX - tap.x, finger.clientY - tap.y) > TAP_PX) return;
    e.preventDefault();
    const { field } = tap;
    const at = document.caretPositionFromPoint?.(finger.clientX, finger.clientY);
    // the keyboard closed with the phone's own button left the focus in the field: focusing it anew brings the keyboard up
    if (document.activeElement === field) field.blur();
    field.focus();
    if (at?.offsetNode === field) field.setSelectionRange(at.offset, at.offset);
  };
  addEventListener('touchstart', start, { capture: true, passive: true });
  addEventListener('touchend', end, { capture: true, passive: false });
  return () => {
    removeEventListener('touchstart', start, { capture: true });
    removeEventListener('touchend', end, { capture: true });
  };
}

/** When something began: the time today, else the day. */

export function Phone({ projects: loaded }: { projects: ProjectInfo[] }) {
  keepDrafts(sessionStorage, DRAFTS);
  useState(() => {
    forTouch();
    enterBreaksLines();
    phoneInUse();
  });
  useEffect(watchKeyboard, []);
  useEffect(tapOpensKeyboard, []);
  const [projects, setProjects] = useState(loaded);
  // the projects it last had, while the server did not answer: the list the server sends once it does
  useEffect(() => setProjects(loaded), [loaded]);
  knowProjects(projects);
  const [snaps, setSnaps] = useState<Record<string, ProjectSnapshot>>({});
  const snapsRef = useRef(snaps);
  snapsRef.current = snaps;
  const [offline, setOffline] = useState<Record<string, number | null>>({});
  // the projects whose connection is open but answers nothing
  const [frozen, setFrozen] = useState<Record<string, boolean>>({});
  // the plan's usage limits, the same over every project's connection
  const [usage, setUsage] = useState<Usage | null>(null);
  const feed = (id: string, live: ReturnType<typeof useProject>) => {
    setUsage(live.usage);
    if (live.snapshot) setSnaps((s) => (s[id] === live.snapshot ? s : { ...s, [id]: live.snapshot! }));
    // a socket that is open but answers nothing (frozen) counts as not answering, like a lost one
    const down = live.offlineSince ?? live.frozenSince;
    setOffline((o) => (o[id] === down ? o : { ...o, [id]: down }));
    const isFrozen = live.offlineSince === null && live.frozenSince !== null;
    setFrozen((f) => (f[id] === isFrozen ? f : { ...f, [id]: isFrozen }));
    if (live.projects) setProjects(live.projects);
  };

  // ---------------------------------------------------------------- what is open
  const [open, setOpenState] = useState<string | null>(cardInAddress);
  /**
   * The address with `card` open on its project (or the project of Seismic's conversation with none),
   * and that conversation open or not, keeping what else it holds (`?view=phone`, say).
   */
  const addressWith = ({ card, talk }: { card: string | null; talk: boolean }) => {
    const x = card ? allRef.current.find((c) => c.item.id === card) : undefined;
    // a card not known yet (the snapshots still on their way) keeps the address that named it
    const path = !card ? projectPath(obeyaRef.current) : x ? cardPath(x.project.id, x.item) : location.pathname;
    const q = queryWithout(location.search, 'c', 'card', 'talk');
    return `${path}${talk ? (q ? `${q}&talk` : '?talk') : q}`;
  };
  /** The id of the card a code names, once the snapshots hold it. */
  const resolve = (code: string | null) => (code && named(allRef.current.map((x) => x.item), code)?.id) || code;
  const openRef = useRef(open);
  openRef.current = open;
  // the conversation of what is in view, a panel over it: the open card's, else Seismic's
  const [talk, setTalk] = useState(talkInAddress);
  const talkRef = useRef(talk);
  talkRef.current = talk;
  /** Closes the open panel as dragging it down does, sliding out. */
  const leaveTalk = useRef<(() => void) | null>(null);
  // the panel sliding out: the button offers it again at once
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!talk) setClosing(false);
  }, [talk]);
  // opening a card or the panel is a step in the browser's history: its Back (or the swipe) closes it
  // again. Each entry holds the steps that led to it, the latest last, so they hold after Back,
  // Forward and a reload alike.
  const steps = (): Step[] => (history.state as { steps?: Step[] } | null)?.steps ?? [];
  const step = (what: Step, to: { card: string | null; talk: boolean }) => history.pushState({ steps: [...steps(), what] }, '', addressWith(to));
  /** Back from `what`: the browser's own step back where this page pushed it, else the address without it. */
  const stepBack = (what: Step, to: { card: string | null; talk: boolean }) => {
    if (steps().at(-1) === what) return history.back();
    history.replaceState(history.state, '', addressWith(to));
    if (what === 'card') setOpenState(null);
    else setTalk(false);
  };
  /** The card just opened, until it is known whether it waits for answers (its conversation opens then). */
  const looked = useRef<string | null>(cardInAddress());
  // a card opens over Seismic's conversation, and from a card's conversation another card in its place
  const openId = (id: string) => {
    if (openRef.current === id) return;
    looked.current = id;
    if (!openRef.current) homeScroll.current = homeRef.current?.scrollTop ?? 0;
    if (openRef.current) {
      // the step that opened the conversation now opens this card: Back returns to the one before
      const s = steps();
      history.replaceState({ steps: s.at(-1) === 'talk' ? [...s.slice(0, -1), 'card'] : s }, '', addressWith({ card: id, talk: false }));
    } else step('card', { card: id, talk: false });
    setOpenState(id);
    setTalk(false);
  };
  const openCard = (i: Item) => openId(i.id);
  /** Back to the list from a card, closing its conversation too. */
  const leavesCard = useRef(false);
  const back = () => {
    if (!openRef.current) return;
    flushEdit().catch(console.error);
    const p = steps();
    if (p.at(-1) === 'talk' && p.at(-2) === 'card') return history.go(-2);
    if (p.at(-1) === 'talk') {
      // the card was opened before this page pushed anything (a reload): back past the conversation, then off the card
      leavesCard.current = true;
      return history.go(-1);
    }
    stepBack('card', { card: null, talk: false });
    setTalk(false);
  };
  const openTalk = () => {
    if (talkRef.current) return;
    step('talk', { card: openRef.current, talk: true });
    setTalk(true);
  };
  const closeTalk = () => talkRef.current && stepBack('talk', { card: openRef.current, talk: false });
  /** Back to the list, from a card and the panel alike. */
  const home = () => {
    flushEdit().catch(console.error);
    const n = steps().length;
    if (n) return history.go(-n);
    history.replaceState(null, '', addressWith({ card: null, talk: false }));
    setOpenState(null);
    setTalk(false);
  };
  // a tapped push: its card (or "Needs you" for several) in the app that is open already
  useEffect(() => {
    registerWorker();
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const tapped = (e: MessageEvent) => {
      if (e.data?.type !== 'open' || typeof e.data.url !== 'string') return;
      const card = readAddress(new URL(e.data.url, location.href)).card;
      if (card) openId(resolve(card)!);
      else home();
    };
    sw.addEventListener('message', tapped);
    return () => sw.removeEventListener('message', tapped);
  }, []);
  useEffect(() => {
    const pop = () => {
      flushEdit().catch(console.error);
      looked.current = null;
      if (leavesCard.current) {
        leavesCard.current = false;
        history.replaceState(null, '', addressWith({ card: null, talk: false }));
      }
      setOpenState(resolve(cardInAddress()));
      setTalk(talkInAddress());
    };
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);
  // the tab and the groups shown, as the owner left them; "Done" hidden until its chip is tapped
  const [tab, setTab] = useAgentsTab('all');
  const [hidden, setHidden] = useStoredState<PhoneStage[]>('obeya-phone-hidden', ['done']);
  // the list keeps where it was scrolled to while a card is open
  const homeRef = useRef<HTMLDivElement>(null);
  const homeScroll = useRef(0);
  useEffect(() => {
    if (!open && homeRef.current) homeRef.current.scrollTop = homeScroll.current;
  }, [open]);

  // ---------------------------------------------------------------- the cards
  const ordered = projects.filter((c) => snaps[c.id]);
  const all = useMemo(() => ordered.flatMap((c) => snaps[c.id]!.items.map((item) => ({ item, project: c }))), [snaps, projects]);
  const allRef = useRef(all);
  allRef.current = all;
  const byId = (id: string) => allRef.current.find((x) => x.item.id === id)?.item;
  // a card the address names by its code: its id once the snapshots hold it, and its address by the code
  useEffect(() => {
    const id = resolve(open);
    if (!open || id === open) return;
    if (looked.current === open) looked.current = id;
    setOpenState(id);
    history.replaceState(history.state, '', addressWith({ card: id, talk: talkRef.current }));
  }, [all]);
  // a project renamed: the address names it as it is called now, the open card's included
  const listed = useRef(projects);
  useEffect(() => {
    if (listed.current === projects) return;
    listed.current = projects;
    const now = addressWith({ card: openRef.current, talk: talkRef.current });
    if (now !== `${location.pathname}${location.search}`) history.replaceState(history.state, '', now);
  }, [projects]);
  // approved cards the server is still landing: they need the owner no longer
  const [underway, setUnderway] = useState<string[]>([]);
  // a card replied to from "Needs you" stays under way while it still waits for the owner
  useEffect(
    () =>
      setUnderway((u) =>
        u.filter((id) => {
          const i = byId(id);
          return !!i && (i.state === 'waiting' || needsYou(i));
        }),
      ),
    [snaps],
  );
  const opened = open ? all.find((x) => x.item.id === open) : undefined;

  // the project whose Seismic is spoken to without a card open
  const [obeyaProject, setObeyaProjectState] = useState(() => {
    const wanted = readAddress().project;
    return (projectNamed(projects, wanted) ?? projects.find((c) => c.id === localStorage.getItem(OBEYA_PROJECT)) ?? projects[0]!).id;
  });
  const obeyaId = projects.some((c) => c.id === obeyaProject) ? obeyaProject : projects[0]!.id;
  const obeyaRef = useRef(obeyaId);
  obeyaRef.current = obeyaId;
  const setObeyaProject = (id: string) => {
    // at once, for the address of the conversation opened next
    obeyaRef.current = id;
    setObeyaProjectState(id);
    try {
      localStorage.setItem(OBEYA_PROJECT, id);
    } catch {}
  };
  // every call goes to the API of the project in view: the open card's, else Seismic's
  setProject(opened?.project.id ?? obeyaId);
  // and every call about a card to its project's
  for (const c of ordered) cardsOn(c.id, snaps[c.id]!.items.map((i) => i.id));

  // ---------------------------------------------------------------- edits of the open card
  const edit = useRef<{ id: string; patch: CardPatch; timer?: ReturnType<typeof setTimeout> } | null>(null);
  /** Saves what was typed into the open card; actions on it wait for this. */
  function flushEdit(): Promise<void> {
    const e = edit.current;
    if (!e) return Promise.resolve();
    clearTimeout(e.timer);
    edit.current = null;
    return Object.keys(e.patch).length ? api.patch(e.id, e.patch) : Promise.resolve();
  }
  /** The open card's title, text and screenshots as typed, ahead of the snapshot: whether it was left without a title. */
  const typed = useRef<{ id: string } & Pick<Item, 'kind' | 'title' | 'body' | 'images'> | null>(null);
  const onEdit = (p: CardPatch) => {
    const id = openRef.current;
    if (!id) return;
    const i = byId(id);
    if (i && typed.current?.id !== id) typed.current = { id, kind: i.kind, title: i.title, body: i.body, images: i.images ?? [] };
    if (typed.current?.id === id) {
      if (p.title !== undefined) typed.current.title = p.title;
      if (p.body !== undefined) typed.current.body = p.body;
      if (p.images !== undefined) typed.current.images = p.images;
    }
    if (edit.current?.id !== id) flushEdit().catch(console.error);
    const e = (edit.current ??= { id, patch: {} });
    Object.assign(e.patch, p);
    clearTimeout(e.timer);
    e.timer = setTimeout(() => flushEdit().catch(console.error), 400);
  };
  useEffect(() => beforeReload(() => void flushEdit().catch(console.error)), []);
  // a card of the owner's left without a title (Back, the browser's own, a push opening another): one
  // left empty was not wanted and goes, one with a task Seismic names, as on the project
  const deleting = useRef<string | null>(null);
  const was = useRef(open);
  useEffect(() => {
    const left = was.current;
    was.current = open;
    if (!left || left === open) return;
    beingWritten.delete(left);
    const i = byId(left);
    if (!i || i.source !== 'manual' || deleting.current === left) return;
    const w = typed.current?.id === left ? typed.current : i;
    if (w.title.trim()) return;
    const saved = flushEdit();
    if (nameless(w)) saved.then(() => api.act(left, { action: 'name' })).catch(console.error);
    else saved.then(() => api.remove(left)).catch(console.error);
  }, [open]);

  // ---------------------------------------------------------------- a new card
  /** The card the plus button made, opened as soon as the snapshot brings it. */
  const [made, setMade] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  async function newCard() {
    if (making) return;
    setMaking(true);
    try {
      // on the project whose Seismic the list speaks to, where there is room on it
      const card = await api.create({ title: '' });
      beingWritten.add(card.id);
      setMade(card.id);
    } catch (e) {
      fail(e);
    } finally {
      setMaking(false);
    }
  }
  useEffect(() => {
    if (!made || !byId(made)) return;
    setMade(null);
    if (openRef.current || talkRef.current) return;
    openId(made);
  }, [made, all]);
  // the card just made is written in its text first, as on the project: Seismic names it from that
  useEffect(() => {
    if (!open || !beingWritten.has(open) || !opened || opened.item.title) return;
    const body = document.querySelector<HTMLElement>('#ph-card .p-body');
    if (!body || body.textContent) return;
    body.focus();
  }, [open, !!opened]);

  // ---------------------------------------------------------------- voice and confirmations
  const toasts = useToasts();
  const { showAck, showWait, fail } = useAck(toasts.store);
  const warnings = useWarnings(toasts.store, (id) => openId(id));
  const ratePrompt = useRatePrompt(useMemo(() => all.map((x) => x.item), [all]));
  // the reply stands in Seismic's conversation, open in front of the owner: no line above the microphone
  const told = useTold(toasts.store, () => {}, (h) => talkRef.current && (h.inCard ? openRef.current === h.inCard : !!snapsRef.current[obeyaRef.current]?.talk.some((x) => x.id === h.talk)), (c) => openId(c.id));
  const { tellAbout, tellTyped } = tellers(byId, told, fail, () => undefined);
  const where = (): Where => (openRef.current ? { card: openRef.current } : null);
  /** The draft of the field that speaks to `target`: the open card's, or the one under Seismic's conversation. */
  const draftFor = (target: Where) => (target && 'card' in target ? cardDraft(target.card) : obeyaDraft(obeyaRef.current));
  const fieldFor = (target: Where) => {
    const key = draftFor(target);
    return fieldOn(key) ? key : MIC_DRAFT;
  };
  const ptt = usePushToTalk(where, fieldFor, tellAbout, (h) => showAck(h.confirm), () => undefined);
  const pttRef = useRef(ptt);
  pttRef.current = ptt;
  /** The open card's demo video while the microphone is held: it pauses, and plays on after unless the words went into a field. */
  const pressing = useRef<{ video: HTMLVideoElement | null; playing: boolean; dictating: boolean } | null>(null);
  const press = () => {
    const id = openRef.current;
    const video = id ? (videoOf(id) ?? document.querySelector<HTMLVideoElement>('.card-sheet video')) : null;
    pressing.current = { video, playing: !!video && !video.paused, dictating: !!focusedDraft() };
    video?.pause();
    pttRef.current.start();
  };
  useEffect(() => {
    // a finger lifted, or taken over by the browser, ends the recording wherever it is
    const release = () => {
      const p = pressing.current;
      pressing.current = null;
      pttRef.current.stop();
      if (p?.video && p.playing && !p.dictating) p.video.play().catch(() => {});
    };
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
    return () => {
      removeEventListener('pointerup', release);
      removeEventListener('pointercancel', release);
    };
  }, []);
  useEffect(
    () =>
      onNotice((n) => {
        if (n.made && n.token) return told.made(n.token, n.made);
        if (n.level === 'warning') return warnings.show(noticeLine(n.text), n.cardId);
        const i = n.cardId ? byId(n.cardId) : undefined;
        told.show(i ? { id: i.id, title: plain(i.title) } : undefined, { confirm: noticeLine(n.text), ...(n.token ? { token: n.token } : {}), ...(n.undoMs ? { undoMs: n.undoMs } : {}), ...(n.talk ? { talk: n.talk } : {}), ...(n.inTalk && n.cardId ? { inCard: n.cardId } : {}) });
      }),
    [],
  );
  // Esc closes the open conversation, else the open card, as Back does (a keyboard at the phone, or the view tried at the desk)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.lightbox, .start-agent-menu')) return;
      if (talkRef.current) closeTalk();
      else back();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);

  /** After an action on the open card: back to the list, with the confirmation; one the server is still at says so until it answered. */
  function onDone(d: ActDone, p?: Pending) {
    if (!d.close) return;
    back();
    if (!p || !d.pending) {
      if (d.rate) ratePrompt.ask(d.rate);
      return showAck(d.ack, d.undo);
    }
    const card = p.card;
    setUnderway((u) => [...u, card]);
    showWait(`${d.pending.charAt(0).toUpperCase()}${d.pending.slice(1)}`);
    p.answered.then(
      () => {
        if (d.rate) ratePrompt.ask(d.rate);
        showAck(d.ack, d.undo);
      },
      (e) => {
        setUnderway((u) => u.filter((id) => id !== card));
        showAck(t.cardError(p.title, failText(e)));
      },
    );
  }
  async function deleteOpen() {
    const i = opened?.item;
    if (!i) return;
    if (edit.current) clearTimeout(edit.current.timer);
    edit.current = null;
    deleting.current = i.id;
    back();
    try {
      await api.remove(i.id);
      showAck(t.deleted(plain(i.title)), () => api.restore(i.id));
    } catch (e) {
      fail(e);
    }
  }

  // ---------------------------------------------------------------- the machine not answering
  const quietSince = Object.values(offline).reduce<number | null>((min, x) => (x === null ? min : min === null ? x : Math.min(min, x)), null);
  const isFrozen = quietSince !== null && Object.keys(offline).some((id) => offline[id] === quietSince && frozen[id]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (quietSince === null) return;
    const h = setTimeout(() => tick((n) => n + 1), Math.max(0, quietSince + (isFrozen ? UNRESPONSIVE_MS : QUIET_MS) - Date.now()) + 50);
    return () => clearTimeout(h);
  }, [quietSince, isFrozen]);
  // a frozen server is named at once (its silence was already 10 s); a lost connection after 3 s
  const quiet = quietSince !== null && (isFrozen || Date.now() - quietSince >= QUIET_MS);
  const unresponsive = isFrozen && Date.now() - quietSince! >= UNRESPONSIVE_MS;

  const feeds = projects.map((c) => <Feed key={c.id} id={c.id} onChange={feed} />);
  const several = projects.length > 1;
  const banner = quiet && (
    <div className="ph-quiet" role="status">
      <b>{isFrozen ? (unresponsive ? t.unresponsiveSince(when(quietSince!)) : t.notResponding) : t.phone.notAnswering(when(quietSince!))}</b>
      <span>{t.phone.notAnsweringWhy}</span>
    </div>
  );
  const acks = (
      <div id="acks">
        <Toasts toasts={toasts} open={open ?? undefined} aside />
        {/* nearest the microphone: a line going above it does not move the stars under a finger */}
        {ratePrompt.prompt}
      </div>
  );
  const mic = (
      <PushToTalk
        phase={ptt.phase}
        level={ptt.level}
        flat={ptt.flat}
        // what is in view fills the screen: whom the microphone speaks to goes without saying, and the room is short
        target={null}
        field={draftFor(where())}
        onDown={press}
      />
  );

  // ---------------------------------------------------------------- the open card's conversation
  /** Where the open card's conversation goes: the panel's content, while it is open. */
  const [talkEl, setTalkEl] = useState<HTMLElement | null>(null);
  /** The cursor goes into the panel's field once it is there (a comment on the demo). */
  const wantFocus = useRef(false);
  const elsewhere = useMemo(
    () => ({
      el: talk ? talkEl : null,
      open: (focus?: boolean) => {
        if (talkRef.current) return void (focus && talkEl?.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus());
        wantFocus.current = !!focus;
        openTalk();
      },
    }),
    [talk, talkEl],
  );
  // a card at work, or one that waits for answers to its questions, opens with its conversation, once
  // each time it is opened (a tap, a push, the page loading); Back or Forward to it leaves it as that step had it
  useEffect(() => {
    if (!open || !opened || looked.current !== open) return;
    looked.current = null;
    if (!talkRef.current && opensWithTalk(opened.item)) openTalk();
  }, [open, !!opened]);
  // beside a demo video the conversation is a half sheet, and the page shows the video above it; on a
  // working card too, so what the card is about stays in view above what its agent says
  const [half, setHalf] = useState(false);
  const halfFor = useRef<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const now = open && talk && opened ? open : null;
    if (now === halfFor.current) return;
    halfFor.current = now;
    setHalf(!!now && (!!pageVideo() || opened?.item.state === 'working'));
  }, [open, talk, !!opened]);
  useLayoutEffect(() => {
    const page = cardRef.current;
    const v = pageVideo();
    if (!half || !page || !v) return;
    const bar = page.querySelector('.ph-bar')?.getBoundingClientRect().bottom ?? 0;
    page.scrollTo({ top: page.scrollTop + v.getBoundingClientRect().top - bar - 10, behavior: scrollBehavior() });
  }, [half]);

  const isUnderway = (id: string) => underway.includes(id);
  // "Needs you" as the desktop's inbox: what the owner has read there, and the open card's entry read while it is open
  // (hooks, so above the open card's early return)
  const entries = inboxEntries(ordered, snaps, isUnderway, 'updated');
  const inboxRead = useInboxRead();
  const openEntry = open ? entries.find((e) => e.card?.id === open) : undefined;
  useEffect(() => {
    if (openEntry) inboxRead.markRead(openEntry);
  }, [openEntry && readMark(openEntry)]);

  if (open) {
    const c = opened?.project;
    const items = c ? snaps[c.id]!.items : [];
    const i = opened?.item;
    return (
      <HoldToTalk.Provider value={press}>
        {feeds}
        <div id="ph-card" className="ph-view" ref={cardRef} style={i ? ({ '--c': `var(--${shownState(i)})` } as React.CSSProperties) : undefined}>
          <header className="ph-bar">
            <button className="ph-back" onClick={back}>
              <ChevronLeft size={18} strokeWidth={2.25} aria-hidden="true" />
              {t.phone.back}
            </button>
            {c && several && <span className="ph-project">{c.name}</span>}
          </header>
          {banner}
          <div className="card-sheet ph-sheet">
            {i && c ? (
              <Cards.Provider value={{ items, open: openCard }}>
                <KoordinatorAgent.Provider value={snaps[c.id]!.koordinatorAgent}>
                <TalkElsewhere.Provider value={elsewhere}>
                <Detail
                  key={i.id}
                  item={i}
                  all={items}
                  repos={snaps[c.id]!.project.repos}
                  parent={i.parent ? items.find((x) => x.id === i.parent) : undefined}
                  from={i.from ? items.find((x) => x.id === i.from) : undefined}
                  onEdit={onEdit}
                  flush={flushEdit}
                  onDelete={() => void deleteOpen()}
                  onDone={onDone}
                  onTell={(text, images, field, replyTo) => void tellTyped(text, images, { card: i.id }, field, replyTo)}
                />
                </TalkElsewhere.Provider>
                </KoordinatorAgent.Provider>
              </Cards.Provider>
            ) : (
              // the snapshots are still on their way, or the card went (archived, deleted)
              Object.keys(snaps).length === projects.length && <p className="hint">{t.phone.gone}</p>
            )}
          </div>
        </div>
        {talk && i && (
          <TalkPanel
            title={plain(i.title)}
            label={t.phone.cardTalk}
            banner={banner}
            half={half}
            onClose={closeTalk}
            leave={leaveTalk}
            onLeave={() => setClosing(true)}
            focus={wantFocus}
          >
            <div id="ph-card-talk" className="ph-talk split-talk" ref={setTalkEl} />
          </TalkPanel>
        )}
        {i && <CardTalkButton key={i.id} item={i} open={talk} shown={talk && !closing} onClick={() => (talk ? leaveTalk.current?.() : openTalk())} />}
        {acks}
        {mic}
      </HoldToTalk.Provider>
    );
  }

  const obeyaSnap = snaps[obeyaId];
  const unreadOf = (id: string) => (snaps[id] ? unreadAnswers(snaps[id].talk) : 0);
  const unread = ordered.reduce((n, c) => n + unreadOf(c.id), 0);
  /** The panel, with the conversation an answer waits unread in when the one last picked has none. */
  const openTalkNewest = () => {
    const waiting = ordered.find((c) => unreadOf(c.id));
    if (!unreadOf(obeyaId) && waiting) setObeyaProject(waiting.id);
    openTalk();
  };
  const shown = talk && !closing;
  // "All": what needs the owner as the inbox lists it (Seismic's answers and snoozed cards among them),
  // every other card by the stage it is at, and what is finished but not archived yet
  const inInbox = new Set(entries.flatMap((e) => (e.card ? [e.card.id] : [])));
  const stageOf = (i: Item): PhoneStage | undefined => {
    if (inInbox.has(i.id) || i.archivedAt || inParkingLot(i)) return undefined;
    const s = agentStage(i, isUnderway(i.id));
    if (s && s !== 'needsYou') return s;
    // an idea's or a question's agent at work: the phone has no canvas to find it on, so it stands under "Working"
    if (!s && !i.queue && runs(i)) return 'working';
    if (!s && finishedArchivable(i) && !needsYou(i) && !snoozeOf(i)?.waiting && !runs(i) && !isUnderway(i.id)) return 'done';
    return undefined;
  };
  const staged = PHONE_STAGES.map((stage) => ({ stage, entries: stage === 'needsYou' ? [] : all.filter(({ item }) => stageOf(item) === stage) }));
  const count = (s: PhoneStage) => (s === 'needsYou' ? entries.length : staged.find((g) => g.stage === s)!.entries.length);
  const groups = PHONE_STAGES.filter((s) => count(s) > 0);
  const shownGroups = groups.filter((s) => !hidden.includes(s));
  const parked = all.filter(({ item }) => inParkingLot(item) && !item.archivedAt);
  const queuedOn = ordered.filter((c) => snaps[c.id]!.items.some((i) => i.queue && !i.archivedAt));
  const queued = ordered.reduce((n, c) => n + snaps[c.id]!.items.filter((i) => i.queue && !i.archivedAt).length, 0);
  // nothing known yet (the server has not answered since the page loaded): no claim that there is nothing
  const known = ordered.length > 0;
  return (
    <HoldToTalk.Provider value={press}>
      {feeds}
      <div id="ph-home" className="ph-view" ref={homeRef}>
        <header className="ph-bar ph-home">
          <Sign size={26} />
          <span className="ph-word">Seismic</span>
          {usage && <UsagePill usage={usage} />}
        </header>
        {banner}
        <Notify />
        <AgentsTabs tab={tab} onTab={setTab} queued={queued} parked={parked.length} />
        {!known ? null : tab === 'all' ? (
          <>
            <StageChips stages={PHONE_STAGES} count={count} hidden={hidden} onHidden={setHidden} onlyFull />
            {!groups.length ? (
              <p className="ph-none ph-empty">{t.agents.none}</p>
            ) : !shownGroups.length ? (
              <p className="ph-none ph-empty">{t.agents.allHidden}</p>
            ) : (
              shownGroups.map((s) => (
                <section key={s} className={`ph-section ph-stage stage-${s}`}>
                  <h2>
                    {t.agents.stages[s]} <span className="n">{count(s)}</span>
                  </h2>
                  {s === 'needsYou' ? (
                    <InboxList
                      entries={entries}
                      isRead={inboxRead.isRead}
                      onRead={inboxRead.markRead}
                      onGo={(e) => {
                        if (e.card) return openCard(e.card);
                        setObeyaProject(e.project);
                        openTalk();
                      }}
                      onProposalCard={(_project, i) => openCard(i)}
                      onReply={(c, i, r) =>
                        sendReply(c, i, r, {
                          mark: (id, what) => setUnderway((u) => (what === null ? u.filter((x) => x !== id) : [...u.filter((x) => x !== id), id])),
                          showAck,
                        })
                      }
                    />
                  ) : (
                    // a snoozed card at the end, after those at work now
                    <CardList entries={staged.find((g) => g.stage === s)!.entries.sort((a, b) => Number(!!snoozeOf(a.item)) - Number(!!snoozeOf(b.item)))} several={several} onOpen={openCard} />
                  )}
                </section>
              ))
            )}
          </>
        ) : tab === 'queue' ? (
          queuedOn.length ? (
            queuedOn.map((c) => (
              <section key={c.id} className="ph-section ph-queue">
                {several && <h2>{c.name}</h2>}
                <ProjectQueue items={snaps[c.id]!.items} scroller={homeRef} onOpen={openCard} />
              </section>
            ))
          ) : (
            <p className="ph-none ph-empty">{t.queue.empty}</p>
          )
        ) : tab === 'parked' ? (
          parked.length ? (
            <section className="ph-section">
              <CardList entries={parked} several={several} onOpen={openCard} />
            </section>
          ) : (
            <p className="ph-none ph-empty">{t.agents.noneParked}</p>
          )
        ) : (
          <section className="ph-section ph-activity">
            <ActivityTab project={obeyaId} changed={snaps} onGo={(_project, i) => openCard(i)} allProjects />
          </section>
        )}
      </div>
      {talk && (
        <TalkPanel
          title={t.koordinator.title}
          head={obeyaSnap && <ChatsHead title={<span className="ph-word">{t.koordinator.title}</span>} project={obeyaId} projectName={obeyaSnap.project.name} chat={obeyaSnap.chat} chats={obeyaSnap.chats} talk={obeyaSnap.talk} onProject={setObeyaProject} />}
          label={t.phone.talkTitle}
          banner={banner}
          onClose={closeTalk}
          leave={leaveTalk}
          onLeave={() => setClosing(true)}
        >
          {obeyaSnap && (
            <div className="ph-talk" key={obeyaId}>
              <KoordinatorAgent.Provider value={obeyaSnap.koordinatorAgent}>
              <KoordinatorTalk
                on
                project={obeyaId}
                talk={obeyaSnap.talk}
                chat={obeyaSnap.chat}
                chatModel={obeyaSnap.chatModel}
                chats={obeyaSnap.chats}
                items={obeyaSnap.items}
                repos={obeyaSnap.project.repos}
                onOpen={openCard}
                onTell={(text, images, replyTo) => void tellTyped(text, images, null, undefined, replyTo)}
                draft={obeyaDraft(obeyaId)}
              />
              </KoordinatorAgent.Provider>
            </div>
          )}
        </TalkPanel>
      )}
      <TalkButton label={t.phone.talkTitle} shown={shown} n={unread} count={t.koordinator.unreadCount(unread)} working={ordered.some((c) => obeyaWorks(snaps[c.id]!.talk))} onClick={() => (talk ? leaveTalk.current?.() : openTalkNewest())} />
      {/* right of the microphone, with several projects: whose Seismic the microphone and the panel speak to */}
      {several && (
        <label className="pill ph-project-pick">
          <span className="name">{projects.find((c) => c.id === obeyaId)?.name}</span>
          <span className="hint">▾</span>
          <select value={obeyaId} aria-label={t.phone.project} onChange={(e) => setObeyaProject(e.target.value)}>
            {projects.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {acks}
      {/* the list's own: a new card; with Seismic's conversation open, the microphone that speaks to it */}
      {talk ? (
        mic
      ) : (
        <button className="ph-new" aria-label={t.newCard} title={t.newCard} disabled={making || !!made} onClick={() => void newCard()}>
          <Plus size={30} strokeWidth={2.25} aria-hidden="true" />
        </button>
      )}
    </HoldToTalk.Provider>
  );
}

/** One project's live snapshot, handed up as it changes. */
function Feed({ id, onChange }: { id: string; onChange: (id: string, live: ReturnType<typeof useProject>) => void }) {
  const live = useProject(id);
  useEffect(() => onChange(id, live), [live.snapshot, live.offlineSince, live.frozenSince, live.projects, live.usage]);
  return null;
}

/** Cards as the project shows them, as wide as the screen, each opening at a tap; led by its project's name where there are several. */
function CardList({ entries, several, onOpen }: { entries: { item: Item; project: ProjectInfo }[]; several: boolean; onOpen: (i: Item) => void }) {
  return (
    <ul className="ph-list">
      {entries.map(({ item: i, project: c }) => (
        <li key={i.id}>
          <button className={`${cardClass(i)} ph-card`} onClick={() => onOpen(i)}>
            <CardFace item={i} where={several ? c.name : undefined} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One project's queue, its rows dragged to their place by their grip, a tap opening the card. */
function ProjectQueue({ items, scroller, onOpen }: { items: Item[]; scroller: React.RefObject<HTMLElement | null>; onOpen: (i: Item) => void }) {
  const q = useQueueSort(items, scroller);
  return <QueueList items={items} q={q} onOpen={onOpen} />;
}

/**
 * Left of the microphone, in reach of the thumb, as the project's top bar has it: opens the conversation
 * of what is in view as a panel, and closes it while it is open (inverted then). `n`: what waits there;
 * `working`: the conversation shows an agent (or Seismic) at work, which the moving line of a working card says.
 */
function TalkButton({ label, shown, n, count, working, onClick }: { label: string; shown: boolean; n: number; count: string; working: boolean; onClick: () => void }) {
  return (
    <button className={['pill kpill talk-pill ph-talk-open', shown && 'on', working && 'working'].filter(Boolean).join(' ')} aria-expanded={shown} aria-label={shown ? t.phone.closeTalk : label} onClick={onClick}>
      <TalkIcon />
      {!shown && n > 0 && (
        <span className="n unread" title={count}>
          {n}
        </span>
      )}
    </button>
  );
}

/**
 * The button for an open card's conversation: what waits there is the messages not seen yet and the
 * questions open, which count as one, the block they stand in together.
 */
function CardTalkButton({ item, open, shown, onClick }: { item: Item; open: boolean; shown: boolean; onClick: () => void }) {
  const events = useEvents(item.id);
  // the conversation marks what it holds seen while it is open
  const messages = events && !open ? unseen(cardTalk(item, events), events, seenOf(item.id)) : 0;
  const questions = openQuestions(item).length;
  const working = agentWorks(item) || (!!events && koordinatorReads(events));
  return <TalkButton label={t.phone.cardTalk} shown={shown} n={messages + (questions ? 1 : 0)} count={t.phone.cardWaiting(messages, questions)} working={working} onClick={onClick} />;
}

/**
 * A conversation as a panel from below, Seismic's or the open card's (`children`): the conversation is
 * the only thing in it that scrolls, the field stands under it and the microphone below that.
 * Its top is a grip the owner drags to the height they want (`settle`): let go near the screen's top
 * it takes the full height, near the bottom it closes (as the button beside the microphone and Back
 * do). Let go in motion, it glides on and slows down (`thrown`), so a short swipe throws it to the
 * full height or closes it. It opens at the full height, or beside a demo video (`half`) in the
 * lower half of the screen.
 */
function TalkPanel({
  title,
  head,
  label,
  banner,
  half = false,
  onClose,
  leave: leaveRef,
  onLeave,
  focus,
  children,
}: {
  title: string;
  /** What the panel's head shows in place of the title. */
  head?: React.ReactNode;
  label: string;
  banner: React.ReactNode;
  half?: boolean;
  onClose: () => void;
  /** Where the panel puts its way of closing, for the button beside the microphone. */
  leave: React.RefObject<(() => void) | null>;
  /** The panel starts sliding out. */
  onLeave: () => void;
  /** Set: the cursor goes into the field once it is there. */
  focus?: React.RefObject<boolean>;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // the height the owner dragged it to, as a share of the screen the keyboard leaves; until then the
  // one it opens with
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => setHeight(null), [half]);
  const [leaving, setLeaving] = useState(false);
  /** Where the finger went down, where the panel's top stood then (a share of the screen the keyboard leaves, from its top), that screen's height in px, and where the finger has been since. */
  const drag = useRef<{ y: number; top: number; px: number; trail: Mark[] } | null>(null);
  // how a thrown panel glides on to where it comes to rest
  const [gliding, setGliding] = useState<{ ms: number; ease: string } | null>(null);
  const glided = useRef<ReturnType<typeof setTimeout>>(undefined);
  // the panel follows the finger without easing
  const [dragging, setDragging] = useState(false);
  const gone = useRef(false);
  const leave = (ms = 200) => {
    if (gone.current) return;
    gone.current = true;
    onLeave();
    setLeaving(true);
    setTimeout(onClose, ms);
  };
  leaveRef.current = leave;
  // the confirmations above the microphone stand above the field while the panel is open; the field
  // comes with the conversation, which may arrive after the panel
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const root = document.documentElement;
    let field: Element | null = null;
    const size = new ResizeObserver(() => field && root.style.setProperty('--ph-field', `${field.getBoundingClientRect().height}px`));
    const find = () => {
      const f = el.querySelector('.composer');
      if (f === field) return;
      if (field) size.unobserve(field);
      field = f;
      if (!f) return root.style.removeProperty('--ph-field');
      size.observe(f);
      if (focus?.current) {
        focus.current = false;
        f.querySelector<HTMLTextAreaElement>('textarea')?.focus();
      }
    };
    const watch = new MutationObserver(find);
    watch.observe(el, { childList: true, subtree: true });
    find();
    return () => {
      watch.disconnect();
      size.disconnect();
      root.style.removeProperty('--ph-field');
    };
  }, []);
  // the page under a panel lower than the screen scrolls on until all of it can stand above the panel
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const root = document.documentElement;
    const size = new ResizeObserver(() => root.style.setProperty('--ph-panel', `${el.getBoundingClientRect().height}px`));
    size.observe(el);
    return () => {
      size.disconnect();
      root.style.removeProperty('--ph-panel');
    };
  }, []);
  const down = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('button, select')) return;
    // the panel ends at the bottom of the screen the keyboard leaves and is its `--ph-h` share high,
    // so that screen's height comes from the panel alone, whether the page is pinned above the
    // keyboard or not
    const el = panel.current!;
    const share = parseFloat(getComputedStyle(el).getPropertyValue('--ph-h')) || 1;
    drag.current = { y: e.clientY, top: 1 - share, px: el.offsetHeight / share, trail: [{ t: e.timeStamp, y: e.clientY }] };
    e.currentTarget.setPointerCapture(e.pointerId);
    clearTimeout(glided.current);
    setGliding(null);
  };
  /** Where the dragged top stands, as a share of the screen from its top, with the finger at `y`. */
  const topAt = (y: number) => {
    const d = drag.current!;
    return d.top + (y - d.y) / d.px;
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current.trail = [...drag.current.trail.filter((m) => e.timeStamp - m.t < 200), { t: e.timeStamp, y: e.clientY }];
    setDragging(true);
    setHeight(Math.min(1, 1 - topAt(e.clientY)));
  };
  const up = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const cancelled = e.type === 'pointercancel';
    // a cancelled touch may report no place of its own: it ends where the finger was last
    const y = cancelled ? drag.current.trail[drag.current.trail.length - 1]!.y : e.clientY;
    const moved = Math.abs(y - drag.current.y) > 4;
    const px = drag.current.px;
    // the top stands no higher than the screen's
    const at = Math.max(0, topAt(y));
    const v = cancelled ? 0 : speed(drag.current.trail, e.timeStamp);
    const to = settle(thrown(at, v, px));
    drag.current = null;
    setDragging(false);
    // a tap leaves the panel as it was
    if (!moved) return;
    let ms: number | undefined;
    if (Math.abs(v) >= THROWN) {
      // the way left to go: down out of the screen, or to the top's new place
      const g = glide(to === 'close' ? panel.current!.offsetHeight : (at - (1 - to)) * px, v);
      ms = g.ms;
      setGliding(g);
      glided.current = setTimeout(() => setGliding(null), g.ms);
    }
    if (to === 'close') leave(ms);
    else setHeight(to);
  };
  const style = {
    ...(height === null ? {} : { '--ph-h': Math.max(0, height) }),
    ...(gliding ? { transitionDuration: `${gliding.ms}ms`, transitionTimingFunction: gliding.ease } : {}),
  };
  return (
    <div
      id="ph-talk"
      className={['ph-view ph-panel', half && 'half', (height ?? 1) < 1 && 'part', leaving && 'leaving', dragging && 'dragging'].filter(Boolean).join(' ')}
      ref={panel}
      style={style as React.CSSProperties}
      role="dialog"
      aria-label={label}
    >
      <header className="ph-bar ph-grip" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {head ?? <span className="ph-word">{title}</span>}
      </header>
      {banner}
      {children}
    </div>
  );
}
