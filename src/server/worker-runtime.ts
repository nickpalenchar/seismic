// Roles belong to Seismic; a harness supplies the coding loop. Local workers roll out first.
import { spawnSync } from 'node:child_process';
import { GIT } from './workstations';
import { messageOf } from '../core/text';
import { OBEYA_PLUGIN } from './demo';
import { createCodexRuntime } from './codex-runtime';
import { createAgyRuntime } from './agy-runtime';
import { bundledSkills } from './skills';
import type { AgentRuntime, AgentSpec } from './runtime';
import { choosesHarness } from '../core/types';

/** Only Seismic's bundled plugin is portable here, by explicit file-based skill instructions. */
function portable(spec: AgentSpec, name = 'Codex'): AgentSpec {
  if (spec.permissionMode && !['auto', 'default'].includes(spec.permissionMode)) throw new Error(`${name} cannot apply Claude permission mode ${spec.permissionMode}`);
  if (spec.plugins?.some((p) => p !== OBEYA_PLUGIN)) throw new Error(`${name} supports only the bundled Seismic skills`);
  if (spec.cwd.startsWith('ssh://')) throw new Error(`${name} workers currently require a local Git workstation`);
  if (spec.watch) throw new Error(`${name} workers do not yet support folders without Git`);
  const git = spawnSync(GIT, ['-C', spec.cwd, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', windowsHide: true });
  if (git.status !== 0 || git.stdout.trim() !== 'true') throw new Error(`${name} workers currently require a local Git workstation`);
  const skills = bundledSkills().map((s) => `- ${s.name}: ${s.description}\n  ${s.file}`);
  const { plugins: _, permissionMode: __, ...rest } = spec;
  return { ...rest, system: `${spec.system}\n\nSeismic skills are available as files, not Claude slash commands. Read the matching SKILL.md before using a skill, resolving its relative paths against its directory.\n${skills.join('\n')}\nUse the Seismic ask tool for owner questions, not a native terminal dialog.` };
}

export function workerHarnessRuntime(claude: AgentRuntime, codex: AgentRuntime = createCodexRuntime(), agy: AgentRuntime = createAgyRuntime()): AgentRuntime {
  return {
    start(spec, firstMessage, images) {
      try {
        const harness = spec.setting?.harness ?? 'claude';
        const owner = spec.resume?.startsWith('codex:') ? 'codex' : spec.resume?.startsWith('agy:') ? 'agy' : 'claude';
        if (spec.resume && owner !== harness) throw new Error('Saved session and worker harness disagree; refusing cross-harness resume');
        if (harness === 'claude') return claude.start(spec, firstMessage, images);
        if (harness === 'agy') {
          if (!spec.role || !choosesHarness(spec.role)) throw new Error('Antigravity is currently available only for card workers and code reviews');
          return agy.start(portable(spec, 'Antigravity'), firstMessage, images);
        }
        if (!spec.role || !choosesHarness(spec.role)) throw new Error('Codex is currently available only for card workers and code reviews');
        return codex.start(portable(spec), firstMessage, images);
      } catch (error) {
        // Orchestration attaches the returned session before observing startup errors, just as it
        // does for SDK login/configuration failures. A failed startup must not leave a busy ghost:
        // the session ended with its error, so the card goes to the owner rather than staying at work.
        let closed = false;
        const done = Promise.resolve().then(() => {
          if (closed) return;
          spec.onEvent({ type: 'error', message: messageOf(error), ended: true });
          spec.onEvent({ type: 'idle' });
        });
        return { send() {}, close() { closed = true; }, done };
      }
    },
  };
}
