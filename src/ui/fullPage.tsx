// A main-area view stays mounted underneath an unfolded card. The canvas camera stays intact.
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function useFullPage<Id extends string>() {
  const [active, render] = useState<Id | null>(null);
  const ref = useRef(active);
  return { active, ref, show: (id: Id | null) => { ref.current = id; render(id); } };
}

export function FullPage({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return createPortal(<div id={id} className="full-page" role="dialog" aria-label={title}>{children}</div>, document.body);
}
