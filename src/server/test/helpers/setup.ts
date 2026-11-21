// Preloaded by `bun test` (bunfig.toml): its hooks run once around all test files.

import { afterAll, setDefaultTimeout } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTemplates } from './testing';

// `bun test --parallel` runs a file per process, and git calls make a test several times slower under
// that load: Bun's 5 s default fails them. (bunfig.toml has no setting for it.)
setDefaultTimeout(30_000);

// Whatever the tests put in the temp directory goes into one of this run, removed after the run. A
// run that was killed (Seismic restarting stops its workers' test runs) never got there: the next run
// removes the directories of runs whose process is gone.
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
// TEMP and TMP are where Windows looks
process.env.TMPDIR = process.env.TEMP = process.env.TMP = run;

// the work retrospective looks for transcripts there: never the machine's own. The live tests need
// the machine's login from there, so they set it back while they run (from `SEISMIC_MACHINE_CLAUDE_CONFIG_DIR`).
if (process.env.CLAUDE_CONFIG_DIR) process.env.SEISMIC_MACHINE_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
const claude = (process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'seismic-claude-')));

afterAll(() => {
  removeTemplates();
  rmSync(claude, { recursive: true, force: true });
  rmSync(run, { recursive: true, force: true });
});
