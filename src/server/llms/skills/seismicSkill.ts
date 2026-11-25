








import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Skill } from '../../../core/types';
import { PLUGIN_NAME, SEISMIC_PLUGIN } from '../../demo';

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const DESCRIPTION_MAX = 200;

export class SeismicSkill {
  
  readonly name: string;
  
  readonly plugin: string;
  
  readonly file: string;
  private meta?: { description?: string; 'argument-hint'?: string };
  private instructions?: string;

  constructor(dir: string, plugin = SEISMIC_PLUGIN) {
    this.plugin = plugin;
    this.file = join(plugin, 'skills', dir, 'SKILL.md');
    this.name = `${PLUGIN_NAME}:${dir}`;
  }

  private header() {
    if (this.meta) return this.meta;
    const m = readFileSync(this.file, 'utf8').match(FRONT_MATTER);
    return (this.meta = m ? (Bun.YAML.parse(m[1]!) as { description?: string; 'argument-hint'?: string }) : {});
  }

  /** What it does and when to use it: the first line of the skill's own description. */
  get description(): string {
    const line = (this.header().description ?? '').trim().split('\n')[0]!.trim();
    return line.length > DESCRIPTION_MAX ? `${line.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : line;
  }

  /** What to write after the name (`<file>`), when it takes an argument. */
  get hint(): string | undefined {
    return this.header()['argument-hint'];
  }

  /** The file without its front matter, for a system prompt that carries it. */
  getInstructions(): string {
    return (this.instructions ??= readFileSync(this.file, 'utf8').replace(FRONT_MATTER, '').trim());
  }

  /** The skill as lists and the UI show it. */
  toListing(): Skill {
    return { name: this.name, description: this.description, ...(this.hint ? { hint: this.hint } : {}) };
  }
}
