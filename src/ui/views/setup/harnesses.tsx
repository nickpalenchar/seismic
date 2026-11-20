/** Connected harnesses in Configuration, with their current usage and the setup wizard. */
import { useEffect, useRef, useState } from 'react';
import type { Harness, Usage } from '../../../core/types';
import { api } from '../../api';
import { Button } from '../../components/button';
import { ConfirmDialog } from '../../components/dialog';
import { failText, t } from '../../strings';
import { HarnessMark, UsageDetails } from '../../usage';
import { Setup } from './setup';

export function Harnesses({ usage }: { usage: Usage[] }) {
  const [configured, setConfigured] = useState<Harness[]>();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Harness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const addButton = useRef<HTMLButtonElement>(null);
  const w = t.config.harnesses;
  const names = t.config.agents.harnesses;
  useEffect(() => {
    let active = true;
    api.harnesses().then(
      (saved) => { if (active) setConfigured(saved); },
      (error) => { if (active) setError(failText(error)); },
    );
    return () => { active = false; };
  }, [attempt]);

  const back = () => {
    setAdding(false);
    requestAnimationFrame(() => addButton.current?.focus());
  };
  const disconnect = async (harness: Harness) => {
    setBusy(true);
    setError('');
    try {
      setConfigured(await api.setHarness(harness, false));
      requestAnimationFrame(() => addButton.current?.focus());
    } catch (error) {
      setError(failText(error, { detail: ['invalid'] }));
    } finally {
      setBusy(false);
    }
  };

  if (adding && configured) return <Setup wizard={{
    configured,
    onBack: back,
    onSaved: (saved, done) => {
      setConfigured(saved);
      if (done) back();
    },
  }} />;

  return (
    <div className="max-w-3xl">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-xl font-semibold">{t.config.sections.harnesses}</h2>
        <Button ref={addButton} variant="primary" disabled={!configured || busy} onClick={() => {
          setError('');
          setAdding(true);
        }}>{w.add}</Button>
      </header>
      {!configured && !error && <p className="hint" role="status">{w.loading}</p>}
      {configured?.length === 0 && <p className="hint">{w.empty}</p>}
      {!!configured?.length && <ul className="m-0 grid list-none gap-3 p-0">
        {configured.map((harness) => {
          const current = usage.find((u) => u.harness === harness && u.limits.length);
          return <li key={harness} className="rounded-lg border border-border px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="m-0 flex items-center gap-2 text-base font-semibold">
                <HarnessMark harness={harness} size={18} />{names[harness]}
              </h3>
              <Button variant="danger" size="small" disabled={busy} aria-label={`${w.disconnect} ${names[harness]}`} onClick={() => setRemoving(harness)}>
                {w.disconnect}
              </Button>
            </div>
            {current && <div className="mt-3 max-w-md text-sm"><UsageDetails usage={current} /></div>}
          </li>;
        })}
      </ul>}
      {error && <p role="alert" className="text-sm text-destructive">{error} {!configured && <Button size="small" onClick={() => {
        setError('');
        setAttempt(attempt + 1);
      }}>{w.retry}</Button>}</p>}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null); }}
        title={removing && w.disconnectTitle(names[removing])}
        confirm={{ label: w.disconnect, variant: 'destructive', onClick: () => { if (removing) void disconnect(removing); } }}
        cancel={w.cancel}
      >
        <p>{w.disconnectHint}</p>
      </ConfirmDialog>
    </div>
  );
}
