









import type { DemoKind } from './types';

export interface PageChange {
  
  id: string;
  
  kinds: readonly DemoKind[];
  



  tagged?: true;
}

export const PAGE_CHANGES = [
  { id: '2026-10-10-look', kinds: ['video', 'html'] },
  { id: '2026-10-16-alone', kinds: ['html'] },
  { id: '2026-10-16-offline', kinds: ['html'] },
  { id: '2026-10-19-credit', kinds: ['video', 'html'] },
  { id: '2026-10-20-by', kinds: ['video', 'html'] },
  { id: '2026-10-20-inline', kinds: ['html'] },
  { id: '2026-10-28-tags', kinds: ['video', 'html'], tagged: true },
  { id: '2026-10-30-commit', kinds: ['video', 'html'] },
  { id: '2026-10-30-steady', kinds: ['html'] },
  { id: '2026-11-02-images', kinds: ['html'] },
  { id: '2026-11-06-seismic', kinds: ['video', 'html'] },
  { id: '2026-11-06-theme', kinds: ['video', 'html'] },
  { id: '2026-11-07-inter', kinds: ['video', 'html'] },
  { id: '2026-11-11-close-icon', kinds: ['html'] },
  { id: '2026-11-11-domain', kinds: ['video', 'html'] },
] as const satisfies readonly PageChange[];

export type KnownChange = (typeof PAGE_CHANGES)[number];
export type PageChangeId = KnownChange['id'];






export const THEME_CHANGED = 'theme';

export type OutdatedBy = PageChangeId | typeof THEME_CHANGED;


export const PAGES_HASH = { video: 'd9246994a3dd', html: '3b23512757fe', stacked: 'e722ffe8ae02' };

/** The version a page published now gets: the newest change; '' while there is none. */
export const pagesVersion = (changes: readonly PageChange[] = PAGE_CHANGES): string => changes.at(-1)?.id ?? '';

/**
 * The changes a page of the kind published with `version` lacks, oldest first. A version that is
 * not a change's ('' or none: published before them all) lacks every one of its kind.
 */
export function missedChanges<C extends PageChange>(version: string | undefined, kind: DemoKind, changes: readonly C[]): C[] {
  const after = changes.findIndex((c) => c.id === version);
  return changes.slice(after + 1).filter((c) => c.kinds.includes(kind) && !c.tagged);
}
