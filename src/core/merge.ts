import type { Merge } from './types';

/** The preview belongs to its comparison, never to the card's current question ordering.
 * Older completed results can recover the text from their recorded inputs. Older retained
 * results without those inputs cannot, and return undefined rather than inventing text.
 */
export function mergeQuestionTexts(merge: Pick<Merge, 'followUp' | 'compared'>): string[] | undefined {
  const followUp = merge.followUp;
  if (!followUp) return undefined;
  if (followUp.questionTexts !== undefined) return followUp.questionTexts;
  if (!followUp.questions.length) return [];
  try {
    const questions: unknown = JSON.parse(merge.compared!.left)[3];
    if (!Array.isArray(questions)) return undefined;
    const texts = followUp.questions.map((n) => questions[n]?.text);
    if (texts.every((text) => typeof text === 'string')) return texts;
  } catch { /* No usable snapshot in older saved comparisons. */ }
  return undefined;
}
