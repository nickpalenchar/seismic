// The looks of the waits on the canvas, which several files draw: the lines
// and heads of `DepLinks` (parts.tsx) and the stubs to other canvases (canvases.tsx) in their layer, the
// arrows the owner draws with their handles (App.tsx), and the colour each card's handles take.

/** How a wait's line is drawn: faint, around the card under the pointer (`lit`), on the way to it (`lit-first`), or settled. */
export type DepKind = 'faint' | 'lit' | 'lit-first' | 'done-dep';

/** A wait's line: every wait faint, those around the card under the pointer in purple, those on the way to it in the waiting colour, a settled one dim green. */
export const depLineClass: Record<DepKind, string> = {
  faint: 'fill-none [stroke:var(--dep-line)]',
  lit: 'fill-none stroke-proposal',
  'lit-first': 'fill-none stroke-waiting',
  'done-dep': 'fill-none [stroke:var(--done-dep)]',
};

/** A wait's head (the marker's path), in its line's colour. */
export const depHeadClass: Record<DepKind, string> = {
  faint: '[&_path]:[fill:var(--dep-line)]',
  lit: '[&_path]:fill-proposal',
  'lit-first': '[&_path]:fill-waiting',
  'done-dep': '[&_path]:[fill:var(--done-dep)]',
};

/** A layer of lines over the world (the waits, the arrow being drawn): at its origin, drawing outside its box, letting the pointer through. */
export const depLayerClass = 'absolute left-0 top-0 overflow-visible pointer-events-none';

/** A dot on a card's edge to draw an arrow from, in the colour of the card's handles (`--c`); larger for a fingertip. */
export const connectionDotClass =
  'absolute w-[14px] h-[14px] p-0 border-2 border-solid [border-color:var(--c)] rounded-[50%] bg-card cursor-pointer [transform:translate(-50%,-50%)] pointer-coarse:w-[22px] pointer-coarse:h-[22px] pointer-coarse:border-3';

/** Where each side's dot stands on the card's edge. */
export const dotSide = { top: 'left-1/2 top-0', right: 'left-full top-1/2', bottom: 'left-1/2 top-full', left: 'left-0 top-1/2' } as const;

/**
 * The trash button on an arrow the owner drew: faint like the other remove buttons, darker under the
 * pointer; sized by its foreignObject, which keeps it the same on screen at every zoom.
 */
export const manualRemoveClass =
  'grid place-items-center box-border w-full h-full p-0 border-[length:calc(1px/var(--s))] border-solid border-border rounded-[50%] bg-card text-muted-foreground cursor-pointer [transition:color_.12s,border-color_.12s] [&_svg]:w-[54%] [&_svg]:h-[54%] hover:text-foreground hover:border-muted-foreground focus-visible:text-foreground focus-visible:border-muted-foreground';

/**
 * The colour of a card's handles (`--c`) where its state makes it another than the state's own (the
 * card's `s-…` class gives that one): the question's, a snoozed card's grey, the colours of an answer
 * being taken up, the owner's turn, an agent asking, a failure. `classes` are the card's (`cardClass`);
 * `dep`: the card is highlighted as a wait of the one under the pointer. Checked in the order the
 * stronger one wins.
 */
export function handleColour(classes: string, dep: boolean): string | undefined {
  const c = new Set(classes.split(/\s+/));
  const waiting = c.has('s-waiting');
  const snoozed = c.has('snoozed');
  const underway = c.has('underway');
  const answering = c.has('answering');
  if (!snoozed && !underway && !answering && (waiting || (c.has('s-idea') && c.has('your-turn')))) return 'var(--waiting)';
  if (waiting && c.has('failed') && !snoozed) return 'var(--destructive)';
  if (c.has('asking') && !dep) return 'var(--asking)';
  if (waiting && answering) return 'var(--working)';
  if (waiting && underway) return 'var(--approved)';
  if (dep) return 'var(--waiting)';
  if (snoozed) return 'var(--muted-foreground)';
  if (c.has('q-card')) return 'var(--question)';
  return undefined;
}
