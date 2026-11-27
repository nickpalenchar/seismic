

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CODEX_RULES_HEADER } from './allowRules';

const generatedHeaders = [
  CODEX_RULES_HEADER,
  '# Generated from .claude/settings.json by `bun scripts/codex-rules.ts`; edit that file, not this one.',
  '# Generated from .claude/settings.json by the `allow-list.ts --codex` of the skill `seismic:settings`; edit that file, not this one.',
];

export function isGeneratedCodexRules(current: string): boolean {
  const [header = ''] = current.split(/\r?\n/, 1);
  return generatedHeaders.includes(header);
}

export function writeCodexRules(out: string, file: string): 'wrote' | 'preserved' {
  if (existsSync(out)) {
    const current = readFileSync(out, 'utf8');
    if (!isGeneratedCodexRules(current)) return 'preserved';
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, file);
  return 'wrote';
}
