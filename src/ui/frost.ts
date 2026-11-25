





export const SETTLE_MS = 160;

/** Sets `moving` on `root` while `world`'s style changes, until it has stood still for `settle` ms. */
export function watchMoves(world: HTMLElement, root: HTMLElement, settle = SETTLE_MS): () => void {
  let last = world.style.transform;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const seen = new MutationObserver(() => {
    const now = world.style.transform;
    if (now === last) return;
    last = now;
    root.classList.add('moving');
    clearTimeout(timer);
    timer = setTimeout(() => root.classList.remove('moving'), settle);
  });
  seen.observe(world, { attributes: true, attributeFilter: ['style'] });
  return () => {
    seen.disconnect();
    clearTimeout(timer);
    root.classList.remove('moving');
  };
}

/** Follows the canvas's world as React mounts and replaces it (switching projects, the phone view). */
function follow(): void {
  let world: HTMLElement | null = null;
  let stop = () => {};
  const look = () => {
    const now = document.getElementById('world');
    if (now === world) return;
    stop();
    world = now;
    stop = world ? watchMoves(world, document.documentElement) : () => {};
  };
  new MutationObserver(look).observe(document.body, { childList: true, subtree: true });
  look();
}

if (typeof document !== 'undefined') follow();
