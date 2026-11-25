




import { query, type SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import type { Skill } from '../core/types';
import { cleanEnv, spawnHere } from './runtime';
import { claudeExecutable } from './llms/harnesses/claude';


export interface SkillPlace {
  cwd: string;
  
  plugins: string[];
  
  untrusted: boolean;
}


export type SkillLister = (place: SkillPlace) => Promise<Skill[]>;


const FRESH_MS = 2 * 60_000;

const ANSWER_MS = 20_000;

/**
 * The commands Claude Code lists that the owner may name: those of the repository, the user and
 * plugins, and of its own those that are skills (`/code-review`); not its controls of the session
 * (`/compact`, `/model`), which Seismic runs itself. Each name once, sorted.
 */
export function skillsOf(commands: SlashCommand[], skillNames: Set<string>): Skill[] {
  const byName = new Map<string, { skill: Skill; rank: number }>();
  for (const c of commands) {
    if ((c.builtin && !skillNames.has(c.name)) || byName.has(c.name)) continue;
    const skill = { name: c.name, description: firstLine(c.description), ...(c.argumentHint?.trim() ? { hint: c.argumentHint.trim() } : {}) };
    byName.set(c.name, { skill, rank: rank(c) });
  }
  return [...byName.values()].sort((a, b) => a.rank - b.rank || a.skill.name.localeCompare(b.skill.name)).map((s) => s.skill);
}

/**
 * Where a skill comes from, in the order the menu lists them: the repository's first, then the
 * user's, those of plugins, and Claude Code's own last. Claude Code marks the first two at the end of
 * the description.
 */
function rank(c: SlashCommand): number {
  const description = c.description.trim();
  if (description.endsWith('(project)')) return 0;
  if (description.endsWith('(user)')) return 1;
  return c.builtin ? 3 : 2;
}

/** What the menu shows of a description, on one line: its first line, clipped. */
function firstLine(text: string): string {
  const line = text.trim().split('\n')[0]!.trim();
  return line.length > DESCRIPTION_MAX ? `${line.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : line;
}

const DESCRIPTION_MAX = 200;

/** Asks Claude Code on this machine, with the machine's login and the user's settings. */
export const sdkSkills: SkillLister = async (place) => {
  const abort = new AbortController();
  const claude = claudeExecutable();
  
  const prompt = (async function* () {
    await new Promise((r) => abort.signal.addEventListener('abort', r));
  })() as AsyncIterable<never>;
  const q = query({
    prompt,
    options: {
      cwd: place.cwd,
      abortController: abort,
      ...(claude ? { pathToClaudeCodeExecutable: claude } : {}),
      spawnClaudeCodeProcess: spawnHere(() => {}),
      env: cleanEnv(),
      ...(place.plugins.length ? { plugins: place.plugins.map((path) => ({ type: 'local' as const, path })) } : {}),
      ...(place.untrusted ? { settingSources: ['user' as const] } : {}),
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<never>((_, fail) => (timer = setTimeout(() => fail(new Error('Claude Code did not list its skills')), ANSWER_MS)));
    
    const [commands, skills] = await Promise.race([Promise.all([q.supportedCommands(), q.reloadSkills().then((r) => r.skills)]), late]);
    return skillsOf(commands, new Set(skills.map((s) => s.name)));
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
};

/**
 * The skill lists by place, each asked once at a time and kept a while (`FRESH_MS`): opening a card
 * asks for them, and many cards share a repository. A list that fails is empty, and asked again next time.
 */
export class Skills {
  private known = new Map<string, { skills: Skill[]; at: number }>();
  private asking = new Map<string, Promise<Skill[]>>();

  constructor(
    private list: SkillLister = sdkSkills,
    private now = () => Date.now(),
  ) {}

  /** The skills at `place`: the list kept, asked afresh behind it once it is old; the first time, once Claude Code has answered. */
  of(place: SkillPlace): Promise<Skill[]> {
    const key = JSON.stringify([place.cwd, place.plugins, place.untrusted]);
    const kept = this.known.get(key);
    if (kept && this.now() - kept.at < FRESH_MS) return Promise.resolve(kept.skills);
    let asking = this.asking.get(key);
    if (!asking) {
      asking = this.list(place)
        .catch((e) => {
          console.error(`Seismic: Claude Code did not list the skills in ${place.cwd}: ${e instanceof Error ? e.message : String(e)}`);
          return null;
        })
        .then((skills) => {
          this.asking.delete(key);
          if (skills) this.known.set(key, { skills, at: this.now() });
          else this.known.delete(key);
          return skills ?? [];
        });
      this.asking.set(key, asking);
    }
    return kept ? Promise.resolve(kept.skills) : asking;
  }
}
