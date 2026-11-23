/**
 * Roles belong to Seismic; a harness supplies the coding loop.
 */
import { spawnSync } from 'node:child_process';
import { GIT } from '../../workstations';
import { messageOf } from '../../../core/text';
import { SEISMIC_PLUGIN } from '../../demo';
import { claudeConnected } from './claude';
import { codexConnected, createCodexRuntime } from './codex';
import { agyConnected, createAgyRuntime } from './agy';
import { seismicSkills } from '../skills/registry';
import { skillListing } from '../skills/attachedSkills';
import { sessionHarness, type AgentRuntime, type AgentSpec } from '../../runtime';
import { HARNESS_NAMES, HARNESSES, type Harness } from '../../../core/types';

/** Only Seismic's bundled plugin is portable here, by explicit file-based skill instructions. */
function portable(spec: AgentSpec, name: string): AgentSpec {
  if (spec.plugins?.some((p) => p !== SEISMIC_PLUGIN)) throw new Error(`${name} supports only the bundled Seismic skills`);
  if (spec.cwd.startsWith('ssh://')) throw new Error(`${name} sessions currently require a local directory`);
  if (spec.watch) throw new Error(`${name} does not yet support folder change tracking`);
  if (!spec.role || spec.role === 'worker' || spec.role === 'review') {
    const git = spawnSync(GIT, ['-C', spec.cwd, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', windowsHide: true });
    if (git.status !== 0 || git.stdout.trim() !== 'true') throw new Error(`${name} workers and code reviews require a local Git checkout`);
  }
  const skills = skillListing([...new Map([...seismicSkills(), ...(spec.skills ?? [])].map((s) => [s.name, s] as const)).values()]);
  const { plugins: _, skills: __, ...rest } = spec;
  return { ...rest, system: `${spec.system}\n\nSeismic skills are available as files, not Claude slash commands. Read the matching SKILL.md before using a skill, resolving its relative paths against its directory.\n${skills.join('\n')}\nUse the Seismic ask tool for owner questions, not a native terminal dialog.` };
}

/** The harnesses a worker could start in on this machine, each installed and signed in; checked anew at each call, all at once. */
export async function connectedHarnesses(connected: Record<Harness, () => Promise<boolean>> = { claude: claudeConnected, codex: codexConnected, agy: agyConnected }): Promise<Harness[]> {
  const ok = await Promise.all(HARNESSES.map((h) => connected[h]().catch(() => false)));
  return HARNESSES.filter((_, i) => ok[i]);
}

/**
 * The harnesses a worker could start in on this machine, as last found: by its own check (`connectedHarnesses`), or by the
 * setup assistant's (`set`), whichever started last; one that started earlier but answers later is older news and changes
 * nothing. Each harness goes by the check that last found it, as the setup assistant checks one harness at a time. A
 * caller never waits for a check: one older than `maxAge` starts the next in the background and gets what the last found
 * meanwhile (nothing before the first has answered).
 */
export class HarnessCheck {
  private found: Harness[] = [];
  /** When the check behind each harness's finding started, for its age. */
  private at: Record<Harness, number> = { claude: -Infinity, codex: -Infinity, agy: -Infinity };
  /** The checks in the order they started (`begin`), and the one behind each harness's finding: ties in time cannot reorder them. */
  private begun = 0;
  private behind: Record<Harness, number> = { claude: 0, codex: 0, agy: 0 };
  private running: Promise<Harness[]> | null = null;

  constructor(private check: () => Promise<Harness[]> = connectedHarnesses, private maxAge = 60_000, private now = Date.now) {}

  /** What the last check found; a stale one starts the next. */
  current(): Harness[] {
    if (this.now() - Math.min(...HARNESSES.map((h) => this.at[h])) > this.maxAge) void this.refresh();
    return this.found;
  }

  /**
   * What the last check found, for a caller that must not wait on the CLIs (a check takes as long as
   * the slowest, `agy models` up to its 15 s limit); only before every harness has been found by
   * some check does it wait, for the check under way or a new one.
   */
  async known(): Promise<Harness[]> {
    return HARNESSES.every((h) => this.at[h] !== -Infinity) ? this.current() : this.refresh();
  }

  /** Checks again, or joins the check under way. */
  refresh(): Promise<Harness[]> {
    if (!this.running) {
      const check = this.begin();
      this.running = this.check()
        .then((found) => this.set(found, check), () => this.found)
        .finally(() => (this.running = null));
    }
    return this.running;
  }

  /** A check starts, its own or one elsewhere (the setup assistant's): what `set` takes to place its finding. */
  begin(): { order: number; at: number } {
    return { order: ++this.begun, at: this.now() };
  }

  /** What a check of the harnesses `of` found that began as `check`; for each, the one that began last stands, whichever answers first. */
  set(found: Harness[], check = this.begin(), of: readonly Harness[] = HARNESSES): Harness[] {
    const placed = of.filter((h) => check.order >= this.behind[h]);
    for (const h of placed) {
      this.behind[h] = check.order;
      this.at[h] = check.at;
    }
    this.found = HARNESSES.filter((h) => (placed.includes(h) ? found.includes(h) : this.found.includes(h)));
    return this.found;
  }
}

/** Harnesses by name, for a prompt; `own` (the harness asking) where none is known, as it runs at least. */
export const harnessNames = (own: Harness, found: Harness[]) => (found.length ? found : [own]).map((h) => HARNESS_NAMES[h]);

export function harnessRuntime(claude: AgentRuntime, codex: AgentRuntime = createCodexRuntime(), agy: AgentRuntime = createAgyRuntime(), configured?: () => readonly Harness[] | undefined): AgentRuntime {
  return {
    start(spec, firstMessage, images) {
      try {
        const harness = spec.setting?.harness ?? 'claude';
        if (spec.resume && sessionHarness(spec.resume) !== harness) throw new Error('Saved session and configured harness disagree; refusing cross-harness resume');
        if (!spec.resume && configured?.()?.includes(harness) === false) throw new Error(`Connect ${HARNESS_NAMES[harness]} in Configuration → Harnesses to start this agent.`);
        if (harness === 'claude') return claude.start(spec, firstMessage, images);
        const backend = harness === 'agy' ? agy : codex;
        return backend.start(portable(spec, HARNESS_NAMES[harness]), firstMessage, images);
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
