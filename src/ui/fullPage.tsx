// A main-area view stays mounted underneath an unfolded card. The canvas camera stays intact.
import { createContext, useContext, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function useFullPage<Id extends string>() {
  const [active, render] = useState<Id | null>(null);
  const ref = useRef(active);
  return { active, ref, show: (id: Id | null) => { ref.current = id; render(id); } };
}

const MainArea = createContext<HTMLDivElement | null>(null);

/** The project root owns the dock offsets. Portal here so every full-page view inherits them. */
export function FullPageHost({ children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return <div {...props} ref={setHost}><MainArea.Provider value={host}>{children}</MainArea.Provider></div>;
}

export function FullPage({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const host = useContext(MainArea);
  return host && createPortal(<div id={id} className="full-page" role="dialog" aria-label={title}>{children}</div>, host);
}
