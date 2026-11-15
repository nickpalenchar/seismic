// The looks of the ring a right click opens on the canvas, which the colour
// ring of the groups (groups.tsx `Ring`) and the ring of the canvases (canvases.tsx `CanvasRing`) share:
// the backdrop that catches the pointer, the frosted halo, the balls around the middle, their names, the
// caption in the middle and the field for a new group's name. `open` is the ring once it has come out (a
// frame after it mounts, so it springs); `hot` the ball the pointer is aimed at. The ball's place and
// hue are its `--bx`, `--by` and `--h`.

import { cn } from 'cn';

/** Over the whole page, under nothing: a click anywhere picks or closes. */
export const ringBackClass = 'fixed inset-0 z-70 cursor-crosshair';

/** The ring's middle, where the pointer was (its `left` and `top`). */
export const radialClass = 'absolute w-0 h-0';

/**
 * The project behind the ring and its names steps back under a frosted halo that fades out at its
 * edge, so they stand out on a busy project and the cards further away stay in view.
 */
export const haloClass = (open: boolean) =>
  cn(
    'absolute left-[-330px] top-[-230px] w-[660px] h-[460px] rounded-full bg-background/72',
    '[backdrop-filter:blur(4px)_saturate(.6)] [-webkit-backdrop-filter:blur(4px)_saturate(.6)]',
    '[mask-image:radial-gradient(closest-side,#000_62%,transparent)] [-webkit-mask-image:radial-gradient(closest-side,#000_62%,transparent)]',
    '[transition:transform_.25s,opacity_.25s]',
    open ? '[transform:scale(1)] opacity-100' : '[transform:scale(.3)] opacity-0',
  );

/**
 * A ball of the ring in its group's hue (`kind` group or canvas), or plain for a new group and none; it
 * springs out from the middle to its place and grows while aimed at. `here`: the canvas shown already.
 */
export const ballClass = (kind: 'group' | 'canvas' | 'new' | 'none', { open, hot, here }: { open: boolean; hot: boolean; here?: boolean }) => {
  const plain = kind === 'new' || kind === 'none';
  return cn(
    'ball',
    kind,
    'absolute left-[-19px] top-[-19px] w-[38px] h-[38px] rounded-full grid place-items-center font-sans text-xl/none font-semibold',
    '[transition:transform_.32s_cubic-bezier(.3,1.5,.5,1),opacity_.2s,box-shadow_.2s]',
    kind === 'canvas' ? 'text-white' : 'text-muted-foreground',
    plain
      ? 'bg-card [box-shadow:0_0_0_1.5px_var(--border),0_4px_12px_--alpha(black/12%)]'
      : 'bg-[radial-gradient(circle_at_35%_30%,hsl(var(--h)_90%_78%),hsl(var(--h)_75%_52%)_60%,hsl(var(--h)_70%_38%))] [box-shadow:0_0_0_2px_var(--background),0_4px_14px_hsl(var(--h)_70%_40%_/_.35)]',
    !open && '[transform:translate(0,0)_scale(.2)]',
    open && !hot && '[transform:translate(var(--bx),var(--by))_scale(1)]',
    open && hot && '[transform:translate(calc(var(--bx)*1.12),calc(var(--by)*1.12))_scale(1.3)]',
    // the canvas shown already stays pale, also while the ring comes out
    here ? 'opacity-55' : open ? 'opacity-100' : 'opacity-0',
    open && hot && (plain ? '[box-shadow:0_0_0_2px_var(--foreground)] text-foreground' : '[box-shadow:0_0_0_2px_var(--background),0_0_0_5px_hsl(var(--h)_80%_55%_/_.5),0_0_26px_hsl(var(--h)_90%_55%_/_.8)]'),
  );
};

/**
 * A ball's name, outside it and turned away from the middle (placed by its own style): a tag with the
 * group's colour around it. `vacant`: an empty group, or the canvas shown already, goes pale.
 */
export const tagClass = ({ open, hot, vacant }: { open: boolean; hot: boolean; vacant: boolean }) =>
  cn(
    'gtag absolute flex items-center gap-1 box-border py-0.5 px-2 rounded-xs whitespace-nowrap [font-family:var(--font)] text-xs/[18px] font-medium text-foreground cursor-pointer bg-card',
    '[transition:opacity_.2s,box-shadow_.15s] [&_span]:overflow-hidden [&_span]:text-ellipsis',
    hot ? 'font-semibold [box-shadow:0_0_0_2px_hsl(var(--h)_75%_52%),0_0_14px_hsl(var(--h)_90%_55%_/_.45)]' : '[box-shadow:0_0_0_1px_hsl(var(--h)_60%_55%_/_.55),0_2px_8px_--alpha(black/10%)]',
    open ? 'opacity-100' : 'opacity-0',
    vacant && '[&_span]:text-muted-foreground',
  );

/** How many of the group's cards are still to be done, in the tag's coloured right end, on the name's line. */
export const countClass = (vacant: boolean) =>
  cn(
    'gcount flex-none self-stretch -mt-0.5 -mr-2 -mb-0.5 ml-0.5 pt-0.5 pr-2 pb-0.5 pl-2 rounded-r-xs [font-family:var(--font)] text-xs/[18px] font-semibold tabular-nums',
    vacant ? 'bg-border/70 text-muted-foreground' : 'text-foreground bg-[hsl(var(--h)_70%_50%_/_.2)]',
  );

/** The × on the aimed group's name that deletes the group. */
export const tagDeleteClass = 'gdel -mr-0.5 rounded-full';

/** What the aimed ball is (or how many cards the ring is for), in the middle. */
export const captionClass = 'rcap absolute left-[-60px] w-[120px] top-[-9px] text-center font-sans text-sm/[18px] font-semibold text-foreground whitespace-nowrap';

/** The name of a new group, typed in the middle. */
export const nameFieldClass =
  'rname absolute left-[-80px] top-[-16px] w-[160px] h-8 box-border rounded-xs border-[1.5px] border-working bg-card text-foreground font-sans text-base py-0 px-3 text-center outline-none [box-shadow:0_0_18px_--alpha(var(--working)/40%)]';
