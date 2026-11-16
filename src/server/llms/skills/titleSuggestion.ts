import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OBEYA_PLUGIN } from '../../demo';

let guide: string | undefined;
/** The title skill's instructions, shared by the plugin and the automatic naming session. */
export function titlesGuide(): string {
  return (guide ??= readFileSync(join(OBEYA_PLUGIN, 'skills', 'titles', 'SKILL.md'), 'utf8')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .trim());
}
