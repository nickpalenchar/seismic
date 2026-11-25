
import type { Demo } from '../core/types';

const key = (cardId: string) => `seismic-demo-seen-${cardId}`;
/** A new render after feedback has other chapter times, so it counts as unseen again. */
const mark = (demo: Demo) => JSON.stringify(demo.chapters);

/** True the first time a demo is opened, and remembers that it was. */
export function firstOpening(store: Pick<Storage, 'getItem' | 'setItem'>, cardId: string, demo: Demo): boolean {
  try {
    if (store.getItem(key(cardId)) === mark(demo)) return false;
    store.setItem(key(cardId), mark(demo));
  } catch {}
  return true;
}
