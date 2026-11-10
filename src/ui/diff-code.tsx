// A file's diff drawn by @pierre/diffs: syntax highlighting, word-level marks, split or unified, and
// the unchanged lines around the hunks expandable. It comes from the patch, so a diff opens as fast as
// the patch is there; the whole old and new file are fetched only when the owner expands. This
// module (with Shiki and its languages) is loaded when a diff first opens, never with the page.

import { type FileDiffMetadata, parsePatchFiles } from '@pierre/diffs';
import { FileDiff as PierreDiff } from '@pierre/diffs/react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { DiffPart } from '../core/diff';
import { api } from './api';
import type { DiffStyle } from './diffStyle';

/** `light` or `dark` as the page shows it now: the owner's choice on the page's root, else the system's. */
function useLook(): 'light' | 'dark' {
  return useSyncExternalStore(
    (notify) => {
      const watch = new MutationObserver(notify);
      watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      const system = matchMedia('(prefers-color-scheme: dark)');
      system.addEventListener('change', notify);
      return () => {
        watch.disconnect();
        system.removeEventListener('change', notify);
      };
    },
    () => {
      const chosen = document.documentElement.dataset.theme;
      return chosen === 'dark' || chosen === 'light' ? chosen : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    },
  );
}

const THEMES = { light: 'github-light', dark: 'github-dark' } as const;

/** Whether a file's whole text can be shown: `null` until asked. */
type Whole = boolean | null;

export default function CodeDiff({ part, card, style }: { part: DiffPart; card: string; style: DiffStyle }) {
  const look = useLook();
  // the same object across renders: expanding fills it in with the whole file
  const fileDiff = useMemo<FileDiffMetadata | undefined>(() => parsePatchFiles(part.lines.join('\n')).flatMap((p) => p.files)[0], [part]);
  const changed = fileDiff?.type === 'change' || fileDiff?.type === 'rename-changed';
  // The library offers to expand only with a loader, so a file is offered it once its whole text is
  // known to be there: a probe, as the file comes near the screen, carries no file; the files
  // themselves are fetched when the owner expands. A file whose text cannot be shown keeps its folded
  // lines as plain text.
  const [whole, setWhole] = useState<Whole>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || !fileDiff || !changed) return;
    let gone = false;
    const look = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        look.disconnect();
        api.hasVersions(card, fileDiff.name).then(
          (ok) => !gone && setWhole(ok),
          () => !gone && setWhole(false),
        );
      },
      { rootMargin: '600px' },
    );
    look.observe(el);
    return () => {
      gone = true;
      look.disconnect();
    };
  }, [fileDiff, card, changed]);
  const options = useMemo(
    () => ({
      theme: THEMES,
      themeType: look,
      diffStyle: style,
      disableFileHeader: true,
      // signs, not coloured bars down the side
      diffIndicators: 'classic' as const,
      hunkSeparators: 'line-info' as const,
      overflow: 'wrap' as const,
      lineDiffType: 'word-alt' as const,
      ...(whole
        ? {
            loadDiffFiles: async (f: FileDiffMetadata) => {
              const v = await api.versions(card, f.name);
              if (!v || v.old === null || v.new === null) throw new Error('no whole file to show');
              return { oldFile: { name: f.prevName ?? f.name, contents: v.old }, newFile: { name: f.name, contents: v.new } };
            },
          }
        : {}),
    }),
    [look, style, card, whole],
  );
  if (!fileDiff) return null;
  return (
    <div ref={box}>
      <PierreDiff fileDiff={fileDiff} options={options} />
    </div>
  );
}
