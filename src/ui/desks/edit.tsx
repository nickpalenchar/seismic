// The cog's dialog on the workspaces page: a workspace's name, and for a remote one its address,
// "Pair again" with a new code (at a new address, where it moved) and "Delete workspace", which is
// here alone, never on a row of the list, so that it is not hit on the way to switching.

import { useId, useState } from 'react';
import { t } from '../strings';
import { Button, CloseButton } from '../components/button';
import { ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/dialog';
import { Input } from '../components/input';
import { Spinner } from '../components/spinner';
import { errorClass, fieldClass, fieldLabelClass } from './connect';
import { type Desk, deskError, desks, originOf } from './shell';

export function EditDesk({ desk, onClose }: { desk: Desk; onClose: () => void }) {
  const e = t.desks.edit;
  const id = useId();
  const [name, setName] = useState(desk.name);
  const [address, setAddress] = useState(desk.origin ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'save' | 'pair' | 'remove' | null>(null);
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState('');
  const [removing, setRemoving] = useState(false);
  const run = async (what: NonNullable<typeof busy>, act: () => Promise<string | void>, about = desk.origin ?? '') => {
    setBusy(what);
    setProblem('');
    setDone('');
    try {
      const said = await act();
      if (said) setDone(said);
      setBusy(null);
      return true;
    } catch (err) {
      setProblem(deskError(err, about));
      setBusy(null);
      return false;
    }
  };
  const moved = originOf(address);
  const editAddress = (text: string) => {
    if (originOf(text) !== moved) setCode('');
    setAddress(text);
    setProblem('');
    setDone('');
  };
  const save = () => run('save', async () => (await desks.rename(desk.id, name.trim()), e.saved));
  const pair = () => {
    if (!moved) return setProblem(t.desks.connect.badAddress);
    if (!/^\d{6}$/.test(code)) return setProblem(t.desks.connect.badCode);
    void run('pair', async () => {
      const { opened } = await desks.pair(desk.id, code, moved !== desk.origin ? moved : undefined);
      setCode('');
      return opened ? undefined : e.paired;
    }, moved);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent glass className="desk-edit grid w-[min(520px,100%)] gap-4 overflow-y-auto rounded-2xl px-6 py-6">
        <div className="flex items-start gap-3">
          <DialogTitle className="m-0 min-w-0 flex-1 text-xl font-semibold [overflow-wrap:anywhere]">{e.title(desk.name)}</DialogTitle>
          <CloseButton label={e.close} variant="ghost" disabled={!!busy} onClick={onClose} />
        </div>
        {desk.local && <DialogDescription className="m-0 text-sm text-muted-foreground">{e.localHint}</DialogDescription>}
        <form
          className="flex items-end gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!busy) void save();
          }}
        >
          <label className={`${fieldClass} flex-1`}>
            <span className={fieldLabelClass}>{e.name}</span>
            <Input placeholder={e.namePlaceholder} value={name} disabled={!!busy} onChange={(ev) => (setName(ev.target.value), setDone(''))} />
          </label>
          <Button type="submit" disabled={!!busy || name.trim() === desk.name}>
            {busy === 'save' && <Spinner className="size-3.5" />}
            {e.save}
          </Button>
        </form>
        {desk.origin && (
          <form
            className="grid gap-3 border-t border-border pt-4"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!busy) pair();
            }}
          >
            <label className={fieldClass}>
              <span className={fieldLabelClass}>{e.address}</span>
              <Input spellCheck={false} autoCapitalize="off" value={address} disabled={!!busy} onChange={(ev) => editAddress(ev.target.value)} />
            </label>
            <p className="m-0 text-sm text-muted-foreground">{e.pairHint}</p>
            <div className="flex items-end gap-2">
              <label className={`${fieldClass} w-36`}>
                <span className={fieldLabelClass}>{t.desks.connect.code}</span>
                <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" className="font-mono tracking-widest" value={code} disabled={!!busy} onChange={(ev) => (setCode(ev.target.value.replace(/\D/g, '')), setProblem(''))} />
              </label>
              <Button type="submit" disabled={!!busy || !code} aria-describedby={problem ? `${id}-problem` : undefined}>
                {busy === 'pair' && <Spinner className="size-3.5" />}
                {busy === 'pair' ? e.pairing : e.pair}
              </Button>
            </div>
          </form>
        )}
        {problem && (
          <p id={`${id}-problem`} role="alert" className={errorClass}>
            {problem}
          </p>
        )}
        {done && !problem && (
          <p role="status" className="m-0 text-sm text-approved-strong">
            {done}
          </p>
        )}
        {!desk.local && (
          <div className="flex border-t border-border pt-4">
            <Button variant="danger" disabled={!!busy} onClick={() => setRemoving(true)}>
              {busy === 'remove' && <Spinner className="size-3.5" />}
              {e.remove}
            </Button>
          </div>
        )}
        <ConfirmDialog
          open={removing}
          onOpenChange={setRemoving}
          title={e.removeTitle}
          scrollBody
          confirm={{
            label: e.remove,
            variant: 'destructive',
            onClick: () => void run('remove', () => desks.remove(desk.id)).then((ok) => ok && onClose()),
          }}
          cancel={t.desks.connect.cancel}
          busy={!!busy}
        >
          <p>{e.removeHint(desk.name)}</p>
        </ConfirmDialog>
      </DialogContent>
    </Dialog>
  );
}
