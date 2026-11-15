import { activeMergeCard } from '../core/merge';
// The controller of the phone view: one WebSocket per project, what is open (a card, a
// conversation) as steps in the browser's history, edits of the open card, a new card, the
// microphone and the confirmations, and the open card full screen with its conversation in a panel
// that comes up from below. The view renders its own list and the open card's top bar.

import { useRatePrompt } from './feedback';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type ProjectInfo, type CardPatch, type Item, nameless, needsYou, openQuestions } from '../core/types';
import { api, beforeReload, cardsOn, onNotice, setProject, type Where } from './api';
import { inboxEntries, readMark } from '../core/inbox';
import { useInboxRead } from './inboxRead';
import { type ActDone, Detail, type Pending, TalkElsewhere, useEvents } from './detail';
import { cardDraft, fieldOn, focusedDraft, keepDrafts, MIC_DRAFT, obeyaDraft } from './draft';
import { plain } from './markdown';
import { Cards, KoordinatorAgent } from './message';
import { CardFace, cardLook, shownState, stateVars } from './card';
import { TalkIcon } from './parts';
import { videoOf } from './spot';
import { failText, t } from './strings';
import { agentWorks, beingWritten, cardTalk, koordinatorReads, opensWithTalk, unseen } from './talk';
import { seenOf } from './seen';
import { noticeLine, tellers, useAck, useWarnings } from './tell';
import { phoneAcksClass, Toasts, useToasts } from './components/toast';
import { HoldToTalk, PushToTalk, usePushToTalk, useTold } from './voice';
import { projectPath, cardPath, named, projectNamed, queryWithout, readAddress } from './address';
import { layerOpen } from './components/ui';
import { Badge } from './components/badge';
import { PillButton } from './components/pill';
import { DrawLine } from './components/draw-line';
import { cn } from 'cn';
import { usePhoneEnvironment, pageClass } from './phoneEnvironment';
import { usePhoneProjects } from './phoneProjects';
import { usePhonePush } from './phonePush';
import { TalkPanel, talkClass, usePhoneCardPanel } from './phoneTalkPanel';

/** The phone view keeps its drafts apart from any project's: it shows every project. */
const DRAFTS = '@phone';
/** The project in view (whose Seismic is spoken to without a card open), as the owner last picked it. */
const OBEYA_PROJECT = 'seismic-phone-project';
/** The card the address names, by its code or its id. */
const cardInAddress = () => readAddress().card ?? null;
const talkInAddress = () => new URLSearchParams(location.search).has('talk');
/** What a step in the browser's history opened: a card, or the conversation of what is in view. */
type Step = 'card' | 'talk';

/** A group of the list (a stage, a project's queue …). */
export const sectionClass = 'ph-section mt-6 ph-landscape:mt-3.5';

export type PhoneShell = ReturnType<typeof usePhoneShell>;

/**
 * The controller of the phone view, which shows one project at a time: opening a card of another
 * project makes that project the one in view.
 */
export function usePhoneShell(loaded: ProjectInfo[]) {
  keepDrafts(sessionStorage, DRAFTS);
  usePhoneEnvironment();
  const { projects, snaps, usage, feeds, banner } = usePhoneProjects(loaded);
  const snapsRef = useRef(snaps);
  snapsRef.current = snaps;

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
  const resolve = (code: string | null) => {
    const items = allRef.current.map((x) => x.item);
    const card = code && named(items, code);
    return card ? activeMergeCard(card, items).id : code;
  };
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
    id = resolve(id) ?? id;
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
  /** The card that takes the open one's place once Back has closed the conversation over it. */
  const instead = useRef<string | null>(null);
  /** The open card gave way to `id` (a merge approved): `id` takes its place in the history, its conversation closed. */
  const replaceCard = (id: string) => {
    if (steps().at(-1) !== 'talk') return openId(id);
    // Back past the conversation first, so no step is left that opens the card that went
    flushEdit().catch(console.error);
    instead.current = resolve(id) ?? id;
    history.back();
  };
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
  usePhonePush((code) => openId(resolve(code)!), home);
  useEffect(() => {
    const pop = () => {
      flushEdit().catch(console.error);
      looked.current = null;
      const next = instead.current;
      if (next) {
        instead.current = null;
        looked.current = next;
        history.replaceState(history.state, '', addressWith({ card: next, talk: false }));
        setOpenState(next);
        setTalk(false);
        return;
      }
      if (leavesCard.current) {
        leavesCard.current = false;
        history.replaceState(null, '', addressWith({ card: null, talk: false }));
      }
      // the view of one project at a time: Back from a card of another project lands on that
      // project's list (the one in view since the card opened), not on the list the entry recorded
      if (!cardInAddress()) history.replaceState(history.state, '', addressWith({ card: null, talk: talkInAddress() }));
      setOpenState(resolve(cardInAddress()));
      setTalk(talkInAddress());
    };
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);
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
    // the view of one project at a time names it in the address, so a reload stays on it
    if (!openRef.current) history.replaceState(history.state, '', addressWith({ card: null, talk: talkRef.current }));
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
  const { tellAbout, tellTyped, tellChat } = tellers(byId, told, fail, () => undefined);
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
      if (e.key !== 'Escape' || layerOpen() || document.querySelector('.lightbox')) return;
      if (talkRef.current) closeTalk();
      else back();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);

  const [onward, setOnward] = useState<{ gone: string; next: string } | null>(null);
  useEffect(() => {
    if (!onward || all.some((c) => c.item.id === onward.gone)) return;
    setOnward(null);
    // the owner may have gone elsewhere meanwhile
    if (openRef.current === onward.gone) replaceCard(onward.next);
  }, [onward, all]);

  /** After an action on the open card: back to the list, with the confirmation; one the server is still at says so until it answered. */
  function onDone(d: ActDone, p?: Pending) {
    if (!d.close) return;
    // the card a merge became opens in this one's place, once the project no longer has the one that went:
    // until then opening it would open the merge again
    if (d.next && openRef.current) setOnward({ gone: openRef.current, next: d.next });
    else back();
    if (!p || !d.pending) {
      if (d.rate) ratePrompt.ask(d.rate);
      if (d.ack) showAck(d.ack, d.undo);
      return;
    }
    const card = p.card;
    setUnderway((u) => [...u, card]);
    const done = showWait(`${d.pending.charAt(0).toUpperCase()}${d.pending.slice(1)}`);
    p.answered.then(
      () => {
        if (d.rate) ratePrompt.ask(d.rate);
        if (d.ack) showAck(d.ack, d.undo);
        else done();
      },
      (e) => {
        setUnderway((u) => u.filter((id) => id !== card));
        // the card is closed by now: a warning that stays, with the way back to it, in place of the wait
        done();
        warnings.show(t.cardError(p.title, failText(e)), p.card);
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

  const acks = (
      <div id="acks" className={phoneAcksClass}>
        <Cards.Provider value={{ items: Object.values(snaps).flatMap((x) => x.items), open: openCard }}>
          <Toasts toasts={toasts} open={open ?? undefined} aside />
        </Cards.Provider>
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
  const cardRef = useRef<HTMLDivElement>(null);
  const half = usePhoneCardPanel(open, talk, opened?.item, cardRef);

  const isUnderway = (id: string) => underway.includes(id);
  // "Needs you" as the desktop's inbox: what the owner has read there, and the open card's entry read while it is open
  // (hooks, so above the open card's early return)
  const entries = inboxEntries(ordered, snaps, isUnderway);
  const inboxRead = useInboxRead();
  const openEntry = open ? entries.find((e) => e.card?.id === open) : undefined;
  useEffect(() => {
    if (openEntry) inboxRead.markRead(openEntry);
  }, [openEntry && readMark(openEntry)]);

  // the view that shows one project at a time: a card of another project opened makes it the one in view
  useEffect(() => {
    if (opened && opened.project.id !== obeyaRef.current) setObeyaProject(opened.project.id);
  }, [opened?.project.id]);

  /**
   * The open card full screen, under its view's own top bar (`header`, scrolling with it), with its
   * conversation's panel and button. `above`: a bar that stays over the card, which then starts
   * right below it (`--ph-top`: that bar's height, which the bar sets).
   */
  const cardScreen = (header: React.ReactNode, above?: React.ReactNode) => {
    const c = opened?.project;
    const items = c ? snaps[c.id]!.items : [];
    const i = opened?.item;
    return (
      <HoldToTalk.Provider value={press}>
        {feeds}
        {above}
        {/* a card opened: full screen, in its state's colour along the top */}
        <div
          id="ph-card"
          className={cn(pageClass, "before:content-[''] before:fixed before:inset-x-0 before:top-0 before:h-1 before:bg-(--c) before:z-6", above && 'top-(--ph-top) pt-0 before:top-(--ph-top)')}
          ref={cardRef}
          style={i ? (stateVars(shownState(i)) as React.CSSProperties) : undefined}
        >
          {header}
          {banner}
          <div className="card-sheet ph-sheet pt-3.5">
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
            <div id="ph-card-talk" className={`${talkClass} split-talk [&>.p-h]:hidden`} ref={setTalkEl} />
          </TalkPanel>
        )}
        {i && <CardTalkButton key={i.id} item={i} open={talk} shown={talk && !closing} onClick={() => (talk ? leaveTalk.current?.() : openTalk())} />}
        {acks}
        {mic}
      </HoldToTalk.Provider>
    );
  };

  return {
    projects, snaps, usage, feeds, banner, all, ordered,
    open, opened, openCard, openId, back, home,
    talk, openTalk, closeTalk, closing, setClosing, leaveTalk,
    obeyaId, setObeyaProject,
    entries, inboxRead, isUnderway, setUnderway,
    homeRef, newCard, making, made,
    showAck, tellTyped, tellChat, press, acks, mic, cardScreen,
  };
}

/** Cards as the project shows them, as wide as the screen, each opening at a tap; the list is of one project, so its faces name none. */
export function CardList({ entries, onOpen }: { entries: { item: Item; project: ProjectInfo }[]; onOpen: (i: Item) => void }) {
  return (
    // one column held upright, two (or more) side by side once the screen is wide enough, the phone turned, say
    <ul className="ph-list list-none m-0 p-0 grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-3.5">
      {entries.map(({ item: i }) => (
        <li key={i.id} className="flex">
          <PhoneCard item={i} onOpen={() => onOpen(i)}>
            <CardFace item={i} place="phone" />
          </PhoneCard>
        </li>
      ))}
    </ul>
  );
}

/** A row of the lists: the card as the project shows it, as wide as the screen, opening at a tap. */
export function PhoneCard({ item, onOpen, children }: { item: Item; onOpen: () => void; children: React.ReactNode }) {
  const look = cardLook(item, { place: 'phone' });
  return (
    <button className={`${look.className} ph-card`} style={look.style} onClick={onOpen}>
      {children}
    </button>
  );
}

/**
 * The talk button and the project picker beside the microphone, a finger's size; hidden while the
 * keyboard is up (the field has its own microphone then). With the phone turned they stand in the
 * microphone's strip at the right edge, centred in it (`translate`, since a pressed button sets `transform`).
 */
export const phoneControl =
  'fixed bottom-[calc(30px+env(safe-area-inset-bottom))] z-50 h-11 py-0 [.ph-kb_.ph-view~&]:hidden ph-landscape:right-[calc(56px+env(safe-area-inset-right))] ph-landscape:left-auto ph-landscape:[translate:50%_0]';

/**
 * Left of the microphone, in reach of the thumb, as the project's top bar has it: opens the conversation
 * of what is in view as a panel, and closes it while it is open (inverted then). `n`: what waits there;
 * `working`: the conversation shows an agent (or Seismic) at work, which the moving line of a working card says.
 */
export function TalkButton({ label, shown, n, count, working, onClick }: { label: string; shown: boolean; n: number; count: string; working: boolean; onClick: () => void }) {
  return (
    <PillButton
      tone="ink"
      on={shown}
      className={cn(
        phoneControl,
        'left-[max(14px,env(safe-area-inset-left))] px-3.5 text-foreground active:[transform:translateY(1px)] active:shadow-none ph-landscape:bottom-[calc(14px+env(safe-area-inset-bottom))] [&_svg]:size-5',
      )}
      aria-expanded={shown}
      aria-label={shown ? t.phone.closeTalk : label}
      onClick={onClick}
    >
      <TalkIcon />
      {/* the conversation shows an agent at work: the moving line of a working card, along the button's foot */}
      {working && <DrawLine className="absolute inset-x-2.5 bottom-[5px] w-auto" />}
      {!shown && n > 0 && (
        <Badge variant="count" tone="waiting" title={count}>
          {n}
        </Badge>
      )}
    </PillButton>
  );
}

/**
 * The button for an open card's conversation: what waits there is the messages not seen yet and the
 * questions open, which count as one, the block they stand in together.
 */
export function CardTalkButton({ item, open, shown, onClick }: { item: Item; open: boolean; shown: boolean; onClick: () => void }) {
  const events = useEvents(item.id);
  // the conversation marks what it holds seen while it is open
  const messages = events && !open ? unseen(cardTalk(item, events), events, seenOf(item.id)) : 0;
  const questions = openQuestions(item).length;
  const working = agentWorks(item) || (!!events && koordinatorReads(events));
  return <TalkButton label={t.phone.cardTalk} shown={shown} n={messages + (questions ? 1 : 0)} count={t.phone.cardWaiting(messages, questions)} working={working} onClick={onClick} />;
}
