// A command of the `app` of a repository's settings (`stop`, `keep`), run in a workspace by Seismic itself (design: Parking).

import { remote } from './hosts';
import { messageOf } from '../core/text';
import { spawnOutput } from './spawn';

/** An app's stop takes seconds; one that hangs this long counts as failed. */
const APP_TIMEOUT = 2 * 60_000;

/** Runs `command` through the platform's shell in `cwd` (there, for a workspace on another machine): whether it exited 0, and what it printed. */
export async function runAppCommand(cwd: string, command: string, timeout = APP_TIMEOUT): Promise<{ ok: boolean; output: string }> {
  const there = remote(cwd);
  if (there) {
    const r = await there.host.run(command, { cwd: there.path, timeout });
    return { ok: r.code === 0, output: `${r.stdout}${r.stderr}`.trim() || (r.code === 0 ? '' : `exit code ${r.code}`) };
  }
  const shell = process.platform === 'win32' ? ['cmd.exe', '/d', '/s', '/c', command] : ['sh', '-c', command];
  try {
    const r = await spawnOutput(shell, { cwd, stdin: 'ignore', timeout });
    return { ok: r.code === 0, output: `${r.stdout}${r.stderr}`.trim() || (r.code === 0 ? '' : r.signal ? `stopped (${r.signal})` : `exit code ${r.code}`) };
  } catch (e) {
    return { ok: false, output: messageOf(e) };
  }
}
