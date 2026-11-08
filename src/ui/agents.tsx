// The Agents sheet: slides out from the bar's robot button, which counts the queued cards in grey, and
// holds two tabs. "Queue" lists the cards waiting to start in turn, dragged to their place as on a
// waiting card (src/ui/queue.tsx); "Working" lists the cards whose agent is at work, grouped by the
// stage it is at (src/core/agents.ts). A row opens its card.

import { useEffect, useRef } from 'react';
import { byStage } from '../core/agents';
import { demoStage, type Item } from '../core/types';
import { Docked } from './docked';
import { plain } from './markdown';
import { QueueList, useQueueSort } from './queue';
import { useStoredState } from './stored';
import { stateLabel, t } from './strings';

type Tab = 'queue' | 'working';

/** The desktop's Agents sheet, docked on the right like the inbox. */
export function AgentsSheet({ on, items, open, onOpen }: { on: boolean; items: Item[]; open?: string; onOpen: (i: Item) => void }) {
  const [tab, setTab] = useStoredState<Tab>('obeya-agents-tab', 'queue');
  const box = useRef<HTMLElement>(null);
  const q = useQueueSort(items, box);
  // the sheet closed or the tab changed under a drag: the row is not dropped anywhere
  useEffect(() => {
    if (!on || tab !== 'queue') q.sort.cancel();
  }, [on, tab]);
  const groups = byStage(items);
  return (
    <Docked id="agents" ref={box} on={on} label={t.agents.title}>
      <h2>{t.agents.title}</h2>
      <div className="seg agents-tabs" role="tablist" aria-label={t.agents.title}>
        {(['queue', 'working'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : undefined} onClick={() => setTab(k)}>
            {t.agents.tabs[k]}
            {k === 'queue' && q.queued.length > 0 && <span className="n">{q.queued.length}</span>}
          </button>
        ))}
      </div>
      {tab === 'queue' ? (
        q.queued.length ? <QueueList items={items} q={q} onOpen={onOpen} /> : <p className="hint agents-empty">{t.queue.empty}</p>
      ) : groups.length ? (
        groups.map((g) => (
          <section key={g.stage} className="agents-stage">
            <h3>
              {t.agents.stages[g.stage]} <span className="count">{g.items.length}</span>
            </h3>
            <ol className="qlist">
              {g.items.map((i) => (
                <li key={i.id} className={i.id === open ? 's-working on' : 's-working'} onClick={() => onOpen(i)}>
                  <span className="dot" />
                  <span className="q-what">
                    {plain(i.title)}
                    <br />
                    <span className="hint">{i.doing && demoStage(i.doing) ? t.doing[i.doing] : stateLabel(i)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ))
      ) : (
        <p className="hint agents-empty">{t.agents.noneWorking}</p>
      )}
    </Docked>
  );
}
