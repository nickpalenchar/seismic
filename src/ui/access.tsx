




import { Fragment, type ReactNode, useEffect, useState } from 'react';
import { encode } from 'uqr';
import type { AccessView, RemoteSetting } from '../core/types';
import { api } from './api';
import { Field, Head } from './config';
import { clock, failText, shortDay, t } from './strings';
import { Button, CloseButton } from './components/button';
import { Dialog, DialogContent, DialogTitle } from './components/dialog';
import { SegmentedControl } from './components/segmented';
import { Select, SelectItem } from './components/select';
import { statusClass } from './setupClasses';


const okClass = "before:content-['✓_'] before:text-approved";

const addressClass = 'acc-address text-sm!';

const stepClass = 'hint acc-step mt-1! mb-0! mx-0!';

/** Text with `code` in backticks, as the strings write commands. */
function Coded({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

/** The view of the section while `on`, looked at again every few seconds: Tailscale logged in meanwhile, a phone paired. */
function useAccess(on: boolean): [AccessView | null, (v: AccessView) => void] {
  const [view, setView] = useState<AccessView | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const load = () => api.access().then((v) => live && v.local && setView(v), console.error);
    void load();
    const timer = setInterval(load, 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [on]);
  return [view, setView];
}

/** A moment as the device list says it: the time today, else the day. */
const when = (iso: string) => (new Date(iso).toDateString() === new Date().toDateString() ? clock(iso) : shortDay(iso));

/** The setting "Reachable from other devices" and what the network needs for it, with one step each. */
function Reach({ view, onView }: { view: AccessView; onView: (v: AccessView) => void }) {
  const a = t.access;
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (remote: RemoteSetting | null) => {
    setBusy(true);
    setStatus('');
    try {
      onView(await api.saveAccess(remote));
    } catch (e) {
      setStatus(failText(e));
    } finally {
      setBusy(false);
    }
  };
  const via = view.remote?.via ?? null;
  
  const awake = view.remote?.awake ? { awake: view.remote.awake } : {};
  const always = view.remote?.awake === 'always';
  const ts = view.tailscale;
  const p = view.problem;
  const step = ts.state === 'missing' ? (a.step.missing[view.platform] ?? a.step.missing.linux!) : ts.state === 'ready' ? null : a.step[ts.state];
  return (
    <>
      <Field label={a.setting}>
        <SegmentedControl
          label={a.setting}
          value={via ?? 'off'}
          disabled={busy}
          onValueChange={(x) => save(x === 'tailscale' ? { via: 'tailscale', ...awake } : x === 'address' ? { via: 'address', address: view.addresses[0] ?? '', ...awake } : x === 'hosts' ? { via: 'hosts', hosts: view.remote?.via === 'hosts' ? view.remote.hosts : [], ...awake } : null)}
          options={[
            { value: 'off', label: a.off },
            { value: 'tailscale', label: a.tailscale },
            { value: 'address', label: a.address },
            { value: 'hosts', label: a.hosts },
          ]}
        />
        <p className="hint">
          <Coded text={via === 'tailscale' ? a.tailscaleHint : via === 'address' ? a.addressHint : via === 'hosts' ? a.hostsHint : a.offHint} />
        </p>
      </Field>
      {via === 'address' && (
        <Field label={a.pick}>
          <Select aria-label={a.pick} value={view.remote?.via === 'address' ? view.remote.address : ''} disabled={busy} onValueChange={(picked) => picked && save({ via: 'address', address: picked, ...awake })}>
            {!view.addresses.length && <SelectItem value="">{a.pickNone}</SelectItem>}
            {view.addresses.map((x) => (
              <SelectItem key={x} value={x}>
                {x}
              </SelectItem>
            ))}
          </Select>
        </Field>
      )}
      {via === 'tailscale' && (
        <Field label={a.network}>
          <div className={ts.state === 'ready' ? `acc-state ok ${okClass}` : 'acc-state'}>{ts.state === 'ready' ? a.state.ready(ts.name, ts.account) : a.state[ts.state]}</div>
          {ts.state === 'ready' && !ts.others && <p className={`${stepClass} acc-alone text-warning! font-semibold`}>{a.alone(ts.account)}</p>}
          {step && (
            <p className={stepClass}>
              <Coded text={step} />
            </p>
          )}
          {ts.state === 'noHttps' && (
            <Button size="small" asChild>
              <a href="https://login.tailscale.com/admin/dns" target="_blank" rel="noreferrer">
                {a.openDns}
              </a>
            </Button>
          )}
        </Field>
      )}
      {via && (
        <Field label={a.reach}>
          {view.address ? <code className={addressClass}>{view.address}</code> : <span className="hint">{a.notYet}</span>}
          {p && (
            <p className="p-error">
              {p.code === 'operator' ? (
                <>
                  <Coded text={a.problem.operator} /> <code>sudo tailscale set --operator=$USER</code>
                </>
              ) : p.code === 'portsTaken' ? (
                <Coded text={a.problem.portsTaken} />
              ) : (
                a.problem[p.code](p.detail)
              )}
            </p>
          )}
        </Field>
      )}
      {view.remote && (
        <Field label={a.awake}>
          <SegmentedControl
            label={a.awake}
            value={always ? 'always' : 'works'}
            disabled={busy}
            onValueChange={(x) => {
              if (!view.remote) return;
              const { awake: _, ...rest } = view.remote;
              void save(x === 'always' ? { ...rest, awake: 'always' } : rest);
            }}
            options={[
              { value: 'works', label: a.awakeWorks },
              { value: 'always', label: a.awakeAlways },
            ]}
          />
          <p className="hint">
            {always ? a.awakeAlwaysHint : a.awakeWorksHint} {a.lid}
          </p>
        </Field>
      )}
      {status && <p className={`hint ${statusClass}`}>{status}</p>}
    </>
  );
}

/** A QR code of `text`, dark on white whatever the theme, so every camera reads it. */
function Qr({ text, size = 220 }: { text: string; size?: number }) {
  const { data, size: n } = encode(text, { ecc: 'M', border: 3 });
  let d = '';
  data.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x} ${y}h1v1h-1z`)));
  return (
    <svg className="acc-qr flex-none rounded-xs [box-shadow:var(--shadow)]" width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label={text}>
      <rect width={n} height={n} fill="white" />
      <path d={d} fill="black" />
    </svg>
  );
}

/** The section "Other devices" of the configuration. */
export function AccessSection({ on, onConnect }: { on: boolean; onConnect: () => void }) {
  const a = t.access;
  const [view, setView] = useAccess(on);
  const [status, setStatus] = useState('');
  if (!view) return <Head title={t.config.sections.devices} hint={a.hint} />;
  const remove = async (id: string) => {
    setStatus('');
    try {
      await api.removeDevice(id);
      setView({ ...view, devices: view.devices.filter((d) => d.id !== id) });
    } catch (e) {
      setStatus(failText(e));
    }
  };
  return (
    <>
      <Head title={t.config.sections.devices} hint={a.hint} file={view.file} />
      <Reach view={view} onView={setView} />
      <Head sub title={a.devices} hint={a.devicesHint} />
      {view.devices.length ? (
        <ul className="acc-devices list-none m-0 p-0 max-w-[720px]">
          {view.devices.map((d) => (
            <li key={d.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-4 items-center py-2 px-0 border-b border-b-border text-sm">
              <span>
                <span className="acc-name font-semibold">{d.name}</span>
                {d.push && <span className="hint"> · {a.pushOn}</span>}
              </span>
              <span className="hint">{a.pairedAt(when(d.pairedAt))}</span>
              <span className="hint">{a.seenAt(when(d.lastSeen))}</span>
              <Button size="small" onClick={() => void remove(d.id)}>
                {a.remove}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{a.noDevices}</p>
      )}
      {view.address && (
        <Button variant="primary" size="small" className="acc-connect mt-3" onClick={onConnect}>
          {a.connect}
        </Button>
      )}
      {status && <p className={`hint ${statusClass}`}>{status}</p>}
      <p className="hint acc-note mt-4 max-w-[76ch]">{a.whileRunning}</p>
    </>
  );
}

/**
 * "Connect a phone": with other devices reaching Seismic, a QR code of the address with a one-time
 * code (a new one once it expires) until a phone paired with it, or what became of a code the
 * desktop app took for its window; else what is still missing, to set
 * right here.
 */
export function PhoneDialog({ onClose, onSection }: { onClose: () => void; onSection: () => void }) {
  const a = t.access;
  const [view, setView] = useAccess(true);
  const [asked, setAsked] = useState(false);
  const pairing = view?.pairing ?? null;
  
  useEffect(() => {
    if (!view?.address || pairing || asked) return;
    setAsked(true);
    api.pair().then((p) => setView({ ...view, pairing: p }), console.error).finally(() => setAsked(false));
  }, [view?.address, pairing?.code]);
  const another = () => api.pair().then((p) => view && setView({ ...view, pairing: p }), console.error);
  let body: ReactNode;
  if (!view) body = null;
  else if (!view.address)
    body = (
      <>
        <p>{a.first}</p>
        <div className="acc-fields">
          <Reach view={view} onView={setView} />
        </div>
      </>
    );
  else if (pairing?.paired)
    body = (
      <div className="acc-done">
        <p className={`acc-connected text-lg font-semibold my-2 mx-0 ${okClass}`}>{a.connected(pairing.paired.name)}</p>
        <Button size="small" onClick={() => void another()}>
          {a.another}
        </Button>
      </div>
    );
  else if (pairing?.linked)
    body = (
      <div className="acc-done">
        <p className="acc-linked my-2 mx-0">{a.linked(clock(pairing.expires))}</p>
        <Button size="small" onClick={() => void another()}>
          {a.another}
        </Button>
      </div>
    );
  else if (pairing) {
    const ts = view.remote?.via === 'tailscale' && view.tailscale.state === 'ready' ? view.tailscale : null;
    body = (
      <div className="acc-pair flex gap-6 items-start [&_p]:mt-0 [&_p]:mb-2.5 [&_p]:mx-0 [&_p]:leading-[1.45]">
        <Qr text={pairing.url} />
        <div>
          {ts && !ts.others && <p className="acc-alone text-warning! font-semibold">{a.alone(ts.account)}</p>}
          <p>{ts ? a.scanTailscale(ts.account) : a.scan}</p>
          <p className="hint">{a.orType}</p>
          <p>
            <code className={addressClass}>{view.address}</code>
          </p>
          <p className="acc-code font-mono text-display/[1.1] font-semibold tracking-[.08em] mt-1! mb-1.5! mx-0!" aria-label={pairing.code}>
            {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
          </p>
          <p className="hint">{a.validUntil(clock(pairing.expires))}</p>
        </div>
      </div>
    );
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent id="phone" glass className={`box relative pt-6 px-6 pb-5 w-[680px] max-w-full max-h-full overflow-auto text-base [&_code]:font-mono [&_code]:text-xs [&_code]:[overflow-wrap:anywhere]`}>
        <CloseButton label={t.close} className="close absolute right-3.5 top-3" onClick={onClose} />
        <DialogTitle asChild>
          <h2 className="mt-0 mb-4 mx-0 text-2xl">{a.connect}</h2>
        </DialogTitle>
        {body}
        <div className="acc-foot mt-4 pt-3 border-t border-t-border">
          <Button size="small" onClick={onSection}>
            {a.toSection}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
