/**
 * A skill of Seismic's bundled plugin: `plugin/skills/<dir>/SKILL.md`, its front matter naming and
 * describing it, the rest being the instructions.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OBEYA_PLUGIN, PLUGIN_NAME } from '../../demo';
import { SeismicSkill } from './seismicSkill';

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export class PluginSkill extends SeismicSkill {
  readonly name: string;
  readonly description: string;
  override readonly hint?: string;
  override readonly plugin: string;
  override readonly file: string;
  private instructions?: string;

  constructor(dir: string, plugin = OBEYA_PLUGIN) {
    super();
    this.plugin = plugin;
    this.file = join(plugin, 'skills', dir, 'SKILL.md');
    this.name = `${PLUGIN_NAME}:${dir}`;
    const meta = this.header();
    this.description = (meta.description ?? '').split('\n')[0]!.trim();
    this.hint = meta['argument-hint'];
  }

  private header(): { description?: string; 'argument-hint'?: string } {
    const m = readFileSync(this.file, 'utf8').match(FRONT_MATTER);
    return m ? (Bun.YAML.parse(m[1]!) as { description?: string; 'argument-hint'?: string }) : {};
  }

  /** The file without its front matter. */
  getInstructions(): string {
    return (this.instructions ??= readFileSync(this.file, 'utf8').replace(FRONT_MATTER, '').trim());
  }
}
