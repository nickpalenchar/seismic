











import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isMain } from './here.ts';
import { conversationLanguageIn } from './language.ts';
import { allowsDemo, HANDOVER_ARTIFACTS, type HandoverArtifact } from './artifacts.ts';
import { type Language, LANGUAGE_NAMES, LANGUAGES } from './locale.ts';


export type NarrationLanguage = Language;





export const VOICES = ['piper', 'qwen3', 'say', 'command', 'http', 'gemini', 'openai', 'elevenlabs', 'azure'] as const;
export type VoiceKind = (typeof VOICES)[number];

export const SERVICES = ['gemini', 'openai', 'elevenlabs', 'azure'] as const satisfies readonly VoiceKind[];

export interface DemoSettings {
  
  language: NarrationLanguage;
  
  voice: VoiceKind;
  



  ownVoice?: boolean;
  
  command?: string;
  
  url?: string;
  
  voiceName?: string;
  




  references?: Partial<Record<NarrationLanguage, string>>;
  



  style?: string;
  
  keyFile?: string;
  
  directory?: string;
  



  keepFrames?: number | 'always';
  



  artifacts?: HandoverArtifact[];
}

export const DEFAULT_DEMO_SETTINGS: DemoSettings = { language: 'en', voice: 'piper' };
export const DEMO_SETTINGS_FILE = 'demo.json';
export const DEFAULT_DEMO_DIRECTORY = '~/demos';

/** Seismic's home, where its settings live. */
export function seismicHome(): string {
  return (process.env.SEISMIC_HOME ?? process.env.OBEYA_HOME) || path.join(os.homedir(), fs.existsSync(path.join(os.homedir(), '.seismic')) ? '.seismic' : '.obeya');
}

export const expandHome = (p: string) => p.replace(/^~(?=$|[\\/])/, os.homedir());

/** Whether a demo directory names a place of its own: absolute, or from `~`; a relative one would land wherever the agent works. */
export const absoluteDirectory = (dir: string) => path.isAbsolute(expandHome(dir));

/** The directory demos go into on this machine: the settings', else `~/demos`; one that is not absolute counts as not set. */
export function demoDirectory(s: Pick<DemoSettings, 'directory'> = readDemoSettings()): string {
  return path.resolve(expandHome(s.directory && absoluteDirectory(s.directory) ? s.directory : DEFAULT_DEMO_DIRECTORY));
}

const TEXT_FIELDS = ['command', 'url', 'voiceName', 'style', 'keyFile', 'directory'] as const;

/**
 * Keeps what is a valid setting, drops the rest; trims texts and leaves out empty ones. The one clip
 * a file from before `references` names (`reference`) is the clip of its language.
 */
export function tidyDemoSettings(input: unknown, fallbackLanguage: NarrationLanguage = DEFAULT_DEMO_SETTINGS.language): DemoSettings {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const language = LANGUAGES.find((l) => l === o.language) ?? fallbackLanguage;
  const voice = VOICES.find((v) => v === o.voice) ?? DEFAULT_DEMO_SETTINGS.voice;
  const out: DemoSettings = { language, voice };
  if (o.ownVoice === true) out.ownVoice = true;
  for (const k of TEXT_FIELDS) {
    const v = str(o[k]);
    if (v) out[k] = v;
  }
  const given = (o.references && typeof o.references === 'object' ? o.references : { [language]: o.reference }) as Record<string, unknown>;
  const references = Object.fromEntries(LANGUAGES.flatMap((l) => (str(given[l]) ? [[l, str(given[l])]] : [])));
  if (Object.keys(references).length) out.references = references;
  if (o.keepFrames === 'always' || (typeof o.keepFrames === 'number' && Number.isInteger(o.keepFrames) && o.keepFrames > 0)) out.keepFrames = o.keepFrames;
  const artifacts = tidyArtifacts(o.artifacts);
  if (artifacts) out.artifacts = artifacts;
  return out;
}

/** The artifacts of a list that are known, once each in their order; none where the list leaves no demo possible. */
export function tidyArtifacts(v: unknown): HandoverArtifact[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const list = HANDOVER_ARTIFACTS.filter((a) => v.includes(a));
  return allowsDemo(list) ? list : undefined;
}

/** The clip a Qwen3 voice clones for the narration language of these settings; none: a speaker. */
export const referenceOf = (s: Pick<DemoSettings, 'language' | 'references'>): string | undefined => s.references?.[s.language];

/** The settings as saved, or the defaults where nothing is: then the narration is in the owner's conversation language. */
export function readDemoSettings(home = seismicHome()): DemoSettings {
  const file = path.join(home, DEMO_SETTINGS_FILE);
  const language = conversationLanguageIn(home);
  if (!fs.existsSync(file)) return { ...DEFAULT_DEMO_SETTINGS, language };
  try {
    return tidyDemoSettings(JSON.parse(fs.readFileSync(file, 'utf8')), language);
  } catch {
    return { ...DEFAULT_DEMO_SETTINGS, language };
  }
}


export type LanguageSource = 'seismic' | 'repository';

/**
 * The language a repository names for its demos (`demo.language` of its settings): from Seismic,
 * which gives its workers the one of their card's repository as `DEMO_LANGUAGE`, else from the
 * `.seismic/settings.json` (else `.obeya/`) of the repository the directory `cwd` is in. None where neither names one.
 */
export function repositoryLanguage(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): { language: NarrationLanguage; from: LanguageSource; file?: string } | undefined {
  const given = LANGUAGES.find((l) => l === env.DEMO_LANGUAGE);
  if (given) return { language: given, from: 'seismic' };
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      
      const file = ['.seismic', '.obeya'].map((d) => path.join(dir, d, 'settings.json')).find((f) => fs.existsSync(f)) ?? path.join(dir, '.seismic', 'settings.json');
      try {
        const language = LANGUAGES.find((l) => l === (JSON.parse(fs.readFileSync(file, 'utf8')) as { demo?: { language?: unknown } }).demo?.language);
        return language ? { language, from: 'repository', file } : undefined;
      } catch {
        return undefined;
      }
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** The settings of a demo of the repository: those saved, in the language the repository names for its demos, if it names one. */
export function inLanguage(s: DemoSettings, language: NarrationLanguage | undefined): DemoSettings {
  return language && language !== s.language ? { ...s, language } : s;
}

/** The settings a demo rendered here is narrated with: those saved, in the language of the repository (`repositoryLanguage`). */
export const demoSettingsHere = (home = seismicHome()): DemoSettings => inLanguage(readDemoSettings(home), repositoryLanguage()?.language);

export function writeDemoSettings(settings: DemoSettings, home = seismicHome()) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, DEMO_SETTINGS_FILE), `${JSON.stringify(tidyDemoSettings(settings), null, 2)}\n`);
}

/**
 * The settings with the voice of one render: `DEMO_VOICE` names a provider (its other settings
 * as saved) or a `.wav` to clone with Qwen3-TTS.
 */
export function withVoice(s: DemoSettings, voice: string | undefined): DemoSettings {
  if (!voice || voice === s.voice) return s;
  if (voice.endsWith('.wav')) return { language: s.language, voice: 'qwen3', references: { [s.language]: voice } };
  const kind = VOICES.find((v) => v === voice);
  if (!kind) throw new Error(`unknown voice "${voice}"; use ${VOICES.join(', ')} or a .wav`);
  
  const { ownVoice: _, ...rest } = s;
  return { ...rest, voice: kind };
}

/**
 * The narration speaks in the first person only in the owner's own voice; any other voice
 * presents the work without an "I". A Qwen3 clone without a clip for the language speaks with a
 * stock speaker, which is nobody's own.
 */
export function narrationPerson(s: Partial<DemoSettings>): 'first' | 'third' {
  if (!s.ownVoice) return 'third';
  return s.voice === 'qwen3' && !(s.language && s.references?.[s.language]) ? 'third' : 'first';
}

/** What the agent writing a narration needs to know, in a few lines; `repo` names the repository's language for its demos. */
export function describeDemoSettings(saved: DemoSettings, override: string | undefined = process.env.DEMO_VOICE, repo: ReturnType<typeof repositoryLanguage> = undefined): string {
  const s = withVoice(inLanguage(saved, repo?.language), override);
  const person = narrationPerson(s);
  const clip = referenceOf(s);
  return [
    `language: ${s.language} — write every \`say\` text, the chapter titles and the report in ${LANGUAGE_NAMES[s.language]}`,
    ...(repo?.from === 'repository'
      ? [`  (the repository's demo.language in ${repo.file}; render with DEMO_LANGUAGE=${repo.language} so the voice speaks it too)`]
      : repo
        ? [`  (the repository's demo.language, given by Seismic as DEMO_LANGUAGE)`]
        : []),
    person === 'first'
      ? `person: first — the voice is the owner's own, so the narration speaks as the owner ("I added …")`
      : `person: third — the voice is not the owner's, so the narration presents the work without "I" or "we" ("The card now shows …")`,
    `voice: ${s.voice}${s.voiceName ? ` (${s.voiceName})` : ''}${clip ? ` (clone of ${clip})` : ''}`,
    `from: ${path.join(seismicHome(), DEMO_SETTINGS_FILE)}${override ? ' (voice from DEMO_VOICE)' : ''}`,
    `directory: ${demoDirectory(saved)} — every demo goes into a directory of its own in it`,
  ].join('\n');
}

if (isMain(import.meta.filename)) {
  console.log(describeDemoSettings(readDemoSettings(), process.env.DEMO_VOICE, repositoryLanguage()));
}
