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

/** What a file's whole text is, once asked: its two versions, or `none` where it has no text to show (too big, binary, no earlier version). */
type Whole = { oldFile: { name: string; contents: string }; newFile: { name: string; contents: string } } | 'none' | null;

export default function CodeDiff({ part, card, style }: { part: DiffPart; card: string; style: DiffStyle }) {
  const look = useLook();
  // the same object across renders: expanding fills it in with the whole file
  const fileDiff = useMemo<FileDiffMetadata | undefined>(() => parsePatchFiles(part.lines.join('\n')).flatMap((p) => p.files)[0], [part]);
  const changed = fileDiff?.type === 'change' || fileDiff?.type === 'rename-changed';
  // The library offers to expand only with a loader, so a file is offered it once its whole text is
  // known to be there: asked for as the file comes near the screen, and a file whose text cannot be
  // shown keeps its folded lines as plain text.
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
        api.versions(card, fileDiff.name).then(
          (v) => !gone && setWhole(v && v.old !== null && v.new !== null ? { oldFile: { name: fileDiff.prevName ?? fileDiff.name, contents: v.old }, newFile: { name: fileDiff.name, contents: v.new } } : 'none'),
          () => !gone && setWhole('none'),
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
      ...(whole && whole !== 'none' ? { loadDiffFiles: async () => whole } : {}),
    }),
    [look, style, whole],
  );
  if (!fileDiff) return null;
  return (
    <div ref={box}>
      <PierreDiff fileDiff={fileDiff} options={options} />
    </div>
  );
}
