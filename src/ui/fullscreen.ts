










import { type RefObject, useEffect, useRef, useState } from 'react';

export type Held = 'portrait' | 'landscape' | 'flat' | 'diagonal';

/**
 * How the phone is held, from a `deviceorientation` event's beta and gamma, as Chrome reads it for
 * its own video full screen: within 23° of portrait or landscape, diagonal between them, flat when
 * the screen is less than 24° from the horizontal. `naturalPortrait`: the device's natural
 * orientation is portrait (a phone), not landscape (some tablets). Null without the readings.
 */
export function held(beta: number | null, gamma: number | null, naturalPortrait = true): Held | null {
  if (beta === null || gamma === null) return null;
  const rad = Math.PI / 180;
  
  const x = -Math.sin(gamma * rad) * Math.cos(beta * rad);
  const y = -Math.sin(beta * rad);
  if (Math.hypot(x, y) < Math.sin(24 * rad)) return 'flat';
  
  const angle = (Math.atan2(x, -y) / rad + 360) % 360;
  const angle90 = Math.round(angle / 90) * 90;
  if (Math.abs(angle - angle90) > 23) return 'diagonal';
  return angle90 % 180 === (naturalPortrait ? 0 : 90) ? 'portrait' : 'landscape';
}


export const TURNED_BACK_MS = 300;

type Shape = 'portrait' | 'landscape';

type Lockable = ScreenOrientation & { lock?: (o: Shape) => Promise<void> };

const orientation = (): Lockable | undefined => (typeof screen !== 'undefined' ? (screen.orientation as Lockable | undefined) : undefined);
const screenShape = (): Shape | null => {
  const type = orientation()?.type;
  return type ? (type.startsWith('portrait') ? 'portrait' : 'landscape') : null;
};

/** Scrolls each view scrolling around `el` by a pixel and back (the page to its top), which makes Safari place taps anew. */
export function unstick(el: Element) {
  if (scrollY) scrollTo(0, 0);
  for (let box = el.parentElement; box; box = box.parentElement) {
    if (box.scrollHeight <= box.clientHeight) continue;
    const top = box.scrollTop;
    const scroller = box;
    scroller.scrollTop = top > 0 ? top - 1 : top + 1;
    
    requestAnimationFrame(() => (scroller.scrollTop = top));
  }
}

/**
 * The phone's full screen for the player `el` holding `video`: `can` says whether the browser puts
 * an element into full screen (an iPhone's Safari does not, and keeps the video's own full screen,
 * whose player turns well), `full` whether it is, `toggle` enters or leaves it. Turning the phone
 * into the video's orientation while it plays in view enters it too, as the video's own controls did.
 */
export function useFullscreen(el: RefObject<HTMLElement | null>, video: RefObject<HTMLVideoElement | null>, enabled: boolean) {
  const [can] = useState(() => enabled && typeof document !== 'undefined' && !!document.fullscreenEnabled && 'controlsList' in HTMLMediaElement.prototype);
  const [full, setFull] = useState(false);
  const fullRef = useRef(false);
  const locked = useRef(false);
  
  const matched = useRef(false);
  const backSince = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const sensed = useRef(false);
  const visible = useRef(false);

  const shape = (): Shape => {
    const v = video.current;
    return v && v.videoHeight > v.videoWidth ? 'portrait' : 'landscape';
  };
  const enter = (turned: boolean) => {
    const target = el.current;
    if (!target || document.fullscreenElement) return;
    target
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => {
        matched.current = turned;
        const o = orientation();
        if (!o?.lock) return;
        locked.current = true;
        o.lock(shape()).catch(() => (locked.current = false));
      })
      .catch(() => {});
  };
  const leave = () => {
    if (document.fullscreenElement === el.current) document.exitFullscreen().catch(() => {});
  };

  useEffect(() => {
    if (!can) return;
    const clearBack = () => {
      if (backSince.current) clearTimeout(backSince.current);
      backSince.current = null;
    };
    const changed = () => {
      const on = !!el.current && document.fullscreenElement === el.current;
      fullRef.current = on;
      setFull(on);
      if (on) return;
      clearBack();
      matched.current = false;
      if (locked.current) orientation()?.unlock();
      locked.current = false;
    };
    const tilt = (e: DeviceOrientationEvent) => {
      const o = orientation();
      
      const natural = o ? (screenShape() === 'portrait') === (o.angle % 180 === 0) : true;
      const h = held(e.beta, e.gamma, natural);
      if (h === null) return;
      sensed.current = true;
      if (!fullRef.current) return;
      const want = shape();
      if (h === want) {
        matched.current = true;
        clearBack();
      } else if (h === 'flat' || h === 'diagonal') clearBack();
      else if (matched.current && !backSince.current) backSince.current = setTimeout(leave, TURNED_BACK_MS);
    };
    
    const turned = () => {
      const v = video.current;
      if (fullRef.current || !v || v.paused || !visible.current || !sensed.current || screenShape() !== shape()) return;
      enter(true);
    };
    const seen = new IntersectionObserver(([e]) => (visible.current = !!e && e.intersectionRatio >= 0.75), { threshold: [0.75] });
    if (video.current) seen.observe(video.current);
    document.addEventListener('fullscreenchange', changed);
    addEventListener('deviceorientation', tilt);
    orientation()?.addEventListener('change', turned);
    return () => {
      seen.disconnect();
      document.removeEventListener('fullscreenchange', changed);
      removeEventListener('deviceorientation', tilt);
      orientation()?.removeEventListener('change', turned);
      clearBack();
      if (fullRef.current) leave();
    };
  }, [can]);

  
  
  useEffect(() => {
    const v = video.current;
    if (!enabled || can || !v) return;
    const back = () => requestAnimationFrame(() => unstick(v));
    v.addEventListener('webkitendfullscreen', back);
    return () => v.removeEventListener('webkitendfullscreen', back);
  }, [enabled, can]);

  return { can, full, toggle: () => (fullRef.current ? leave() : enter(false)), leave };
}
