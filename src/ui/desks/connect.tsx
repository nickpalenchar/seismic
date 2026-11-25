




import { useId, useState } from 'react';
import { t } from '../strings';
import { Button } from '../components/button';
import { Input } from '../components/input';
import { Spinner } from '../components/spinner';
import { deskError, desks, fromPairingLink, originOf } from './shell';


export const fieldClass = 'grid gap-1 min-w-0 [&_[data-slot=input]]:w-full [&_[data-slot=input]]:min-w-0';
export const fieldLabelClass = 'text-xs text-muted-foreground';

export const errorClass = 'm-0 text-sm text-destructive [overflow-wrap:anywhere]';

export function ConnectForm({ onCancel, autoFocus }: { onCancel?: () => void; autoFocus?: boolean }) {
  const c = t.desks.connect;
  const id = useId();
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const origin = originOf(address);
  const codeOk = /^\d{6}$/.test(code);
  const typed = (text: string) => {
    
    const link = fromPairingLink(text);
    if (link) {
      setAddress(link.address);
      setCode(link.code);
    } else {
      if (originOf(text) !== origin) setCode('');
      setAddress(text);
    }
    setProblem('');
  };
  const connect = async () => {
    if (!origin) return setProblem(c.badAddress);
    if (!codeOk) return setProblem(c.badCode);
    setBusy(true);
    setProblem('');
    try {
      const { opened } = await desks.add(origin, code, name);
      
      if (!opened) setProblem(c.saved(name.trim() || new URL(origin).host));
    } catch (e) {
      setProblem(deskError(e, origin));
    }
    setBusy(false);
  };
  return (
    <form
      className="desk-connect grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void connect();
      }}
    >
      <p className="m-0 text-sm text-muted-foreground">{c.how}</p>
      <label className={fieldClass}>
        <span className={fieldLabelClass}>{c.address}</span>
        <Input autoFocus={autoFocus} spellCheck={false} autoCapitalize="off" placeholder={c.addressPlaceholder} value={address} disabled={busy} onChange={(e) => typed(e.target.value)} />
      </label>
      <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3">
        <label className={fieldClass}>
          <span className={fieldLabelClass}>{c.code}</span>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" className="font-mono tracking-widest" value={code} disabled={busy} onChange={(e) => (setCode(e.target.value.replace(/\D/g, '')), setProblem(''))} />
        </label>
        <label className={fieldClass}>
          <span className={fieldLabelClass}>{c.name}</span>
          <Input placeholder={origin ? new URL(origin).hostname : c.namePlaceholder} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      {problem && (
        <p id={`${id}-problem`} role="alert" className={errorClass}>
          {problem}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button type="button" disabled={busy} onClick={onCancel}>
            {c.cancel}
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={busy || !address.trim() || !code} aria-describedby={problem ? `${id}-problem` : undefined}>
          {busy && <Spinner className="size-3.5" />}
          {busy ? c.connecting : c.connect}
        </Button>
      </div>
    </form>
  );
}
