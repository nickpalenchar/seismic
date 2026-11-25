





import { useEffect, useState } from 'react';
import { api } from './api';
import { failText, t } from './strings';
import { Button } from './components/button';


const notifyClass =
  'ph-notify mt-3.5 mx-0 mb-0 py-2.5 px-3 rounded-md border border-glass-edge bg-card shadow-[inset_0_1px_0_var(--glass-hi),var(--shadow)] backdrop-blur-glass text-base flex flex-col items-start gap-2';

type State = 'none' | 'install' | 'ask' | 'on';

const ios = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

function stateNow(): State {
  
  if (!isSecureContext) return 'none';
  if (ios() && !standalone()) return 'install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'none';
  return Notification.permission === 'granted' ? 'on' : Notification.permission === 'default' ? 'ask' : 'none';
}

/** The service worker, which also keeps the page's shell for when the machine does not answer. */
export function registerWorker() {
  if (isSecureContext && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('service worker', e));
}

const bytes = (b64u: string) => Uint8Array.from(atob(b64u.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const same = (a: ArrayBuffer | null, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

/** Subscribes with Seismic's key (anew where the one before was another's) and gives the server the subscription. */
async function subscribe() {
  await navigator.serviceWorker.register('/sw.js');
  
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api.push();
  const wanted = bytes(key);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !same(sub.options.applicationServerKey, wanted)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
  await api.subscribe(sub.toJSON());
}

/** The hint to put Seismic on the home screen, or the button that turns notifications on; nothing once they are. */
export function Notify() {
  const [state, setState] = useState(stateNow);
  const [failed, setFailed] = useState<string | null>(null);
  
  useEffect(() => {
    if (state === 'on') subscribe().catch((e) => console.warn('push subscription', e));
  }, []);
  const n = t.phone.notify;
  if (failed) return <p className={notifyClass}>{n.failed(failed)}</p>;
  if (state === 'install') return <p className={notifyClass}>{n.install}</p>;
  if (state !== 'ask') return null;
  return (
    <div className={notifyClass}>
      <span>{n.why}</span>
      <Button
        variant="primary"
        onClick={async () => {
          
          const p = await Notification.requestPermission();
          if (p === 'granted') await subscribe().then(() => setFailed(null), (e) => setFailed(failText(e, { offline: (e as Error).message })));
          setState(p === 'granted' ? 'on' : p === 'default' ? 'ask' : 'none');
        }}
      >
        {n.turnOn}
      </Button>
    </div>
  );
}
