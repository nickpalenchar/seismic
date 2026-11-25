



import type { SeismicSkill } from './seismicSkill';

/** The plugin directories to load for these skills, each once. */
export function skillPlugins(skills: SeismicSkill[] = []): string[] {
  return [...new Set(skills.flatMap((s) => (s.plugin ? [s.plugin] : [])))];
}

/** One line per skill for a system prompt: its name, what it does, and where to read it (or the text itself when it has no file). */
export function skillListing(skills: SeismicSkill[] = []): string[] {
  return skills.map((s) => `- ${s.name}: ${s.description}\n  ${s.file ?? s.getInstructions()}`);
}
