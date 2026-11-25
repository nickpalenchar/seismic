


import type { Notice } from '../../core/types';
import { confirmShownMs, type Heard, undoShownMs } from '../api';
import { failText, t } from '../strings';
import type { ToastStore } from './toast';


export const MADE_SHOWN_MS = 15_000;


interface Told {
  
  toast?: number;
  
  card?: { id: string; title: string };
  heard?: Heard;
}

export interface ToldDeps {
  toasts: ToastStore;
  onHeard: (h: Heard) => void;
  inView: (h: Heard) => boolean;
  onGo: (card: NonNullable<Notice['made']>[number]) => void;
  undo: (token: string) => Promise<{ undone: boolean }>;
  
  onReading: (reading: boolean) => void;
}

/** See `useTold`. */
export function toldLines({ toasts, onHeard, inView, onGo, undo: undoRequest, onReading }: ToldDeps) {
  const lines = new Set<Told>();
  const changed = () => onReading([...lines].some((x) => !x.heard));
  /** The command is done with: its line goes, and a confirmation still to come shows nowhere. */
  function forget(x: Told) {
    if (!lines.delete(x)) return;
    if (x.toast !== undefined) toasts.remove(x.toast);
    changed();
  }

  function settle(x: Told, h: Heard) {
    if (!lines.has(x)) return;
    const undo = !!(h.token && h.undoMs);
    if (!undo && (h.quiet || inView(h))) return forget(x);
    x.heard = h;
    changed();
    const line = {
      kind: 'command' as const,
      text: h.confirm,
      reading: false,
      ...(x.card ? { card: x.card } : {}),
      undo: undo ? () => void undoIt(x) : undefined,
      ...(undo ? { undoMs: undoShownMs(h.undoMs!) } : {}),
      stayMs: confirmShownMs(h.undoMs),
    };
    if (x.toast !== undefined) toasts.update(x.toast, line);
    else x.toast = toasts.show({ ...line, onGone: () => forget(x) });
  }

  function made(token: string, cards: NonNullable<Notice['made']>) {
    const x = [...lines].find((y) => y.heard?.token === token);
    if (x?.toast === undefined) return;
    toasts.update(x.toast, { go: cards.map((c) => ({ id: c.id, label: cards.length > 1 ? t.voice.goTo(c.title) : t.voice.goToCard, run: () => onGo(c) })), stayMs: MADE_SHOWN_MS });
  }

  async function tell(pending: string | null, card: Told['card'], request: () => Promise<Heard>): Promise<Heard> {
    const x: Told = card ? { card } : {};
    lines.add(x);
    changed();
    
    if (pending) x.toast = toasts.show({ kind: 'command', text: pending, reading: true, ...(card ? { card } : {}), onGone: () => forget(x) });
    let h: Heard;
    try {
      h = await request();
    } catch (e) {
      h = { confirm: failText(e, { offline: t.voice.failed }) };
    }
    settle(x, h);
    onHeard(h);
    return h;
  }

  function show(card: Told['card'], h: Heard) {
    
    if (h.token && [...lines].some((x) => x.heard?.token === h.token)) return;
    const x: Told = card ? { card } : {};
    lines.add(x);
    settle(x, h);
  }

  async function undoIt(x: Told) {
    const id = x.toast!;
    toasts.update(id, { undo: undefined });
    try {
      const { undone } = await undoRequest(x.heard!.token!);
      if (undone) return toasts.remove(id);
      
      x.heard = { confirm: t.voice.tooLate };
      toasts.update(id, { text: t.voice.tooLate });
    } catch {
      x.heard = { confirm: t.offlineError };
      toasts.update(id, { text: t.offlineError });
    }
  }

  return { tell, show, made };
}
