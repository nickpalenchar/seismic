

import { useSyncExternalStore } from 'react';
import { ConfirmDialog, Dialog, DialogContent, DialogTitle } from './components/dialog';
import { Spinner } from './components/spinner';
import { t } from './strings';

const pending = new Set<AbortController>();

const switches = new Set<string>();
const onIdle = new Set<() => void>();
type Choice = 'ask' | 'wait' | 'discard' | 'back' | 'connecting';
let request: { id: string; choice: Choice } | null = null;
const listeners = new Set<() => void>();
function setRequest(next: typeof request) {
  request = next;
  for (const listener of listeners) listener();
}

function navigateWhenIdle() {
  if (pending.size || switches.size) return;
  const ready = [...onIdle];
  onIdle.clear();
  for (const action of ready) action();
}

export function beginAttachment() {
  const controller = new AbortController();
  pending.add(controller);
  return {
    signal: controller.signal,
    finish(ok: boolean) {
      pending.delete(controller);
      if (!ok && !controller.signal.aborted && request && (request.choice === 'wait' || request.choice === 'ask')) {
        setRequest({ ...request, choice: 'back' });
      }
      navigateWhenIdle();
    },
  };
}

/** Run an automatic navigation when uploads and the native switch have released the page. */
export function afterAttachments(action: () => void) {
  onIdle.add(action);
  navigateWhenIdle();
}



export function attachmentSwitch(id: string, action: 'ask' | 'check' | 'connecting' | 'end') {
  if (action === 'end') {
    switches.delete(id);
    if (request?.id === id) setRequest(null);
    navigateWhenIdle();
    return 'ready';
  }
  switches.add(id);
  const ready = () => {
    if (action === 'connecting' && (request?.id !== id || request.choice !== 'connecting')) {
      setRequest({ id, choice: 'connecting' });
    }
    return 'ready';
  };
  if (request?.id === id) {
    if (request.choice === 'back') return 'back';
    if (request.choice === 'discard') {
      if (![...pending].some(upload => !upload.signal.aborted)) return ready();
      if (action === 'ask') setRequest({ id, choice: 'ask' });
    }
    if (request.choice !== 'connecting') {
      return request.choice === 'wait' && !pending.size ? ready() : 'pending';
    }
  }
  if (![...pending].some(upload => !upload.signal.aborted)) return ready();
  if (action === 'ask') setRequest({ id, choice: 'ask' });
  return 'pending';
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function AttachmentSwitchDialog() {
  const current = useSyncExternalStore(subscribe, () => request);
  if (current?.choice === 'connecting') {
    return <Dialog open>
      <DialogContent className="w-[min(360px,100%)] rounded-sm p-6">
        <DialogTitle className="m-0 flex items-center gap-3 text-lg font-semibold" role="status">
          <Spinner aria-hidden /> {t.attachmentSwitch.connecting}
        </DialogTitle>
      </DialogContent>
    </Dialog>;
  }
  if (!current || (current.choice !== 'ask' && current.choice !== 'wait')) return null;
  const choose = (choice: Choice) => {
    if (request !== current) return;
    setRequest({ ...current, choice });
    if (choice === 'discard') {
      for (const upload of pending) upload.abort();
    }
  };
  const words = t.attachmentSwitch;
  return <ConfirmDialog open onOpenChange={open => { if (!open) choose('back'); }} title={words.title}
    confirm={{ label: words.wait, keepOpen: true, disabled: current.choice === 'wait', onClick: () => choose('wait') }}
    also={{ label: words.discard, variant: 'destructive', onClick: () => choose('discard') }} cancel={words.back}>
    <p>{current.choice === 'wait' ? words.waiting : words.message}</p>
  </ConfirmDialog>;
}
