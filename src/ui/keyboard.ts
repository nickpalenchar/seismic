









export const KEYBOARD_PX = 150;


export interface Screen {
  
  pageTop: number;
  height: number;
  scale: number;
  page: number;
}

/**
 * Where the page goes while the keyboard is up: its top and height, from the page's top. None while
 * the visible part is about as tall as the page, or while the owner has zoomed in with two fingers
 * (the visible part is smaller then too, and the page is to be zoomed, not pinned).
 */
export function pinned(s: Screen): { top: number; height: number } | null {
  if (Math.abs(s.scale - 1) > 0.01) return null;
  if (s.page - s.height < KEYBOARD_PX) return null;
  return { top: Math.max(0, s.pageTop), height: s.height };
}

/** An iPhone or iPad; an iPad asks for the desktop site and says it is a Mac, one with a touch screen. */
const apple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/**
 * Safari zooms into a text field written smaller than 16 px when it gets the cursor, which moved
 * the whole page as much as the keyboard. A largest scale of 1 stops that zoom; zooming with two
 * fingers stays possible there (Safari ignores the limit for it), so only Safari gets it.
 */
function noZoomIntoFields() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name=viewport]');
  if (meta && apple() && !meta.content.includes('maximum-scale')) meta.content += ', maximum-scale=1';
}

/**
 * The keyboard makes the page shorter (`interactive-widget`), as Chrome on Android does with it: the
 * views fixed to the screen end at the keyboard then. Without it Chrome only shrinks the visual
 * viewport and reports it wrong by its own bars (by the gesture bar where it draws under it, by the
 * bottom toolbar where it has one), and the field ended under the keyboard or far above it. Safari
 * ignores it and shrinks only the visual viewport, to which the page is pinned instead.
 */
function keyboardResizes() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name=viewport]');
  if (meta && !meta.content.includes('interactive-widget')) meta.content += ', interactive-widget=resizes-content';
}

/** Keeps the page above the keyboard while it is up, on the canvas and the phone alike; once, for the page's life. */
export function pinAboveKeyboard() {
  keyboardResizes();
  noZoomIntoFields();
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const fit = () => {
    const at = pinned({ pageTop: vv.pageTop, height: vv.height, scale: vv.scale, page: root.clientHeight });
    root.classList.toggle('kb-pin', !!at);
    if (!at) return;
    root.style.setProperty('--kb-top', `${at.top}px`);
    root.style.setProperty('--kb-h', `${at.height}px`);
  };
  fit();
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  addEventListener('scroll', fit);
}
