// Agent work: slides out from the floating row's robot button, which counts the queued cards in grey.
// Its first tab holds "Working" (the cards at work, src/core/agents.ts) and "Todo": the cards waiting
// to start in turn, dragged to their place as on a waiting card (src/ui/queue.tsx), then the planned
// ones; each card a pane like an inbox entry (its face at size S), whose title or "Go to card" opens
// it. Cards that need the owner are in "Needs you" instead (src/ui/needsYou.tsx), the parked ones in
// the Parked view (src/ui/views.tsx). "Activity" is the log of what happened on the cards (src/ui/activity.tsx).
// The phone keeps its own lists with the tabs and stage chips below.

import { useEffect, useRef } from 'react';
import { agentStage, agentWork } from '../core/agents';
import { waitsFor } from '../core/inbox';
import type { Item } from '../core/types';
import { ActivityTab } from './activity';
import { CardFace, shownTitle } from './card';
import { Docked } from './docked';
import { Inline, plain } from './markdown';
import { QueueList, useQueueSort } from './queue';
import { useStoredState } from './stored';
import { t } from './strings';
import { Button } from './components/button';
import { ToggleGroup, ToggleItem } from './components/segmented';
import { Tabs, TabsList, TabsTrigger } from './components/tabs';

export type AgentsTab = 'queue' | 'all' | 'parked' | 'activity';
type Tab = AgentsTab;

/** The tab chosen last in this browser, the desktop's sheet and the phone's list alike; `first` until one was chosen. */
export function useAgentsTab(first: Tab): [Tab, (t: Tab) => void] {
  const [kept, setTab] = useStoredState<Tab | null>('obeya-agents-tab', null);
  const tab: Tab = kept === 'queue' || kept === 'parked' || kept === 'activity' || kept === 'all' ? kept : first;
  return [tab, setTab];
}

/** The switch between the four tabs, the queue's count on "Queue" and the parked cards' on "Parked". */
export function AgentsTabs({ tab, onTab, queued, parked }: { tab: Tab; onTab: (t: Tab) => void; queued: number; parked: number }) {
  return (
    <Tabs value={tab} onValueChange={(k) => onTab(k as Tab)}>
      <TabsList variant="segmented" className="agents-tabs" aria-label={t.agents.title}>
        {(['queue', 'all', 'parked', 'activity'] as const).map((k) => (
          <TabsTrigger key={k} value={k}>
            {t.agents.tabs[k]}
            {k === 'queue' && queued > 0 && <span className="n">{queued}</span>}
            {k === 'parked' && parked > 0 && <span className="count">{parked}</span>}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/**
 * The chips above "All": one per stage with its count, tinted while its group shows; a tap shows or
 * hides the group. With `onlyFull` (the phone, where the row has room for few) a stage without cards has none.
 */
export function StageChips<S extends string>({ stages, count, hidden, onHidden, onlyFull }: { stages: readonly S[]; count: (s: S) => number; hidden: S[]; onHidden: (h: S[]) => void; onlyFull?: boolean }) {
  return (
    <ToggleGroup type="multiple" className="agents-filter" aria-label={t.agents.filter} value={stages.filter((s) => !hidden.includes(s))} onValueChange={(shown) => onHidden(stages.filter((s) => !shown.includes(s)))}>
      {stages.filter((s) => !onlyFull || count(s) > 0).map((s) => (
        <ToggleItem key={s} value={s} className={`chip stage-${s}${count(s) ? '' : ' none'}`}>
          {(t.agents.stages as Record<string, string>)[s]} <span className="count">{count(s)}</span>
        </ToggleItem>
      ))}
    </ToggleGroup>
  );
}

/** The desktop's Agent work tabs: the cards at work and to do, and the log. */
type WorkTab = 'work' | 'activity';

/** The desktop's Agent work, docked on the right: "Working" and "Todo" (the queue, then the planned cards), and "Activity". */
export function AgentsSheet({ on, items, open, underway, onOpen, project, changed, onGo }: { on: boolean; items: Item[]; open?: string; underway: (id: string) => boolean; onOpen: (i: Item) => void; project: string; changed: unknown; onGo: (project: string, i: Item) => void }) {
  const [kept, setTab] = useStoredState<WorkTab | null>('obeya-agent-work-tab', null);
  const tab: WorkTab = kept === 'activity' ? kept : 'work';
  const box = useRef<HTMLElement>(null);
  const q = useQueueSort(items, box);
  // the sheet closed or the tab changed under a drag: the row is not dropped anywhere
  useEffect(() => {
    if (!on || tab !== 'work') q.sort.cancel();
  }, [on, tab]);
  const { working, planned } = agentWork(items, underway);
  const todo = q.queued.length + planned.length;
  const entry = (i: Item) => <AgentEntry key={i.id} item={i} here={i.id === open} underway={underway(i.id)} onOpen={onOpen} />;
  return (
    <Docked id="agents" ref={box} on={on} label={t.agents.work.title}>
      <h2>{t.agents.work.title}</h2>
      <Tabs value={tab} onValueChange={(k) => setTab(k as WorkTab)}>
        <TabsList variant="segmented" className="agents-tabs" aria-label={t.agents.work.title}>
          {(['work', 'activity'] as const).map((k) => (
            <TabsTrigger key={k} value={k}>
              {t.agents.work.tabs[k]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab === 'activity' ? (
        <ActivityTab project={project} changed={changed} open={open} onGo={onGo} />
      ) : (
        <>
          <section className="agents-stage">
            <h3>
              {t.agents.work.working} <span className="count">{working.length}</span>
            </h3>
            {working.length ? <ul className="inbox-list">{working.map(entry)}</ul> : <p className="hint agents-empty">{t.agents.work.noneWorking}</p>}
          </section>
          <section className="agents-stage">
            <h3>
              {t.agents.work.todo} <span className="count">{todo}</span>
            </h3>
            {!todo && <p className="hint agents-empty">{t.agents.work.noneTodo}</p>}
            {q.queued.length > 0 && (
              <>
                <h4>
                  {t.agents.work.queued} <span className="n">{q.queued.length}</span>
                </h4>
                <QueueList items={items} q={q} onOpen={onOpen} />
              </>
            )}
            {planned.length > 0 && (
              <>
                {q.queued.length > 0 && <h4>{t.agents.stages.planned}</h4>}
                <ul className="inbox-list">{planned.map(entry)}</ul>
              </>
            )}
          </section>
        </>
      )}
    </Docked>
  );
}

/** A card, as the inbox shows an entry: its face at size S, with what it waits for where it needs the owner, and "Go to card". With `els`, a card opened from it unfolds from it. */
export function AgentEntry({ item: i, els, here, underway, onOpen }: { item: Item; els?: Map<string, HTMLElement>; here: boolean; underway: boolean; onOpen: (i: Item) => void }) {
  const stage = agentStage(i, underway);
  // what it waits for where it needs the owner, as its inbox entry says; else the line its card shows under its title
  const waits = stage === 'needsYou' ? waitsFor(i) : undefined;
  return (
    <li ref={els ? (el) => void (el ? els.set(i.id, el) : els.delete(i.id)) : undefined} className={`inbox-entry agent-entry stage-${stage ?? 'parked'}${here ? ' on' : ''}`} aria-current={here || undefined}>
      <CardFace
        item={i}
        size="s"
        title={
          <button type="button" className="ttl-link" onClick={() => onOpen(i)}>
            {i.title ? plain(i.title) : shownTitle(i)}
          </button>
        }
        text={waits && <Inline md={waits} />}
      >
        <div className="replies">
          <Button type="button" onClick={() => onOpen(i)}>
            {t.inbox.goToCard}
          </Button>
        </div>
      </CardFace>
    </li>
  );
}
