import type { Label } from '../../../core/labels';
import { labelsGuide, labelWords } from '../skills/labelSuggestion';

/** What judges the labels of a card that has its title already. */
export const labelsSystem = (labels: Label[]) =>
  `You label a card on Seismic, a project on which the owner directs coding agents: its title, text and screenshots are below. Give its ${labelWords(labels)} with the tool labels, judged as the guide below says, from the card alone, without reading files. Then end your turn.\n\n${labelsGuide()}`;
