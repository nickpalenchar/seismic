/** What the sessions that choose a demo page's tags share: the tool's field text and schema, and what is kept of the answer. */
import { z } from 'zod';
import { dimensions } from '../../../../core/page-tags';
import type { PageTags } from '../../../../core/types';

export const TAGS_FIELD = 'for each dimension, the values that fit (an empty list where none does), only from the values given for it';

export const tagsSchema = (lacking: PageTags) =>
  z
    .record(z.string(), z.array(z.string()))
    .describe(
      dimensions(lacking)
        .map(([d, v]) => `${d}: ${v.join(', ')}`)
        .join('; '),
    );

/** The tags a session gave, kept to the dimensions and values asked for; a dimension it left out has none. */
export function picked(given: unknown, lacking: PageTags): PageTags {
  const g = (given && typeof given === 'object' ? given : {}) as Record<string, unknown>;
  return Object.fromEntries(dimensions(lacking).map(([d, values]) => [d, values.filter((v) => Array.isArray(g[d]) && (g[d] as unknown[]).includes(v))]));
}
