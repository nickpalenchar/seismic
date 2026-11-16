import { titlesSkill } from '../../agents/skills/titles';

/**
 * The title skill's instructions, shared by the plugin and the automatic naming session.
 * @deprecated use `titlesSkill.getInstructions()` (`src/server/agents/skills/titles.ts`).
 */
export const titlesGuide = (): string => titlesSkill.getInstructions();
