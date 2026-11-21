import type { Label } from '../../../core/labels';
import { labelsSkill } from '../skills/labels';
import { labelWords } from '../skills/labelSuggestion';
import { titlesSkill } from '../skills/titles';

/** What names a card the owner left without a title, with the labels left to suggest judged in the same call. */
export const nameSystem = (language: string, labels: Label[] = []) =>
  `You name a card on Seismic, a project on which the owner directs coding agents. The owner wrote the card's task (below) without a title. Give it one with the tool title, following the naming guide below, in ${language} unless an explicit standing preference names another language. The task's language does not change the title's language.${labels.length ? ` In the same call, give its ${labelWords(labels)}, judged as the labels guide below says.` : ''} Then end your turn.\n\n${titlesSkill.getInstructions()}${labels.length ? `\n\n${labelsSkill.getInstructions()}` : ''}`;
