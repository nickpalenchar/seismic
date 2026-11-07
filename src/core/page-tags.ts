// Tags of a shared demo page, from the vocabulary its canvas names for its demo site: a
// few dimensions, each with its values, which workers and Seismic's reading session choose from and
// add nothing to. A page carries per dimension zero or more of its values; a dimension it has no
// key for has none chosen yet, and one holding a value the vocabulary no longer has counts as
// chosen by nobody either, so it is chosen again.
//
// A card's page takes each dimension from the first of these that has it: the owner's choice by
// hand, the newest of its demos whose worker gave it, Seismic's reading session.

import type { PageTags } from './types';

/** The vocabulary's dimensions that have values, in its order. */
export const dimensions = (vocabulary: PageTags | undefined): [string, string[]][] => Object.entries(vocabulary ?? {}).filter(([d, v]) => d.trim() && v.length);

/** Each dimension from the first layer that has it, highest first. */
export function pageTags(layers: (PageTags | undefined)[]): PageTags {
  const out: PageTags = {};
  for (const layer of layers) for (const [d, v] of Object.entries(layer ?? {})) if (!(d in out)) out[d] = v;
  return out;
}

/** The vocabulary's dimensions the tags have none chosen for, or hold a value it no longer has in. */
export function untagged(tags: PageTags, vocabulary: PageTags | undefined): string[] {
  return dimensions(vocabulary).flatMap(([d, values]) => (!tags[d] || tags[d]!.some((v) => !values.includes(v)) ? [d] : []));
}

/** What a page shows of its tags: each dimension of the vocabulary with the values it has, in the vocabulary's order; none where it has none. */
export function shownTags(tags: PageTags | undefined, vocabulary: PageTags | undefined): [string, string[]][] {
  return dimensions(vocabulary).flatMap(([d, values]) => {
    const on = values.filter((v) => tags?.[d]?.includes(v));
    return on.length ? [[d, on] as [string, string[]]] : [];
  });
}

/** The tags as the page carries them: the vocabulary's dimensions only, each with its values in the vocabulary's order. */
export function tagsOf(tags: PageTags | undefined, vocabulary: PageTags | undefined): PageTags {
  return Object.fromEntries(dimensions(vocabulary).flatMap(([d, values]) => (tags?.[d] ? [[d, values.filter((v) => tags[d]!.includes(v))]] : [])));
}

/** What of the tags is not in the vocabulary, as `dimension: value`; none where all is. */
export function outside(tags: PageTags, vocabulary: PageTags | undefined): string[] {
  const vocab = new Map(dimensions(vocabulary));
  return Object.entries(tags).flatMap(([d, values]) => (vocab.has(d) ? values.filter((v) => !vocab.get(d)!.includes(v)).map((v) => `${d}: ${v}`) : [`${d} (no such dimension)`]));
}

/** The vocabulary as the configuration writes it: a dimension per line, `Dimension: value, value`. */
export const tagLines = (vocabulary: PageTags | undefined) =>
  Object.entries(vocabulary ?? {})
    .map(([d, v]) => `${d}: ${v.join(', ')}`)
    .join('\n');

/** The vocabulary of `Dimension: value, value` lines; none for no line with a dimension and a value. */
export function parseTagLines(text: string): PageTags | undefined {
  const out: PageTags = {};
  for (const line of text.split('\n')) {
    const m = /^([^:]+):(.*)$/.exec(line);
    const d = m?.[1]!.trim();
    if (!d) continue;
    const values = [...new Set(m![2]!.split(',').map((v) => v.trim()).filter(Boolean))];
    if (values.length) out[d] = [...new Set([...(out[d] ?? []), ...values])];
  }
  return Object.keys(out).length ? out : undefined;
}
