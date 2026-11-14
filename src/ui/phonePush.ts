// Push routing belongs to the phone controller; subscription and the prompt remain shared in notify.tsx.
import { useEffect, useRef } from 'react';
import { registerWorker } from './notify';
import { readAddress } from './address';

export function usePhonePush(openCard: (code: string) => void, home: () => void) {
  const actions = useRef({ openCard, home });
  actions.current = { openCard, home };
  // a tapped push: its card (or "Needs you" for several) in the app that is open already
  useEffect(() => {
    registerWorker();
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const tapped = (e: MessageEvent) => {
      if (e.data?.type !== 'open' || typeof e.data.url !== 'string') return;
      const card = readAddress(new URL(e.data.url, location.href)).card;
      if (card) actions.current.openCard(card);
      else actions.current.home();
    };
    sw.addEventListener('message', tapped);
    return () => sw.removeEventListener('message', tapped);
  }, []);
}
