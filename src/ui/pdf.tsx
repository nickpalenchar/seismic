




import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import { PDFJS_BASE as BASE } from '../core/files';
import { t } from './strings';


const MODULE = `${BASE}pdf.min.mjs`;
let loaded: Promise<typeof import('pdfjs-dist')> | undefined;

/** pdf.js, fetched at its first use. */
function pdfjs(): Promise<typeof import('pdfjs-dist')> {
  loaded ??= (import(MODULE) as Promise<typeof import('pdfjs-dist')>).then((m) => {
    m.GlobalWorkerOptions.workerSrc = `${BASE}pdf.worker.min.mjs`;
    return m;
  });
  loaded.catch(() => (loaded = undefined));
  return loaded;
}


const MAX_PIXELS = 12e6;

export function PdfPages({ url, title }: { url: string; title: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | 'failed' | null>(null);
  useEffect(() => {
    setDoc(null);
    let gone = false;
    let task: { destroy(): Promise<void> } | undefined;
    pdfjs()
      .then((m) => {
        if (gone) return;
        const opened = m.getDocument({ url, enableXfa: false, wasmUrl: `${BASE}wasm/`, standardFontDataUrl: `${BASE}standard_fonts/` });
        task = opened;
        return opened.promise;
      })
      .then((d) => !gone && d && setDoc(d), () => !gone && setDoc('failed'));
    return () => {
      gone = true;
      void task?.destroy();
    };
  }, [url]);
  if (doc === null) return <p className="hint" aria-busy="true">{t.files.loading}</p>;
  if (doc === 'failed') return <p className="hint">{t.files.failed}</p>;
  return (
    <div className="r-pdf-pages flex flex-col gap-2" role="document" aria-label={title}>
      {Array.from({ length: doc.numPages }, (_, i) => (
        <PdfPage key={i} doc={doc} n={i + 1} />
      ))}
    </div>
  );
}

/** Page `n`, as wide as the column; drawn once it comes near the screen, again when the width changes. */
function PdfPage({ doc, n }: { doc: PDFDocumentProxy; n: number }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  
  const [ratio, setRatio] = useState<number | 'failed'>();
  const [near, setNear] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let gone = false;
    doc.getPage(n).then((p) => {
      const v = p.getViewport({ scale: 1 });
      if (!gone) setRatio(v.width / v.height);
    }, () => !gone && setRatio('failed'));
    return () => {
      gone = true;
    };
  }, [doc, n]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const sees = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), { rootMargin: '100% 0px' });
    const sizes = new ResizeObserver(() => setWidth(el.clientWidth));
    sees.observe(el);
    sizes.observe(el);
    return () => {
      sees.disconnect();
      sizes.disconnect();
    };
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!near || !width || !c) return;
    let gone = false;
    let render: { cancel(): void } | undefined;
    doc.getPage(n).then((p) => {
      if (gone) return;
      const base = p.getViewport({ scale: 1 });
      let scale = (width * (window.devicePixelRatio || 1)) / base.width;
      scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (base.width * base.height)));
      const viewport = p.getViewport({ scale });
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      const task = p.render({ canvas: c, viewport });
      render = task;
      task.promise.catch(() => {});
    }, () => {});
    return () => {
      gone = true;
      render?.cancel();
    };
  }, [doc, n, near, width]);

  return (
    <div ref={box} className="r-pdf-page w-full border border-border rounded-xs bg-white overflow-hidden" aria-busy={ratio === undefined} style={typeof ratio === 'number' ? { aspectRatio: String(ratio) } : undefined}>
      <canvas ref={canvas} />
    </div>
  );
}
