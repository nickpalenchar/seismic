/**
 * The base class of the skills Seismic ships: instructions an agent reads on demand. A subclass says
 * where they come from; an agent lists the skills it uses in `SeismicAgent.getSkills()` and each
 * harness attaches them its own way (`attachedSkills.ts`): Claude loads the plugin, the others are
 * told the file.
 */
import type { Skill } from '../../../core/types';

export abstract class SeismicSkill {
  /** As an agent invokes it: `seismic:labels`. */
  abstract readonly name: string;
  /** What it does and when to use it, as the skill's own file says. */
  abstract readonly description: string;
  /** What to write after the name (`<file>`), when it takes an argument. */
  readonly hint?: string;
  /** The Claude Code plugin directory the skill is part of, when it is part of one. */
  readonly plugin?: string;
  /** The file holding the instructions, when they are a file. */
  readonly file?: string;

  /** The instructions themselves, for a system prompt that carries them. */
  abstract getInstructions(): string;

  /** The skill as lists and the UI show it. */
  toListing(): Skill {
    return { name: this.name, description: this.description, ...(this.hint ? { hint: this.hint } : {}) };
  }
}
