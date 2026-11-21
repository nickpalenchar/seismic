// The phone view for one project at a time (`?view=phone`): a slim top bar with Seismic's sign, the project in view and its switcher, and the usage
// pills scrolling under it; a box "N working" with the workstation dots, which unfolds to the cards
// agents are on; the project's other cards in sections (Queued, Planned, then Parked and Done
// folded), twenty at a time; and a floating bar along the foot with Menu, Chat, New card, Search and
// Needs you. Chat opens Seismic's conversation as a full page and Search a page over the project's
// cards (`phoneSearch.tsx`), each without the bar. A card opens full screen with an X at the top and
// no floating bar; its conversation is the panel of `phoneShell.tsx`.

import { Bell, ChevronDown, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { finishedArchivable, halted, inParkingLot, type Item, needsYou, type ProjectInfo, snoozeOf, type Usage, unreadAnswers } from '../core/types';
import { agentStage, agentWork } from '../core/agents';
import { queueOrder } from '../core/queue';
import { useStoredState } from './stored';
import { Sign } from './logo';
import { Notify } from './notify';
import { failText, t } from './strings';
import { UsagePill } from './usage';
import { seismicWorks, runs } from './talk';
import { Badge } from './components/badge';
import { DrawLine } from './components/draw-line';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/collapsible';
import { TalkIcon } from './parts';
import { hostSpots, WorkingRows, WorkstationDots } from './workstations';
import { api, ApiError } from './api';
import { needsYouCount } from '../core/inbox';
import { plain } from './markdown';
import { cn } from 'cn';
import { pageBarClass, pageClass, viewClass } from './phoneEnvironment';
import { CardList, sectionClass, usePhoneShell } from './phoneShell';
import { HoldToTalk } from './voice';
import { ChatsHead } from './chats';
import { KoordinatorTalk } from './koordinator';
import { KoordinatorAgent } from './message';
import { seismicDraft } from './draft';
import { PhoneSearch } from './phoneSearch';
import { gripWordClass, TalkPanel, talkClass } from './phoneTalkPanel';
import { InboxList } from './inbox';
import { sendReply } from './quickReply';
import { PhoneNavSheet } from './nav';
import { plannedOrder } from './phoneOrder';
import { ProjectSettingsBody } from './projectSettings/sheet';
import { settingsSheetClass } from './configClasses';
import { showAddSite } from './config';
import { leave } from './leaving';

/** The sections of the list, in their order; those folded until the owner unfolds them. */
const SECTIONS = ['queued', 'planned', 'parked', 'done'] as const;
type Section = (typeof SECTIONS)[number];
const FOLDED: Section[] = ['parked', 'done'];
/** How many cards a section shows before "Load more", and how many more each tap brings. */
const PAGE = 20;

export function PhoneNext({ projects: loaded }: { projects: ProjectInfo[] }) {
  const s = usePhoneShell(loaded);
  const { projects, snaps, usage, feeds, banner, open, openCard, seismicId, setSeismicProject, entries, isUnderway, homeRef, newCard, making, made, press, acks, back, showAck } = s;
  const [menuOpen, setMenuOpen] = useState(false);
  const [page, showPage, closePage] = usePage();
  const needsOn = page === 'needs';
  const settingsOn = page === 'settings';
  // what closes the settings page or puts another in its place waits for an unsaved draft in it (`leaving`)
  const openNeeds = () => (settingsOn ? leave(() => showPage('needs')) : showPage('needs'));
  const openSettings = () => showPage('settings');
  const closeNeeds = () => { if (needsOn) closePage(); };
  const closeSettings = () => { if (settingsOn) leave(closePage); };
  const [workingOpen, setWorkingOpen] = useStoredState('seismic-phone-working-open', true);
  const [folded, setFolded] = useStoredState<Section[]>('seismic-phone-folded', FOLDED);
  // how many cards each section shows; back to the first twenty with another project
  const [shown, setShown] = useState<{ project: string; n: Partial<Record<Section, number>> }>({ project: seismicId, n: {} });
  const shownOf = (x: Section) => (shown.project === seismicId ? shown.n[x] : undefined) ?? PAGE;
  // the search page is a step in the browser's history too, so Back from a card found there returns to it
  const [searching, setSearching] = useState(() => !!(history.state as { search?: boolean } | null)?.search);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const pop = () => setSearching(!!(history.state as { search?: boolean } | null)?.search);
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);
  const openSearch = () => {
    history.pushState({ ...history.state, search: true }, '', location.href);
    setSearching(true);
  };
  const closeSearch = () => {
    if ((history.state as { search?: boolean } | null)?.search) history.back();
    else setSearching(false);
  };

  // an open card goes right up to the bottom of the top bar, which stays, with the X in place of the usage pills
  if (open)
    return s.cardScreen(
      null,
      <div className={cn(viewClass, 'inset-x-0 top-0 z-30')} ref={measureTop}>
        <TopBar projects={projects} project={seismicId} usage={usage} onClose={() => leaveCard(back, needsOn, closeNeeds)} />
      </div>,
    );


  const snap = snaps[seismicId];
  const project = projects.find((c) => c.id === seismicId)!;
  const items = snap?.items ?? [];
  const entriesOf = (i: Item) => ({ item: i, project });
  // what needs the owner waits under the bell, not in the list
  const inInbox = new Set(entries.flatMap((e) => (e.card ? [e.card.id] : [])));
  const listed = (i: Item) => !inInbox.has(i.id) && !i.archivedAt;
  // the cards agents are on; one whose agent is paused or snoozed stands in the box after them, but no agent works on it
  const onIt = [...agentWork(items, isUnderway).working, ...items.filter((i) => i.kind !== 'task' && !i.queue && !needsYou(i) && !i.archivedAt && runs(i))].filter(listed);
  const idle = (i: Item) => halted(i) || !!snoozeOf(i);
  // the cards the dots show (`hostSpots`: not stopped, queued, snoozed or parked); rows follow the dots
  const held = new Set((snap?.workstations ?? []).flatMap((p) => p.hosts.flatMap((h) => hostSpots(h, items).flatMap((w) => (w?.card && !w.project ? [w.card] : [])))));
  // a worker still in a turn on a card that left the agent stages (finishing after landing, say) is at work too, as the status bar counts it
  const busy = new Set((snap?.workstations ?? []).flatMap((p) => p.hosts.flatMap((h) => [...h.busy, ...(h.reviewing ?? []), ...(h.exploring ?? [])])));
  const finishing = items.filter((i) => busy.has(i.id) && held.has(i.id) && !onIt.includes(i) && !needsYou(i) && !i.archivedAt);
  // a card waiting for the owner keeps its workstation (an orange dot): it stands in the box as the desktop's list has it, but no agent works on it
  const waits = items.filter((i) => held.has(i.id) && needsYou(i) && !i.archivedAt && !onIt.includes(i));
  const working = [...onIt.filter((i) => !idle(i)), ...finishing, ...waits, ...onIt.filter(idle)];
  // the count is the agents at work, whether or not their card shows as a row (a card being stopped still holds its slot until the worker ends)
  const atWork = new Set([...onIt.filter((i) => !idle(i)).map((i) => i.id), ...items.filter((i) => busy.has(i.id)).map((i) => i.id)]).size;
  /** Gives a card its workstation back during the undo window after it was taken, with what came of it, as the status bar does. */
  const keepWorkstation = async (i: Item) => {
    try {
      await api.act(i.id, { action: 'keepWorkstation' });
      showAck(t.workstations.keptBack(plain(i.title)));
    } catch (e) {
      showAck(e instanceof ApiError && e.code === 'notEvictable' ? t.voice.tooLate : failText(e));
    }
  };
  const sections: Record<Section, Item[]> = {
    queued: queueOrder(items).filter(listed),
    planned: items.filter((i) => listed(i) && agentStage(i, isUnderway(i.id)) === 'planned').sort(plannedOrder),
    parked: items.filter((i) => listed(i) && inParkingLot(i)),
    done: items.filter((i) => listed(i) && !inParkingLot(i) && !agentStage(i, isUnderway(i.id)) && finishedArchivable(i) && !needsYou(i) && !snoozeOf(i)?.waiting && !runs(i) && !isUnderway(i.id)),
  };
  const full = SECTIONS.filter((x) => sections[x].length);
  const fold = (x: Section, open: boolean) => setFolded(open ? folded.filter((f) => f !== x) : [...folded, x]);
  /** A section of the list from the menu: the pages over the list close, it unfolds and scrolls into view. */
  const showSection = (x: Section) => {
    setMenuOpen(false);
    closeNeeds();
    closeSettings();
    fold(x, true);
    requestAnimationFrame(() => document.querySelector(`.ph-next-${x}`)?.scrollIntoView({ block: 'start' }));
  };

  return (
    <HoldToTalk.Provider value={press}>
      {feeds}
      <div id="ph-home" className={pageClass} ref={homeRef} inert={needsOn || settingsOn || searching || !!s.talk}>
        <TopBar projects={projects} project={seismicId} onProject={setSeismicProject} usage={usage} onMenu={() => setMenuOpen(true)} />
        {banner}
        <Notify />
        {snap && (
          <>
            <WorkingBox
              open={workingOpen}
              onOpen={setWorkingOpen}
              cards={working}
              atWork={atWork}
              onKeep={(i) => void keepWorkstation(i)}
              snap={snap}
              projects={projects}
              onCard={openCard}
              onElsewhere={(c, card) => {
                setSeismicProject(c);
                s.openId(card);
              }}
            />
            {!full.length && <p className="hint mt-6 text-center">{t.phone.next.none}</p>}
            {full.map((x) => {
              const cards = sections[x];
              const n = shownOf(x);
              return (
                <Collapsible key={x} open={!folded.includes(x)} onOpenChange={(o) => fold(x, o)} className={cn(sectionClass, `ph-next-${x}`)}>
                  <CollapsibleTrigger className="group mb-2 flex w-full items-center gap-2.5 py-1">
                    <span className="text-xl leading-[1.15] font-semibold">{t.phone.next.sections[x]}</span>
                    <Badge variant="count" className="rounded-lg bg-muted px-2 py-1.5 text-sm font-semibold text-muted-foreground [text-box:trim-both_cap_alphabetic]">
                      {cards.length}
                    </Badge>
                    <ChevronDown size={18} strokeWidth={2} className="ml-auto text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" aria-hidden="true" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardList entries={cards.slice(0, n).map(entriesOf)} onOpen={openCard} />
                    {cards.length > n && (
                      <button
                        className="mt-3 w-full rounded-lg border border-border bg-transparent py-2.5 text-base text-foreground cursor-pointer"
                        onClick={() => setShown({ project: seismicId, n: { ...(shown.project === seismicId ? shown.n : {}), [x]: n + PAGE } })}
                      >
                        {t.phone.next.loadMore(cards.length - n)}
                      </button>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </>
        )}
      </div>
      {needsOn && !searching && (
        <div id="ph-needs" className={cn(pageClass, 'z-20 bg-background')}>
          <header className={cn(pageBarClass, 'gap-2')}>
            <button className="-ml-1 inline-grid size-10 shrink-0 place-items-center rounded-full bg-transparent p-0" aria-label={t.phone.next.menu} onClick={() => setMenuOpen(true)}>
              <Sign size={26} />
            </button>
            <h1 className="m-0 min-w-0 flex-1 overflow-hidden text-xl font-semibold text-ellipsis whitespace-nowrap">{t.phone.next.needsYou}</h1>
            <button className="ph-close inline-grid size-10 shrink-0 place-items-center rounded-full bg-muted text-foreground cursor-pointer ph-landscape:size-9" aria-label={t.phone.next.closeNeedsYou} onClick={closeNeeds}>
              <X size={20} strokeWidth={2.25} aria-hidden="true" />
            </button>
          </header>
          {banner}
          {/* every project's entries, each naming its project; Seismic's own entries bring its project into view */}
          <div className="mt-3">
            <InboxList
              entries={entries}
              isRead={s.inboxRead.isRead}
              onRead={s.inboxRead.markRead}
              onGo={(e) => {
                if (e.card) return openCard(e.card);
                // Seismic's own entry: its chat page opens over this one, in its project; Back returns here
                setSeismicProject(e.project);
                s.openTalk();
              }}
              onProposalCard={(_project, i) => openCard(i)}
              onReply={(c, i, r) =>
                sendReply(c, i, r, {
                  mark: (id, what) => s.setUnderway((u) => (what === null ? u.filter((x) => x !== id) : [...u.filter((x) => x !== id), id])),
                  showAck,
                })
              }
            />
          </div>
        </div>
      )}
      {/* the project's settings: kept while closed, so a change that waits for the owner's word stays with it */}
      {snap && (
        <div id="ph-settings" className={cn(pageClass, 'z-20 bg-background')} hidden={!settingsOn || searching}>
          <header className={cn(pageBarClass, 'gap-2')}>
            <button className="-ml-1 inline-grid size-10 shrink-0 place-items-center rounded-full bg-transparent p-0" aria-label={t.phone.next.menu} onClick={() => setMenuOpen(true)}>
              <Sign size={26} />
            </button>
            <h1 className="m-0 min-w-0 flex-1 overflow-hidden text-xl font-semibold text-ellipsis whitespace-nowrap">{t.projectSettings.title}</h1>
            <button className="ph-close inline-grid size-10 shrink-0 place-items-center rounded-full bg-muted text-foreground cursor-pointer ph-landscape:size-9" aria-label={t.phone.next.closeSettings} onClick={closeSettings}>
              <X size={20} strokeWidth={2.25} aria-hidden="true" />
            </button>
          </header>
          <div id="project-settings" className={cn(settingsSheetClass, 'px-5.5 pt-3')}>
            <ProjectSettingsBody phone project={seismicId} name={snap.project.name} homePath={snap.project.repos[0]?.path} onAddSite={showAddSite} on={settingsOn} covered={false} />
          </div>
        </div>
      )}
      {acks}
      {/* the desktop's left menu, behind the logo at the top left, with what the phone has a view for */}
      {project && (
        <PhoneNavSheet
          open={menuOpen}
          onOpenChange={setMenuOpen}
          projects={projects}
          project={project}
          onProject={(id) =>
            leave(() => {
              setSeismicProject(id);
              closeNeeds();
              closeSettings();
              setMenuOpen(false);
            })
          }
          onInbox={() => {
            setMenuOpen(false);
            openNeeds();
          }}
          onProjectSettings={() => {
            setMenuOpen(false);
            openSettings();
          }}
          {...(sections.queued.length ? { onQueue: () => showSection('queued') } : {})}
          {...(sections.parked.length ? { onParked: () => showSection('parked') } : {})}
          {...(needsOn ? { showing: 'inbox' as const } : settingsOn ? { showing: 'settings' as const } : {})}
          canvases={[]}
          pinned={false}
          pinnable={false}
          onPin={() => {}}
        />
      )}
      {searching && <PhoneSearch items={items.filter((i) => !i.archivedAt)} query={query} onQuery={setQuery} onOpen={openCard} onClose={closeSearch} />}
      {s.talk && (
        <TalkPanel
          page
          title={t.koordinator.title}
          head={snap && <ChatsHead title={<span className={gripWordClass}>{t.koordinator.title}</span>} project={seismicId} projectName={snap.project.name} chat={snap.chat} chats={snap.chats} talk={snap.talk} onProject={setSeismicProject} onClose={s.closeTalk} />}
          label={t.phone.talkTitle}
          banner={banner}
          onClose={s.closeTalk}
          leave={s.leaveTalk}
          onLeave={() => s.setClosing(true)}
        >
          {snap && (
            <div className={talkClass} key={seismicId}>
              <KoordinatorAgent.Provider value={snap.koordinatorAgent}>
                <KoordinatorTalk
                  on
                  project={seismicId}
                  talk={snap.talk}
                  chat={snap.chat}
                  chatModel={snap.chatModel}
                  chats={snap.chats}
                  items={snap.items}
                  repos={snap.project.repos}
                  onOpen={openCard}
                  onTell={s.tellChat}
                  draft={seismicDraft(seismicId)}
                />
              </KoordinatorAgent.Provider>
            </div>
          )}
        </TalkPanel>
      )}
      {s.talk && s.mic}
      {!s.talk && !searching && !needsOn && !settingsOn && (
        <FloatingBar
          needsYou={needsYouCount(entries)}
          making={making || !!made}
          chat={snap ? unreadAnswers(snap.talk) : 0}
          chatWorking={!!snap && seismicWorks(snap.talk)}
          onNew={() => void newCard()}
          onChat={s.openTalk}
          onSearch={openSearch}
          onSettings={openSettings}
          onNeedsYou={openNeeds}
        />
      )}
    </HoldToTalk.Provider>
  );
}

/**
 * The top bar: Seismic's sign (the menu), the project in view with the phone's own picker
 * to switch it (`onProject`), and at the right the usage pills, or over an open card its X (`onClose`).
 */
function TopBar({ projects, project, onProject, usage, onClose, onMenu }: { projects: ProjectInfo[]; project: string; onProject?: (id: string) => void; usage: Usage[]; onClose?: () => void; onMenu?: () => void }) {
  const name = projects.find((c) => c.id === project)?.name;
  return (
    <header className={cn(pageBarClass, 'gap-2', onClose ? 'ph-card-top' : 'ph-home ph-landscape:static')}>
      {/* the sign opens the menu */}
      <button className="-ml-1 inline-grid size-10 shrink-0 place-items-center rounded-full bg-transparent p-0 disabled:cursor-default" aria-label={t.phone.next.menu} disabled={!onMenu} onClick={onMenu}>
        <Sign size={26} />
      </button>
      {/* the project in view; the phone's own picker switches it, remembered in this browser */}
      <label className="relative z-1 flex min-w-0 shrink items-center gap-1 rounded-sm py-1 pr-1 cursor-pointer bg-background">
        <span className="overflow-hidden text-xl font-semibold text-ellipsis whitespace-nowrap">{name}</span>
        {onProject && projects.length > 1 && <ChevronDown size={16} strokeWidth={2} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
        {onProject && projects.length > 1 && (
          <select className="absolute inset-0 h-full w-full cursor-pointer text-base opacity-0" value={project} aria-label={t.phone.next.switchProject} onChange={(e) => onProject(e.target.value)}>
            {projects.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </label>
      {/* the usage pills at the right, scrolling sideways and fading out under the project's name
          (right to left, so they start at the right end; the pills inside read left to right) */}
      {onClose ? (
        <button className="ph-close ml-auto inline-grid size-10 shrink-0 place-items-center rounded-full bg-muted text-foreground cursor-pointer ph-landscape:size-9" aria-label={t.phone.next.close} onClick={onClose}>
          <X size={20} strokeWidth={2.25} aria-hidden="true" />
        </button>
      ) : usage.some((u) => u.limits.length > 0) && (
        <div className="min-w-0 flex-1 overflow-x-auto [direction:rtl] [scrollbar-width:none] [mask-image:linear-gradient(to_right,transparent,black_18px)] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max items-center gap-1.5 pl-4 [direction:ltr]">
            {usage.map((u) => (
              <UsagePill key={u.harness} usage={u} phone compact={usage.filter((v) => v.limits.length > 0).length > 1} />
            ))}
          </div>
        </div>
      )}
    </header>
  );
}

/**
 * The X of an open card: back to its project's list. A card opened from the Needs you page has that
 * page's step before it, which browser Back returns to; the X goes on past it (`closeNeeds`) once the
 * card's own steps are undone, so the list shows and not Needs you again.
 */
function leaveCard(back: () => void, needsOn: boolean, closeNeeds: () => void) {
  if (!needsOn) return back();
  // the steps the page pushed (the card, its conversation) are traversed, which ends in a popstate; a card
  // the address named on loading is left without one
  const steps = (history.state as { steps?: string[] } | null)?.steps ?? [];
  if (steps.at(-1) === 'card' || steps.at(-1) === 'talk') addEventListener('popstate', () => closeNeeds(), { once: true });
  back();
  if (!(steps.at(-1) === 'card' || steps.at(-1) === 'talk')) closeNeeds();
}

/** The fixed top bar's height for the open card below it (`--ph-top`), while it stands. */
function measureTop(el: HTMLElement | null) {
  if (!el) return;
  const root = document.documentElement.style;
  const size = new ResizeObserver(() => root.setProperty('--ph-top', `${el.getBoundingClientRect().height}px`));
  size.observe(el);
  return () => {
    size.disconnect();
    root.removeProperty('--ph-top');
  };
}

/**
 * "● ● ○ ○ 4 working": the workstation dots of the desktop's status bar and how many cards agents
 * are on; unfolded, a line per card as the status bar's workstation list has it, a tap opening it.
 */
function WorkingBox({ open, onOpen, cards, atWork, snap, projects, onCard, onElsewhere, onKeep }: {
  open: boolean;
  onOpen: (open: boolean) => void;
  /** The cards agents are on, those whose agent is paused or snoozed last; `atWork` of them have an agent at work. */
  cards: Item[];
  atWork: number;
  onKeep: (i: Item) => void;
  snap: NonNullable<ReturnType<typeof usePhoneShell>['snaps'][string]>;
  projects: ProjectInfo[];
  onCard: (i: Item) => void;
  onElsewhere: (project: string, card: string) => void;
}) {
  const pools = snap.workstations ?? [];
  const head = (
    <>
      <WorkstationDots pools={pools} items={snap.items} underway={{}} />
      <span className="shrink-0 font-semibold whitespace-nowrap">{t.phone.next.working(atWork)}</span>
    </>
  );
  if (!cards.length) return <div className="ph-working mt-3 flex min-h-12 items-center gap-2.5 rounded-lg bg-muted px-3.5 py-2 text-base">{head}</div>;
  return (
    <Collapsible open={open} onOpenChange={onOpen} className="ph-working mt-3 rounded-lg bg-muted">
      <CollapsibleTrigger className="group flex min-h-12 w-full items-center gap-2.5 px-3.5 py-2 text-base" aria-label={`${t.phone.next.working(atWork)}: ${open ? t.phone.next.hideWorking : t.phone.next.showWorking}`}>
        {head}
        <ChevronDown size={18} strokeWidth={2} className="ml-auto shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3.5 pb-2.5 text-base">
        <WorkingRows
          cards={cards}
          pools={pools}
          items={snap.items}
          underway={{}}
          projects={projects}
          onOpen={onCard}
          onElsewhere={onElsewhere}
          onKeep={onKeep}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A button of the floating bar, a finger's size. */
const barButton = 'relative inline-grid size-11 place-items-center rounded-full bg-transparent p-0 text-foreground cursor-pointer disabled:cursor-default disabled:text-muted-foreground [&_svg]:size-[22px]';

/**
 * The floating bar along the foot: a glass pill with Menu, Chat, New card (larger, standing out of
 * the bar above and below without making it taller), Search
 * and Needs you, whose bell counts what waits across every project. Hidden while the keyboard is up;
 * with the phone turned it stands upright in the microphone's strip at the right.
 */
function FloatingBar({ needsYou, making, chat, chatWorking, onNew, onChat, onSearch, onSettings, onNeedsYou }: { needsYou: number; making: boolean; chat: number; chatWorking: boolean; onNew: () => void; onChat: () => void; onSearch: () => void; /** The project's settings, where ☰ stood: the menu is behind the logo at the top left. */ onSettings: () => void; onNeedsYou: () => void }) {
  return (
    <nav
      className="ph-float fixed z-50 left-1/2 bottom-[calc(14px+env(safe-area-inset-bottom))] -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-glass px-2 py-0.5 shadow-lift backdrop-blur-xl [.ph-kb_.ph-view~&]:hidden ph-landscape:left-auto ph-landscape:right-[calc(10px+env(safe-area-inset-right))] ph-landscape:top-1/2 ph-landscape:bottom-auto ph-landscape:-translate-y-1/2 ph-landscape:translate-x-0 ph-landscape:flex-col ph-landscape:px-1 ph-landscape:py-1"
      aria-label={t.phone.next.menu}
    >
      <button className={barButton} aria-label={t.leftMenu.projectSettings} onClick={onSettings}>
        <SlidersHorizontal aria-hidden="true" />
      </button>
      <button className={barButton} aria-label={t.phone.next.chat} title={chat ? t.koordinator.unreadCount(chat) : undefined} onClick={onChat}>
        <TalkIcon />
        {/* the conversation shows an agent at work: the moving line of a working card, along the button's foot */}
        {chatWorking && <DrawLine className="absolute inset-x-2.5 bottom-1 w-auto" />}
        {chat > 0 && (
          <Badge variant="count" tone="waiting" className="absolute top-0.5 right-0.5">
            {chat}
          </Badge>
        )}
      </button>
      <button
        className="ph-new mx-1.5 -my-4 ph-landscape:-mx-4 ph-landscape:my-1.5 inline-grid size-[60px] place-items-center rounded-full bg-foreground p-0 text-background shadow-lift cursor-pointer [-webkit-touch-callout:none] select-none active:translate-y-px disabled:opacity-60 disabled:cursor-default"
        aria-label={t.newCard}
        disabled={making}
        onClick={onNew}
      >
        <Plus size={28} strokeWidth={2.25} aria-hidden="true" />
      </button>
      <button className={barButton} aria-label={t.phone.next.search} onClick={onSearch}>
        <Search aria-hidden="true" />
      </button>
      <button className={barButton} aria-label={needsYou ? `${t.phone.next.needsYou}: ${t.phone.next.needsYouCount(needsYou)}` : t.phone.next.needsYou} onClick={onNeedsYou}>
        <Bell aria-hidden="true" />
        {needsYou > 0 && (
          <Badge variant="count" tone="waiting" className="absolute top-0.5 right-0.5">
            {needsYou}
          </Badge>
        )}
      </button>
    </nav>
  );
}

/**
 * Whether a page over the project is open (Needs you, `needs`; the project's settings, `settings`),
 * kept in the address (`?needs`) so Back and a reload hold it; opening is a step in the browser's
 * history, closing takes it back (or drops it from the address where the page was loaded on it).
 */
type PhonePage = 'needs' | 'settings';
function usePage(): [PhonePage | null, (page: PhonePage) => void, () => void] {
  const read = (): PhonePage | null => {
    const q = new URLSearchParams(location.search);
    return q.has('settings') ? 'settings' : q.has('needs') ? 'needs' : null;
  };
  const [page, setPage] = useState(read);
  useEffect(() => {
    const pop = () => setPage(read());
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);
  const address = (next: PhonePage | null) => {
    const q = new URLSearchParams(location.search);
    q.delete('needs');
    q.delete('settings');
    if (next) q.set(next, '');
    const text = q.toString().replace(/=(&|$)/g, '$1');
    return `${location.pathname}${text ? `?${text}` : ''}${location.hash}`;
  };
  return [page, (next) => {
    const current = read();
    if (current === next) return;
    // Switching sibling pages replaces their one history step; no asynchronous back can
    // arrive after a push and dismiss the page that was just opened.
    const state = { ...history.state, needs: undefined, settings: undefined };
    const pushed = current ? !!history.state?.[current] : true;
    if (pushed) state[next] = true;
    if (current) history.replaceState(state, '', address(next));
    else history.pushState(state, '', address(next));
    setPage(next);
  }, () => {
    const current = read();
    if (!current) return;
    if (history.state?.[current]) history.back();
    else history.replaceState(history.state, '', address(null));
    setPage(null);
  }];
}
