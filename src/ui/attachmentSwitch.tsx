// A desktop switch can retire the document doing an attachment upload. Keep the choice
// with that document, including uploads whose editor or project has since changed.
import { useSyncExternalStore } from 'react';
import { ConfirmDialog } from './components/dialog';
import { t } from './strings';

const pending = new Set<AbortController>();
// A shell switch owns the outgoing document through capture and native navigation.
const switches = new Set<string>();
const onIdle = new Set<() => void>();
type Choice = 'ask' | 'wait' | 'discard' | 'back';
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

// The shell checks again with input hidden before sampling. Discard applies only to
// the attachments pending when the owner makes the choice.
export function attachmentSwitch(id: string, action: 'ask' | 'check' | 'end') {
  if (action === 'end') {
    switches.delete(id);
    if (request?.id === id) setRequest(null);
    navigateWhenIdle();
    return 'ready';
  }
  switches.add(id);
  if (request?.id === id) {
    if (request.choice === 'back') return 'back';
    if (request.choice === 'discard') {
      if (![...pending].some(upload => !upload.signal.aborted)) return 'ready';
      if (action === 'ask') setRequest({ id, choice: 'ask' });
    }
    if (request.choice === 'wait' && !pending.size) return 'ready';
    return 'pending';
  }
  if (!pending.size) return 'ready';
  if (action === 'ask') setRequest({ id, choice: 'ask' });
  return 'pending';
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function AttachmentSwitchDialog() {
  const current = useSyncExternalStore(subscribe, () => request);
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
