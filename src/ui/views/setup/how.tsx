





import { createContext, useContext, useEffect, useState } from 'react';
import { Sign } from '../../logo';
import { t } from '../../strings';
import { Button, ExternalLink } from '../../components/button';
import { RadioGroup, RadioOption } from '../../components/radio';
import { ConfirmDialog } from '../../components/dialog';
import { Spinner } from '../../components/spinner';
import { cn } from 'cn';
import { ConnectForm, errorClass } from '../../desks/connect';
import { DeskIcon, Unread } from '../../desks/page';
import { currentDesk, deskError, desks, GUIDE, LOCAL, onThisMachine, useDesks, useDesksFailed, usePairing } from '../../desks/shell';

const CHOSEN = 'seismic-setup-here';
/** Whether "On this machine" (or "Set up …") was chosen in this tab: a reload goes on with the setup. */
export const setUpHereChosen = () => {
  try {
    return sessionStorage.getItem(CHOSEN) === '1';
  } catch {
    return false;
  }
};
const choose = (here: boolean) => {
  try {
    if (here) sessionStorage.setItem(CHOSEN, '1');
    else sessionStorage.removeItem(CHOSEN);
  } catch {}
};
/** The setup's Back from its first step: the question comes again. */
export const askAgain = () => choose(false);

export function HowStep({ onHere }: { onHere: () => void }) {
  const h = t.desks.how;
  const all = useDesks();
  const failed = useDesksFailed();
  const pairing = usePairing();
  const [choice, setChoice] = useState<'here' | 'remote'>('here');
  const [problem, setProblem] = useState('');
  const local = onThisMachine(all);
  
  useEffect(() => {
    if (all && !local) onHere();
  }, [all, local]);
  const options = {
    here: { title: h.local, hint: h.localHint },
    remote: { title: h.remote, hint: h.remoteHint },
  };
  const next = () => {
    choose(true);
    onHere();
  };
  const known = all?.list.filter((d) => d.id !== LOCAL) ?? [];
  return (
    <div className="desk-how grid gap-4">
      <header className="flex items-center gap-3.5">
        <Sign size={34} />
        <div>
          <div className="p-kind">{t.setup.kind}</div>
          <h2 className="m-0">{h.title}</h2>
        </div>
      </header>
      {!all || !local ? (
        failed ? <Unread /> : <Spinner className="justify-self-center text-muted-foreground" />
      ) : (
        <>
          <RadioGroup className="grid grid-cols-2 gap-2.5" label={h.title} value={choice} onValueChange={(v) => (setChoice(v as typeof choice), setProblem(''))}>
            {(['here', 'remote'] as const).map((c) => (
              <RadioOption key={c} value={c} disabled={pairing} className={cn('grid grid-cols-[auto_1fr] content-start items-center gap-x-2.5 gap-y-0.5 m-0 rounded-lg border cursor-pointer [&_.hint]:col-start-2', choice === c ? 'border-2 border-foreground p-3' : 'border-border px-3.5 py-3 hover:border-foreground')}>
                <b className="[overflow-wrap:anywhere]">{options[c].title}</b>
                <span className="hint">{options[c].hint}</span>
              </RadioOption>
            ))}
          </RadioGroup>
          <div>
            <ExternalLink className="text-sm" href={GUIDE}>
              {h.learnMore}
            </ExternalLink>
          </div>
          {choice === 'remote' ? (
            <>
              {known.length > 0 && (
                <section className="grid gap-2">
                  <h3 className="m-0 text-base">{h.known}</h3>
                  <ul className="m-0 grid list-none gap-1.5 p-0">
                    {known.map((d) => (
                      <li key={d.id} className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-2">
                        <DeskIcon desk={d} />
                        <span className="min-w-0 flex-1">
                          <b className="block [overflow-wrap:anywhere]">{d.name}</b>
                          <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{d.origin}</span>
                        </span>
                        <Button size="small" disabled={pairing} onClick={() => void desks.open(d.id).catch((e) => setProblem(deskError(e, d.origin ?? '')))}>
                          {t.desks.page.open}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section className="grid gap-3 rounded-lg border border-border p-4">
                <h3 className="m-0 text-base">{t.desks.connect.title}</h3>
                <ConnectForm />
              </section>
              <div className="flex">
                <ExitSetup />
              </div>
            </>
          ) : (
            <div className="flex justify-end gap-2">
              <ExitSetup />
              <Button variant="primary" onClick={next}>
                {h.next}
              </Button>
            </div>
          )}
          {problem && <p role="alert" className={errorClass}>{problem}</p>}
        </>
      )}
    </div>
  );
}


export const FirstStart = createContext(false);

/**
 * "Exit setup", on the left of each step's buttons on the first start in the app, while another
 * workspace is on the list: after a confirmation the window switches there, to this machine's from a
 * remote one, else to the first remote one. The setup stays where it was and goes on when its
 * workspace is opened again; without it, a machine in setup has no way to another outside a Mac's
 * Workspace menu.
 */
export function ExitSetup() {
  const x = t.desks.exit;
  const first = useContext(FirstStart);
  const all = useDesks();
  const pairing = usePairing();
  const [asking, setAsking] = useState(false);
  const [going, setGoing] = useState(false);
  const [problem, setProblem] = useState('');
  const shown = currentDesk(all);
  const to = shown && (shown.local ? all?.list.find((d) => !d.local) : all?.list.find((d) => d.local));
  if (!first || !shown || !to) return null;
  const exit = () => {
    setGoing(true);
    setProblem('');
    
    desks.open(to.id).then(
      () => setGoing(false),
      (e) => (setGoing(false), setProblem(deskError(e, to.origin ?? ''))),
    );
  };
  return (
    <>
      <Button size="small" className="desk-exit mr-auto" disabled={pairing} onClick={() => (setProblem(''), setAsking(true))}>
        {x.button}
      </Button>
      <ConfirmDialog
        open={asking}
        onOpenChange={(open) => !going && setAsking(open)}
        layerClassName="z-90"
        scrollBody
        title={x.title}
        confirm={{ label: <>{going && <Spinner className="size-3.5" />}{x.confirm}</>, onClick: exit, keepOpen: true }}
        cancel={x.stay}
        busy={going}
      >
        <p>{x.text(shown.name, to.name)}</p>
        {problem && <p role="alert" className={errorClass}>{problem}</p>}
      </ConfirmDialog>
    </>
  );
}
