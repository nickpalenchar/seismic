// The workspaces page, on this machine's Seismic in the desktop app (`/workspaces`): the list, each
// workspace with "Open" and its cog (the dialog with name, address, "Pair again" and "Delete
// workspace"), and "New workspace" with the form that pairs one. `?new` opens with the form,
// `?edit=<id>` with that workspace's dialog: the menu's "New Workspace…" and a remote page's
// switcher lead here so. A remote Seismic's page cannot change the list: it leads here instead.

import { ArrowLeft, Cloud, Cog, Monitor, Plus } from 'lucide-react';
import { useState } from 'react';
import { Sign } from '../logo';
import { t } from '../strings';
import { Badge } from '../components/badge';
import { Button, IconButton } from '../components/button';
import { Spinner } from '../components/spinner';
import { cn } from 'cn';
import { ConnectForm, errorClass } from './connect';
import { EditDesk } from './edit';
import { backFromWorkspaces, currentDesk, type Desk, deskError, desks, LOCAL, onThisMachine, openWorkspaces, readDesks, useDesks, useDesksFailed } from './shell';

/** The page's pane, as the setup's first start has it. */
export const deskPageClass = 'fixed inset-0 overflow-y-auto bg-background';
export const deskPaneClass = 'frost-pane mx-auto mt-14 mb-12 grid max-w-[720px] gap-5 px-7 pt-6 pb-7';

export function WorkspacesPage() {
  const p = t.desks.page;
  const all = useDesks();
  const failed = useDesksFailed();
  const [asked] = useState(() => new URLSearchParams(location.search));
  const [adding, setAdding] = useState(asked.has('new'));
  const [editing, setEditing] = useState<string | null>(asked.get('edit'));
  const edited = all?.list.find((d) => d.id === editing);
  const here = onThisMachine(all);
  return (
    <div className={cn(deskPageClass, 'desks-page')}>
      <div className={deskPaneClass}>
        <header className="flex items-center gap-3.5">
          <Sign size={34} />
          <div className="min-w-0 flex-1">
            <div className="p-kind">{p.kind}</div>
            <h2 className="m-0">{p.title}</h2>
          </div>
          <Button size="small" onClick={backFromWorkspaces}>
            <ArrowLeft aria-hidden />
            {p.back}
          </Button>
        </header>
        {!all ? (
          failed ? <Unread /> : <Spinner className="justify-self-center text-muted-foreground" />
        ) : !here ? (
          <Elsewhere all={all} />
        ) : (
          <>
            <p className="m-0 text-sm text-muted-foreground">{p.intro}</p>
            <ul className="m-0 grid list-none gap-2 p-0">
              {all.list.map((d) => (
                <DeskRow key={d.id} desk={d} shown={d.id === all.current} onEdit={() => setEditing(d.id)} />
              ))}
            </ul>
            {adding ? (
              <section className="grid gap-3 rounded-lg border border-border p-4">
                <h3 className="m-0 text-base">{t.desks.connect.title}</h3>
                <ConnectForm autoFocus onCancel={() => setAdding(false)} />
              </section>
            ) : (
              <div>
                <Button onClick={() => setAdding(true)}>
                  <Plus aria-hidden />
                  {t.desks.newDesk}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      {here && edited && <EditDesk key={edited.id} desk={edited} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Where a workspace runs: a monitor for this machine, a cloud for another. */
export function DeskIcon({ desk, size = 16 }: { desk: Pick<Desk, 'local'>; size?: number }) {
  const Icon = desk.local ? Monitor : Cloud;
  return <Icon size={size} strokeWidth={2} className="flex-none text-muted-foreground" aria-hidden />;
}

function DeskRow({ desk, shown, onEdit }: { desk: Desk; shown: boolean; onEdit: () => void }) {
  const p = t.desks.page;
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState('');
  const open = () => {
    setOpening(true);
    setProblem('');
    // once it opens, the window shows that workspace and this page goes
    desks.open(desk.id).then(
      () => setOpening(false),
      (e) => (setOpening(false), setProblem(deskError(e, desk.origin ?? ''))),
    );
  };
  return (
    <li className={cn('desk-row grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3.5 py-2.5', shown && 'bg-muted')}>
      <DeskIcon desk={desk} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <b className="[overflow-wrap:anywhere]">{desk.name}</b>
          <span className="text-xs text-muted-foreground">{desk.local ? t.desks.thisMachine : t.desks.remote}</span>
        </div>
        {/* a long address wraps, never scrolls sideways */}
        {desk.origin && <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{desk.origin}</div>}
      </div>
      <div className="flex items-center gap-1.5">
        {shown ? (
          <Badge variant="secondary">{p.shown}</Badge>
        ) : (
          <Button size="small" disabled={opening} onClick={open}>
            {opening && <Spinner className="size-3.5" />}
            {p.open}
          </Button>
        )}
        <IconButton icon={<Cog />} label={t.desks.settings} variant="ghost" onClick={onEdit} />
      </div>
      {problem && <p role="alert" className={cn(errorClass, 'col-[2/-1]')}>{problem}</p>}
    </li>
  );
}

/** A remote Seismic's page at this address: the list is this machine's to change. */
function Elsewhere({ all }: { all: NonNullable<ReturnType<typeof useDesks>> }) {
  const p = t.desks.page;
  const [going, setGoing] = useState(false);
  const [problem, setProblem] = useState('');
  const shown = currentDesk(all);
  return (
    <div className="grid justify-items-start gap-3">
      <p className="m-0 text-sm text-muted-foreground">{p.elsewhere}</p>
      <Button
        variant="primary"
        disabled={going}
        onClick={() => {
          setGoing(true);
          openWorkspaces(all, shown && shown.id !== LOCAL ? `?edit=${encodeURIComponent(shown.id)}` : '').catch((e) => (setGoing(false), setProblem(deskError(e))));
        }}
      >
        {going && <Spinner className="size-3.5" />}
        {p.openHere}
      </Button>
      {problem && <p role="alert" className={errorClass}>{problem}</p>}
    </div>
  );
}

/** The list could not be read: what the page says, and "Try again". */
export function Unread() {
  return (
    <div className="grid justify-items-start gap-2">
      <p className="m-0 text-sm text-muted-foreground">{t.desks.unread}</p>
      <Button size="small" onClick={readDesks}>
        {t.desks.retry}
      </Button>
    </div>
  );
}
