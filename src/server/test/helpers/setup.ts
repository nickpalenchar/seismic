

import { afterAll, setDefaultTimeout } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTemplates } from './testing';



setDefaultTimeout(30_000);




const RUN = 'seismic-test-';
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};
for (const name of readdirSync(tmpdir())) {
  const pid = Number(name.startsWith(RUN) && name.slice(RUN.length).split('-')[0]);
  if (pid && !alive(pid)) rmSync(join(tmpdir(), name), { recursive: true, force: true });
}
const run = mkdtempSync(join(tmpdir(), `${RUN}${process.pid}-`));

process.env.TMPDIR = process.env.TEMP = process.env.TMP = run;



if (process.env.CLAUDE_CONFIG_DIR) process.env.SEISMIC_MACHINE_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
const claude = (process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'seismic-claude-')));

afterAll(() => {
  removeTemplates();
  rmSync(claude, { recursive: true, force: true });
  rmSync(run, { recursive: true, force: true });
});
