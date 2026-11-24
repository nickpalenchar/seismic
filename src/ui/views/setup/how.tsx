// The setup's first step in the desktop app, on this machine's first start alone: "How do you want
// to use Seismic?". "On this machine" goes on to the setup's steps here, "Remote connection" shows
// the remote workspaces the app knows and the form that pairs another. A remote Seismic without
// projects does not ask: it goes on to set itself up. "Learn more" stands outside the radio's label,
// so a click on it opens the guide without choosing.

import { useEffect, useState } from 'react';
import { Sign } from '../../logo';
import { t } from '../../strings';
import { Button, LinkButton } from '../../components/button';
import { RadioGroup, RadioOption } from '../../components/radio';
import { Spinner } from '../../components/spinner';
import { cn } from 'cn';
import { ConnectForm, errorClass } from '../../desks/connect';
import { DeskIcon, Unread } from '../../desks/page';
import { deskError, desks, GUIDE, LOCAL, onThisMachine, useDesks, useDesksFailed } from '../../desks/shell';

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
  const [choice, setChoice] = useState<'here' | 'remote'>('here');
  const [problem, setProblem] = useState('');
  const local = onThisMachine(all);
  // a remote Seismic's page sets that machine up without asking
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
              <RadioOption key={c} value={c} className={cn('grid grid-cols-[auto_1fr] content-start items-center gap-x-2.5 gap-y-0.5 m-0 rounded-lg border cursor-pointer [&_.hint]:col-start-2', choice === c ? 'border-2 border-foreground p-3' : 'border-border px-3.5 py-3 hover:border-foreground')}>
                <b className="[overflow-wrap:anywhere]">{options[c].title}</b>
                <span className="hint">{options[c].hint}</span>
              </RadioOption>
            ))}
          </RadioGroup>
          <div>
            <LinkButton className="text-sm" onClick={() => window.open(GUIDE, '_blank', 'noopener')}>
              {h.learnMore}
            </LinkButton>
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
                        <Button size="small" onClick={() => void desks.open(d.id).catch((e) => setProblem(deskError(e, d.origin ?? '')))}>
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
            </>
          ) : (
            <div className="flex justify-end">
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
