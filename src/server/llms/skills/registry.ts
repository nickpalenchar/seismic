/**
 * Every skill the plugin ships: one line each. An agent that wants a skill by name imports its
 * instance; code that needs all of them (the listing for harnesses that cannot load the plugin, the
 * card's skill list) reads this. A skill is added with its folder, its instance file and a line here;
 * the test fails when a folder has none.
 */
import { existsSync } from 'node:fs';
import { browserSkill } from './browser';
import { demoSkill } from './demo';
import { labelsSkill } from './labels';
import type { SeismicSkill } from './seismicSkill';
import { settingsSkill } from './settings';
import { titlesSkill } from './titles';

export const SEISMIC_SKILLS: readonly SeismicSkill[] = [browserSkill, demoSkill, labelsSkill, settingsSkill, titlesSkill];

/** The skills whose files are there: a damaged plugin lists what is left (`checkPlugin` names the fault). */
export const seismicSkills = (skills: readonly SeismicSkill[] = SEISMIC_SKILLS): SeismicSkill[] => skills.filter((s) => existsSync(s.file));
