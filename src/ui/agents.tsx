// The Agents sheet: slides out from the bar's robot button, which counts the queued cards in grey, and
// holds two tabs. "Queue" lists the cards waiting to start in turn, dragged to their place as on a
// waiting card (src/ui/queue.tsx); "All" lists the project's other cards by the stage they are at,
// those that need the owner first (src/core/agents.ts), each card a pane like an inbox entry, under
// a chip per stage that shows or hides its group. A row's title or "Go to card" opens its card.

import { useEffect, useRef } from 'react';
import { AGENT_STAGES, type AgentStage, agentStage, byStage } from '../core/agents';
import { waitsFor } from '../core/inbox';
import { demoStage, type Item } from '../core/types';
import { Docked } from './docked';
import { Inline, plain } from './markdown';
import { QueueList, useQueueSort } from './queue';
import { useStoredState } from './stored';
import { stateLabel, t } from './strings';

type Tab = 'queue' | 'all';

/** The desktop's Agents sheet, docked on the right like the inbox. */
export function AgentsSheet({ on, items, open, underway, onOpen }: { on: boolean; items: Item[]; open?: string; underway: (id: string) => boolean; onOpen: (i: Item) => void }) {
  const [kept, setTab] = useStoredState<Tab>('obeya-agents-tab', 'queue');
  const tab: Tab = kept === 'queue' ? 'queue' : 'all';
  const box = useRef<HTMLElement>(null);
  const q = useQueueSort(items, box);
  // the sheet closed or the tab changed under a drag: the row is not dropped anywhere
  useEffect(() => {
    if (!on || tab !== 'queue') q.sort.cancel();
  }, [on, tab]);
  const groups = byStage(items, underway);
  // the groups the owner switched off with their chips above the list
  const [hidden, setHidden] = useStoredState<AgentStage[]>('obeya-agents-hidden', []);
  const count = (s: AgentStage) => groups.find((g) => g.stage === s)?.items.length ?? 0;
  const shown = groups.filter((g) => !hidden.includes(g.stage));
  return (
    <Docked id="agents" ref={box} on={on} label={t.agents.title}>
      <h2>{t.agents.title}</h2>
      <div className="seg agents-tabs" role="tablist" aria-label={t.agents.title}>
        {(['queue', 'all'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : undefined} onClick={() => setTab(k)}>
            {t.agents.tabs[k]}
            {k === 'queue' && q.queued.length > 0 && <span className="n">{q.queued.length}</span>}
          </button>
        ))}
      </div>
      {tab === 'queue' ? (
        q.queued.length ? <QueueList items={items} q={q} onOpen={onOpen} /> : <p className="hint agents-empty">{t.queue.empty}</p>
      ) : (
        <>
          <div className="agents-filter" role="group" aria-label={t.agents.filter}>
            {AGENT_STAGES.map((s) => (
              <button key={s} type="button" className={`chip stage-${s}${count(s) ? '' : ' none'}`} aria-pressed={!hidden.includes(s)} onClick={() => setHidden(hidden.includes(s) ? hidden.filter((x) => x !== s) : [...hidden, s])}>
                {t.agents.stages[s]} <span className="count">{count(s)}</span>
              </button>
            ))}
          </div>
          {!groups.length ? (
            <p className="hint agents-empty">{t.agents.none}</p>
          ) : !shown.length ? (
            <p className="hint agents-empty">{t.agents.allHidden}</p>
          ) : (
            shown.map((g) => (
          <section key={g.stage} className="agents-stage">
            <h3>
              {t.agents.stages[g.stage]} <span className="count">{g.items.length}</span>
            </h3>
            <ul className="inbox-list">
              {g.items.map((i) => (
                <AgentEntry key={i.id} item={i} here={i.id === open} underway={underway(i.id)} onOpen={onOpen} />
              ))}
            </ul>
          </section>
            ))
          )}
        </>
      )}
    </Docked>
  );
}

/** A card, as the inbox shows an entry: its title large, its state with what the agent does, what it waits for or its status line, and "Go to card". */
function AgentEntry({ item: i, here, underway, onOpen }: { item: Item; here: boolean; underway: boolean; onOpen: (i: Item) => void }) {
  const doing = i.doing && i.doing !== 'working' ? t.doing[i.doing] : '';
  // what it waits for where it needs the owner, as its inbox entry says, else what its agent reported last
  const text = agentStage(i, underway) === 'needsYou' ? waitsFor(i) : i.statusLine;
  return (
    <li className={`inbox-entry agent-entry stage-${agentStage(i, underway)}${here ? ' on' : ''}`} aria-current={here || undefined}>
      <div className="ttl">
        <button type="button" className="ttl-link" onClick={() => onOpen(i)}>
          {plain(i.title)}
        </button>
      </div>
      <div className="state">
        {stateLabel(i)}
        {doing && <span className={i.doing && demoStage(i.doing) ? 'doing demo' : 'doing'}> · {doing}</span>}
      </div>
      {text && <div className="text"><Inline md={text} /></div>}
      <div className="replies">
        <button type="button" className="btn" onClick={() => onOpen(i)}>
          {t.inbox.goToCard}
        </button>
      </div>
    </li>
  );
}
