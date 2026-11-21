import { dimensions } from '../../../core/page-tags';
import type { PageTags } from '../../../core/types';

/** What writes the page on which a demo is shared, with the tags it lacks where there are some. */
export const writeDemoPageSystem = (language: string, lacking: PageTags | null) => `You write the page on which the demo of a change (a video, or a page with charts or an analysis) is shared with colleagues of the team. They have never seen the tool the change was planned in, its cards or plan docs; they know the product. Read the card's task and its worker's summary, and call the tool page once with:
- title: what changes, for a user of the product, in a few words (not the card's internal wording).
- text: two to five sentences in ${language}: what changes for the user and why. No findings, no test details, no internal process (cards, workers, demos, reviews), no markdown.${
  lacking
    ? `
- tags: for each of these dimensions, the values that fit the change (an empty list where none does), from these alone:
${dimensions(lacking)
  .map(([d, v]) => `  - ${d}: ${v.join(', ')}`)
  .join('\n')}`
    : ''
}
Then end your turn. Read code only if the summary leaves unclear what the change does for the user.`;
