






import { cn } from 'cn';
import { Quote } from 'lucide-react';
import { type RefObject, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cite } from './draft';
import { HintLabel } from './components/hint';
import { useHint } from './hints';
import { t } from './strings';
import { Tooltip } from './components/tooltip';


/** The marked text as the quote has it: one line, without the spaces around it. */
export const citable = (marked: string) => marked.replace(/\s+/g, ' ').trim();

interface Marked {
  text: string;
  
  x: number;
  y: number;
  below: boolean;
  
  left: boolean;
}


type Box = [number, number, number, number];

const boxOf = (r: DOMRect): Box => [r.left, r.top, r.right, r.bottom];
const within = (a: Box, b: Box): Box => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];

/**
 * Where the button goes for a marking from line `first` to line `last` in `view`, the part of the
 * window it is seen in: null when it is scrolled out of view. At the desk beside where the pointer let
 * go, outside the marking: below its last line, or above its first when marked backwards, on the other
 * side where the view has no room for it; on a touch screen below the middle of its last line, clear
 * of the handles and of the system's menu above it.
 */
export function spot(first: Box, last: Box, backwards: boolean, view: Box, touch: boolean): Omit<Marked, 'text'> | null {
  const [left, top, right, bottom] = view;
  if (last[3] < top || first[1] > bottom || last[2] < left || first[0] > right) return null;
  const below = touch || !backwards ? bottom - last[3] > 40 || first[1] - top < 36 : first[1] - top < 36;
  const x = touch ? (last[0] + last[2]) / 2 : backwards ? first[0] : last[2];
  
  const ends = below && !touch && !backwards;
  
  const y = Math.min(Math.max(below ? last[3] : first[1], top), bottom);
  return { x: Math.min(Math.max(x, left + (ends ? 80 : 24)), right - 24), y, below, left: ends };
}






interface FrameMark {
  frame: HTMLIFrameElement;
  text: string;
  first: Box;
  last: Box;
  backwards: boolean;
}

let framed: FrameMark | null = null;
const onFramed = new Set<() => void>();
const framedChanged = () => {
  for (const fn of onFramed) fn();
};

/** Takes the marking away in the frame that has one: the page in it clears it on `{ seismicUnmark }`. */
function unmarkFrame() {
  if (!framed) return;
  framed.frame.contentWindow?.postMessage({ seismicUnmark: true }, '*');
  framed = null;
  framedChanged();
}

const isBox = (b: unknown): b is Box => Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number' && Number.isFinite(n));

let hearing = false;
/** Listens once for what framed pages say is marked in them. */
function hearFrames() {
  if (hearing) return;
  hearing = true;
  addEventListener('message', (e) => {
    const m = (e.data as { seismicMarked?: unknown } | null)?.seismicMarked;
    if (m === undefined) return;
    const frame = [...document.querySelectorAll('iframe')].find((f) => f.contentWindow === e.source);
    if (!frame) return;
    const said = m as Partial<FrameMark> | null;
    if (!said || typeof said.text !== 'string' || !isBox(said.first) || !isBox(said.last)) {
      if (framed?.frame !== frame) return;
      framed = null;
      return framedChanged();
    }
    
    if (document.activeElement !== frame) return;
    if (framed && framed.frame !== frame) unmarkFrame();
    
    const sel = getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
    framed = { frame, text: said.text, first: said.first, last: said.last, backwards: !!said.backwards };
    framedChanged();
  });
  document.addEventListener('pointerdown', (e) => !(e.target as Element).closest?.('.cite') && unmarkFrame(), true);
}

/**
 * The button at text marked in `box`, for the field of draft `draft`: in its messages (`.msg`), or
 * `anywhere` in it but a field to type in; also in a page framed in it.
 */
export function CiteButton({ box, draft, anywhere, onCite }: { box: RefObject<HTMLElement | null>; draft: string; anywhere?: boolean; onCite?: () => void }) {
  const [marked, setMarked] = useState<Marked | null>(null);
  const citeHint = useHint('cite');
  useEffect(() => {
    hearFrames();
    const touch = matchMedia('(pointer: coarse)').matches;
    
    let dragging = false;
    const place = () => {
      const b = box.current;
      if (dragging || !b) return setMarked(null);
      
      const view = within(boxOf(b.getBoundingClientRect()), [0, 0, innerWidth, innerHeight]);
      if (framed) {
        const { frame, first, last, backwards } = framed;
        const text = citable(framed.text);
        if (!b.contains(frame) || !text) return setMarked(null);
        const f = frame.getBoundingClientRect();
        const dx = f.left + frame.clientLeft;
        const dy = f.top + frame.clientTop;
        const moved = (l: Box): Box => [l[0] + dx, l[1] + dy, l[2] + dx, l[3] + dy];
        
        const at = spot(moved(first), moved(last), backwards, within(view, boxOf(f)), touch);
        return setMarked(at && { text, ...at });
      }
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return setMarked(null);
      const typing = document.activeElement;
      if ((typing instanceof HTMLTextAreaElement || typing instanceof HTMLInputElement) && b.contains(typing)) return setMarked(null);
      const r = sel.getRangeAt(0);
      const inside = (n: Node) => {
        const el = n instanceof Element ? n : n.parentElement;
        if (anywhere) return !!el && b.contains(el) && !el.closest('[contenteditable]');
        const m = el?.closest('.msg');
        return !!m && b.contains(m);
      };
      if (!inside(r.startContainer) || !inside(r.endContainer)) return setMarked(null);
      const text = citable(sel.toString());
      const lines = [...r.getClientRects()].filter((c) => c.width > 0);
      if (!text || !lines.length) return setMarked(null);
      const backwards = sel.anchorNode === r.endContainer && sel.anchorOffset === r.endOffset;
      const at = spot(boxOf(lines[0]!), boxOf(lines.at(-1)!), backwards, view, touch);
      setMarked(at && { text, ...at });
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && !(e.target as Element).closest?.('.cite')) {
        dragging = true;
        setMarked(null);
      }
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      place();
    };
    document.addEventListener('selectionchange', place);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    
    document.addEventListener('scroll', place, true);
    addEventListener('resize', place);
    onFramed.add(place);
    return () => {
      document.removeEventListener('selectionchange', place);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('scroll', place, true);
      removeEventListener('resize', place);
      onFramed.delete(place);
    };
  }, [box, anywhere]);
  if (!marked) return null;
  return createPortal(
    <Tooltip content={t.talk.citeHint}>
      <button
          className={cn(
            'fixed z-50 flex h-7 min-w-7 cursor-pointer items-center justify-center gap-1 rounded-xs bg-foreground px-1.5 py-0 text-sm text-background shadow-glass select-none hover:bg-foreground/85 pointer-coarse:h-9 pointer-coarse:min-w-9',
            
            !marked.below ? '[transform:translate(-50%,calc(-100%-6px))]' : marked.left ? '[transform:translate(calc(-100%+2px),6px)]' : '[transform:translate(-50%,6px)] pointer-coarse:[transform:translate(-50%,30px)]',
            citeHint.shown && 'pr-2 pl-2',
          )}
          style={{ left: marked.x, top: marked.y }} aria-label={t.talk.citeHint}
          
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (framed) unmarkFrame();
            else getSelection()?.removeAllRanges();
            setMarked(null);
            cite(draft, t.talk.cited(marked.text));
            onCite?.();
            citeHint.markSeen();
          }}
      >
        <Quote size={15} strokeWidth={2} aria-hidden="true" />
        <HintLabel hintId="cite">{t.talk.cite}</HintLabel>
      </button>
    </Tooltip>,
    document.body,
  );
}
